import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./ui.module.css";

/* Button ------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  size?: "md" | "sm";
}

export function Button({
  variant = "secondary",
  icon: Icon,
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.btn, styles[variant], size === "sm" ? styles.sm : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.9} aria-hidden="true" />}
      {children}
    </button>
  );
}

/* Text field --------------------------------------------------------------- */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({ label, hint, error, id, className, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={[styles.field, className ?? ""].join(" ")}>
      <label htmlFor={inputId} className={styles.fieldLabel}>
        {label}
      </label>
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? hintId : undefined}
        {...rest}
      />
      {(error ?? hint) && (
        <p id={hintId} className={error ? styles.fieldError : styles.fieldHint}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/* Dialog ------------------------------------------------------------------- */

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom. */
  actions?: ReactNode;
  tone?: "default" | "danger";
  wide?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** A modal dialog: focus moves in and is trapped, Esc closes, focus returns on close. */
export function Dialog({ title, onClose, children, actions, tone = "default", wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    const first =
      box?.querySelector<HTMLElement>("[data-autofocus]") ??
      box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const head = items[0];
      const tail = items[items.length - 1];
      if (!head || !tail) return;
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          styles.dialog,
          wide ? styles.wide : "",
          tone === "danger" ? styles.dangerDialog : "",
        ].join(" ")}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
        <div className={styles.dialogBody}>{children}</div>
        {actions && <div className={styles.dialogActions}>{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** When set, the user must type this exactly before confirming (SPEC §4 defect 11). */
  typeToConfirm?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  typeToConfirm,
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const [typed, setTyped] = useState("");
  const ok = typeToConfirm === undefined || typed === typeToConfirm;
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      tone={danger ? "danger" : "default"}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!ok || busy}
            onClick={onConfirm}
            data-autofocus={typeToConfirm === undefined ? true : undefined}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {typeToConfirm !== undefined && (
        <Field
          label={`Type "${typeToConfirm}" to confirm`}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          onChange={(e) => {
            setTyped(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok && !busy) onConfirm();
          }}
        />
      )}
    </Dialog>
  );
}

/* Banner ------------------------------------------------------------------- */

interface BannerProps {
  tone: "info" | "warning" | "danger";
  children: ReactNode;
  onDismiss?: () => void;
}

export function Banner({ tone, children, onDismiss }: BannerProps) {
  return (
    <div
      className={[styles.banner, styles[`banner-${tone}`]].join(" ")}
      role={tone === "info" ? "status" : "alert"}
    >
      <div className={styles.bannerText}>{children}</div>
      {onDismiss && (
        <button
          type="button"
          className={styles.bannerClose}
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
