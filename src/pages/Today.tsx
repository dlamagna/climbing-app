import { useState } from "react";
import { HttpError, isQueued, savedToast, send, toast, useApi } from "../api";
import {
  type FollowUp,
  type InjuryDraft,
  EMPTY_DRAFT,
  FollowUpRow,
  QuickInjury,
  draftBody,
  initialFollowUp,
  injuryName,
  redFlagLabels,
  trendLabel,
} from "../components/injury";
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

      {data.checkin && !editing ? (
        <CheckinSummary checkin={data.checkin} injuries={data.injuries} today={today} onEdit={() => setEditing(true)} />
      ) : (
        <Card title="Morning check-in" tone="accent">
          <CheckinForm
            date={today}
            initial={data.checkin}
            defaults={data.last_checkin}
            injuries={data.injuries}
            onSaved={(c, followUps, queued) => {
              // Shown straight away (also covers a queued offline save); a reload then picks up new injuries.
              setData({ ...data, checkin: c, injuries: applyFollowUps(data.injuries, today, followUps) });
              setEditing(false);
              if (!queued) reload();
              const gone = data.injuries.filter((i) => followUps.some((f) => f.injury_id === i.id && f.trend === "gone"));
              if (gone.length) {
                toast(`${gone.map(injuryName).join(", ")} marked healed${queued ? " (offline)" : ""}`, {
                  label: "Undo",
                  run: async () => {
                    for (const inj of gone) await send("POST", `/injuries/${inj.id}/reopen`, { undo_date: today });
                    reload();
                  },
                });
              }
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

// Applies the check-in's follow-ups locally: today's update replaces any earlier one, "gone" drops the injury.
function applyFollowUps(injuries: Injury[], date: string, followUps: FollowUp[]): Injury[] {
  return injuries.flatMap((inj) => {
    const f = followUps.find((u) => u.injury_id === inj.id);
    if (!f) return [inj];
    if (f.trend === "gone") return [];
    const update = {
      date,
      pain: f.pain!,
      trend: f.trend,
      stiffness: f.stiffness,
      red_flags: f.red_flags.join(",") || null,
      note: null,
    };
    return [{ ...inj, updates: [update, ...(inj.updates ?? []).filter((u) => u.date !== date)] }];
  });
}

function CheckinSummary({
  checkin: c,
  injuries,
  today,
  onEdit,
}: {
  checkin: Checkin;
  injuries: Injury[];
  today: string;
  onEdit: () => void;
}) {
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
      {injuries.length > 0 && (
        <ul className="mini-list">
          {injuries.map((inj) => {
            const u = inj.updates?.find((u) => u.date === today);
            const flags = redFlagLabels(u?.red_flags ?? null);
            return (
              <li key={inj.id}>
                {injuryName(inj)}:{" "}
                {u ? (
                  <>
                    {[trendLabel(u.trend), `pain ${u.pain}`, u.stiffness ? "stiff" : ""].filter(Boolean).join(" · ")}
                    {flags.length > 0 && <span className="warn"> · {flags.join(", ")}</span>}
                  </>
                ) : (
                  <span className="muted">not checked today</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
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
  injuries = [],
  onSaved,
  editDate = false,
}: {
  date: string;
  initial: Checkin | null;
  defaults: Checkin | null;
  injuries?: Injury[];
  onSaved: (c: Checkin, followUps: FollowUp[], queued: boolean) => void;
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
  const [followUps, setFollowUps] = useState<Record<number, FollowUp>>(() =>
    Object.fromEntries(injuries.map((inj) => [inj.id, initialFollowUp(inj, date)])),
  );
  const [draft, setDraft] = useState<InjuryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Checkin>(k: K, v: Checkin[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const touched = Object.values(followUps).filter((f) => f.touched);
  const unrated = injuries.find((inj) => touched.some((f) => f.injury_id === inj.id && f.pain === null));
  const ready = c.sleep_quality !== null && c.feeling !== null && !unrated && (!draft || draft.part !== null);

  async function submit() {
    setBusy(true);
    try {
      const body = {
        ...c,
        injuries: touched.map(({ injury_id, trend, pain, stiffness, red_flags }) => ({ injury_id, trend, pain, stiffness, red_flags })),
        new_injuries: draft ? [draftBody(draft)] : [],
      };
      let result;
      try {
        result = await send("PUT", `/checkins/${date}`, body);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 409)) throw e;
        if (!confirm(`${prettyDate(c.date)} already has a check-in. Replace it with this one?`)) return;
        result = await send("PUT", `/checkins/${date}`, { ...body, overwrite: true });
      }
      savedToast(result, "Check-in saved");
      onSaved(c, touched, isQueued(result));
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
      {injuries.map((inj) => (
        <FollowUpRow
          key={inj.id}
          injury={inj}
          date={date}
          value={followUps[inj.id] ?? initialFollowUp(inj, date)}
          onChange={(f) => setFollowUps((prev) => ({ ...prev, [inj.id]: f }))}
        />
      ))}
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
      {draft ? (
        <QuickInjury draft={draft} onChange={setDraft} onRemove={() => setDraft(null)} />
      ) : (
        <button type="button" className="link" onClick={() => setDraft(EMPTY_DRAFT)}>
          + new injury
        </button>
      )}
      <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
        {ready
          ? "Save"
          : c.sleep_quality === null || c.feeling === null
            ? "Pick sleep quality and feeling"
            : unrated
              ? `Pick a pain score for ${injuryName(unrated)}`
              : "Pick where the new injury is"}
      </button>
    </div>
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
