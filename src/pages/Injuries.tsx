import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { injuryName, redFlagLabels } from "../components/injury";
import { ReportForm, ResolveForm } from "../components/injuryForms";
import { NoteReview } from "../components/noteSuggestions";
import { Card, PageHeader } from "../components/ui";
import { dayLabel, localToday, prettyDate } from "../dates";
import { type Injury, typeLabel } from "../types";

const TREND_ARROW = { better: "↓", same: "", worse: "↑", gone: "✓" };

export default function Injuries() {
  const today = localToday();
  const { data, error, reload } = useApi<{ active: Injury[]; resolved: Injury[] }>("/injuries");
  const [reporting, setReporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);

  async function reopen(inj: Injury) {
    if (!confirm(`${injuryName(inj)} is back? It will show up in the morning check-in again.`)) return;
    savedToast(await send("POST", `/injuries/${inj.id}/reopen`, {}), "Reopened");
    reload();
  }

  return (
    <div className="page">
      <PageHeader title="Injuries" sub="Active injuries get a quick follow-up in the morning check-in." back="#/more" />
      {reporting ? (
        <ReportForm onSaved={() => (setReporting(false), reload())} onCancel={() => setReporting(false)} />
      ) : (
        <button className="btn primary block" onClick={() => setReporting(true)}>Report an injury</button>
      )}
      {reviewing ? (
        <NoteReview onAdded={reload} onClose={() => setReviewing(false)} />
      ) : (
        <button className="link" onClick={() => setReviewing(true)}>Review past session notes for injuries</button>
      )}
      {error && <p className="error">{error}</p>}
      {data?.active.map((inj) => (
        <Card key={inj.id} tone="warn" title={injuryName(inj)}
          action={resolving !== inj.id && <button className="link" onClick={() => setResolving(inj.id)}>Healed</button>}>
          <p className="muted small">
            Since {prettyDate(inj.started_on)}
            {inj.session_type ? ` · during a ${typeLabel(inj.session_type).toLowerCase()} session` : ""}
            {inj.description ? ` · ${inj.description}` : ""}
          </p>
          {inj.updates?.length ? (
            <>
              <p className="small">Pain: {inj.updates.slice().reverse().map((u) => `${u.pain}${u.trend ? TREND_ARROW[u.trend] : ""}`).join(" → ")}
                <span className="muted"> (latest {dayLabel(inj.updates[0].date, today)})</span></p>
              {inj.updates[0].red_flags && <p className="small warn">Red flags: {redFlagLabels(inj.updates[0].red_flags).join(", ")}</p>}
            </>
          ) : <p className="muted small">No pain scores yet.</p>}
          {resolving === inj.id && (
            <ResolveForm injury={inj} onSaved={() => (setResolving(null), reload())} onCancel={() => setResolving(null)} />
          )}
        </Card>
      ))}
      {data && data.resolved.length > 0 && (
        <Card title="Healed">
          <ul className="mini-list">
            {data.resolved.map((inj) => (
              <li key={inj.id} className="row-between">
                <span>{injuryName(inj)} · {prettyDate(inj.started_on)} → {prettyDate(inj.resolved_on!)}</span>
                <button className="link" onClick={() => reopen(inj)}>Reopen</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
