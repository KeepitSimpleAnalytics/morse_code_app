import { isTauri } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArchiveRestore,
  DatabaseBackup,
  Download,
  FolderOpen,
  History,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  deleteCurrentProfile,
  exportData,
  pickImportFile,
  planV1,
  rebuildStats,
  resetProgress,
  runImport,
  runV1Import,
  type ExportScope,
  type PendingImport,
} from "../../app/data-actions";
import { Segmented } from "../../components/controls";
import { Button, ConfirmDialog, Dialog } from "../../components/ui";
import { addNotice, errorText, useApp } from "../../state/app";
import { describeSummary } from "../../storage/export";
import type { V1ImportPlan } from "../../storage/import-v1";
import {
  backupDb,
  listBackups,
  restoreBackupAndRelaunch,
  type BackupInfo,
} from "../../storage/native";
import type { ImportMode } from "../../storage/store";
import { Row } from "./SettingsScreen";
import styles from "./Settings.module.css";

type Open =
  | { kind: "none" }
  | { kind: "import"; pending: PendingImport }
  | { kind: "v1" }
  | { kind: "backups" }
  | { kind: "reset" }
  | { kind: "delete" };

const fail = (what: string) => (err: unknown) => {
  addNotice("danger", `${what} failed: ${errorText(err)}`);
};

