// Stub design system. Stands in for the real one until its CI publishes
// an ESM bundle (React external) + CSS to the CDN.
import { useState, type ReactNode } from "react";

type Children = { children?: ReactNode };

export function Button({
  variant = "primary",
  onClick,
  disabled,
  children,
}: Children & {
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`ds-btn ds-btn--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Card({ title, children }: Children & { title?: ReactNode }) {
  return (
    <section className="ds-card">
      {title != null && <h3 className="ds-card__title">{title}</h3>}
      {children}
    </section>
  );
}

export function Stack({
  direction = "column",
  gap = 3,
  children,
}: Children & { direction?: "row" | "column"; gap?: 1 | 2 | 3 | 4 | 6 }) {
  return <div className={`ds-stack ds-stack--${direction} ds-gap-${gap}`}>{children}</div>;
}

export function Text({
  size = "md",
  tone = "default",
  children,
}: Children & { size?: "sm" | "md" | "lg" | "xl"; tone?: "default" | "muted" }) {
  return <p className={`ds-text ds-text--${size} ds-text--${tone}`}>{children}</p>;
}

export function Badge({ tone = "neutral", children }: Children & { tone?: "neutral" | "success" | "warning" }) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="ds-field">
      <span className="ds-field__label">{label}</span>
      <input className="ds-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Stateful on purpose: proves hooks inside the DS bundle share the preview's React.
export function Disclosure({ summary, children }: Children & { summary: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ds-disclosure">
      <button className="ds-disclosure__summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{open ? "▾" : "▸"}</span> {summary}
      </button>
      {open && <div className="ds-disclosure__body">{children}</div>}
    </div>
  );
}

export function MockShell({ title = "Acme", children }: Children & { title?: string }) {
  return (
    <div className="ds-shell">
      <header className="ds-shell__top">{title}</header>
      <main className="ds-shell__main">{children}</main>
    </div>
  );
}
