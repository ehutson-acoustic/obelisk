import * as Dialog from "@radix-ui/react-dialog";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Appearance, AppSettings } from "../lib/appSettings";

const MODES: { value: Appearance; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

type Props = {
  open: boolean;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({
  open,
  settings,
  onChange,
  onOpenChange,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog-title">Settings</Dialog.Title>

          <div className="field">
            <span>Appearance</span>
            <div className="mode-row">
              {MODES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  className={`mode-btn${settings.appearance === value ? " active" : ""}`}
                  aria-pressed={settings.appearance === value}
                  onClick={() => onChange({ ...settings, appearance: value })}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="dialog-hint">
            Markdown theming and per-component styles arrive in P4.
          </p>

          <div className="dialog-actions">
            <button className="btn primary" onClick={() => onOpenChange(false)}>
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
