import { Keyboard } from "lucide-react";
import { Fragment } from "react";
import { PRIMARY_MODIFIER_LABEL } from "../../app/shortcuts";
import { Button, Dialog } from "../ui";
import { useShortcutsStore } from "./shortcuts-state";
import styles from "./Shortcuts.module.css";

/** The keyboard shortcut overlay (SPEC §10.3), opened with `?` or the top bar button. */

const M = PRIMARY_MODIFIER_LABEL;

const ROWS: readonly { action: string; keys: readonly string[][] }[] = [
  { action: "Play new / next", keys: [[M, "Enter"]] },
  { action: "Repeat", keys: [[M, "Space"]] },
  { action: "Stop", keys: [["Esc"]] },
  { action: "Submit answer", keys: [["Enter"]] },
  { action: "Reveal", keys: [[M, "Shift", "Enter"]] },
  { action: "Text Player play / pause", keys: [[M, "Enter"], ["Space"]] },
  { action: "Go to a mode", keys: [[M, "1…8"]] },
  { action: "Instant Recognition: answer", keys: [["the character's key"]] },
  { action: "This list", keys: [["?"]] },
];

export function ShortcutsButton() {
  const setOpen = useShortcutsStore((s) => s.setOpen);
  return (
    <button
      type="button"
      className={styles.button}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      onClick={() => {
        setOpen(true);
      }}
    >
      <Keyboard size={16} aria-hidden="true" />
    </button>
  );
}

export function ShortcutsOverlay() {
  const open = useShortcutsStore((s) => s.open);
  const setOpen = useShortcutsStore((s) => s.setOpen);
  if (!open) return null;
  const close = () => {
    setOpen(false);
  };
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={close}
      actions={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <dl className={styles.list}>
        {ROWS.map((row) => (
          <Fragment key={row.action}>
            <dt>{row.action}</dt>
            <dd>
              {row.keys.map((combo, i) => (
                <Fragment key={combo.join("+")}>
                  {i > 0 && <span className={styles.or}> or </span>}
                  {combo.map((k, j) => (
                    <Fragment key={k}>
                      {j > 0 && "+"}
                      <kbd>{k}</kbd>
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </dd>
          </Fragment>
        ))}
      </dl>
    </Dialog>
  );
}
