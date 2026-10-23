import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { switchProfile, updateCurrentProfile } from "../../app/session";
import { Button, Field } from "../../components/ui";
import { addNotice, errorText, useApp } from "../../state/app";
import { ColorPicker, NewProfileDialog, ProfileAvatar } from "../profiles/ProfileWidgets";
import { Row } from "./SettingsScreen";
import styles from "./Settings.module.css";

/** Keyed by profile so the name field resets when the profile changes. */
export function ProfileSection() {
  const id = useApp((s) => s.current?.id);
  return <ProfileEditor key={id} />;
}

function ProfileEditor() {
  const current = useApp((s) => s.current);
  const profiles = useApp((s) => s.profiles);
  const [name, setName] = useState(current?.name ?? "");
  const [creating, setCreating] = useState(false);
  if (!current) return null;

  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === current.name) {
      setName(current.name);
      return;
    }
    updateCurrentProfile({ name: trimmed }).catch((err: unknown) => {
      addNotice("danger", `Renaming failed: ${errorText(err)}`);
      setName(current.name);
    });
  };

  return (
    <>
      <div className={styles.profileHero}>
        <ProfileAvatar name={current.name} color={current.color} size={56} />
        <Field
          label="Name"
          className={styles.grow}
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
      <ColorPicker
        value={current.color}
        onChange={(color) => {
          updateCurrentProfile({ color }).catch((err: unknown) => {
            addNotice("danger", `Changing the colour failed: ${errorText(err)}`);
          });
        }}
      />
      <Row
        label="Profiles on this computer"
        hint="Each has its own progress, settings and snippets."
      >
        <Button
          size="sm"
          icon={Plus}
          onClick={() => {
            setCreating(true);
          }}
        >
          New profile
        </Button>
      </Row>
      <ul className={styles.profileList}>
        {profiles.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={styles.profileItem}
              aria-current={p.id === current.id ? "true" : undefined}
              onClick={() => {
                switchProfile(p.id).catch((err: unknown) => {
                  addNotice("danger", `Switching profile failed: ${errorText(err)}`);
                });
              }}
            >
              <ProfileAvatar name={p.name} color={p.color} />
              <span className={styles.grow}>{p.name}</span>
              {p.id === current.id && <Check size={16} aria-label="Current profile" />}
            </button>
          </li>
        ))}
      </ul>
      {creating && (
        <NewProfileDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
