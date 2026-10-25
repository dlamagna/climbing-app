// The Coach tab's coach activity (#64, #80): when the daily review last ran, when the next run is expected, and a
// browsable history of past runs with their outcome, summary and changes. With the routines' API triggers
// set up, the review and the issue worker can also be started from here (#73), and they start by themselves
// when a training session is logged (worker/autoStart.ts).
import { useState } from "react";
import { sendNow, toast, useApi } from "../api";
import { nextRunLabel, stampLabel } from "../coachRuns";
import { localToday } from "../dates";
import type { CoachActivity as Activity, AutoStart, CoachRoutines, CoachRun } from "../types";
import { StepList } from "./StepList";
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
      <StepList text={run.summary} className="steps small" />
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

const RUNNERS: { name: keyof CoachRoutines; label: string; confirm: string }[] = [
  { name: "review", label: "Run review now", confirm: "Start the coach review now?" },
  {
    name: "worker",
    label: "Run issue worker now",
    confirm: "Start the issue worker now? It works on your open P0/P1 issues and merges fixes that pass CI, which deploys them.",
  },
];

function RunNow() {
  const { data } = useApi<CoachRoutines>("/coach/routines");
  const [busy, setBusy] = useState<keyof CoachRoutines | null>(null);
  const [started, setStarted] = useState<Partial<Record<keyof CoachRoutines, string | null>>>({});
  if (!data) return null;
  if (!data.review && !data.worker) {
    return <p className="muted small">To run the review from here, add its API trigger to the worker (see the README).</p>;
  }

  async function run(name: keyof CoachRoutines, question: string) {
    if (!confirm(question)) return;
    setBusy(name);
    try {
      const r = await sendNow<{ session_url: string | null }>("POST", `/coach/routines/${name}/run`);
      setStarted((s) => ({ ...s, [name]: r.session_url }));
      toast("Started. It usually takes a few minutes");
    } catch (e) {
      alert(e instanceof TypeError ? "You're offline, so it couldn't be started." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="form">
      {RUNNERS.filter((r) => data[r.name]).map((r) =>
        r.name in started ? (
          <p key={r.name} className="small">
            <span className="tag status done">started</span>{" "}
            {started[r.name] ? (
              <a href={started[r.name]!} target="_blank" rel="noreferrer">
                Open the session
              </a>
            ) : (
              "Check claude.ai/code for the session"
            )}
          </p>
        ) : (
          <button key={r.name} type="button" className="btn block" disabled={busy !== null} onClick={() => run(r.name, r.confirm)}>
            {busy === r.name ? "Starting…" : r.label}
          </button>
        ),
      )}
    </div>
  );
}

const ROUTINE_LABEL: Record<"review" | "worker", string> = { review: "Review", worker: "Issue worker" };

const STATUS_TAG: Record<NonNullable<AutoStart["last"]>["status"], string> = {
  starting: "skipped",
  started: "done",
  failed: "skipped",
  skipped: "skipped",
};

// What starts the review, and how the last automatic start went.
function AutoInfo({ auto, today }: { auto: AutoStart; today: string }) {
  const last = auto.last;
  return (
    <>
      <p className="muted small">
        The review starts when you log a training session (not a warm-up)
        {auto.worker ? ", then the issue worker runs if there are open P0 or P1 issues" : ""}.
      </p>
      {last && (
        <p className="small">
          <span className="muted">Last automatic start:</span> {ROUTINE_LABEL[last.routine]} · {stampLabel(last.created_at, today)} ·{" "}
          <span className={`tag status ${STATUS_TAG[last.status]}`}>{last.status}</span>
          {last.error && <span className={last.status === "failed" ? "error" : "muted"}> {last.error}</span>}
        </p>
      )}
    </>
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
          {data.auto?.enabled ? (
            <AutoInfo auto={data.auto} today={today} />
          ) : (
            <>
              <p className="small">
                <span className="muted">Next run:</span> {nextRunLabel(data.next_run_expected, new Date(), today)}
              </p>
              <p className="muted small">The daily review runs about every {data.interval_hours} hours.</p>
            </>
          )}
          <RunNow />
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
