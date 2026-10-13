import { useState } from "react";
import { send, useApi } from "../api";
import { Card, PageHeader } from "../components/ui";
import { addDays, dayLabel, localToday, prettyDate } from "../dates";
import { type HistoryView, type WeekLoad, typeLabel } from "../types";
import { FEELING, SLEEP_QUALITY } from "./Today";

export default function History() {
  const today = localToday();
  const { data, error, reload } = useApi<HistoryView>(`/history?from=${addDays(today, -55)}&to=${today}`);

  if (!data) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  const dates = [...new Set([...data.sessions, ...data.checkins, ...data.hangs].map((r) => r.date))].sort().reverse();

  async function remove(kind: "sessions" | "hangs", id: number) {
    if (!confirm("Delete this entry?")) return;
    await send("DELETE", `/${kind}/${id}`);
    reload();
  }

  return (
    <div className="page">
      <PageHeader title="History" sub="Last 8 weeks" />
      <Card title="Weekly training load">
        <LoadChart weeks={data.load.weeks} />
      </Card>

      {dates.length === 0 && <p className="muted">Nothing logged yet.</p>}
      {dates.map((date) => {
        const c = data.checkins.find((x) => x.date === date);
        const sessions = data.sessions.filter((s) => s.date === date);
        const hangs = data.hangs.filter((h) => h.date === date);
        return (
          <section key={date} className="day">
            <h3>{dayLabel(date, today)}</h3>
            {c && (
              <p className="muted small">
                Sleep {c.sleep_hours ?? "?"}h {SLEEP_QUALITY[c.sleep_quality ?? 0]?.toLowerCase()} · {FEELING[c.feeling ?? 0] || "?"} ·{" "}
                {c.drinks ?? "?"} drinks · protein {c.protein ?? "?"}
                {c.weight_kg ? ` · ${c.weight_kg}kg` : ""}
                {c.note ? ` · ${c.note}` : ""}
              </p>
            )}
            {sessions.map((s) => (
              <div key={s.id} className="entry">
                <div>
                  <strong>{typeLabel(s.type)}</strong> {s.duration_min} min · effort {s.rpe}
                  {s.max_grade && ` · ${s.max_grade}`}
                  <span className="muted"> · load {s.duration_min * s.rpe}</span>
                  {s.notes && <div className="muted small prewrap">{s.notes}</div>}
                </div>
                <button className="icon-btn" aria-label="Delete session" onClick={() => remove("sessions", s.id)}>
                  ×
                </button>
              </div>
            ))}
            {hangs.map((h) => (
              <div key={h.id} className="entry">
                <div className="small">
                  🖐 {h.preset}: {h.completed_reps}/{h.reps * h.sets} hangs · {h.on_s}s on
                  {h.edge_mm ? ` · ${h.edge_mm}mm` : ""}
                  {h.grip ? ` ${h.grip}` : ""}
                  {h.added_kg ? ` · ${h.added_kg > 0 ? "+" : ""}${h.added_kg}kg` : ""}
                </div>
                <button className="icon-btn" aria-label="Delete hangboard log" onClick={() => remove("hangs", h.id)}>
                  ×
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// Stacked bars per week: finger load (bottom) + everything else (top). Tap a week for its numbers.
function LoadChart({ weeks }: { weeks: WeekLoad[] }) {
  const [picked, setPicked] = useState(weeks.length - 1);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const w = weeks[picked];

  return (
    <div className="viz">
      <div className="legend">
        <span>
          <i className="swatch finger" /> Fingers
        </span>
        <span>
          <i className="swatch other" /> Other
        </span>
      </div>
      <div className="bars" role="list">
        {weeks.map((wk, i) => {
          const other = wk.total - wk.finger;
          return (
            <button
              key={wk.week_start}
              role="listitem"
              className={i === picked ? "bar-col picked" : "bar-col"}
              aria-label={`Week of ${prettyDate(wk.week_start)}: ${wk.total} total, ${wk.finger} fingers`}
              onClick={() => setPicked(i)}
            >
              <span className="bar-total">{wk.total || ""}</span>
              <span className="bar-stack" style={{ height: `calc(${wk.total / max} * (100% - 18px))` }}>
                {other > 0 && <span className="seg other" style={{ flexGrow: other }} />}
                {wk.finger > 0 && <span className="seg finger" style={{ flexGrow: wk.finger }} />}
              </span>
              <span className="bar-label">{wk.week_start.slice(8)}/{wk.week_start.slice(5, 7)}</span>
            </button>
          );
        })}
      </div>
      {w && (
        <p className="small viz-detail">
          Week of {prettyDate(w.week_start)}: <strong>{w.total}</strong> total · {w.finger} fingers · {w.sessions} sessions
        </p>
      )}
    </div>
  );
}
