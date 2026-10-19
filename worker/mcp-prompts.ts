// MCP prompts for voice-note logging (#18): "morning_log" and "training_log" serve the checklists from
// worker/checklists.ts, and the get_log_checklist tool returns the same text for clients that don't surface
// prompts. Data loading is injected (ChecklistLoader), so the JSON-RPC handling is unit tested without D1.
// "daily_review" (#52) starts the scheduled coach review; its steps come from start_daily_review.

import {
  CHECKLIST_KINDS,
  type ChecklistInjury,
  type ChecklistKind,
  type ChecklistPlanEntry,
  checklistMessage,
  morningChecklist,
  saveNotes,
  trainingChecklist,
} from "./checklists";
import { type Env, getPlan } from "./db";
import { isIsoDate } from "./injury-dates";
import { type Tool, dateSchema, todayFor } from "./mcp-common";
import { SESSION_TAGS } from "./tags";

export interface ChecklistData {
  today: string;
  injuries: ChecklistInjury[];
  plan: ChecklistPlanEntry[]; // entries on the requested date
}

// Loads what a checklist needs for a date (YYYY-MM-DD, or undefined for today in the climber's timezone).
export type ChecklistLoader = (date: string | undefined) => Promise<ChecklistData & { date: string }>;

export function d1ChecklistLoader(env: Env): ChecklistLoader {
  return async (date) => {
    const today = await todayFor(env);
    const day = date ?? today;
    const [injuries, plan] = await Promise.all([
      env.DB.prepare("SELECT id, body_part, side FROM injuries WHERE resolved_on IS NULL ORDER BY started_on, id")
        .all<ChecklistInjury>()
        .then((r) => r.results),
      getPlan(env.DB, day, day, today).then((p) => p.entries as ChecklistPlanEntry[]),
    ]);
    return { date: day, today, injuries, plan };
  };
}

export class InvalidParams extends Error {}

function checkDate(date: unknown): string | undefined {
  if (date === undefined || date === null || date === "") return undefined;
  if (!isIsoDate(date)) throw new InvalidParams("date must be YYYY-MM-DD");
  return date;
}

// The full checklist message for a kind (what the prompt and the tool both return).
export async function checklistText(kind: ChecklistKind, date: unknown, load: ChecklistLoader): Promise<string> {
  if (!CHECKLIST_KINDS.includes(kind)) throw new InvalidParams(`kind must be one of ${CHECKLIST_KINDS.join(", ")}`);
  const d = await load(checkDate(date));
  const checklist =
    kind === "morning"
      ? morningChecklist(d.date, d.injuries)
      : trainingChecklist({ date: d.date, today: d.today, injuries: d.injuries, plan: d.plan, tags: SESSION_TAGS });
  return checklistMessage(kind, checklist, saveNotes(kind, d.date, d.injuries, d.plan));
}

const DATE_ARG = {
  name: "date",
  description: "The day the session was (YYYY-MM-DD). Defaults to today in the climber's timezone.",
  required: false,
};

export const PROMPTS = [
  {
    name: "morning_log",
    title: "Morning log (voice note)",
    description:
      "Shows the morning check-in checklist (sleep, feeling, drinks, protein, each active injury) to read while recording a voice note, then saves what the note says.",
    arguments: [],
    kind: "morning" as ChecklistKind,
  },
  {
    name: "training_log",
    title: "Training log (voice note)",
    description:
      "Shows the training session checklist (type, duration, effort, hardest send, planned session and its tests) to read while recording a voice note, then logs the session.",
    arguments: [DATE_ARG],
    kind: "training" as ChecklistKind,
  },
];

export const REVIEW_PROMPT = {
  name: "daily_review",
  title: "Daily coach review",
  description:
    "The scheduled daily review: checks what was logged since the last run and, when something changed, adjusts the coming plan, leaves a coach note and asks the climber questions in the app.",
  arguments: [],
};

export const REVIEW_PROMPT_TEXT =
  "Run the daily coach review for the climbing app: call start_daily_review and follow its instructions exactly.";

// prompts/list and prompts/get. Returns the JSON-RPC result, or throws InvalidParams (-32602).
export async function handlePromptRequest(method: "prompts/list" | "prompts/get", params: any, load: ChecklistLoader) {
  if (method === "prompts/list") return { prompts: [...PROMPTS.map(({ kind: _kind, ...p }) => p), REVIEW_PROMPT] };
  if (params?.name === REVIEW_PROMPT.name) {
    return { description: REVIEW_PROMPT.description, messages: [{ role: "user", content: { type: "text", text: REVIEW_PROMPT_TEXT } }] };
  }
  const prompt = PROMPTS.find((p) => p.name === params?.name);
  if (!prompt) throw new InvalidParams(`Unknown prompt: ${params?.name}`);
  const date = prompt.kind === "training" ? params?.arguments?.date : undefined;
  const text = await checklistText(prompt.kind, date, load);
  return { description: prompt.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

export const CHECKLIST_TOOL: Tool = {
  name: "get_log_checklist",
  description:
    "The fixed voice-note checklist for a 'morning log' or 'training log' (same text as the morning_log / training_log prompts): show the checklist part to the climber exactly as written, wait for their voice note, then follow the instructions in the text to confirm and save.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: CHECKLIST_KINDS },
      date: { ...dateSchema, description: "Training: the day of the session (defaults to today in the climber's timezone)" },
    },
    required: ["kind"],
  },
  annotations: { readOnlyHint: true },
  run: async (a, env) => checklistText(a.kind, a.date, d1ChecklistLoader(env)),
};
