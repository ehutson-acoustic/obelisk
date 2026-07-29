import * as Dialog from "@radix-ui/react-dialog";
import {useEffect, useState} from "react";

type Props = {
    open: boolean;
    /** Auto-generated title, pre-filled and fully editable (DESIGN §3.3). */
    suggestion: string;
    fileName: string;
    /** Branch the commit will land on, since it is real history now. */
    branch: string | null;
    /** This file is staged at other content, which the commit supersedes. */
    staged: boolean;
    onConfirm: (title: string) => void;
    onOpenChange: (open: boolean) => void;
};

export function CheckpointDialog({
                                     open,
                                     suggestion,
                                     fileName,
                                     branch,
                                     staged,
                                     onConfirm,
                                     onOpenChange,
                                 }: Readonly<Props>) {
    const [title, setTitle] = useState(suggestion);

    // The suggestion is recomputed from the current diff each time it opens.
    useEffect(() => {
        if (open) setTitle(suggestion);
    }, [open, suggestion]);

    const submit = () => {
        if (!title.trim()) return;
        onConfirm(title.trim());
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="overlay"/>
                <Dialog.Content className="dialog">
                    <Dialog.Title className="dialog-title">Create checkpoint</Dialog.Title>
                    <div className="dialog-hint">
                        {fileName}
                        {branch && (
                            <>
                                {" — commits to "}
                                <code>{branch}</code>
                            </>
                        )}
                    </div>

                    {/* The staged version is superseded rather than kept, so say so
                        before the commit rather than after (DESIGN §3.2). */}
                    {staged && (
                        <p className="dialog-warn">
                            This file has staged changes. Checkpointing replaces what is
                            staged with the version being committed.
                        </p>
                    )}

                    <label className="field">
                        <span>Title</span>
                        <input
                            autoFocus
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && submit()}
                            onFocus={(e) => e.target.select()}
                        />
                    </label>

                    <div className="dialog-actions">
                        <button className="btn" onClick={() => onOpenChange(false)}>
                            Cancel
                        </button>
                        <button
                            className="btn primary"
                            onClick={submit}
                            disabled={!title.trim()}
                        >
                            Checkpoint
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
