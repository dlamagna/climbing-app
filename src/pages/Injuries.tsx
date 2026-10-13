import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { Card, Chips, Field, PageHeader, range } from "../components/ui";
import { dayLabel, localToday, prettyDate } from "../dates";
import type { Injury } from "../types";

const BODY_PARTS = ["Finger", "Wrist", "Elbow", "Shoulder", "Neck / back", "Hip", "Knee", "Ankle", "Skin", "Other"];

export default function Injuries() {
  const today = localToday();
  const { data, error, reload } = useApi<{ active: Injury[]; resolved: Injury[] }>("/injuries");
  const [reporting, setReporting] = useState(false);

  async function resolve(inj: Injury) {
    if (!confirm(`Mark ${inj.body_part} as healed?`)) return;
    savedToast(await send("POST", `/injuries/${inj.id}/resolve`, { date: today }), "Marked as healed");
    reload();
  }

  return (
    <div className="page">
      <PageHeader title="Injuries" sub="Active injuries get a quick pain check on the Today screen." back="#/more" />
      {reporting ? (
        <ReportForm today={today} onDone={() => (setReporting(false), reload())} />
      ) : (
        <button className="btn primary block" onClick={() => setReporting(true)}>Report an injury</button>
      )}
      {error && <p className="error">{error}</p>}
      {data?.active.map((inj) => (
        <Card key={inj.id} tone="warn" title={`${inj.body_part}${inj.side ? ` (${inj.side})` : ""}`}
          action={<button className="link" onClick={() => resolve(inj)}>Healed</button>}>
          <p className="muted small">Since {prettyDate(inj.started_on)}{inj.description ? ` · ${inj.description}` : ""}</p>
          {inj.updates?.length ? (
            <p className="small">Pain: {inj.updates.slice().reverse().map((u) => `${u.pain}`).join(" → ")}
              <span className="muted"> (latest {dayLabel(inj.updates[0].date, today)})</span></p>
          ) : <p className="muted small">No pain scores yet.</p>}
        </Card>
      ))}
      {data && data.resolved.length > 0 && (
        <Card title="Healed">
          <ul className="mini-list">
            {data.resolved.map((inj) => (
              <li key={inj.id}>{inj.body_part}{inj.side ? ` (${inj.side})` : ""} · {prettyDate(inj.started_on)} → {prettyDate(inj.resolved_on!)}</li>
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
        <Field label="Side"><Chips options={["left", "right", "both"].map((s) => ({ value: s, label: s }))} value={side} onChange={setSide} clearable /></Field>
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
