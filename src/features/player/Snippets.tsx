import { BookMarked, Check, Pencil, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { newId } from "../../app/session";
import { Button, ConfirmDialog, Dialog, Field } from "../../components/ui";
import { errorText, requireProfile, requireStore, useApp } from "../../state/app";
import type { Snippet } from "../../storage/schemas";
import { SNIPPET_TITLE_MAX, suggestTitle } from "./snippets-model";
import styles from "./Snippets.module.css";

/** Event handlers only; kept outside components so render stays pure. */
const timestamp = (): number => Date.now();

/**
 * The snippet library (SPEC §7.8): named texts saved per profile. Sending a snippet
 * to Custom Practice arrives with that mode in phase 5.
 */
export function SnippetsButton({ text, onLoad }: { text: string; onLoad: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        icon={BookMarked}
        onClick={() => {
          setOpen(true);
        }}
      >
        Snippets
      </Button>
      {open && (
        <SnippetsDialog
          text={text}
          onLoad={(body) => {
            onLoad(body);
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function SnippetsDialog({
  text,
  onLoad,
  onClose,
}: {
  text: string;
  onLoad: (body: string) => void;
  onClose: () => void;
}) {
  const profileId = useApp((s) => s.current?.id);
  const [list, setList] = useState<Snippet[] | null>(null);
  const [title, setTitle] = useState(() => suggestTitle(text));
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<Snippet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!profileId) return;
    requireStore()
      .listSnippets(profileId)
      .then(setList, (err: unknown) => {
        setError(errorText(err));
      });
  }, [profileId]);
  useEffect(refresh, [refresh]);

  const attempt = (what: string, p: Promise<void>) => {
    p.then(
      () => {
        setError(null);
        refresh();
      },
      (err: unknown) => {
        setError(`${what} failed: ${errorText(err)}`);
      },
    );
  };

  const saveNew = () => {
    const t = title.trim();
    if (!t) {
      setError("Give the snippet a title.");
      return;
    }
    const now = timestamp();
    attempt(
      "Saving",
      requireStore().saveSnippet({
        id: newId(),
        profileId: requireProfile().id,
        title: t,
        body: text,
        createdAt: now,
        updatedAt: now,
      }),
    );
  };

  const rename = (s: Snippet, next: string) => {
    const t = next.trim();
    setEditing(null);
    if (!t || t === s.title) return;
    attempt("Renaming", requireStore().saveSnippet({ ...s, title: t, updatedAt: timestamp() }));
  };

  if (deleting) {
    return (
      <ConfirmDialog
        title={`Delete “${deleting.title}”?`}
        confirmLabel="Delete snippet"
        danger
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          const id = deleting.id;
          setDeleting(null);
          attempt("Deleting", requireStore().deleteSnippet(id));
        }}
      >
        <p>The snippet is removed from this profile. The text in the editor isn't affected.</p>
      </ConfirmDialog>
    );
  }

  return (
    <Dialog
      title="Snippets"
      wide
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <form
        className={styles.saveRow}
        onSubmit={(e) => {
          e.preventDefault();
          saveNew();
        }}
      >
        <Field
          label="Save the current text as"
          className={styles.grow}
          value={title}
          maxLength={SNIPPET_TITLE_MAX}
          data-autofocus
          onChange={(e) => {
            setTitle(e.currentTarget.value);
          }}
        />
        <Button type="submit" icon={Save} disabled={!text.trim()}>
          Save
        </Button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {list === null && !error && <p>Loading…</p>}
      {list?.length === 0 && <p className={styles.empty}>No snippets yet. Save one above.</p>}
      {list && list.length > 0 && (
        <ul className={styles.list} aria-label="Saved snippets">
          {list.map((s) => (
            <li key={s.id} className={styles.item}>
              {editing?.id === s.id ? (
                <input
                  className={styles.renameInput}
                  value={editing.title}
                  maxLength={SNIPPET_TITLE_MAX}
                  aria-label="Snippet title"
                  autoFocus
                  onChange={(e) => {
                    setEditing({ id: s.id, title: e.currentTarget.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(s, editing.title);
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                  onBlur={() => {
                    rename(s, editing.title);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={styles.load}
                  title="Load into the editor"
                  onClick={() => {
                    onLoad(s.body);
                  }}
                >
                  <span className={styles.itemTitle}>{s.title}</span>
                  <span className={styles.itemBody}>
                    {s.body.replace(/\s+/g, " ").slice(0, 90)}
                  </span>
                </button>
              )}
              <div className={styles.itemActions}>
                {editing?.id === s.id ? (
                  <>
                    <IconButton
                      label="Save title"
                      icon={Check}
                      onClick={() => {
                        rename(s, editing.title);
                      }}
                    />
                    <IconButton
                      label="Cancel"
                      icon={X}
                      onClick={() => {
                        setEditing(null);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <IconButton
                      label={`Rename ${s.title}`}
                      icon={Pencil}
                      onClick={() => {
                        setEditing({ id: s.id, title: s.title });
                      }}
                    />
                    <IconButton
                      label={`Delete ${s.title}`}
                      icon={Trash2}
                      onClick={() => {
                        setDeleting(s);
                      }}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Pencil;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        // Keep focus in the rename field so its blur doesn't commit first.
        e.preventDefault();
      }}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}
