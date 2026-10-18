import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { WeekSoFar } from "../components/planStatus";
import { Card, Chips, Field, PageHeader } from "../components/ui";
import { addDays, dayLabel, localToday } from "../dates";
import type { PlanEntry } from "../types";
import { PlanItem } from "./Today";

const INTENSITIES = ["rest", "easy", "moderate", "hard"].map((v) => ({ value: v, label: v }));

export default function Plan() {
  const today = localToday();
  // From a week back, so past days show what happened (and Monday onwards feeds the week-so-far line).
  const { data, error, reload } = useApi<PlanEntry[]>(`/plan?from=${addDays(today, -7)}&to=${addDays(today, 41)}&today=${today}`);
  const [adding, setAdding] = useState(false);

  async function remove(id: number) {
    if (!confirm("Remove this from the plan?")) return;
    await send("DELETE", `/plan/${id}`);
    reload();
  }

  const dates = [...new Set((data ?? []).map((p) => p.date))];

  return (
    <div className="page">
      <PageHeader title="Plan" sub="Last week and the next 6" back="#/more" />
      <Card tone="accent">
        <p className="small">
          Easiest way to fill this: ask Claude something like <em>"Write my training plan for the next 4 weeks"</em>. It reads your profile and
          history, then saves the plan here.
        </p>
      </Card>
      {adding ? <AddEntry today={today} onDone={() => (setAdding(false), reload())} /> : (
        <button className="btn block" onClick={() => setAdding(true)}>+ Add a session by hand</button>
      )}
      {data && <WeekSoFar entries={data} today={today} />}
      {error && <p className="error">{error}</p>}
      {data && dates.length === 0 && <p className="muted">Nothing planned yet.</p>}
      {dates.map((d) => (
        <section key={d} className="day">
          <h3>{dayLabel(d, today)}</h3>
          {data!.filter((p) => p.date === d).map((p) => (
            <div key={p.id} className="entry">
              <PlanItem entry={p} today={today} onChanged={reload} />
              <button className="icon-btn" aria-label="Remove" onClick={() => remove(p.id)}>×</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function AddEntry({ today, onDone }: { today: string; onDone: () => void }) {
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [intensity, setIntensity] = useState<string | null>(null);
  const [details, setDetails] = useState("");

  async function submit() {
    savedToast(await send("POST", "/plan", { date, title: title.trim(), intensity, details: details.trim() || null }), "Added to plan");
    onDone();
  }

  return (
    <Card title="Add to plan">
      <div className="form">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="What"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Limit bouldering" /></Field>
        <Field label="Intensity"><Chips options={INTENSITIES} value={intensity} onChange={setIntensity} /></Field>
        <Field label="Details" hint="optional"><textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <div className="actions">
          <button className="btn" onClick={onDone}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || !date} onClick={submit}>Add</button>
        </div>
      </div>
    </Card>
  );
}
