import { type ReactNode, useEffect, useRef, useState } from "react";
import { addDays, localToday, prettyDate } from "../dates";

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

// Like Chips, but any number of options can be on.
export function MultiChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="chips wrap" role="group">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={on ? "chip on" : "chip"}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
          >
            {o.label}
          </button>
        );
      })}
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

// Today / yesterday / two days ago as chips (the usual case), plus a calendar for anything older.
// Future dates are not offered: these are logs of things that already happened. min only limits the calendar;
// callers still validate (a quick chip can be earlier than min).
export function DatePicker({ value, onChange, min }: { value: string; onChange: (date: string) => void; min?: string }) {
  const today = localToday();
  const quick = [today, addDays(today, -1), addDays(today, -2)];
  const [picking, setPicking] = useState(!quick.includes(value));
  const label = (d: string) => (d === today ? "Today" : d === quick[1] ? "Yesterday" : prettyDate(d));
  return (
    <div className="form-tight">
      <Chips
        wrap
        options={[
          ...quick.map((d) => ({ value: d, label: label(d) })),
          { value: "pick", label: picking && !quick.includes(value) ? prettyDate(value) : "Other…" },
        ]}
        value={picking ? "pick" : value}
        onChange={(v) => {
          if (v === "pick") setPicking(true);
          else if (v) {
            setPicking(false);
            onChange(v);
          }
        }}
      />
      {picking && (
        <input type="date" aria-label="Date" min={min} max={today} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// Three-dot overflow menu for a list row. Closes on outside tap or Escape.
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="overflow" ref={ref}>
      <button type="button" className="icon-btn more-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="overflow-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? "danger" : ""}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