export function DataSection() {
  const dbPath = useApp((s) => s.dbPath);
  const kind = useApp((s) => s.store?.kind);
  const current = useApp((s) => s.current);
  const profileCount = useApp((s) => s.profiles.length);
  const [scope, setScope] = useState<ExportScope>("current");
  const [open, setOpen] = useState<Open>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen({ kind: "none" });
  };
  const sqlite = kind === "sqlite";

  const doExport = async () => {
    const path = await exportData(scope);
    if (path) addNotice("info", `Exported to ${path}`);
  };

  const doPickImport = async () => {
    const pending = await pickImportFile();
    if (pending) setOpen({ kind: "import", pending });
  };

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      close();
    } catch (err) {
      fail(what)(err);
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    <>
      <Row
        label="Database"
        hint={
          sqlite ? (
            <code className={styles.path}>{dbPath}</code>
          ) : (
            "In memory (dev mode). Nothing is saved."
          )
        }
      >
        {sqlite && isTauri() && dbPath && (
          <Button
            size="sm"
            icon={FolderOpen}
            onClick={() => {
              revealItemInDir(dbPath).catch(fail("Opening the folder"));
            }}
          >
            Open folder
          </Button>
        )}
      </Row>

      <Row
        label="Export"
        hint="A JSON file you can keep, move to another computer, or import later."
      >
        <div className={styles.inline}>
          {profileCount > 1 && (
            <Segmented<ExportScope>
              label="Export which profiles"
              value={scope}
              options={[
                { value: "current", label: "This profile" },
                { value: "all", label: "All profiles" },
              ]}
              onChange={setScope}
            />
          )}
          <Button size="sm" icon={Download} onClick={() => void doExport().catch(fail("Export"))}>
            Export…
          </Button>
        </div>
      </Row>

      <Row
        label="Import"
        hint="Restore from an export file. You'll see what's in it before anything changes."
      >
        <Button size="sm" icon={Upload} onClick={() => void doPickImport().catch(fail("Import"))}>
          Import…
        </Button>
      </Row>

      <Row
        label="Import v1 progress"
        hint="Bring your Koch level, speeds and totals over from the old web app."
      >
        <Button
          size="sm"
          icon={History}
          onClick={() => {
            setOpen({ kind: "v1" });
          }}
        >
          Import v1…
        </Button>
      </Row>

      {sqlite && (
        <Row
          label="Backups"
          hint="A copy is taken on the first launch each day and before risky changes. The newest 14 are kept."
        >
          <Button
            size="sm"
            icon={DatabaseBackup}
            onClick={() => {
              setOpen({ kind: "backups" });
            }}
          >
            Backups…
          </Button>
        </Row>
      )}

      <Row
        label="Rebuild statistics"
        hint="Recalculates per-character accuracy from your full history."
      >
        <Button
          size="sm"
          icon={RefreshCw}
          disabled={busy}
          onClick={() =>
            void run("Rebuilding statistics", async () => {
              await rebuildStats();
              addNotice("info", "Statistics rebuilt.");
            })
          }
        >
          Rebuild
        </Button>
      </Row>

      <div className={styles.danger}>
        <Row
          label="Reset progress"
          hint="Deletes this profile's lessons, statistics and Koch level. Settings and snippets stay."
        >
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setOpen({ kind: "reset" });
            }}
          >
            Reset…
          </Button>
        </Row>
        <Row label="Delete profile" hint="Removes this profile and everything in it.">
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            onClick={() => {
              setOpen({ kind: "delete" });
            }}
          >
            Delete…
          </Button>
        </Row>
      </div>

      {open.kind === "import" && (
        <ImportDialog
          pending={open.pending}
          busy={busy}
          onCancel={close}
          onImport={(mode) =>
            void run("Import", async () => {
              const r = await runImport(open.pending.file, mode);
              addNotice(
                "info",
                `Imported ${r.profiles === 1 ? "1 profile" : `${r.profiles} profiles`} and ${r.sessions} new sessions.${
                  r.backup ? ` The previous data was backed up first.` : ""
                }`,
              );
            })
          }
        />
      )}

      {open.kind === "v1" && (
        <V1Dialog
          busy={busy}
          onCancel={close}
          onImport={(plan) =>
            void run("v1 import", async () => {
              await runV1Import(plan);
              addNotice("info", "Your v1 progress was imported.");
            })
          }
        />
      )}

      {open.kind === "backups" && <BackupsDialog onClose={close} />}

      {open.kind === "reset" && (
        <ConfirmDialog
          title="Reset progress?"
          confirmLabel="Reset progress"
          danger
          busy={busy}
          typeToConfirm={current.name}
          onCancel={close}
          onConfirm={() =>
            void run("Reset", async () => {
              await resetProgress();
              addNotice("info", `${current.name}'s progress was reset.`);
            })
          }
        >
          <p>
            All lessons, statistics, Koch levels and achievements for{" "}
            <strong>{current.name}</strong> will be deleted. Settings, snippets and word lists are
            kept.
            {sqlite && " A backup is taken first."}
          </p>
        </ConfirmDialog>
      )}

      {open.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${current.name}?`}
          confirmLabel="Delete profile"
          danger
          busy={busy}
          typeToConfirm={current.name}
          onCancel={close}
          onConfirm={() =>
            void run("Deleting the profile", async () => {
              const name = current.name;
              await deleteCurrentProfile();
              addNotice("info", `${name} was deleted.`);
            })
          }
        >
          <p>
            The profile and all of its progress, settings and snippets will be deleted.
            {sqlite && " A backup is taken first."}
          </p>
          <div>
            <Button
              size="sm"
              icon={Download}
              onClick={() => {
                exportData("current")
                  .then((path) => {
                    if (path) addNotice("info", `Exported to ${path}`);
                  })
                  .catch(fail("Export"));
              }}
            >
              Export this profile first
            </Button>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

function ImportDialog({
  pending,
  busy,
  onCancel,
  onImport,
}: {
  pending: PendingImport;
  busy: boolean;
  onCancel: () => void;
  onImport: (mode: ImportMode) => void;
}) {
  const [mode, setMode] = useState<ImportMode>("merge");
  const sqlite = useApp((s) => s.store?.kind === "sqlite");
  const { summary } = pending;
  return (
    <Dialog
      title="Import progress"
      onClose={onCancel}
      tone={mode === "replace" ? "danger" : "default"}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === "replace" ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              onImport(mode);
            }}
          >
            {busy ? "Importing…" : mode === "replace" ? "Replace everything" : "Merge"}
          </Button>
        </>
      }
    >
      <p className={styles.summaryLine}>{describeSummary(summary)}</p>
      <ul className={styles.summaryList}>
        {summary.profiles.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> · {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
          </li>
        ))}
      </ul>
      <Segmented<ImportMode>
        label="Import mode"
        value={mode}
        options={[
          { value: "merge", label: "Merge" },
          { value: "replace", label: "Replace" },
        ]}
        onChange={setMode}
      />
      <p>
        {mode === "merge"
          ? "Adds anything that isn't already here. Nothing you have now is changed or removed."
          : `Deletes every profile on this computer, then loads the file.${sqlite ? " A backup is taken first." : ""}`}
      </p>
    </Dialog>
  );
}

function V1Dialog({
  busy,
  onCancel,
  onImport,
}: {
  busy: boolean;
  onCancel: () => void;
  onImport: (plan: V1ImportPlan) => void;
}) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<V1ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useApp((s) => s.current);

  const check = () => {
    try {
      setPlan(planV1(text));
      setError(null);
    } catch (err) {
      setPlan(null);
      setError(errorText(err));
    }
  };

  return (
    <Dialog
      title="Import v1 progress"
      wide
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {plan ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                onImport(plan);
              }}
            >
              {busy ? "Importing…" : `Import into ${current?.name ?? "this profile"}`}
            </Button>
          ) : (
            <Button variant="primary" disabled={!text.trim()} onClick={check}>
              Check
            </Button>
          )}
        </>
      }
    >
      <ol className={styles.steps}>
        <li>Open the old Morse Trainer in your browser.</li>
        <li>
          Press <kbd>F12</kbd> to open the console.
        </li>
        <li>
          Run <code>copy(localStorage.morseCodeTrainerProgress)</code>
        </li>
        <li>Paste the result here.</li>
      </ol>
      <textarea
        className={styles.paste}
        value={text}
        rows={5}
        spellCheck={false}
        aria-label="v1 progress"
        placeholder='{"kochLevel":5,"charSpeed":20,…}'
        data-autofocus
        onChange={(e) => {
          setText(e.currentTarget.value);
          setPlan(null);
          setError(null);
        }}
      />
      {error && <p className={styles.errorText}>{error}</p>}
      {plan && (
        <div className={styles.planBox}>
          <p className={styles.summaryLine}>This will import:</p>
          <ul className={styles.summaryList}>
            {plan.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className={styles.small}>Your current training speed and tone are replaced.</p>
        </div>
      )}
    </Dialog>
  );
}

function BackupsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    listBackups().then(setList, (err: unknown) => {
      setError(errorText(err));
    });
  };
  useEffect(refresh, []);

  if (restore) {
    return (
      <ConfirmDialog
        title="Restore this backup?"
        confirmLabel="Restore and restart"
        danger
        busy={busy}
        onCancel={() => {
          setRestore(null);
        }}
        onConfirm={() => {
          setBusy(true);
          restoreBackupAndRelaunch(restore.path).catch((err: unknown) => {
            setBusy(false);
            setRestore(null);
            setError(`Restore failed: ${errorText(err)}`);
          });
        }}
      >
        <p>
          Morse Trainer will restart with the data from <strong>{restore.takenAt}</strong>.
          Everything since then is replaced, but the current data is backed up first, so this can be
          undone.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Dialog
      title="Backups"
      wide
      onClose={onClose}
      actions={
        <>
          <Button
            icon={DatabaseBackup}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              backupDb("manual")
                .then(refresh, (err: unknown) => {
                  setError(`Backup failed: ${errorText(err)}`);
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            Back up now
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {error && <p className={styles.errorText}>{error}</p>}
      {list === null && !error && <p>Loading…</p>}
      {list?.length === 0 && (
        <p>
          No backups yet. One is taken automatically the next time Morse Trainer starts, or take one
          now.
        </p>
      )}
      {list && list.length > 0 && (
        <ul className={styles.backupList}>
          {list.map((b) => (
            <li key={b.path} className={styles.backupItem}>
              <span className={styles.grow}>
                <span className={styles.backupTime}>{b.takenAt}</span>
                <span className={styles.small}>{(b.sizeBytes / 1024).toFixed(0)} KB</span>
              </span>
              <Button
                size="sm"
                icon={ArchiveRestore}
                onClick={() => {
                  setRestore(b);
                }}
              >
                Restore…
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
