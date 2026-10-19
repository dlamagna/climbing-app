// Voice-note logging checklists (#18): the text Claude shows for "morning log" / "training log", which the
// climber reads while recording a voice note. Pure: inputs are the active injuries, the plan entries for the
// date and the style tags, so the text is unit tested (checklists.test.ts). worker/mcp-prompts.ts serves it
// as MCP prompts and as the get_log_checklist tool.
//
// The wording is FIXED (the same every time, so it becomes familiar); only the dynamic parts change:
// the date, each active injury by name, the planned entries for the date and their expected benchmarks.
// Lines starting with "Optional:" are optional; REQUIRED below says which items Claude asks about when the
// voice note misses them.

import { OUTDOOR_TYPES, SESSION_TYPES } from "./sessions";

export const CHECKLIST_KINDS = ["morning", "training"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export interface ChecklistInjury {
  id: number;
  body_part: string;
  side?: string | null;
}

export interface ChecklistPlanEntry {
  id: number;
  title: string;
  type?: string | null;
  intensity?: string | null;
  duration_min?: number | null;
  status?: string | null;
  expected_benchmarks?: { name: string; unit?: string | null }[] | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-18" -> "Sun 18 Oct". Computed in UTC so it doesn't depend on the server's timezone.
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// "Finger - ring finger A2 pulley (left)"
export const injuryName = (i: ChecklistInjury) => (i.side ? `${i.body_part} (${i.side})` : i.body_part);

const isRest = (e: ChecklistPlanEntry) => e.type === "rest" || e.intensity === "rest";

// '"Limit bouldering" (boulder, hard, 90 min)'
function entryLabel(e: ChecklistPlanEntry): string {
  const bits = [e.type, e.intensity, e.duration_min ? `${e.duration_min} min` : null].filter(Boolean);
  return `"${e.title}"${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

const benchmarkLabel = (b: { name: string; unit?: string | null }) => (b.unit ? `${b.name} (${b.unit})` : b.name);

export function morningChecklist(date: string, injuries: ChecklistInjury[]): string {
  const lines = [
    `Morning log - ${dayLabel(date)}`,
    "- Sleep: hours, and bad / ok / good",
    "- How you feel: 1 wrecked .. 5 fresh",
    "- Drinks yesterday",
    "- Protein yesterday: low / ok / high",
    ...injuries.map(
      (i) =>
        `- ${injuryName(i)}: pain 0-10; better / same / worse / gone; morning stiffness?; any red flags (swelling, numbness/tingling, night pain)?`,
    ),
    "- Optional: weight, anything else",
  ];
  return lines.join("\n");
}

export interface TrainingChecklistInput {
  date: string; // the day the checklist is for
  today: string; // today in the climber's timezone
  injuries: ChecklistInjury[];
  plan: ChecklistPlanEntry[]; // entries on `date`
  tags: readonly string[]; // SESSION_TAGS
}

export function trainingChecklist({ date, today, injuries, plan, tags }: TrainingChecklistInput): string {
  const day = dayLabel(date);
  const injuryNames = injuries.map(injuryName);
  const sessions = plan.filter((e) => !isRest(e));
  const benchmarks = sessions.flatMap((e) => e.expected_benchmarks ?? []);
  const lines = [
    `Training log - ${day}${date === today ? " (today)" : ""}`,
    `- Date, if not ${day}`,
    `- Type: ${SESSION_TYPES.join(", ")}`,
    "- Duration (minutes), effort 1-10",
    "- Hardest send",
    `- What you worked on, how your fingers${injuryNames.length ? ` and ${injuryNames.join(", ")}` : ""} felt`,
    `- Optional: style tags (${tags.join(", ")})`,
    `- Optional: indoor or outdoor? (${OUTDOOR_TYPES.join(", ")} only; indoor if not said)`,
    "- Optional: which gym?",
    sessions.length
      ? `- Was this the planned session? Planned for ${day}: ${sessions.map(entryLabel).join(" or ")}`
      : plan.length
        ? `- Planned for ${day}: rest day. Was this a planned session from another day?`
        : `- Nothing planned for ${day}. Was this a planned session from another day?`,
    benchmarks.length
      ? `- Optional: results for the planned tests: ${benchmarks.map(benchmarkLabel).join(", ")}`
      : "- Optional: any test / benchmark results",
    "- Optional: new tweak or injury",
  ];
  return lines.join("\n");
}

// The ids Claude needs to save what the voice note says. Not part of the checklist shown to the climber.
export function saveNotes(kind: ChecklistKind, date: string, injuries: ChecklistInjury[], plan: ChecklistPlanEntry[]): string {
  const lines = [`Date: ${date}.`];
  lines.push(
    injuries.length
      ? `Active injuries (injury_id = name): ${injuries.map((i) => `${i.id} = ${injuryName(i)}`).join("; ")}.`
      : "No active injuries.",
  );
  if (kind === "training") {
    lines.push(
      plan.length
        ? `Plan entries on ${date} (plan_id = title, status): ${plan.map((e) => `${e.id} = "${e.title}", ${e.status ?? "planned"}`).join("; ")}.`
        : `No plan entries on ${date}.`,
    );
  }
  return lines.join("\n");
}

const FLOW: Record<ChecklistKind, string> = {
  morning:
    "I'm logging this morning by voice note. Reply with the checklist below exactly as written, with nothing added, then wait for my voice note.",
  training:
    "I'm logging a training session by voice note. Reply with the checklist below exactly as written, with nothing added, then wait for my voice note.",
};

// Which items count as required (asked about when missing). The rest is saved only when mentioned.
const REQUIRED: Record<ChecklistKind, string> = {
  morning:
    "Required: sleep hours and quality, feeling, drinks, protein, and each listed injury's pain and trend. Stiffness, red flags, weight and notes are saved only if I mention them.",
  training:
    "Required: type, duration, effort, and whether it was the planned session (when something was planned that day). The date is the one above unless I say another. Everything else is saved only if I mention it.",
};

const AFTER =
  "When the voice note arrives: summarise what you understood in a few short lines, ask only about required items I missed, and save after I confirm. Never fill in values I didn't mention. Follow the server's voice-log instructions for scales and which tools to use.";

// The full text served by the prompt and by get_log_checklist: what to do, the checklist, and the ids.
export function checklistMessage(kind: ChecklistKind, checklist: string, notes: string): string {
  return [FLOW[kind], "", "---", checklist, "---", "", REQUIRED[kind], AFTER, "", "For saving (don't show this part):", notes].join("\n");
}
