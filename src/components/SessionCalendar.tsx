// Month calendar of sessions (#32): one marker per session, coloured by type group with its letter.
// Tap a day to list its sessions; each links to the session's edit page.
import { useState } from "react";
import { monthGrid, monthLabel, monthOf, sessionsByDay, shiftMonth } from "../calendar";
import { dayLabel } from "../dates";
import { type Session, groupOf, typeLabel } from "../types";

// "Top rope (outdoor)": the day's accessible label and the list both say it, not only the ring.
const sessionLabel = (s: Session) => `${typeLabel(s.type)}${s.outdoor ? " (outdoor)" : ""}`;
import { GroupLegend, GroupMarker } from "./typeGroups";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

export function SessionCalendar({
  month,
  onMonth,
  sessions,
  today,
  loading,
}: {
  month: string; // YYYY-MM
  onMonth: (month: string) => void;
  sessions: Session[];
  today: string;
  loading?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(today);
  const days = sessionsByDay(sessions, month);
  const current = monthOf(today);
  const pickedList = picked && monthOf(picked) === month ? (days[picked] ?? []) : null;

  const go = (by: number) => {
    const next = shiftMonth(month, by);
    onMonth(next);
    setPicked(next === current ? today : null);
  };

  return (
    <div className="viz">
      <div className="cal-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => go(-1)}>
          ‹
        </button>
        <h3 aria-live="polite">{monthLabel(month)}</h3>
        <button type="button" className="icon-btn" aria-label="Next month" disabled={month >= current} onClick={() => go(1)}>
          ›
        </button>
      </div>
      <GroupLegend markers />
      <div className="cal-grid" aria-busy={loading || undefined}>
        {DOW.map((d, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {monthGrid(month)
          .flat()
          .map((date, i) => {
            if (!date) return <span key={`e${i}`} className="cal-day empty" />;
            const list = days[date] ?? [];
            const cls = ["cal-day", date === today && "today", date > today && "future", date === picked && "picked"]
              .filter(Boolean)
              .join(" ");
            const label = `${dayLabel(date, today)}: ${list.length ? list.map(sessionLabel).join(", ") : "nothing logged"}`;
            return (
              <button key={date} type="button" className={cls} aria-label={label} aria-pressed={date === picked} onClick={() => setPicked(date)}>
                <span className="num">{Number(date.slice(8))}</span>
                <span className="cal-marks">
                  {list.map((s) => (
                    <GroupMarker key={s.id} group={groupOf(s.type)} title={typeLabel(s.type)} outdoor={Boolean(s.outdoor)} />
                  ))}
                </span>
              </button>
            );
          })}
      </div>
      {loading && <p className="muted small">Loading…</p>}
      {pickedList && (
        <div className="cal-list">
          <strong className="small">{dayLabel(picked!, today)}</strong>
          {pickedList.length === 0 && <p className="muted small">No sessions logged.</p>}
          {pickedList.map((s) => (
            <a key={s.id} href={`#/log?edit=${s.id}`} aria-label={`Edit ${sessionLabel(s)} session`}>
              <GroupMarker group={groupOf(s.type)} outdoor={Boolean(s.outdoor)} />
              <span>
                <strong>{typeLabel(s.type)}</strong> {s.duration_min} min{s.outdoor ? " · outdoor" : ""} · effort {s.rpe}
                {s.max_grade && ` · ${s.max_grade}`}
                <span className="muted"> · load {s.duration_min * s.rpe}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
