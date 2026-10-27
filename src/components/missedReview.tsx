// "Review did not complete, run it now?" (#94): shown when the last automatic coach review failed to start or
// never recorded a run. Run now starts it again; Dismiss hides the prompt for that start only.
import { useState } from "react";
import { sendNow, toast, useApi } from "../api";
import { dismissReview, dismissedReview } from "../prefs";
import type { CoachActivity } from "../types";

export function MissedReview() {
  const { data } = useApi<CoachActivity>("/coach/runs?limit=1");
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const missed = data?.auto?.enabled ? data.auto.missed : null;
  if (!missed || gone || dismissedReview() === missed.start_id) return null;

  async function run() {
    setBusy(true);
    try {
      await sendNow("POST", "/coach/routines/review/run");
      toast("Review started. It usually takes a few minutes");
      setGone(true);
    } catch (e) {
      toast(e instanceof TypeError ? "You're offline, so it couldn't be started." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p>
        <strong>Review did not complete.</strong> Run it now?
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            dismissReview(missed.start_id);
            setGone(true);
          }}
        >
          Dismiss
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={run}>
          {busy ? "Starting…" : "Run review"}
        </button>
      </div>
    </div>
  );
}
