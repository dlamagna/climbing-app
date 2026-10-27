// The Coach tab (#80): everything the daily coach review shows or reads in one place. Questions to answer,
// the latest coach note and review, picking climbing days, notes to the coach, coach activity and the pop-up
// setting. Today keeps only a pointer here while questions are waiting, plus the weekly pop-up.
import { useState } from "react";
import { useApi } from "../api";
import { ClimbingDaysPlanner, CoachQuestions, CoachUpdate, NoteToCoach } from "../components/coach";
import { CoachActivity } from "../components/coachActivity";
import { MissedReview } from "../components/missedReview";
import { StepList } from "../components/StepList";
import { Card, Chips, PageHeader } from "../components/ui";
import { dayLabel, localDateOf, localToday } from "../dates";
import { popupsEnabled, setPopupsEnabled } from "../prefs";
import type { TodayView } from "../types";

interface ClimberNote {
  id: number;
  text: string;
  created_at: string;
}

const SENT_SHOWN = 3;

export default function Coach() {
  const today = localToday();
  const { data, error, reload, setData } = useApi<TodayView>(`/today?date=${today}`);
  const sent = useApi<ClimberNote[]>("/coach/notes");

  if (!data) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  const [latest, ...earlier] = data.coach_notes;
  const answered = (id: number) => setData({ ...data, coach_questions: (data.coach_questions ?? []).filter((q) => q.id !== id) });

  return (
    <div className="page">
      <PageHeader title="Coach" sub="Daily review, questions and your notes" />

      <MissedReview />

      <CoachQuestions questions={data.coach_questions ?? []} onAnswered={answered} />

      <Card title={latest ? `Coach note · ${dayLabel(latest.date, today)}` : "Coach note"}>
        {latest ? <StepList text={latest.text} /> : <p className="muted small">No recent note. Ask Claude how to train, or wait for the next daily review.</p>}
        {earlier.length > 0 && <EarlierNotes notes={earlier} today={today} />}
      </Card>

      {data.coach_update && (
        <Card title="Latest daily review">
          <CoachUpdate run={data.coach_update} today={today} />
        </Card>
      )}

      <Card title="Your climbing days">
        <ClimbingDaysPlanner today={today} current={data.climbing_days ?? null} onSaved={reload} />
      </Card>

      <Card title="Notes to the coach">
        <NoteToCoach onSent={sent.reload} />
        {sent.data && sent.data.length > 0 && <SentNotes notes={sent.data} today={today} />}
      </Card>

      <CoachActivity />

      <PopupSetting />
    </div>
  );
}

function EarlierNotes({ notes, today }: { notes: TodayView["coach_notes"]; today: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="link small" onClick={() => setOpen(true)}>
        Earlier notes ({notes.length})
      </button>
    );
  }
  return (
    <div className="earlier-notes">
      {notes.map((n) => (
        <div key={n.id}>
          <p className="muted small">{dayLabel(n.date, today)}</p>
          <StepList text={n.text} />
        </div>
      ))}
    </div>
  );
}

function SentNotes({ notes, today }: { notes: ClimberNote[]; today: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? notes : notes.slice(0, SENT_SHOWN);
  return (
    <>
      <ul className="mini-list small sent-notes">
        {shown.map((n) => (
          <li key={n.id}>
            <span className="muted">{dayLabel(localDateOf(n.created_at), today)}:</span> {n.text}
          </li>
        ))}
      </ul>
      {!all && notes.length > SENT_SHOWN && (
        <button type="button" className="link small" onClick={() => setAll(true)}>
          Show all ({notes.length})
        </button>
      )}
    </>
  );
}

function PopupSetting() {
  const [on, setOn] = useState(popupsEnabled);
  return (
    <Card title="Weekly pop-up">
      <p className="small">
        The weekly "which days will you climb?" question opens as a pop-up on Today. Switched off, it only shows here, and you can still pick
        your days any time above. Saved on this phone.
      </p>
      <Chips
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        value={on ? "on" : "off"}
        onChange={(v) => {
          if (!v) return;
          setPopupsEnabled(v === "on");
          setOn(v === "on");
        }}
      />
    </Card>
  );
}
