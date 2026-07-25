import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  /** Auto-generated title, pre-filled and fully editable (DESIGN §3.3). */
  suggestion: string;
  fileName: string;
  onConfirm: (title: string) => void;
  onOpenChange: (open: boolean) => void;
};

export function CheckpointDialog({
  open,
  suggestion,
  fileName,
  onConfirm,
  onOpenChange,
}: Props) {
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
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog-title">Create checkpoint</Dialog.Title>
          <div className="dialog-hint">{fileName}</div>

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
