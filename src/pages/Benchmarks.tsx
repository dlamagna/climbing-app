import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { LineChart } from "../components/LineChart";
import { Card, Field, PageHeader } from "../components/ui";
import { DISCIPLINE_NAMES, useAllSessions } from "../grades";
import { GradeSummary } from "./GradeProgress";
import { gradeProgress } from "../../worker/grades";
import { addDays, localToday, prettyDate } from "../dates";
import { type BenchmarkSeries, benchmarkSeries, formatClock, type Point, rollingAverage } from "../progress";
import type { Benchmark } from "../types";

const SUGGESTED = [
  { name: "Max hang 20mm 10s", unit: "kg added" },
  { name: "Max pull-ups", unit: "reps" },
  { name: "Weighted pull-up 1RM", unit: "kg added" },
  { name: "Hardest boulder", unit: "grade" },
  { name: "Hardest route", unit: "grade" },
  { name: "Bodyweight", unit: "kg" },
];

const WEIGHT_DAYS = 84; // bodyweight chart: last 12 weeks

export default function Benchmarks() {
  const { data, error, reload } = useApi<Benchmark[]>("/benchmarks");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");

  async function submit() {
    savedToast(await send("POST", "/benchmarks", { date: localToday(), name: name.trim(), value: value.trim(), unit: unit.trim() || null }), "Benchmark saved");
    setValue("");
    reload();
  }

  async function remove(id: number) {
    if (!confirm("Delete this result?")) return;
    await send("DELETE", `/benchmarks/${id}`);
    reload();
  }

  const series = benchmarkSeries(data ?? []);
  const names = series.map((s) => s.name);

  return (
    <div className="page">
      <PageHeader title="Benchmarks" sub="Test at the start, middle and end of the block." back="#/more" />
      <Card title="Add a result">
        <div className="form">
          <Field label="Test">
            <input list="bench-names" value={name} placeholder="e.g. Max hang 20mm 10s"
              onChange={(e) => {
                setName(e.target.value);
                const s = SUGGESTED.find((x) => x.name === e.target.value);
                if (s) setUnit(s.unit);
              }} />
            <datalist id="bench-names">{[...new Set([...names, ...SUGGESTED.map((s) => s.name)])].map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <div className="grid2">
            <Field label="Result"><input value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
          </div>
          <button className="btn primary block" disabled={!name.trim() || !value.trim()} onClick={submit}>Save</button>
        </div>
      </Card>
      <HardestGradeCard />
      <BodyweightCard />
      {error && <p className="error">{error}</p>}
      {data && series.length === 0 && (
        <Card title="Tests">
          <p className="muted small">No results yet. Tests planned on your plan show up in the session log on that day, or add one above.</p>
        </Card>
      )}
      {series.map((s) => (
        <BenchmarkCard key={s.key} series={s} onDelete={remove} />
      ))}
    </div>
  );
}

function BenchmarkCard({ series: s, onDelete }: { series: BenchmarkSeries<Benchmark>; onDelete: (id: number) => void }) {
  const unit = s.unit ? ` ${s.unit}` : "";
  const format = s.clock ? formatClock : (v: number) => String(Number(v.toFixed(2)));
  return (
    <Card title={s.unit ? `${s.name} (${s.unit})` : s.name}>
      {s.points.length >= 2 ? (
        <LineChart
          points={s.points}
          clock={s.clock}
          format={format}
          label={`${s.name} over time`}
          detail={(date) => (
            <>
              {prettyDate(date)}: <strong>{s.points.filter((p) => p.date === date).map((p) => p.label).join(" / ")}</strong>
              {unit}
            </>
          )}
        />
      ) : (
        <p className="muted small">
          {s.points.length === 1 ? "One result so far: the chart starts with the second." : "Only numbers and times are charted; grades and notes are listed below."}
        </p>
      )}
      {s.points.length >= 2 && s.skipped > 0 && (
        <p className="muted small">{s.skipped === 1 ? "1 result isn't a number and is" : `${s.skipped} results aren't numbers and are`} listed but not charted.</p>
      )}
      {s.rows.map((b) => (
        <div key={b.id} className="entry">
          <span><strong>{b.value}</strong> {b.unit} <span className="muted small">· {prettyDate(b.date)}</span></span>
          <button className="icon-btn" aria-label="Delete" onClick={() => onDelete(b.id)}>×</button>
        </div>
      ))}
    </Card>
  );
}

// Weigh-ins from the morning check-in: each day faint, with the 7-day rolling average as the line.
function BodyweightCard() {
  const today = localToday();
  const from = addDays(today, -(WEIGHT_DAYS - 1));
  // 6 extra days before the window so the first average in it is a full 7-day one.
  const { data, error } = useApi<{ date: string; weight_kg: number }[]>(`/weights?from=${addDays(from, -6)}&to=${today}`);

  if (!data) return error ? <p className="error">{error}</p> : null;
  const all: Point[] = data.map((r) => ({ date: r.date, value: r.weight_kg }));
  const daily = all.filter((p) => p.date >= from);
  const avg = rollingAverage(all).filter((p) => p.date >= from);
  const kg = (v: number) => v.toFixed(1);

  return (
    <Card title="Bodyweight (kg)">
      {daily.length === 0 ? (
        <p className="muted small">No weigh-ins in the last 12 weeks. Add your weight in the morning check-in to see the trend here.</p>
      ) : (
        <>
          <p className="muted small">
            Last 12 weeks · <i className="lc-key dot" /> daily · <i className="lc-key line" /> 7-day average
          </p>
          <LineChart
            points={avg}
            dots={daily}
            markers={false}
            gapDays={7}
            format={kg}
            label="Bodyweight, daily and 7-day average"
            detail={(date) => {
              const d = daily.find((p) => p.date === date);
              const a = avg.find((p) => p.date === date);
              return (
                <>
                  {prettyDate(date)}: <strong>{d ? kg(d.value) : "?"} kg</strong>
                  {a && <span className="muted"> · 7-day average {kg(a.value)} kg</span>}
                </>
              );
            }}
          />
          <details className="small">
            <summary className="muted">All weigh-ins</summary>
            {[...daily].reverse().map((p) => (
              <div key={p.date} className="entry">
                <span>
                  <strong>{kg(p.value)}</strong> kg <span className="muted">· {prettyDate(p.date)}</span>
                </span>
                <span className="muted">avg {kg(avg.find((a) => a.date === p.date)!.value)}</span>
              </div>
            ))}
          </details>
        </>
      )}
    </Card>
  );
}

// The hardest grade logged per discipline (from sessions' max grade), linking to the chart over time.
function HardestGradeCard() {
  const { sessions, today } = useAllSessions();
  if (!sessions) return null;
  const progress = gradeProgress(sessions, today);
  const disciplines = (["boulder", "route"] as const).filter((d) => progress[d]);
  return (
    <Card title="Hardest grade" action={disciplines.length > 0 && <a className="link" href="#/grade-progress">Over time ›</a>}>
      {disciplines.length === 0 ? (
        <p className="muted small">No grades logged yet. Add your hardest grade when you log a climbing session.</p>
      ) : (
        disciplines.map((d) => (
          <div key={d} className="grade-block">
            <strong className="small">{DISCIPLINE_NAMES[d]}</strong>
            <GradeSummary discipline={d} progress={progress[d]!} />
          </div>
        ))
      )}
    </Card>
  );
}
