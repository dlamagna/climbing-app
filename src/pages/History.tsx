import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { TagList } from "../components/TagPicker";
import { TrainingMix } from "../components/TrainingMix";
import { TypeWeekChart } from "../components/TypeWeekChart";
import { Card, Chips, OverflowMenu, PageHeader } from "../components/ui";
import { addDays, dayLabel, localToday, prettyDate } from "../dates";
import { type HistoryView, type WeekLoad, typeLabel } from "../types";
import { FEELING, SLEEP_QUALITY } from "./Today";
import { baselineNote } from "../progress";

export default function History() {
  const today = localToday();
  const from = addDays(today, -55);
  const { data, error, reload } = useApi<HistoryView>(`/history?from=${from}&to=${today}`);
  const [chart, setChart] = useState<"load" | "type">("load");

  if (!data) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  const dates = [...new Set([...data.sessions, ...data.checkins, ...data.hangs].map((r) => r.date))].sort().reverse();

  async function remove(what: string, path: string) {
    if (!confirm(`Delete this ${what}? This can't be undone.`)) return;
    try {
      savedToast(await send("DELETE", path), "Deleted");
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="page">
      <PageHeader title="History" sub="Last 8 weeks · ⋯ to edit or delete an entry" />
      <Card title={chart === "load" ? "Weekly training load" : "Weekly minutes by type"}>
        <div className="view-toggle">
          <Chips
            options={[
              { value: "load", label: "Fingers / other" },
              { value: "type", label: "By type" },
            ]}
            value={chart}
            onChange={(v) => v && setChart(v)}
          />
        </div>
        {chart === "load" ? (
          <LoadChart weeks={data.load.weeks} baseline={baselineNote(data.load)} />
        ) : (
          <TypeWeekChart weekStarts={data.load.weeks.map((w) => w.week_start)} sessions={data.sessions} />
        )}
      </Card>
      <TrainingMix sessions={data.sessions} from={from} today={today} />

      {dates.length === 0 && <p className="muted">Nothing logged yet.</p>}
      {dates.map((date) => {
        const c = data.checkins.find((x) => x.date === date);
        const sessions = data.sessions.filter((s) => s.date === date);
        const hangs = data.hangs.filter((h) => h.date === date);
        return (
          <section key={date} className="day">
            <h3>{dayLabel(date, today)}</h3>
            {c && (
              <div className="entry">
                <p className="muted small">
                  Sleep {c.sleep_hours ?? "?"}h {SLEEP_QUALITY[c.sleep_quality ?? 0]?.toLowerCase()} · {FEELING[c.feeling ?? 0] || "?"} ·{" "}
                  {c.drinks ?? "?"} drinks · protein {c.protein ?? "?"}
                  {c.weight_kg ? ` · ${c.weight_kg}kg` : ""}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
                <OverflowMenu
                  label="Check-in options"
                  items={[
                    { label: "Edit", onSelect: () => (location.hash = `#/checkin?date=${c.date}`) },
                    { label: "Delete", danger: true, onSelect: () => remove("check-in", `/checkins/${c.date}`) },
                  ]}
                />
              </div>
            )}
            {sessions.map((s) => (
              <div key={s.id} className="entry">
                <a className="entry-link" href={`#/log?edit=${s.id}`} aria-label={`Edit ${typeLabel(s.type)} session`}>
                  <strong>{typeLabel(s.type)}</strong> {s.duration_min} min · effort {s.rpe}
                  {s.max_grade && ` · ${s.max_grade}`}
                  <TagList tags={s.tags} />
                  <span className="muted"> · load {s.duration_min * s.rpe}</span>
                  {s.updated_at && <span className="muted small"> · edited</span>}
                  {s.notes && <div className="muted small prewrap">{s.notes}</div>}
                </a>
                <OverflowMenu
                  label={`${typeLabel(s.type)} session options`}
                  items={[
                    { label: "Edit", onSelect: () => (location.hash = `#/log?edit=${s.id}`) },
                    { label: "Delete", danger: true, onSelect: () => remove("session", `/sessions/${s.id}`) },
                  ]}
                />
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
                <OverflowMenu
                  label="Hangboard log options"
                  items={[{ label: "Delete", danger: true, onSelect: () => remove("hangboard log", `/hangs/${h.id}`) }]}
                />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// Stacked bars per week: finger load (bottom) + everything else (top). Tap a week for its numbers.
// The bars split the raw total; the detail line also gives the weighted finger load (type and style tags) when it differs.
function LoadChart({ weeks, baseline }: { weeks: WeekLoad[]; baseline?: string | null }) {
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
      {baseline && <p className="muted small load-baseline">{baseline}</p>}
      <div className="bars" role="list">
        {weeks.map((wk, i) => {
          const other = wk.total - wk.finger_raw;
          return (
            <button
              key={wk.week_start}
              role="listitem"
              className={i === picked ? "bar-col picked" : "bar-col"}
              aria-label={`Week of ${prettyDate(wk.week_start)}: ${wk.total} total, ${wk.finger_raw} fingers`}
              onClick={() => setPicked(i)}
            >
              <span className="bar-total">{wk.total || ""}</span>
              <span className="bar-stack" style={{ height: `calc(${wk.total / max} * (100% - 18px))` }}>
                {other > 0 && <span className="seg other" style={{ flexGrow: other }} />}
                {wk.finger_raw > 0 && <span className="seg finger" style={{ flexGrow: wk.finger_raw }} />}
              </span>
              <span className="bar-label">{wk.week_start.slice(8)}/{wk.week_start.slice(5, 7)}</span>
            </button>
          );
        })}
      </div>
      {w && (
        <p className="small viz-detail">
          Week of {prettyDate(w.week_start)}: <strong>{w.total}</strong> total · {w.finger_raw} fingers
          {w.finger !== w.finger_raw && ` (${w.finger} weighted)`} · {w.sessions} sessions
        </p>
      )}
    </div>
  );
}
