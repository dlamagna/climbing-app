import { useState } from "react";
import { LineChart } from "../components/LineChart";
import { Card, Chips, PageHeader } from "../components/ui";
import { prettyDate } from "../dates";
import { DISCIPLINE_NAMES, SYSTEM_SHORT, bothGrades, gradeIn, useAllSessions } from "../grades";
import type { Session } from "../types";
import { type Discipline, type GradeProgress as Progress, type GradeSystem, LADDERS, gradeProgress, gradeTimeline, usualSystem } from "../../worker/grades";

// Benchmarks -> Hardest grade (#60): per discipline, each session day's hardest grade (dots) and the hardest
// of the 28 days ending on it (the line), in whichever of the discipline's two systems you pick.
export default function GradeProgress() {
  const { sessions, error, today } = useAllSessions();
  const progress = sessions ? gradeProgress(sessions, today) : {};
  const disciplines = (["boulder", "route"] as const).filter((d) => progress[d]);
  return (
    <div className="page">
      <PageHeader title="Hardest grade" sub="The hardest grade you logged each day, and the best of the 28 days up to it." back="#/benchmarks" />
      {error && <p className="error">{error}</p>}
      {sessions && disciplines.length === 0 && (
        <Card>
          <p className="muted small">No grades logged yet. Add your hardest grade when you log a climbing session and it shows up here.</p>
        </Card>
      )}
      {sessions && disciplines.map((d) => <DisciplineCard key={d} discipline={d} sessions={sessions} today={today} progress={progress[d]!} />)}
    </div>
  );
}

function DisciplineCard({ discipline: d, sessions, today, progress }: { discipline: Discipline; sessions: Session[]; today: string; progress: Progress }) {
  const [system, setSystem] = useState<GradeSystem>(() => usualSystem(sessions, d));
  const { days, best28 } = gradeTimeline(sessions, d, today);
  const { finer, coarser } = LADDERS[d];
  // Grid lines can land between two rungs; only whole rungs get a label.
  const format = (v: number) => (Number.isInteger(v) ? gradeIn(d, v, system) : "");
  return (
    <Card
      title={DISCIPLINE_NAMES[d]}
      action={<Chips options={[finer, coarser].map((s) => ({ value: s, label: SYSTEM_SHORT[s] }))} value={system} onChange={(s) => s && setSystem(s)} />}
    >
      <GradeSummary discipline={d} progress={progress} system={system} />
      {days.length >= 2 ? (
        <>
          <p className="muted small">
            <i className="lc-key dot" /> hardest that day · <i className="lc-key line" /> best of 28 days
          </p>
          <LineChart
            points={best28.map((p) => ({ date: p.date, value: p.index }))}
            dots={days.map((p) => ({ date: p.date, value: p.index }))}
            markers={false}
            format={format}
            label={`Hardest ${d} grade over time`}
            detail={(date) => {
              const day = days.find((p) => p.date === date)!;
              const best = best28.find((p) => p.date === date)!;
              return (
                <>
                  {prettyDate(date)}: <strong>{bothGrades(d, day.index, system)}</strong>
                  <span className="muted">
                    {loggedAs(day.grades, gradeIn(d, day.index, system))} · best of 28 days {gradeIn(d, best.index, system)}
                  </span>
                </>
              );
            }}
          />
        </>
      ) : (
        <p className="muted small">One graded day so far: the chart starts with the second.</p>
      )}
    </Card>
  );
}

// "(logged as 6b/6b+)" when what was typed isn't simply the grade shown.
const loggedAs = (grades: string[], shown: string) =>
  grades.length === 1 && grades[0].toLowerCase() === shown.toLowerCase() ? "" : ` (logged as ${grades.join(", ")})`;

// The change on the 28 days before, in rungs of the finer system: "up 1 grade", "down half a grade".
function changeText(change: number): string {
  if (change === 0) return "same as the 28 days before";
  const n = Math.abs(change);
  const size = n === 0.5 ? "half a grade" : `${n} ${n === 1 ? "grade" : "grades"}`;
  return `${change > 0 ? "up" : "down"} ${size} on the 28 days before`;
}

// "Last 28 days: 6C · V5 · up 1 grade on the 28 days before", then the best ever. Also on the Benchmarks card.
export function GradeSummary({ discipline: d, progress: p, system }: { discipline: Discipline; progress: Progress; system?: GradeSystem }) {
  return (
    <div className="grade-summary small">
      <div>
        Last 28 days: <strong>{p.last_28_days ? bothGrades(d, p.last_28_days.index, system) : "nothing logged"}</strong>
        {p.change !== null && <span className="muted"> · {changeText(p.change)}</span>}
      </div>
      <div className="muted">
        Best ever: {bothGrades(d, p.best_ever.index, system)}, {prettyDate(p.best_ever.date)}
      </div>
    </div>
  );
}
