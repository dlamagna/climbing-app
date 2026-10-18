// Report / resolve forms with editable dates, so an injury remembered days later (or found in an old
// session note) can be recorded with the dates it really happened.

import { useState } from "react";
import { type InjuryDraft, BODY_PARTS, SIDES, injuryName } from "./injury";
import { savedToast, send } from "../api";
import { localToday, prettyDate } from "../dates";
import type { Injury } from "../types";
import { defaultStartedOn, injuryDatesError } from "../../worker/injury-dates";
import { Card, Chips, DatePicker, Field, range } from "./ui";

export interface ReportPrefill extends Partial<InjuryDraft> {
  startedOn?: string; // the session's date when added from a session
  sessionId?: number | null; // links the injury to that session
}

export function ReportForm({
  prefill,
  title = "Report an injury",
  onSaved,
  onCancel,
}: {
  prefill?: ReportPrefill;
  title?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const today = localToday();
  const [part, setPart] = useState<string | null>(prefill?.part ?? null);
  const [detail, setDetail] = useState("");
  const [side, setSide] = useState<string | null>(prefill?.side ?? null);
  const [pain, setPain] = useState<number | null>(null);
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [startedOn, setStartedOn] = useState(defaultStartedOn(today, prefill?.startedOn));
  const [healed, setHealed] = useState(false);
  const [resolvedOn, setResolvedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const dateError = injuryDatesError(startedOn, healed ? resolvedOn : null, today);

  async function submit() {
    setBusy(true);
    try {
      const body_part = detail.trim() ? `${part} - ${detail.trim()}` : part;
      const result = await send("POST", "/injuries", {
        body_part,
        side,
        description: description.trim() || null,
        started_on: startedOn,
        resolved_on: healed ? resolvedOn : null,
        pain: healed ? null : pain,
        session_id: prefill?.sessionId ?? null,
      });
      savedToast(result, healed ? "Healed injury recorded" : "Injury reported");
      onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={title} tone="warn">
      <div className="form">
        <Field label="Where"><Chips wrap options={BODY_PARTS.map((p) => ({ value: p, label: p }))} value={part} onChange={setPart} /></Field>
        <Field label="More specific" hint="optional"><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. ring finger A2 pulley" /></Field>
        <Field label="Side"><Chips options={SIDES} value={side} onChange={setSide} clearable /></Field>
        <Field label="Started" hint={prefill?.sessionId ? "linked to that session" : undefined}>
          <DatePicker value={startedOn} onChange={setStartedOn} />
        </Field>
        <Field label="Already healed?">
          <Chips options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} value={healed ? "yes" : "no"} onChange={(v) => v && setHealed(v === "yes")} />
        </Field>
        {healed ? (
          <Field label="Healed on"><DatePicker value={resolvedOn} onChange={setResolvedOn} min={startedOn} /></Field>
        ) : (
          <Field label={startedOn === today ? "Pain now" : "Pain on that day"} hint="0 none · 10 worst">
            <Chips wrap options={range(0, 10).map((v) => ({ value: v, label: String(v) }))} value={pain} onChange={setPain} />
          </Field>
        )}
        <Field label="What happened" hint="optional"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Move, feeling (pop? gradual?), what makes it hurt" /></Field>
        {dateError && <p className="small error">{dateError}</p>}
        <div className="actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!part || (!healed && pain === null) || Boolean(dateError) || busy} onClick={submit}>Save</button>
        </div>
        <p className="muted small">A pop, swelling, bruising or pain that keeps getting worse is worth getting checked by a physio.</p>
      </div>
    </Card>
  );
}

// "Healed" confirm with a date (default today, or a session's date when it comes from a note).
export function ResolveForm({
  injury,
  defaultDate,
  onSaved,
  onCancel,
}: {
  injury: Pick<Injury, "id" | "body_part" | "side" | "started_on">;
  defaultDate?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const today = localToday();
  const [date, setDate] = useState(defaultDate ?? today);
  const [busy, setBusy] = useState(false);
  const dateError = injuryDatesError(injury.started_on, date, today);

  async function submit() {
    setBusy(true);
    try {
      savedToast(await send("POST", `/injuries/${injury.id}/resolve`, { date }), `${injuryName(injury)} marked healed`);
      onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-tight">
      <Field label="Healed on" hint={`started ${prettyDate(injury.started_on)}`}>
        <DatePicker value={date} onChange={setDate} min={injury.started_on} />
      </Field>
      {dateError && <p className="small error">{dateError}</p>}
      <div className="actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={Boolean(dateError) || busy} onClick={submit}>Mark healed</button>
      </div>
    </div>
  );
}
