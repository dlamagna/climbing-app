import { useState } from "react";
import { savedToast, send } from "../api";
import { Chips, Field, PageHeader, Stepper, range } from "../components/ui";
import { addDays, localToday, prettyDate } from "../dates";
import { SESSION_TYPES } from "../types";

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

export default function Log() {
  const today = localToday();
  const [date, setDate] = useState(today);
  const [type, setType] = useState<string | null>(null);
  const [duration, setDuration] = useState(90);
  const [rpe, setRpe] = useState<number | null>(null);
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = type !== null && rpe !== null;

  async function submit() {
    setBusy(true);
    try {
      const r = await send("POST", "/sessions", {
        date,
        type,
        duration_min: duration,
        rpe,
        max_grade: grade.trim() || null,
        notes: notes.trim() || null,
      });
      savedToast(r, "Session logged");
      location.hash = "#/today";
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Log session" />
      <div className="form">
        <Field label="When">
          <Chips
            options={[
              { value: today, label: "Today" },
              { value: addDays(today, -1), label: "Yesterday" },
              { value: addDays(today, -2), label: prettyDate(addDays(today, -2)) },
            ]}
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
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {ready ? "Save" : "Pick what and how hard"}
        </button>
      </div>
    </div>
  );
}
