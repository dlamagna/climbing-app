import { useState } from "react";
import { isQueued, savedToast, send, toast, useApi } from "../api";
import { benchmarkBody } from "../benchmarkInputs";
import { type InjuryDraft, EMPTY_DRAFT, QuickInjury, draftBody } from "../components/injury";
import { BenchmarkFields, useBenchmarkInputs } from "../components/plannedBenchmarks";
import { NoteSuggestions } from "../components/noteSuggestions";
import { TagPicker, takesTags } from "../components/TagPicker";
import { Chips, DatePicker, Field, PageHeader, Stepper, range } from "../components/ui";
import { localToday } from "../dates";
import { type NoteSuggestions as Suggestions, noteSuggestions } from "../painWords";
import { type Injury, type Readiness, SESSION_TYPES, type Session, type TodayView } from "../types";
import { isHardSession } from "../../worker/readiness";
import { type SessionTag, parseTags } from "../../worker/tags";
import { isClimbingType } from "../../worker/typeGroups";

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

// After logging a hard session (worker/plan.ts's hard-day definition) today on an amber / red day: a note
// in the saved toast. Advisory only, logging is never blocked. The reasons are on the Today screen it goes to.
export function readinessNote(r: Readiness | undefined, s: { date: string; duration_min: number; rpe: number }, today: string) {
  if (!r || r.level === "green" || s.date !== today || !isHardSession(s)) return null;
  return `Hard session on ${r.level === "red" ? "a red" : "an amber"} day: keep the rest of today easy and recover well.`;
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
  const [tags, setTags] = useState<SessionTag[]>(parseTags(session?.tags));
  const [outdoor, setOutdoor] = useState(Boolean(session?.outdoor)); // indoors unless picked (#33)
  const [injury, setInjury] = useState<InjuryDraft | null>(null);
  const [linked, setLinked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ suggestions: Suggestions<Injury>; sessionId: number | null; next: string } | null>(null);
  const { data: injuries } = useApi<{ active: Injury[] }>("/injuries");
  const { data: todayView } = useApi<TodayView>(session ? null : `/today?date=${localToday()}`); // for readiness
  const tests = useBenchmarkInputs(date, session?.benchmarks);
  const ready = type !== null && rpe !== null && (!injury || injury.part !== null);

  // After saving, a note that mentions a tweak or a healed injury gets a one-tap follow-up instead of
  // going straight back. Skipped when an injury was added in the form, or an edit left the note as it was.
  function afterSave(result: unknown, next: string) {
    const noteChanged = !session || (session.notes ?? "") !== notes.trim();
    const suggestions = noteSuggestions(injury || !noteChanged ? "" : notes, injuries?.active ?? []);
    if (!suggestions.tweaks.length && !suggestions.healed.length) {
      location.hash = next;
      return;
    }
    const sessionId = session?.id ?? (isQueued(result) ? null : (result as { id: number }).id);
    setSaved({ suggestions, sessionId, next });
  }

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
        tags: takesTags(type) ? tags : [], // kept while switching types, only sent for climbing ones
        outdoor: isClimbingType(type) && outdoor, // same: non-climbing types are always indoors
        new_injury: injury && { ...draftBody(injury), link: linked },
        benchmarks: benchmarkBody(tests.inputs),
      };
      if (session) {
        const result = await send("PUT", `/sessions/${session.id}`, body);
        savedToast(result, "Session updated");
        afterSave(result, "#/history");
      } else {
        const result = await send("POST", "/sessions", body);
        const what = injury ? "Session and injury logged" : "Session logged";
        const note = readinessNote(todayView?.readiness, { date, duration_min: duration, rpe: rpe! }, localToday());
        if (note) toast(`${what}${isQueued(result) ? " offline" : ""}. ${note}`, undefined, 7000);
        else savedToast(result, what);
        afterSave(result, "#/today");
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <NoteSuggestions suggestions={saved.suggestions} sessionId={saved.sessionId} date={date} onDone={() => (location.hash = saved.next)} />
    );
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
        {isClimbingType(type) && (
          <Field label="Where">
            <Chips
              options={[
                { value: "indoor", label: "Indoor" },
                { value: "outdoor", label: "Outdoor" },
              ]}
              value={outdoor ? "outdoor" : "indoor"}
              onChange={(v) => v && setOutdoor(v === "outdoor")}
            />
          </Field>
        )}
        {takesTags(type) && <TagPicker value={tags} onChange={setTags} />}
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
        <BenchmarkFields inputs={tests.inputs} onChange={tests.setValue} />
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {ready ? "Save" : type === null || rpe === null ? "Pick what and how hard" : "Pick where the injury is"}
        </button>
      </div>
    </div>
  );
}
