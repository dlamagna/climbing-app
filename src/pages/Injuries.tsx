import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { BODY_PARTS, SIDES, injuryName, redFlagLabels } from "../components/injury";
import { Card, Chips, Field, PageHeader, range } from "../components/ui";
import { dayLabel, localToday, prettyDate } from "../dates";
import { type Injury, typeLabel } from "../types";

const TREND_ARROW = { better: "↓", same: "", worse: "↑", gone: "✓" };

export default function Injuries() {
  const today = localToday();
  const { data, error, reload } = useApi<{ active: Injury[]; resolved: Injury[] }>("/injuries");
  const [reporting, setReporting] = useState(false);

  async function resolve(inj: Injury) {
    if (!confirm(`Mark ${inj.body_part} as healed?`)) return;
    savedToast(await send("POST", `/injuries/${inj.id}/resolve`, { date: today }), "Marked as healed");
    reload();
  }

  async function reopen(inj: Injury) {
    if (!confirm(`${injuryName(inj)} is back? It will show up in the morning check-in again.`)) return;
    savedToast(await send("POST", `/injuries/${inj.id}/reopen`, {}), "Reopened");
    reload();
  }

  return (
    <div className="page">
      <PageHeader title="Injuries" sub="Active injuries get a quick follow-up in the morning check-in." back="#/more" />
      {reporting ? (
        <ReportForm today={today} onDone={() => (setReporting(false), reload())} />
      ) : (
        <button className="btn primary block" onClick={() => setReporting(true)}>Report an injury</button>
      )}
      {error && <p className="error">{error}</p>}
      {data?.active.map((inj) => (
        <Card key={inj.id} tone="warn" title={injuryName(inj)}
          action={<button className="link" onClick={() => resolve(inj)}>Healed</button>}>
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

function ReportForm({ today, onDone }: { today: string; onDone: () => void }) {
  const [part, setPart] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [side, setSide] = useState<string | null>(null);
  const [pain, setPain] = useState<number | null>(null);
  const [description, setDescription] = useState("");

  async function submit() {
    const body_part = detail.trim() ? `${part} - ${detail.trim()}` : part;
    savedToast(await send("POST", "/injuries", { body_part, side, description: description.trim() || null, started_on: today, pain }), "Injury reported");
    onDone();
  }

  return (
    <Card title="Report an injury" tone="warn">
      <div className="form">
        <Field label="Where"><Chips wrap options={BODY_PARTS.map((p) => ({ value: p, label: p }))} value={part} onChange={setPart} /></Field>
        <Field label="More specific" hint="optional"><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. ring finger A2 pulley" /></Field>
        <Field label="Side"><Chips options={SIDES} value={side} onChange={setSide} clearable /></Field>
        <Field label="Pain now" hint="0 none · 10 worst"><Chips wrap options={range(0, 10).map((v) => ({ value: v, label: String(v) }))} value={pain} onChange={setPain} /></Field>
        <Field label="What happened" hint="optional"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Move, feeling (pop? gradual?), what makes it hurt" /></Field>
        <div className="actions">
          <button className="btn" onClick={onDone}>Cancel</button>
          <button className="btn primary" disabled={!part || pain === null} onClick={submit}>Save</button>
        </div>
        <p className="muted small">A pop, swelling, bruising or pain that keeps getting worse is worth getting checked by a physio.</p>
      </div>
    </Card>
  );
}
