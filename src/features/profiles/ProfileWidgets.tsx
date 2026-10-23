import { Check } from "lucide-react";
import { useState } from "react";
import { createProfile, PROFILE_COLORS } from "../../app/session";
import { Button, Dialog, Field } from "../../components/ui";
import { errorText } from "../../state/app";
import styles from "./ProfileWidgets.module.css";

/** Small pieces shared by the top-bar switcher, Settings → Profile and first run. */

export function ProfileAvatar({
  name,
  color,
  size = 28,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className={styles.avatar}
      style={
        {
          "--avatar": color,
          width: size,
          height: size,
          fontSize: size * 0.42,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset className={styles.colors}>
      <legend className={styles.colorsLabel}>Colour</legend>
      <div className={styles.swatches}>
        {PROFILE_COLORS.map((c) => (
          <label key={c} className={styles.swatch} style={{ "--swatch": c } as React.CSSProperties}>
            <input
              type="radio"
              name="profile-color"
              value={c}
              checked={value === c}
              onChange={() => {
                onChange(c);
              }}
              aria-label={`Colour ${c}`}
            />
            <span aria-hidden="true">{value === c && <Check size={14} strokeWidth={3} />}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NewProfileDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PROFILE_COLORS[1]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    try {
      await createProfile(name, color);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New profile"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            Create and switch
          </Button>
        </>
      }
    >
      <Field
        label="Name"
        value={name}
        maxLength={40}
        data-autofocus
        error={error}
        onChange={(e) => {
          setName(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      <ColorPicker value={color} onChange={setColor} />
    </Dialog>
  );
}
