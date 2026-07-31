import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {ChevronDown} from "lucide-react";
import {basename, dirname} from "../lib/files";
import type {OpenFile} from "../types";

type Props = {
    files: OpenFile[];
    activePath: string | null;
    onSelect: (path: string) => void;
};

/**
 * ponytail: shown whenever anything is open rather than only when the tab strip
 * actually overflows — measuring that costs a resize observer and a re-render,
 * and a permanent list is easier to find anyway. Gate it on overflow if the
 * button starts feeling noisy.
 */
export function OpenFilesMenu({files, activePath, onSelect}: Readonly<Props>) {
    if (files.length === 0) return null;

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button className="icon-btn" title="Open files">
                    <ChevronDown size={16}/>
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className="menu file-menu"
                    align="end"
                    sideOffset={4}
                >
                    {files.map((f) => (
                        <DropdownMenu.Item
                            key={f.path}
                            className={`menu-item file${f.path === activePath ? " active" : ""}`}
                            onSelect={() => onSelect(f.path)}
                        >
                            <span className="menu-item-name">{basename(f.path)}</span>
                            {/* Two files can share a name, so the folder disambiguates them. */}
                            <span className="menu-item-dir">{dirname(f.path)}</span>
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
