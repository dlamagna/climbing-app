// Suggestions from pain words in session notes (src/painWords.ts): right after saving a session, and as a
// one-off review of old notes on the Injuries screen. Nothing is created until the climber taps.

import { useState } from "react";
import { useApi } from "../api";
import { localToday, prettyDate } from "../dates";
import { type NoteHit, type NoteSuggestions as Suggestions, type SessionNote, reviewMatches } from "../painWords";
import { type Injury, typeLabel } from "../types";
import { injuryName } from "./injury";
import { ReportForm, ResolveForm } from "./injuryForms";
import { Card, Chips, PageHeader } from "./ui";

const hitKey = (h: NoteHit) => `${h.kind}:${h.part ?? "?"}`;

// The snippet with the matched word in bold.
function Snippet({ hit }: { hit: NoteHit }) {
  const at = hit.snippet.toLowerCase().indexOf(hit.word);
  if (at < 0) return <>“{hit.snippet}”</>;
  return (
    <>
      “{hit.snippet.slice(0, at)}
      <strong>{hit.snippet.slice(at, at + hit.word.length)}</strong>
      {hit.snippet.slice(at + hit.word.length)}”
    </>
  );
}

const prefillFrom = (hit: NoteHit, date: string, sessionId: number | null) => ({
  part: hit.part,
  side: hit.side,
  description: hit.snippet,
  startedOn: date,
  sessionId,
});

// Shown in place of the session form after saving, when its note mentions a tweak or a healed injury.
// sessionId is null when the save was queued offline (the session has no id yet, so no link).
export function NoteSuggestions({
  suggestions,
  sessionId,
  date,
  onDone,
}: {
  suggestions: Suggestions<Injury>;
  sessionId: number | null;
  date: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, number | null>>({});
  const finish = (key: string) => (setDone((d) => [...d, key]), setOpen(null));

  return (
    <div className="page">
      <PageHeader title="Session saved" />
      <Card title="Anything to track?" tone="warn">
        <p className="muted small">Your note mentions this. Add it so the morning check-in follows it up, or skip.</p>
        <div className="form">
          {suggestions.tweaks.map((hit) => {
            const key = hitKey(hit);
            return done.includes(key) ? (
              <p key={key} className="small">✓ Added</p>
            ) : open === key ? (
              <ReportForm
                key={key}
                title="Add injury"
                prefill={prefillFrom(hit, date, sessionId)}
                onSaved={() => finish(key)}
                onCancel={() => setOpen(null)}
              />
            ) : (
              <div key={key} className="row-between">
                <span className="small"><Snippet hit={hit} /></span>
                <button className="btn" onClick={() => setOpen(key)}>Add {hit.part ? hit.part.toLowerCase() : ""} injury</button>
              </div>
            );
          })}
          {suggestions.healed.map(({ hit, candidates }) => {
            const key = hitKey(hit);
            const chosen = candidates.length === 1 ? candidates[0] : candidates.find((i) => i.id === picked[key]);
            if (done.includes(key)) return <p key={key} className="small">✓ Marked healed</p>;
            return (
              <div key={key} className="form-tight">
                <span className="small"><Snippet hit={hit} /></span>
                {candidates.length > 1 && (
                  <Chips
                    wrap
                    options={candidates.map((i) => ({ value: i.id, label: injuryName(i) }))}
                    value={picked[key] ?? null}
                    onChange={(id) => setPicked((p) => ({ ...p, [key]: id }))}
                  />
                )}
                {open === key && chosen ? (
                  <ResolveForm injury={chosen} defaultDate={date} onSaved={() => finish(key)} onCancel={() => setOpen(null)} />
                ) : (
                  <button className="btn" disabled={!chosen} onClick={() => setOpen(key)}>
                    {chosen ? `Mark ${injuryName(chosen)} healed` : "Pick which injury"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <button className="btn primary block" onClick={onDone}>Done</button>
    </div>
  );
}

// One-off scan of old session notes, for tweaks written down before injuries could be tracked.
// Sessions already linked to an injury are left out by the API.
export function NoteReview({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const { data, error, reload } = useApi<SessionNote[]>("/session-notes");
  const [open, setOpen] = useState<string | null>(null);
  const matches = data ? reviewMatches(data) : [];
  const today = localToday();

  return (
    <Card title="Past session notes" action={<button className="link" onClick={onClose}>Close</button>}>
      <p className="muted small">Notes that mention a tweak or pain. Add the ones that were real injuries, with the date they healed if they have.</p>
      {error && <p className="error">{error}</p>}
      {data && matches.length === 0 && <p className="muted small">Nothing found.</p>}
      <div className="form">
        {matches.map(({ session, hit }) => {
          const key = `${session.id}:${hitKey(hit)}`;
          return (
            <div key={key} className="form-tight">
              <div className="small">
                <strong>{session.date === today ? "Today" : prettyDate(session.date)}</strong>
                <span className="muted"> · {typeLabel(session.type)}</span>
              </div>
              <span className="small muted"><Snippet hit={hit} /></span>
              {open === key ? (
                <ReportForm
                  title="Add as injury"
                  prefill={prefillFrom(hit, session.date, session.id)}
                  onSaved={() => (setOpen(null), reload(), onAdded())}
                  onCancel={() => setOpen(null)}
                />
              ) : (
                <button className="btn" onClick={() => setOpen(key)}>Add as injury</button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
