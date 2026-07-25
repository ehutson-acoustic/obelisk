import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { basicSetup } from "codemirror";
import { Eye, FileCode } from "lucide-react";
import { useEffect, useRef } from "react";
import { frontmatterRemark, frontmatterSchema } from "../lib/frontmatter";
import type { Theme } from "../lib/theme";
import { buildToolbar } from "../lib/toolbar";
import type { EditorMode } from "../types";

// The light/dark half of Crepe's theme is swapped at runtime by lib/theme.ts;
// importing it here would bundle one variant and pin it.
import "@milkdown/crepe/theme/common/style.css";

type ViewProps = {
  value: string;
  readOnly?: boolean;
  cursor?: number;
  theme: Theme;
  onChange: (value: string) => void;
  onCursorChange: (pos: number) => void;
};

/**
 * Both views mount imperatively and own their own document state, so `value`
 * and `cursor` are only ever initial values. The parent forces a fresh mount
 * (via `key`) when the file or its on-disk revision changes.
 */

function Wysiwyg({ value, readOnly, cursor, onChange, onCursorChange }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursorChange;

  useEffect(() => {
    if (!host.current) return;
    const crepe = new Crepe({
      root: host.current,
      defaultValue: value,
      features: {
        // Spec calls for a selection popup only — no bar across the top, and no
        // slash menu / drag handles that weren't asked for.
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Toolbar]: { buildToolbar },
      },
    });

    // Must be registered before create(), which is when defaultValue is parsed.
    crepe.addFeature((editor) => {
      editor.use(frontmatterRemark).use(frontmatterSchema);
    });

    crepe.on((api) => {
      api.markdownUpdated((_ctx, md) => onChangeRef.current(md));
      api.selectionUpdated((_ctx, selection) =>
        onCursorRef.current(selection.head),
      );
    });

    let cancelled = false;
    // Destroying mid-create throws, and StrictMode unmounts immediately in dev,
    // so always wait for create() to settle before tearing down.
    const created = crepe.create().then(() => {
      if (cancelled) return;
      if (readOnly) crepe.setReadonly(true);
      if (cursor == null) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = Math.min(Math.max(cursor, 0), view.state.doc.content.size);
        // No view.focus() — restoring position shouldn't steal focus on load.
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.near(view.state.doc.resolve(pos)),
          ),
        );
      });
    });
    return () => {
      cancelled = true;
      created.finally(() => crepe.destroy());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="crepe-host" ref={host} />;
}

function Source({
  value,
  readOnly,
  cursor,
  theme,
  onChange,
  onCursorChange,
}: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursorChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      selection:
        cursor == null
          ? undefined
          : EditorSelection.cursor(Math.min(Math.max(cursor, 0), value.length)),
      extensions: [
        basicSetup,
        markdown(),
        ...(theme === "dark" ? [oneDark] : []),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            onCursorRef.current(u.state.selection.main.head);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="cm-host" ref={host} />;
}

type EditorProps = ViewProps & {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  /** Bumped when the file is reloaded from disk, to force a remount. */
  revision: number;
  path: string | null;
};

export function Editor({
  mode,
  onModeChange,
  revision,
  path,
  ...view
}: EditorProps) {
  if (!path) {
    return (
      <div className="editor-panel">
        <div className="editor-empty">No file open</div>
      </div>
    );
  }

  const key = `${path}:${revision}`;

  return (
    <div className="editor-panel">
      <div className="editor-mode-toggle" role="group" aria-label="Editor mode">
        <button
          className={mode === "wysiwyg" ? "active" : ""}
          onClick={() => onModeChange("wysiwyg")}
          title="WYSIWYG"
          aria-pressed={mode === "wysiwyg"}
        >
          <Eye size={14} /> WYSIWYG
        </button>
        <button
          className={mode === "source" ? "active" : ""}
          onClick={() => onModeChange("source")}
          title="Markdown source"
          aria-pressed={mode === "source"}
        >
          <FileCode size={14} /> Source
        </button>
      </div>
      <div className="editor-scroll">
        {mode === "wysiwyg" ? (
          // Crepe restyles via the swapped stylesheet, so no remount needed.
          <Wysiwyg key={`w:${key}`} {...view} />
        ) : (
          // CodeMirror takes its theme as an extension, fixed at construction.
          <Source key={`s:${key}:${view.theme}`} {...view} />
        )}
      </div>
    </div>
  );
}
