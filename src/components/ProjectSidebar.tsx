import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { readableFg } from "../lib/contrast";
import type { Project } from "../types";

const SWATCHES = [
  "#2f6f4e",
  "#1f4e79",
  "#6b3fa0",
  "#a03f3f",
  "#b5761f",
  "#3f6b6b",
  "#7a5230",
  "#43474e",
];

type Props = {
  projects: Project[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onChange: (projects: Project[]) => void;
  onToggleCollapse: () => void;
  onOpenAppSettings: () => void;
  onOpenProjectSettings: (project: Project) => void;
};

type Draft = { id: string | null; name: string; color: string; dir: string };

export function ProjectSidebar({
  projects,
  activeId,
  collapsed,
  onSelect,
  onChange,
  onToggleCollapse,
  onOpenAppSettings,
  onOpenProjectSettings,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const startAdd = () =>
    setDraft({
      id: null,
      name: "",
      color: SWATCHES[projects.length % SWATCHES.length],
      dir: "",
    });

  const startEdit = (p: Project) =>
    setDraft({ id: p.id, name: p.name, color: p.color, dir: p.dir });

  const pickDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string" && draft) {
      setDraft({
        ...draft,
        dir: picked,
        name: draft.name || picked.split(/[/\\]/).pop() || "",
      });
    }
  };

  const save = () => {
    if (!draft || !draft.dir.trim()) return;
    const name = draft.name.trim() || draft.dir.split(/[/\\]/).pop() || "Project";
    if (draft.id) {
      onChange(
        projects.map((p) =>
          p.id === draft.id
            ? { ...p, name, color: draft.color, dir: draft.dir }
            : p,
        ),
      );
    } else {
      const project: Project = {
        id: crypto.randomUUID(),
        name,
        color: draft.color,
        dir: draft.dir,
      };
      onChange([...projects, project]);
      onSelect(project.id);
    }
    setDraft(null);
  };

  const remove = (id: string) => onChange(projects.filter((p) => p.id !== id));

  return (
    <div className={`project-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="project-list">
        {projects.map((p) => (
          <ContextMenu.Root key={p.id}>
            <ContextMenu.Trigger asChild>
              <button
                className={`project-card${p.id === activeId ? " selected" : ""}`}
                style={{ background: p.color, color: readableFg(p.color) }}
                onClick={() => onSelect(p.id)}
                title={collapsed ? `${p.name} — ${p.dir}` : p.dir}
              >
                {collapsed ? (
                  <span className="project-initial">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <>
                    <span className="project-name">{p.name}</span>
                    <span className="project-dir">{p.dir}</span>
                  </>
                )}
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="menu">
                <ContextMenu.Item
                  className="menu-item"
                  onSelect={() => startEdit(p)}
                >
                  Edit…
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="menu-item"
                  onSelect={() => onOpenProjectSettings(p)}
                >
                  Project settings…
                </ContextMenu.Item>
                <ContextMenu.Separator className="menu-sep" />
                <ContextMenu.Item
                  className="menu-item danger"
                  onSelect={() => remove(p.id)}
                >
                  Remove from list
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ))}

        <button className="project-card add" onClick={startAdd} title="Add project">
          <Plus size={collapsed ? 16 : 20} />
        </button>
      </div>

      <div className="sidebar-footer">
        <button
          className="side-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
        <button
          className="side-btn"
          onClick={onOpenAppSettings}
          title="Application settings"
        >
          <Settings size={16} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      <Dialog.Root open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title className="dialog-title">
              {draft?.id ? "Edit project" : "Add project"}
            </Dialog.Title>

            <label className="field">
              <span>Name</span>
              <input
                value={draft?.name ?? ""}
                placeholder="Folder name"
                onChange={(e) =>
                  draft && setDraft({ ...draft, name: e.target.value })
                }
              />
            </label>

            <label className="field">
              <span>Directory</span>
              <div className="field-row">
                <input value={draft?.dir ?? ""} readOnly placeholder="Choose a folder…" />
                <button className="btn" onClick={pickDir}>
                  <FolderOpen size={14} /> Browse
                </button>
              </div>
            </label>

            <div className="field">
              <span>Color</span>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={`swatch${draft?.color === c ? " selected" : ""}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => draft && setDraft({ ...draft, color: c })}
                  />
                ))}
                <input
                  className="color-input"
                  type="color"
                  value={draft?.color ?? "#2f6f4e"}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, color: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="dialog-actions">
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={save}
                disabled={!draft?.dir.trim()}
              >
                Save
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
