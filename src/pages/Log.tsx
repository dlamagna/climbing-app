import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { type InjuryDraft, EMPTY_DRAFT, QuickInjury, draftBody } from "../components/injury";
import { Chips, Field, PageHeader, Stepper, range } from "../components/ui";
import { addDays, localToday, prettyDate } from "../dates";
import { SESSION_TYPES, type Session } from "../types";

export const EFFORT_HINT: Record<number, string> = {
  1: "barely anything",
  3: "easy",
  5: "moderate",
  7: "hard",
  9: "near max",
  10: "all out",
};

export function effortHint(rpe: number | null) {
  if (rpe === null) return "";
  const keys = Object.keys(EFFORT_HINT).map(Number);
  return EFFORT_HINT[keys.filter((k) => k <= rpe).pop()!];
}

// #/log?edit=<id> opens an existing session (tapped in History) prefilled.
export default function Log() {
  const editId = new URLSearchParams(location.hash.split("?")[1]).get("edit");
  const { data, error } = useApi<Session>(editId ? `/sessions/${editId}` : null);

  if (editId && !data) {
    return (
      <div className="page">
        <PageHeader title="Edit session" back="#/history" />
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }
  return <SessionForm session={data} />;
}

function SessionForm({ session }: { session: Session | null }) {
  const today = localToday();
  const [date, setDate] = useState(session?.date ?? today);
  const [type, setType] = useState<string | null>(session?.type ?? null);
  const [duration, setDuration] = useState(session?.duration_min ?? 90);
  const [rpe, setRpe] = useState<number | null>(session?.rpe ?? null);
  const [grade, setGrade] = useState(session?.max_grade ?? "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [injury, setInjury] = useState<InjuryDraft | null>(null);
  const [linked, setLinked] = useState(true);
  const [busy, setBusy] = useState(false);
  const ready = type !== null && rpe !== null && (!injury || injury.part !== null);

  const dates = [today, addDays(today, -1), addDays(today, -2)];
  if (!dates.includes(date)) dates.push(date); // an older session being edited
  const dateLabel = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : prettyDate(d));

  async function submit() {
    setBusy(true);
    try {
      const body = {
        date,
        type,
        duration_min: duration,
        rpe,
        max_grade: grade.trim() || null,
        notes: notes.trim() || null,
        new_injury: injury && { ...draftBody(injury), link: linked },
      };
      if (session) {
        savedToast(await send("PUT", `/sessions/${session.id}`, body), "Session updated");
        location.hash = "#/history";
      } else {
        savedToast(await send("POST", "/sessions", body), injury ? "Session and injury logged" : "Session logged");
        location.hash = "#/today";
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {session ? <PageHeader title="Edit session" back="#/history" /> : <PageHeader title="Log session" />}
      <div className="form">
        <Field label="When">
          <Chips
            options={dates.map((d) => ({ value: d, label: dateLabel(d) }))}
            value={date}
            onChange={(v) => v && setDate(v)}
          />
        </Field>
        <Field label="What">
          <Chips wrap options={SESSION_TYPES} value={type} onChange={setType} />
        </Field>
        <Field label="How long">
          <div className="row">
            <Stepper value={duration} step={15} min={5} max={360} format={(v) => `${v} min`} onChange={setDuration} />
            <Chips options={[45, 60, 90, 120].map((v) => ({ value: v, label: String(v) }))} value={duration} onChange={(v) => v && setDuration(v)} />
          </div>
        </Field>
        <Field label="How hard overall" hint={effortHint(rpe)}>
          <Chips wrap options={range(1, 10).map((v) => ({ value: v, label: String(v) }))} value={rpe} onChange={setRpe} />
        </Field>
        <Field label="Hardest send" hint="optional">
          <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. 6C, V5, 7a" autoCapitalize="characters" />
        </Field>
        <Field label="Notes" hint="optional">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you worked on, how fingers felt…" />
        </Field>
        {injury ? (
          <QuickInjury draft={injury} onChange={setInjury} onRemove={() => setInjury(null)}>
            <Field label="Happened in this session?">
              <Chips
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No, just noticed it" },
                ]}
                value={linked ? "yes" : "no"}
                onChange={(v) => v && setLinked(v === "yes")}
              />
            </Field>
          </QuickInjury>
        ) : (
          <button type="button" className="link" onClick={() => setInjury(EMPTY_DRAFT)}>
            + new injury
          </button>
        )}
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {ready ? "Save" : type === null || rpe === null ? "Pick what and how hard" : "Pick where the injury is"}
        </button>
      </div>
    </div>
  );
}
