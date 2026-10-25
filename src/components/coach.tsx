// The daily coach review on the Coach tab (#52, #80): questions to answer with a tap, and what the last review
// changed. Answers go through the offline outbox like other writes and reach the coach on its next run. The
// weekly "which days will you climb" question (#54) also opens as a pop-up.
import { useState } from "react";
import { savedToast, send } from "../api";
import { addDays, dayLabel, localDateOf, shortDay } from "../dates";
import { popupsEnabled } from "../prefs";
import { MAX_COACH_NOTE, NO_CLIMBING, climbingDaysBody, coachNoteBody, isWeekly, multiAnswer, plannerDays, togglePick } from "../coachAnswers";
import type { CoachQuestion, CoachRun } from "../types";
import { StepList } from "./StepList";
import { Card } from "./ui";

export function CoachQuestions({ questions, onAnswered }: { questions: CoachQuestion[]; onAnswered: (id: number) => void }) {
  if (!questions.length) return null;
  return (
    <Card title={questions.length === 1 ? "Coach asks" : `Coach asks (${questions.length})`} tone="accent">
      {questions.map((q) => (
        <QuestionItem key={q.id} q={q} onDone={() => onAnswered(q.id)} />
      ))}
      <p className="muted small">Used in the next daily review.</p>
    </Card>
  );
}

function QuestionItem({ q, onDone, onLater }: { q: CoachQuestion; onDone: () => void; onLater?: () => void }) {
  const multi = Boolean(q.multi);
  const freeText = q.options.length === 0;
  const [typing, setTyping] = useState(freeText);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(body: { answer: string } | { skip: true }) {
    setBusy(true);
    try {
      savedToast(await send("PUT", `/coach/questions/${q.id}`, body), "skip" in body ? "Skipped" : "Answer saved");
      onDone();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const answer = multi ? multiAnswer(picked, q.options, text) : text.trim();

  return (
    <div className="coach-question">
      <p>
        <strong>{q.question}</strong>
      </p>
      {q.why && <p className="muted small">{q.why}</p>}
      {q.options.length > 0 && (
        <div className="chips wrap">
          {q.options.map((o) =>
            multi ? (
              <button
                key={o}
                type="button"
                aria-pressed={picked.includes(o)}
                className={picked.includes(o) ? "chip on" : "chip"}
                onClick={() => setPicked((p) => togglePick(p, o))}
              >
                {o}
              </button>
            ) : (
              <button key={o} type="button" className="chip" disabled={busy} onClick={() => submit({ answer: o })}>
                {o}
              </button>
            ),
          )}
        </div>
      )}
      {typing && (
        <div className="row">
          <textarea rows={2} value={text} placeholder={multi ? "Note (optional)" : "Your answer"} onChange={(e) => setText(e.target.value)} />
          {!multi && (
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => submit({ answer: text.trim() })}>
              Send
            </button>
          )}
        </div>
      )}
      {multi && (
        <button className="btn primary block" disabled={busy || !answer} onClick={() => submit({ answer })}>
          Send
        </button>
      )}
      <div className="row-between">
        {!typing && q.allow_text ? (
          <button type="button" className="link" onClick={() => setTyping(true)}>
            {multi ? "Add a note" : "Type an answer"}
          </button>
        ) : (
          <span />
        )}
        <span className="row">
          {onLater && (
            <button type="button" className="link muted" disabled={busy} onClick={onLater}>
              Later
            </button>
          )}
          <button type="button" className="link muted" disabled={busy} onClick={() => submit({ skip: true })}>
            Skip
          </button>
        </span>
      </div>
    </div>
  );
}

const LATER_KEY = "climb.weeklyLater"; // question id -> the day "Later" was tapped

function laterDay(id: number): string | null {
  try {
    return (JSON.parse(localStorage.getItem(LATER_KEY) ?? "{}") as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}

function setLaterDay(id: number, day: string) {
  try {
    localStorage.setItem(LATER_KEY, JSON.stringify({ [id]: day }));
  } catch {
    // the pop-up just comes back next time
  }
}

// The weekly question as a pop-up over Today, unless pop-ups are off in Settings (#56). "Later" hides it until
// the next day (it stays as a card).
export function WeeklyPopup({ questions, today, onAnswered }: { questions: CoachQuestion[]; today: string; onAnswered: (id: number) => void }) {
  const q = questions.find(isWeekly);
  const [hidden, setHidden] = useState<number | null>(null);
  if (!q || hidden === q.id || laterDay(q.id) === today || !popupsEnabled()) return null;
  return (
    <div className="popup-backdrop" role="dialog" aria-modal="true" aria-label="This week">
      <div className="popup card">
        <QuestionItem
          q={q}
          onDone={() => onAnswered(q.id)}
          onLater={() => {
            setLaterDay(q.id, today);
            setHidden(q.id);
          }}
        />
      </div>
    </div>
  );
}

export interface ClimbingDaysView {
  answer: string;
  answered_at: string;
}

// "Plan my climbing days" in Today's plan card (#56): pick days in the next week, the coach plans around them
// in its next review. Always there, whether or not pop-ups are on.
export function ClimbingDaysPlanner({ today, current, onSaved }: { today: string; current: ClimbingDaysView | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const body = climbingDaysBody(picked, note);

  async function save() {
    if (!body) return;
    setBusy(true);
    try {
      savedToast(await send("PUT", "/coach/climbing-days", body), "Saved - the coach plans around it in the next review");
      setOpen(false);
      setPicked([]);
      setNote("");
      onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="climbing-days">
        {current && (
          <p className="small">
            <span className="muted">Climbing days:</span> {current.answer}{" "}
            <span className="muted">(set {dayLabel(localDateOf(current.answered_at), today).toLowerCase()})</span>
          </p>
        )}
        <button className="btn block" onClick={() => setOpen(true)}>
          Plan my climbing days
        </button>
      </div>
    );
  }

  const options = [...plannerDays(today).map((d) => ({ value: d, label: d === today ? "Today" : shortDay(d) })), { value: NO_CLIMBING, label: NO_CLIMBING }];
  return (
    <div className="climbing-days picker">
      <p>
        <strong>Which days do you plan to climb?</strong>
      </p>
      <div className="chips wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={picked.includes(o.value)}
            className={picked.includes(o.value) ? "chip on" : "chip"}
            onClick={() => setPicked((p) => togglePick(p, o.value, NO_CLIMBING))}
          >
            {o.label}
          </button>
        ))}
      </div>
      <textarea rows={2} value={note} placeholder="Note (optional), e.g. evenings only, Saturday outdoors" onChange={(e) => setNote(e.target.value)} />
      <div className="actions">
        <button className="btn" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !body} onClick={save}>
          Save
        </button>
      </div>
      <p className="muted small">The coach plans your sessions on these days in its next daily review.</p>
    </div>
  );
}

