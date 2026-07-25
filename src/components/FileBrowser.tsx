import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createFile, createFolder, isMarkdown, listDir } from "../lib/files";
import type { FileNode } from "../types";

type Props = {
  root: string | null;
  activePath: string | null;
  collapsed: boolean;
  onOpen: (path: string) => void;
  onCollapse: () => void;
};

export function FileBrowser({
  root,
  activePath,
  collapsed,
  onOpen,
  onCollapse,
}: Props) {
  const [children, setChildren] = useState<Record<string, FileNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ kind: "file" | "folder"; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dir: string) => {
    try {
      const nodes = await listDir(dir);
      setChildren((prev) => ({ ...prev, [dir]: nodes }));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    setSelectedDir(null);
    setError(null);
    if (root) load(root);
  }, [root, load]);

  const toggle = (node: FileNode) => {
    setSelectedDir(node.path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
        if (!children[node.path]) load(node.path);
      }
      return next;
    });
  };

  const targetDir = selectedDir ?? root;

  const submitPrompt = async () => {
    if (!prompt || !targetDir || !prompt.name.trim()) return;
    try {
      if (prompt.kind === "file") {
        let name = prompt.name.trim();
        if (!isMarkdown(name) && !name.includes(".")) name += ".md";
        const path = await createFile(targetDir, name);
        await load(targetDir);
        onOpen(path);
      } else {
        await createFolder(targetDir, prompt.name.trim());
        await load(targetDir);
      }
      setPrompt(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const renderNodes = (dir: string, depth: number) =>
    (children[dir] ?? []).map((node) =>
      node.isDir ? (
        <div key={node.path}>
          <button
            className={`tree-row${selectedDir === node.path ? " selected" : ""}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => toggle(node)}
          >
            {expanded.has(node.path) ? (
              <ChevronDown size={13} className="tree-caret" />
            ) : (
              <ChevronRight size={13} className="tree-caret" />
            )}
            {expanded.has(node.path) ? (
              <FolderOpen size={14} />
            ) : (
              <Folder size={14} />
            )}
            <span className="tree-name">{node.name}</span>
          </button>
          {expanded.has(node.path) && renderNodes(node.path, depth + 1)}
        </div>
      ) : (
        <button
          key={node.path}
          className={`tree-row${activePath === node.path ? " active" : ""}`}
          style={{ paddingLeft: 6 + depth * 12 + 13 }}
          onClick={() => onOpen(node.path)}
          title={isMarkdown(node.path) ? node.name : `${node.name} (read-only)`}
        >
          <FileIcon size={14} className={isMarkdown(node.path) ? "md" : "plain"} />
          <span className="tree-name">{node.name}</span>
        </button>
      ),
    );

  return (
    <div className="panel file-browser">
      <div className="panel-header">
        <span className="panel-title">Files</span>
        <div className="panel-actions">
          <button
            className="icon-btn"
            title="New file"
            disabled={!targetDir}
            onClick={() => setPrompt({ kind: "file", name: "" })}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="New folder"
            disabled={!targetDir}
            onClick={() => setPrompt({ kind: "folder", name: "" })}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn"
            title={collapsed ? "Expand files" : "Collapse files"}
            onClick={onCollapse}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      <div className="panel-body tree">
        {!root && <div className="panel-empty">No project selected</div>}
        {error && <div className="panel-error">{error}</div>}
        {root && renderNodes(root, 0)}
      </div>

      <Dialog.Root open={!!prompt} onOpenChange={(o) => !o && setPrompt(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog small">
            <Dialog.Title className="dialog-title">
              {prompt?.kind === "file" ? "New file" : "New folder"}
            </Dialog.Title>
            <div className="dialog-hint">in {targetDir}</div>
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={prompt?.name ?? ""}
                placeholder={prompt?.kind === "file" ? "notes.md" : "chapter-1"}
                onChange={(e) =>
                  prompt && setPrompt({ ...prompt, name: e.target.value })
                }
                onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
              />
            </label>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={submitPrompt}
                disabled={!prompt?.name.trim()}
              >
                Create
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
