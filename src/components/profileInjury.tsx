// Injury text left in the profile (from before the connector could write injuries, issue #20) drives
// nothing in the app. When the profile mentions an injury and none is tracked, offer to turn it into a
// tracked one, prefilled from the text. Nothing is created or removed until the climber taps.

import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { partOf, sideOf } from "../painWords";
import { injuryProfileEntries } from "../../worker/profile-injury";
import { ReportForm } from "./injuryForms";
import { Card } from "./ui";

export function ProfileInjuryBanner({ activeCount, onTracked }: { activeCount: number; onTracked: () => void }) {
  const { data: profile, setData } = useApi<Record<string, string>>("/profile");
  const [stage, setStage] = useState<"offer" | "form" | "clear" | "done">("offer");
  const [busy, setBusy] = useState(false);
  const entry = profile ? injuryProfileEntries(profile)[0] : undefined;
  // "clear" stays up after the new injury makes activeCount > 0, so the climber can still answer it.
  if (!entry || stage === "done" || (activeCount > 0 && stage !== "clear")) return null;
  const [key, text] = entry;

  async function clear() {
    setBusy(true);
    try {
      savedToast(await send("PUT", "/profile", { [key]: null }), "Removed from profile");
      const { [key]: _removed, ...rest } = profile!;
      setData(rest);
      setStage("done");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "form") {
    return (
      <ReportForm
        title="Track this injury"
        prefill={{ part: partOf(text), side: sideOf(text), description: text }}
        onSaved={() => (setStage("clear"), onTracked())}
        onCancel={() => setStage("offer")}
      />
    );
  }

  return (
    <Card tone="warn" title={stage === "clear" ? "Injury tracked" : "Turn this into a tracked injury?"}>
      <p className="muted small">
        {stage === "clear"
          ? "Remove the old note from your profile? Claude now reads the tracked injury instead."
          : "Your profile mentions an injury, but only tracked injuries get the morning check and a pain trend."}
      </p>
      <p className="prewrap small">“{text}”</p>
      <div className="actions">
        {stage === "clear" ? (
          <>
            <button className="btn" onClick={() => setStage("done")}>Keep it</button>
            <button className="btn primary" disabled={busy} onClick={clear}>Remove from profile</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => setStage("form")}>Track it</button>
        )}
      </div>
    </Card>
  );
}