// Shown for a few days after a review changed something.
export const RECENT_UPDATE_DAYS = 2;

export function recentUpdate(run: CoachRun | null | undefined, today: string): CoachRun | null {
  if (!run?.summary) return null;
  return localDateOf(run.created_at) >= addDays(today, -RECENT_UPDATE_DAYS) ? run : null;
}

export function CoachUpdate({ run, today }: { run: CoachRun; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="coach-update">
      <p className="muted small">{dayLabel(localDateOf(run.created_at), today)}</p>
      <StepList text={run.summary} className="steps small" />
      {run.changes.length > 0 &&
        (open ? (
          <ul className="mini-list small">
            {run.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : (
          <button type="button" className="link small" onClick={() => setOpen(true)}>
            What changed ({run.changes.length})
          </button>
        ))}
    </div>
  );
}

// Free-text context for the coach (#65), sent from the Coach tab. Stored, and handed to the next daily review.
export function NoteToCoach({ onSent }: { onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const body = coachNoteBody(text);

  async function submit() {
    if (!body) return;
    setBusy(true);
    try {
      savedToast(await send("POST", "/coach/notes", body), "Sent - the coach reads it in the next daily review");
      setText("");
      setOpen(false);
      onSent?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn block" onClick={() => setOpen(true)}>
        Send a note to the coach
      </button>
    );
  }
  return (
    <div className="form">
        <textarea
          rows={4}
          maxLength={MAX_COACH_NOTE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anything the coach should know, e.g. a busy week coming up or a goal you want to focus on"
          autoFocus
        />
        <p className="muted small">Used in the next daily review.</p>
        <div className="actions">
          <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !body}>
            Send
          </button>
        </div>
    </div>
  );
}
