// Injury pieces shared by the morning check-in, the session log and the Injuries page.

import { type ReactNode, useState } from "react";
import { dayLabel } from "../dates";
import type { Injury, RedFlag, Trend } from "../types";
import { Chips, Field, MultiChips, range } from "./ui";

export const BODY_PARTS = ["Finger", "Wrist", "Elbow", "Shoulder", "Neck / back", "Hip", "Knee", "Ankle", "Skin", "Other"];
export const SIDES = ["left", "right", "both"].map((s) => ({ value: s, label: s }));

export const TRENDS: { value: Trend; label: string }[] = [
  { value: "better", label: "Better" },
  { value: "same", label: "Same" },
  { value: "worse", label: "Worse" },
  { value: "gone", label: "Gone" },
];

export const RED_FLAGS: { value: RedFlag; label: string }[] = [
  { value: "swelling", label: "Swelling" },
  { value: "numbness", label: "Numbness / tingling" },
  { value: "night_pain", label: "Night pain" },
];

const PAIN = range(0, 10).map((v) => ({ value: v, label: String(v) }));

export const injuryName = (inj: { body_part: string; side: string | null }) =>
  `${inj.body_part}${inj.side ? ` (${inj.side})` : ""}`;

export const trendLabel = (t: Trend | null) => TRENDS.find((o) => o.value === t)?.label ?? "";

export const redFlagLabels = (flags: string | null) =>
  (flags ? flags.split(",") : []).map((f) => RED_FLAGS.find((o) => o.value === f)?.label ?? f);

// --- Daily follow-up row in the morning check-in ---

export interface FollowUp {
  injury_id: number;
  trend: Trend | null;
  pain: number | null;
  stiffness: number | null;
  red_flags: RedFlag[];
  touched: boolean; // only touched rows are sent, so an untouched injury isn't recorded as "same"
  prevPain: number | null; // restored when switching away from "gone"
}

// Prefilled from today's update when re-editing, else from the latest one so a "same" day is one tap.
export function initialFollowUp(inj: Injury, date: string): FollowUp {
  const todays = inj.updates?.find((u) => u.date === date);
  const last = inj.updates?.find((u) => u.date < date);
  const prevPain = last?.pain ?? null;
  if (todays) {
    return {
      injury_id: inj.id,
      trend: todays.trend,
      pain: todays.pain,
      stiffness: todays.stiffness,
      red_flags: (todays.red_flags?.split(",") ?? []) as RedFlag[],
      touched: true,
      prevPain,
    };
  }
  return { injury_id: inj.id, trend: null, pain: prevPain, stiffness: null, red_flags: [], touched: false, prevPain };
}

export function FollowUpRow({
  injury,
  date,
  value: f,
  onChange,
}: {
  injury: Injury;
  date: string;
  value: FollowUp;
  onChange: (f: FollowUp) => void;
}) {
  const [flagsOpen, setFlagsOpen] = useState(f.red_flags.length > 0);
  const set = (patch: Partial<FollowUp>) => onChange({ ...f, ...patch, touched: true });
  const last = injury.updates?.find((u) => u.date < date);

  function setTrend(trend: Trend | null) {
    if (trend === "gone") set({ trend, pain: 0 });
    else if (f.trend === "gone") set({ trend, pain: f.prevPain });
    else set({ trend });
  }

  return (
    <div className="injury-row">
      <Field label={injuryName(injury)} hint={last ? `last: ${last.pain} · ${dayLabel(last.date, date)}` : "first check"}>
        <Chips options={TRENDS} value={f.trend} onChange={setTrend} />
      </Field>
      {f.trend === "gone" ? (
        <p className="muted small">Will be marked healed. Ease back in over a few sessions.</p>
      ) : (
        <>
          <Field label="Pain" hint="0 none · 10 worst">
            <Chips wrap options={PAIN} value={f.pain} onChange={(pain) => set({ pain })} />
          </Field>
          <Field label="Stiff this morning?">
            <Chips
              options={[
                { value: 0, label: "No" },
                { value: 1, label: "Yes" },
              ]}
              value={f.stiffness}
              onChange={(stiffness) => set({ stiffness })}
              clearable
            />
          </Field>
          {flagsOpen ? (
            <Field label="Red flags" hint="tap any you have">
              <MultiChips options={RED_FLAGS} value={f.red_flags} onChange={(red_flags) => set({ red_flags })} />
            </Field>
          ) : (
            <button type="button" className="link" onClick={() => setFlagsOpen(true)}>
              + swelling / numbness / night pain
            </button>
          )}
        </>
      )}
    </div>
  );
}

// --- Quick-add form, used inside the check-in and the session log ---

export interface InjuryDraft {
  part: string | null;
  side: string | null;
  description: string;
}

export const EMPTY_DRAFT: InjuryDraft = { part: null, side: null, description: "" };

export const draftBody = (d: InjuryDraft) => ({
  body_part: d.part!,
  side: d.side,
  description: d.description.trim() || null,
});

export function QuickInjury({
  draft,
  onChange,
  onRemove,
  children,
}: {
  draft: InjuryDraft;
  onChange: (d: InjuryDraft) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const set = (patch: Partial<InjuryDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="sub-form">
      <div className="sub-form-head">
        <strong>New injury</strong>
        <button type="button" className="link" onClick={onRemove}>
          Remove
        </button>
      </div>
      <Field label="Where">
        <Chips wrap options={BODY_PARTS.map((p) => ({ value: p, label: p }))} value={draft.part} onChange={(part) => set({ part })} />
      </Field>
      <Field label="Side">
        <Chips options={SIDES} value={draft.side} onChange={(side) => set({ side })} clearable />
      </Field>
      <Field label="What happened" hint="optional">
        <input
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="e.g. ring finger A2, tweaked on a crimp"
        />
      </Field>
      {children}
    </div>
  );
}
