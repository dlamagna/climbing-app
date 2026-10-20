import { useState } from "react";
import { Card, Chips, PageHeader } from "../components/ui";
import { DISCIPLINE_NAMES, SYSTEM_SHORT, useAllSessions } from "../grades";
import { type Discipline, LADDERS, gradeHint, gradeProgress, gradeTable, parseGrade } from "../../worker/grades";

// More -> Grade table (#60): boulders in Font and V, routes in French and YDS, with a converter that
// highlights the grade you type, and your hardest grade of the last 28 days marked.
export default function Grades() {
  const [discipline, setDiscipline] = useState<Discipline>("boulder");
  const [text, setText] = useState("");
  const { sessions, today } = useAllSessions();
  const parsed = parseGrade(text, discipline);
  const progress = sessions ? gradeProgress(sessions, today) : {};

  return (
    <div className="page">
      <PageHeader title="Grade table" sub="Boulders in Font and V, routes in French and YDS. Boulder and route grades don't convert into each other." back="#/more" />
      <Card title="Convert a grade">
        <div className="form">
          <Chips
            options={(["boulder", "route"] as const).map((d) => ({ value: d, label: d === "boulder" ? "Boulder" : "Route" }))}
            value={discipline}
            onChange={(d) => d && setDiscipline(d)}
          />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={discipline === "boulder" ? "e.g. 6C or V5" : "e.g. 7a or 5.11d"} aria-label="Grade" />
          {text.trim() && <p className="small">{parsed ? <strong>{gradeHint(parsed)}</strong> : <span className="muted">Not a grade I can read.</span>}</p>}
        </div>
      </Card>
      {(["boulder", "route"] as const).map((d) => (
        <GradeTableCard key={d} discipline={d} hit={parsed?.discipline === d ? parsed.index : null} mine={progress[d]?.last_28_days?.index ?? null} />
      ))}
    </div>
  );
}

function GradeTableCard({ discipline: d, hit, mine }: { discipline: Discipline; hit: number | null; mine: number | null }) {
  const { finer, coarser } = LADDERS[d];
  // A half index (a slash grade, or a V grade covering two rungs) sits between two rows: both light up.
  const near = (i: number, x: number | null) => x !== null && Math.abs(i - x) < 1;
  return (
    <Card title={DISCIPLINE_NAMES[d]}>
      {mine !== null && <p className="muted small"><i className="grade-key" /> your hardest in the last 28 days</p>}
      <table className="grade-table">
        <thead>
          <tr>
            <th>{SYSTEM_SHORT[finer]}</th>
            <th>{SYSTEM_SHORT[coarser]}</th>
          </tr>
        </thead>
        <tbody>
          {gradeTable(d).map((r) => (
            <tr key={r.index} className={near(r.index, hit) ? "hit" : undefined}>
              <td className={near(r.index, mine) ? "mine" : undefined}>{r.finer}</td>
              {r.coarser !== null && <td rowSpan={r.span}>{r.coarser}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
