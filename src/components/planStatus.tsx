// Plan vs actual (#21): status chip on past / today's plan entries, the conflict flags on upcoming ones,
// and the "this week so far" line. Statuses come from the server (worker/plan.ts).

import { useState } from "react";
import { savedToast, send } from "../api";
import { dayLabel } from "../dates";
import type { PlanConflict, PlanEntry, PlanStatus } from "../types";
import { weekSummary, weekSummaryText } from "../../worker/plan";
import { Chips } from "./ui";

const LABELS: Record<PlanStatus, string> = {
  planned: "Planned",
  done: "Done",
  partial: "Partial",
  skipped: "Skipped",
  swapped: "Swapped",
};

const CHOICES: PlanStatus[] = ["done", "partial", "swapped", "skipped"];

// Tap the chip, then one option to set the status by hand; "Auto" goes back to the derived one.
export function StatusChip({ entry, today, onChanged }: { entry: PlanEntry; today: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<{ status: PlanStatus; override: boolean } | null>(null);
  if (!entry.status || !entry.auto_status || entry.date > today) return null;
  const status = local?.status ?? entry.status;
  const overridden = local?.override ?? entry.status_override != null;

  async function pick(value: PlanStatus | "auto" | null) {
    if (value === null) return;
    const override = value === "auto" ? null : value;
    setOpen(false);
    setLocal({ status: override ?? entry.auto_status!, override: override !== null });
    try {
      savedToast(await send("PUT", `/plan/${entry.id}/status`, { status: override }), "Status saved");
      onChanged?.();
    } catch (e) {
      setLocal(null);
      alert((e as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`tag status ${status}`}
        aria-expanded={open}
        title={overridden ? "Set by hand - tap to change" : "Worked out from what you logged - tap to change"}
        onClick={() => setOpen(!open)}
      >
        {LABELS[status]}
        {overridden && " ✎"}
      </button>
      {open && (
        <div className="status-picker">
          <Chips<PlanStatus | "auto">
            wrap
            options={[
              ...CHOICES.map((v) => ({ value: v, label: LABELS[v] })),
              { value: "auto", label: `Auto (${LABELS[entry.auto_status].toLowerCase()})` },
            ]}
            value={overridden ? status : "auto"}
            onChange={pick}
          />
        </div>
      )}
    </>
  );
}

export function conflictText(c: PlanConflict, today: string): string {
  const day = dayLabel(c.date, today);
  switch (c.kind) {
    case "rest_day_session":
      return `Trained on the rest day (${day})`;
    case "hard_before_hard":
      return `Comes right after a hard day (${day})`;
    case "key_session_missed":
      return `${c.title} didn't happen (${day}) - reschedule?`;
  }
}

export function PlanFlags({ flags, today }: { flags?: PlanConflict[]; today: string }) {
  if (!flags?.length) return null;
  return (
    <ul className="flags">
      {flags.map((c, i) => (
        <li key={i} className="small warn">
          {conflictText(c, today)}
        </li>
      ))}
    </ul>
  );
}

// Needs the entries from Monday of this week to today.
export function WeekSoFar({ entries, today }: { entries: PlanEntry[]; today: string }) {
  const withStatus = entries.filter((e): e is PlanEntry & { status: PlanStatus } => e.status !== undefined);
  const text = weekSummaryText(weekSummary(withStatus, today));
  return text ? <p className="small muted">{text}</p> : null;
}
