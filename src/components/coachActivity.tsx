// Settings' coach activity (#64): when the daily review last ran, when the next run is expected, and a
// browsable history of past runs with their outcome, summary and changes.
import { useState } from "react";
import { useApi } from "../api";
import { nextRunLabel, stampLabel } from "../coachRuns";
import { localToday } from "../dates";
import type { CoachActivity as Activity, CoachRun } from "../types";
import { Card } from "./ui";

const PAGE = 10;
const OUTCOME: Record<CoachRun["outcome"], string> = { updated: "updated", no_change: "no change" };

function RunItem({ run, today }: { run: CoachRun; today: string }) {
  return (
    <li>
      <p className="small">
        <strong>{stampLabel(run.created_at, today)}</strong> ·{" "}
        <span className={`tag status ${run.outcome === "updated" ? "done" : "skipped"}`}>{OUTCOME[run.outcome]}</span>
      </p>
      {run.summary && <p className="small">{run.summary}</p>}
      {run.changes.length > 0 && (
        <ul className="mini-list small">
          {run.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CoachActivity() {
  const { data, error } = useApi<Activity>("/coach/runs?limit=100");
  const [shown, setShown] = useState(0);
  const today = localToday();
  const runs = data?.runs ?? [];
  return (
    <Card title="Coach activity">
      {error && <p className="error small">{error}</p>}
      {data && (
        <>
          <p className="small">
            <span className="muted">Last run:</span> {data.last_run ? stampLabel(data.last_run.created_at, today) : "Not run yet"}
          </p>
          <p className="small">
            <span className="muted">Next run:</span> {nextRunLabel(data.next_run_expected, new Date(), today)}
          </p>
          <p className="muted small">The daily review runs about every {data.interval_hours} hours.</p>
          {runs.length > 0 &&
            (shown === 0 ? (
              <button type="button" className="link small" onClick={() => setShown(PAGE)}>
                Show history ({runs.length})
              </button>
            ) : (
              <>
                <ul className="feedback-list">
                  {runs.slice(0, shown).map((r) => (
                    <RunItem key={r.id} run={r} today={today} />
                  ))}
                </ul>
                {shown < runs.length && (
                  <button type="button" className="link small" onClick={() => setShown(shown + PAGE)}>
                    Show older
                  </button>
                )}
              </>
            ))}
        </>
      )}
    </Card>
  );
}
