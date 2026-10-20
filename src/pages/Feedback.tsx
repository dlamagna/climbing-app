// App feedback (#52): bugs and ideas about the app. The daily coach review reads new feedback and decides
// whether to file it as a GitHub issue (written without personal details, since the repo is public).
import { useState } from "react";
import { isQueued, savedToast, send, useApi } from "../api";
import { Card, Field, OverflowMenu, PageHeader } from "../components/ui";
import { dayLabel, localDateOf, localToday } from "../dates";
import type { AppFeedback } from "../types";

// The linked issue's progress (#70): "live" means the fix is in the running app.
const ISSUE_STATUS: Record<NonNullable<AppFeedback["issue_status"]>, { label: string; cls: string }> = {
  open: { label: "open", cls: "" },
  merged: { label: "merged", cls: "partial" },
  deploying: { label: "merged, deploying", cls: "partial" },
  live: { label: "live", cls: "done" },
  closed: { label: "closed", cls: "skipped" },
};

const STATUS: Record<AppFeedback["status"], string> = {
  new: "waiting for review",
  filed: "filed",
  duplicate: "already planned",
  declined: "not filed",
};

export default function Feedback() {
  const today = localToday();
  const { data, error, reload } = useApi<AppFeedback[]>("/feedback");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      savedToast(await send("PUT", `/feedback/${editing.id}`, { text: editing.text.trim() }), "Feedback updated");
      setEditing(null);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this feedback? This can't be undone.")) return;
    try {
      savedToast(await send("DELETE", `/feedback/${id}`), "Deleted");
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const result = await send("POST", "/feedback", { text: text.trim() });
      savedToast(result, "Thanks - the coach will look at it in the next daily review");
      setText("");
      if (!isQueued(result)) reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="App feedback" sub="Bugs, ideas, anything annoying" back="#/more" />
      <Card>
        <div className="form">
          <Field label="What should change?">
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. The timer beep is too quiet" />
          </Field>
          <p className="muted small">
            The daily review decides whether it becomes an issue on the app's public GitHub repo. Issues are written in general terms; nothing
            personal is copied there.
          </p>
          <button className="btn primary block" disabled={busy || !text.trim()} onClick={submit}>
            Send
          </button>
        </div>
      </Card>
      {error && <p className="error">{error}</p>}
      {data && data.length > 0 && (
        <Card title="Sent">
          <ul className="feedback-list">
            {data.map((f) => (
              <li key={f.id}>
                {editing?.id === f.id ? (
                  <div className="form">
                    <textarea rows={4} aria-label="Feedback" value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} />
                    <div className="row">
                      <button className="btn primary" disabled={busy || !editing.text.trim()} onClick={saveEdit}>
                        Save
                      </button>
                      <button className="btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="entry">
                    <p className="prewrap">{f.text}</p>
                    <OverflowMenu
                      label="Feedback options"
                      items={[
                        ...(f.status === "new" ? [{ label: "Edit", onSelect: () => setEditing({ id: f.id, text: f.text }) }] : []),
                        { label: "Delete", danger: true, onSelect: () => remove(f.id) },
                      ]}
                    />
                  </div>
                )}
                <p className="muted small">
                  {dayLabel(localDateOf(f.created_at), today)} ·{" "}
                  <span className={`tag status ${f.status === "new" ? "" : f.status === "declined" ? "skipped" : "done"}`}>{STATUS[f.status]}</span>
                  {f.issue_number !== null && (
                    <>
                      {" "}
                      ·{" "}
                      {f.issue_url ? (
                        <a href={f.issue_url} target="_blank" rel="noreferrer">
                          #{f.issue_number}
                        </a>
                      ) : (
                        `#${f.issue_number}`
                      )}
                      {f.issue_status && (
                        <>
                          {" "}
                          <span className={`tag status ${ISSUE_STATUS[f.issue_status].cls}`}>{ISSUE_STATUS[f.issue_status].label}</span>
                        </>
                      )}
                    </>
                  )}
                </p>
                {f.reply && <p className="small">{f.reply}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
