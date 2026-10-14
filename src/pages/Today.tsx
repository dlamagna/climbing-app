import { useState } from "react";
import { HttpError, savedToast, send, useApi } from "../api";
import { Card, Chips, DatePicker, Field, Stepper, range } from "../components/ui";
import { dayLabel, localToday, prettyDate } from "../dates";
import { type Checkin, type Injury, type LoadStats, type PlanEntry, type TodayView, typeLabel } from "../types";

export const FEELING = ["", "Wrecked", "Tired", "OK", "Good", "Fresh"];
export const SLEEP_QUALITY = ["", "Bad", "OK", "Good"];

export default function Today() {
  const today = localToday();
  const { data, error, reload, setData } = useApi<TodayView>(`/today?date=${today}`);
  const [editing, setEditing] = useState(false);

  if (!data) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  const todaysPlan = data.plan.filter((p) => p.date === today);
  const upcoming = data.plan.filter((p) => p.date > today);
  const note = data.coach_notes[0];

  return (
    <div className="page">
      <header className="page-head">
        <h1>{prettyDate(today)}</h1>
      </header>

      {data.injuries.length > 0 && <InjuryPain injuries={data.injuries} today={today} onSaved={reload} />}

      {data.checkin && !editing ? (
        <CheckinSummary checkin={data.checkin} onEdit={() => setEditing(true)} />
      ) : (
        <Card title="Morning check-in" tone="accent">
          <CheckinForm
            date={today}
            initial={data.checkin}
            defaults={data.last_checkin}
            onSaved={(c) => {
              setData({ ...data, checkin: c });
              setEditing(false);
            }}
          />
        </Card>
      )}

      {note && (
        <Card title={`Coach · ${dayLabel(note.date, today)}`}>
          <p className="prewrap">{note.text}</p>
        </Card>
      )}

      <Card title="Today's plan">
        {todaysPlan.length ? (
          todaysPlan.map((p) => <PlanItem key={p.id} entry={p} />)
        ) : (
          <p className="muted">Nothing planned. Ask Claude to write your plan, or add one under More → Plan.</p>
        )}
        {upcoming.length > 0 && (
          <ul className="mini-list">
            {upcoming.map((p) => (
              <li key={p.id}>
                <span className="muted">{dayLabel(p.date, today)}</span> {p.title}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="actions">
        <a className="btn primary" href="#/log">
          Log session
        </a>
        <a className="btn" href="#/timer">
          Hangboard timer
        </a>
      </div>

      {data.sessions.length > 0 && (
        <Card title="Done today">
          <ul className="mini-list">
            {data.sessions.map((s) => (
              <li key={s.id}>
                {typeLabel(s.type)} · {s.duration_min} min · effort {s.rpe}
                {s.max_grade && ` · ${s.max_grade}`}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LoadCard load={data.load} />
    </div>
  );
}

export function PlanItem({ entry }: { entry: PlanEntry }) {
  return (
    <div className="plan-item">
      <div className="plan-title">
        <strong>{entry.title}</strong>
        {entry.intensity && <span className={`tag ${entry.intensity}`}>{entry.intensity}</span>}
      </div>
      {entry.details && <p className="prewrap muted">{entry.details}</p>}
    </div>
  );
}

function CheckinSummary({ checkin: c, onEdit }: { checkin: Checkin; onEdit: () => void }) {
  return (
    <Card
      title="Check-in done"
      action={
        <button className="link" onClick={onEdit}>
          Edit
        </button>
      }
    >
      <div className="stats">
        <Stat label="Sleep" value={`${c.sleep_hours ?? "?"}h`} sub={SLEEP_QUALITY[c.sleep_quality ?? 0]} />
        <Stat label="Feeling" value={FEELING[c.feeling ?? 0] || "?"} />
        <Stat label="Drinks" value={c.drinks === null ? "?" : c.drinks >= 5 ? "5+" : String(c.drinks)} sub="yesterday" />
        <Stat label="Protein" value={c.protein ?? "?"} sub="yesterday" />
      </div>
    </Card>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// With editDate (editing from History) the date can be changed, which moves the check-in to that day.
export function CheckinForm({
  date,
  initial,
  defaults,
  onSaved,
  editDate = false,
}: {
  date: string;
  initial: Checkin | null;
  defaults: Checkin | null;
  onSaved: (c: Checkin) => void;
  editDate?: boolean;
}) {
  // Prefill the "boring" fields so a normal day is three taps: sleep quality, feeling, save.
  const [c, setC] = useState<Checkin>(
    initial ?? {
      date,
      sleep_hours: defaults?.sleep_hours ?? 7.5,
      sleep_quality: null,
      feeling: null,
      drinks: 0,
      protein: "ok",
      weight_kg: null,
      note: null,
    },
  );
  const [more, setMore] = useState(Boolean(initial?.weight_kg || initial?.note));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Checkin>(k: K, v: Checkin[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const ready = c.sleep_quality !== null && c.feeling !== null;

  async function submit() {
    setBusy(true);
    try {
      let result;
      try {
        result = await send("PUT", `/checkins/${date}`, c);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 409)) throw e;
        if (!confirm(`${prettyDate(c.date)} already has a check-in. Replace it with this one?`)) return;
        result = await send("PUT", `/checkins/${date}`, { ...c, overwrite: true });
      }
      savedToast(result, "Check-in saved");
      onSaved(c);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      {editDate && (
        <Field label="Morning of">
          <DatePicker value={c.date} onChange={(v) => set("date", v)} />
        </Field>
      )}
      <Field label="Sleep">
        <div className="row">
          <Stepper value={c.sleep_hours ?? 7.5} step={0.5} min={0} max={14} format={(v) => `${v}h`} onChange={(v) => set("sleep_hours", v)} />
          <Chips
            options={[1, 2, 3].map((v) => ({ value: v, label: SLEEP_QUALITY[v] }))}
            value={c.sleep_quality}
            onChange={(v) => set("sleep_quality", v)}
          />
        </div>
      </Field>
      <Field label="How do you feel?" hint="energy + soreness">
        <Chips options={range(1, 5).map((v) => ({ value: v, label: FEELING[v] }))} value={c.feeling} onChange={(v) => set("feeling", v)} />
      </Field>
      <Field label="Drinks yesterday">
        <Chips
          options={range(0, 5).map((v) => ({ value: v, label: v === 5 ? "5+" : String(v) }))}
          value={c.drinks}
          onChange={(v) => set("drinks", v)}
        />
      </Field>
      <Field label="Protein yesterday" hint="rough guess">
        <Chips
          options={[
            { value: "low", label: "Low" },
            { value: "ok", label: "OK" },
            { value: "high", label: "High" },
          ]}
          value={c.protein}
          onChange={(v) => set("protein", v)}
        />
      </Field>
      {more ? (
        <>
          <Field label="Weight (kg)" hint="optional">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={c.weight_kg ?? ""}
              onChange={(e) => set("weight_kg", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Note" hint="optional">
            <textarea rows={2} value={c.note ?? ""} onChange={(e) => set("note", e.target.value || null)} />
          </Field>
        </>
      ) : (
        <button type="button" className="link" onClick={() => setMore(true)}>
          + weight / note
        </button>
      )}
      <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
        {ready ? "Save" : "Pick sleep quality and feeling"}
      </button>
    </div>
  );
}

function InjuryPain({ injuries, today, onSaved }: { injuries: Injury[]; today: string; onSaved: () => void }) {
  async function rate(id: number, pain: number | null) {
    if (pain === null) return;
    savedToast(await send("POST", `/injuries/${id}/updates`, { date: today, pain }));
    onSaved();
  }
  return (
    <Card title="Injury check" tone="warn">
      {injuries.map((inj) => {
        const todays = inj.updates?.find((u) => u.date === today);
        const last = inj.updates?.find((u) => u.date !== today);
        return (
          <Field
            key={inj.id}
            label={`${inj.body_part}${inj.side ? ` (${inj.side})` : ""} - pain today`}
            hint={last ? `last: ${last.pain} on ${dayLabel(last.date, today)}` : undefined}
          >
            <Chips wrap options={range(0, 10).map((v) => ({ value: v, label: String(v) }))} value={todays?.pain} onChange={(v) => rate(inj.id, v)} />
          </Field>
        );
      })}
    </Card>
  );
}

export function loadMessage(ratio: number | null, last7: number): { tone: "" | "warn" | "bad"; text: string } {
  if (ratio === null) {
    return { tone: "", text: last7 ? "Comparison kicks in once there are a few weeks of history." : "No sessions in the last 7 days." };
  }
  if (ratio > 1.5) return { tone: "bad", text: "Much more than your usual week. Go easy." };
  if (ratio > 1.3) return { tone: "warn", text: "Ramping up fast compared to your usual week." };
  if (ratio < 0.7) return { tone: "", text: "Lighter than your usual week." };
  return { tone: "", text: "In line with your usual week." };
}

export function LoadCard({ load }: { load: LoadStats }) {
  const msg = loadMessage(load.ratio_total, load.last7.total);
  const fingerHigh = (load.ratio_finger ?? 0) > 1.3;
  return (
    <Card title="Training load · last 7 days">
      <div className="stats">
        <Stat label="Total" value={String(load.last7.total)} sub={`usual ${load.prev28_weekly_avg.total}`} />
        <Stat label="Fingers" value={String(load.last7.finger)} sub={`usual ${load.prev28_weekly_avg.finger}`} />
      </div>
      <p className={`muted small ${msg.tone}`}>{msg.text}</p>
      {fingerHigh && <p className="small warn">Finger load is up a lot - tendons adapt slower than muscle.</p>}
      <p className="muted small">Load = minutes × effort, worked out from what you log.</p>
    </Card>
  );
}
