import type { ReactNode } from "react";

export interface Option<T> {
  value: T;
  label: ReactNode;
}

// Tap-to-pick row of options; tapping the selected option again clears it when `clearable`.
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  clearable = false,
  wrap = false,
}: {
  options: Option<T>[];
  value: T | null | undefined;
  onChange: (v: T | null) => void;
  clearable?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "chips wrap" : "chips"} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "chip on" : "chip"}
          onClick={() => onChange(clearable && o.value === value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Infinity,
  format = (v) => String(v),
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <span className="stepper-value">{format(value)}</span>
      <button type="button" aria-label="Increase" onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  tone,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tone?: "accent" | "warn" | "bad";
}) {
  return (
    <section className={tone ? `card tone-${tone}` : "card"}>
      {(title || action) && (
        <header className="card-head">
          <h2>{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, back }: { title: ReactNode; sub?: ReactNode; back?: string }) {
  return (
    <header className="page-head">
      {back && (
        <a className="back" href={back}>
          ‹ Back
        </a>
      )}
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </header>
  );
}

export const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function seconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
