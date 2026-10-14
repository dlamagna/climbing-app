import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { Chips, DatePicker, Field, PageHeader, Stepper, range } from "../components/ui";
import { localToday } from "../dates";
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

// #/log?edit=<id> opens an existing session (from History) prefilled.
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
  const [date, setDate] = useState(session?.date ?? localToday());
  const [type, setType] = useState<string | null>(session?.type ?? null);
  const [duration, setDuration] = useState(session?.duration_min ?? 90);
  const [rpe, setRpe] = useState<number | null>(session?.rpe ?? null);
  const [grade, setGrade] = useState(session?.max_grade ?? "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const ready = type !== null && rpe !== null;

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
      };
      if (session) {
        savedToast(await send("PUT", `/sessions/${session.id}`, body), "Session updated");
        location.hash = "#/history";
      } else {
        savedToast(await send("POST", "/sessions", body), "Session logged");
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
          <DatePicker value={date} onChange={setDate} />
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
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {ready ? "Save" : "Pick what and how hard"}
        </button>
      </div>
    </div>
  );
}
