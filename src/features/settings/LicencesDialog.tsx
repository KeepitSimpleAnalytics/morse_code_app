import { useEffect, useState } from "react";
import { Banner, Button, Dialog, Field } from "../../components/ui";
import cwAbbrev from "../../data/cw-abbrev.json";
import koch from "../../data/koch-orders.json";
import prefixes from "../../data/prefixes.json";
import qcodes from "../../data/qcodes.json";
import v1Common from "../../data/v1-common.json";
import appLicence from "../../../LICENSE?raw";
import { errorText } from "../../state/app";
import styles from "./Settings.module.css";

/**
 * Settings → About → Licences (SPEC §15, phase 10): the app's own licence, the
 * bundled data and its sources (src/data/README.md), and every third-party
 * package the app ships with its licence text.
 */

interface ThirdParty {
  source: "npm" | "crate";
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  /** Index into `texts`. */
  text: number;
}

interface Licences {
  packages: ThirdParty[];
  texts: string[];
}

/** Each bundled file records its own source and licence. */
const DATA: readonly { name: string; source: string; license: string }[] = [
  koch,
  v1Common,
  cwAbbrev,
  qcodes,
  prefixes,
];

export function LicencesDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Licences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    // About 1.7 MB of text, so it is only loaded when this opens.
    import("../../data/third-party-licenses.json").then(
      (m) => {
        if (live) setData(m.default as Licences);
      },
      (err: unknown) => {
        if (live) setError(`Loading the licence list failed: ${errorText(err)}`);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const shown = data?.packages.filter(
    (p) => q === "" || p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q),
  );

  return (
    <Dialog
      title="Licences"
      wide
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <section aria-labelledby="licences-app" className={styles.licenceGroup}>
        <h3 id="licences-app" className={styles.licenceHeading}>
          Morse Trainer
        </h3>
        <p>Released under the MIT licence.</p>
        <details>
          <summary>MIT licence text</summary>
          <pre className={styles.licenceText}>{appLicence}</pre>
        </details>
      </section>

      <section aria-labelledby="licences-data" className={styles.licenceGroup}>
        <h3 id="licences-data" className={styles.licenceHeading}>
          Bundled data
        </h3>
        <ul className={styles.licenceData}>
          {DATA.map((d) => (
            <li key={d.name}>
              <strong>{d.name}.</strong> {d.source}{" "}
              <span className={styles.small}>{d.license}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="licences-oss" className={styles.licenceGroup}>
        <h3 id="licences-oss" className={styles.licenceHeading}>
          Open-source software
        </h3>
        {error && <Banner tone="danger">{error}</Banner>}
        {data && (
          <p>
            Morse Trainer is built with {data.packages.length} open-source packages: JavaScript
            libraries and fonts, and the Rust crates of Tauri.
          </p>
        )}
        {/* One live region throughout, so screen readers announce each change. */}
        <p className={styles.small} role="status">
          {error
            ? ""
            : !data
              ? "Loading the licence list…"
              : matchText(shown?.length ?? 0, data, q)}
        </p>
        {data && (
          <>
            <Field
              label="Filter"
              placeholder="Package or licence, e.g. react or Apache"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
            <ul className={styles.licenceList}>
              {shown?.map((p) => (
                <PackageLicence
                  key={`${p.source}:${p.name}@${p.version}`}
                  p={p}
                  text={data.texts[p.text] ?? ""}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </Dialog>
  );
}

function matchText(count: number, data: Licences, q: string): string {
  if (q === "") return "";
  return count === 0
    ? "No package matches."
    : `${count} of ${data.packages.length} packages match.`;
}

/** One package. Its text is only put in the page while it is open: there are hundreds. */
function PackageLicence({ p, text }: { p: ThirdParty; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <details
        onToggle={(e) => {
          setOpen(e.currentTarget.open);
        }}
      >
        <summary>
          <span className={styles.licenceName}>{p.name}</span> {p.version}{" "}
          <span className={styles.small}>· {p.license}</span>
        </summary>
        {open && (
          <>
            {p.homepage && <p className={styles.path}>{p.homepage}</p>}
            <pre className={styles.licenceText}>{text}</pre>
          </>
        )}
      </details>
    </li>
  );
}
