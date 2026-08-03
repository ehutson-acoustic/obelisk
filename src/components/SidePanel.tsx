import type {RefObject} from "react";
import {Group, type Layout, Panel, type PanelImperativeHandle, Separator,} from "react-resizable-panels";
import type {PanelLayout} from "../types";
import {FileBrowser} from "./FileBrowser";
import {SearchPanel} from "./SearchPanel";
import {VersionsPanel, type VersionsPanelProps} from "./VersionsPanel";

type SideTab = "files" | "search";

type Props = {
    tab: SideTab;
    onTabChange: (tab: SideTab) => void;
    root: string | null;
    activePath: string | null;
    filesCollapsed: boolean;
    /** Owned by App so the shared collapse-state sync can read every panel. */
    filesPanelRef: RefObject<PanelImperativeHandle | null>;
    defaultLayout: PanelLayout;
    onLayoutChanged: (layout: Layout) => void;
    onOpen: (path: string) => void;
    onOpenAtLine: (path: string, line: number) => void;
    onToggleFiles: () => void;
    versions: VersionsPanelProps;
};

/**
 * The right sidebar: one of the two stacked file views over the versions list.
 * Files and Search share a slot rather than stacking, so the tabs stand in for
 * whichever panel title would otherwise be there.
 */
export function SidePanel({
                              tab,
                              onTabChange,
                              root,
                              activePath,
                              filesCollapsed,
                              filesPanelRef,
                              defaultLayout,
                              onLayoutChanged,
                              onOpen,
                              onOpenAtLine,
                              onToggleFiles,
                              versions,
                          }: Readonly<Props>) {
    const tabs = (
        <div className="side-tabs" role="tablist" aria-label="Side panel">
            {(["files", "search"] as const).map((id) => (
                <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? "active" : ""}
                    onClick={() => onTabChange(id)}
                >
                    {id === "files" ? "Files" : "Search"}
                </button>
            ))}
        </div>
    );

    return (
        <Group
            id="side"
            orientation="vertical"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
        >
            <Panel
                panelRef={filesPanelRef}
                id="files"
                defaultSize="60"
                collapsible
                collapsedSize={28}
            >
                {tab === "search" ? (
                    <SearchPanel root={root} titleSlot={tabs} onOpen={onOpenAtLine}/>
                ) : (
                    <FileBrowser
                        root={root}
                        activePath={activePath}
                        collapsed={filesCollapsed}
                        titleSlot={tabs}
                        onOpen={onOpen}
                        onCollapse={onToggleFiles}
                    />
                )}
            </Panel>
            <Separator className="handle horizontal"/>
            <Panel id="versions">
                <VersionsPanel {...versions} />
            </Panel>
        </Group>
    );
}
