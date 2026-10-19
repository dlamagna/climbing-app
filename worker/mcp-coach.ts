// MCP tools for the daily coach review (#52): start_daily_review (what changed since the last run, plus the
// review steps), ask_question / close_questions (questions shown on the app's Today screen) and
// record_coach_run (logs the run; its seen_through is where the next one starts), and resolve_feedback (what
// was done with feedback typed in the app). Logic is in worker/coach.ts.

import {
  DEFAULT_EXPIRY_DAYS,
  FEEDBACK_OUTCOMES,
  MAX_EXPIRY_DAYS,
  MAX_OPEN_QUESTIONS,
  MAX_OPTIONS,
  RUN_OUTCOMES,
  askQuestion,
  closeQuestions,
  nowStamp,
  parseQuestion,
  parseResolution,
  parseRun,
  recordRun,
  resolveFeedback,
  startReview,
} from "./coach";
import { type Tool, dateSchema, todayFor } from "./mcp-common";

export const COACH_TOOLS: Tool[] = [
  {
    name: "start_daily_review",
    description:
      "First call of the scheduled daily coach review (also fine to call by hand). Returns checked_at, the last run, review_needed with reasons, what was written since the last run (sessions logged or edited, new injuries, injury updates, profile keys changed, plan entries added by hand, answered and skipped questions, app feedback not handled yet, check-in and benchmark counts), planned_days_ahead, climbing_days (the climber's latest pick of climbing days, as dates), open questions, and the review instructions to follow.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, env) => startReview(env.DB, await todayFor(env)),
  },
  {
    name: "ask_question",
    description: `Ask the climber something the data can't tell you; it shows as a card on the app's Today screen until answered, skipped or expired, and the answer comes back in start_daily_review / get_overview. Give 2-${MAX_OPTIONS} short options to tap when you can. At most ${MAX_OPEN_QUESTIONS} open at once; asking the same open question again returns the existing one.`,
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Short and specific, e.g. 'How many days can you climb this week?'" },
        why: { type: "string", description: "One line on why you ask, shown under the question" },
        options: { type: "array", items: { type: "string" }, maxItems: MAX_OPTIONS, description: "Answer chips, e.g. ['2', '3', '4+']; leave out for a free-text question" },
        allow_text: { type: "boolean", default: true, description: "With options: also allow a short typed answer" },
        multi: { type: "boolean", default: false, description: "With options: several can be picked (the answer lists them comma-separated)" },
        expires_on: { ...dateSchema, description: `Last day to show it (default today + ${DEFAULT_EXPIRY_DAYS}, at most + ${MAX_EXPIRY_DAYS})` },
      },
      required: ["question"],
    },
    run: async (a, env) => {
      const today = await todayFor(env);
      return askQuestion(env.DB, parseQuestion(a, today), today);
    },
  },
  {
    name: "close_questions",
    description:
      "Close questions by id: answered ones once you have used the answer, skipped ones, and open ones that no longer matter (withdrawn, they disappear from the app). Closed questions don't come back.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "integer" }, minItems: 1 } },
      required: ["ids"],
    },
    annotations: { idempotentHint: true },
    run: async (a, env) => closeQuestions(env.DB, a.ids),
  },
  {
    name: "resolve_feedback",
    description:
      "Record what was done with an app feedback item (start_daily_review's changes.new_feedback): 'filed' as a new issue, 'duplicate' of an existing issue (both need issue_number), or 'declined'. The reply is shown to the climber next to their feedback in the app.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Feedback id" },
        status: { type: "string", enum: FEEDBACK_OUTCOMES },
        issue_number: { type: "integer" },
        issue_url: { type: "string", description: "The issue's github.com link" },
        reply: { type: "string", description: "One short line for the climber, e.g. 'Filed as #60 (P2)' or why it was declined" },
      },
      required: ["id", "status"],
    },
    annotations: { idempotentHint: true },
    run: async (a, env) => resolveFeedback(env.DB, a.id, parseResolution(a)),
  },
  {
    name: "record_coach_run",
    description:
      "Last call of every daily review: logs the run so the next one only looks at newer data and the app can show the summary. Pass seen_through = checked_at from start_daily_review.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: RUN_OUTCOMES, description: "'updated' if you changed the plan, notes, profile or questions, else 'no_change'" },
        summary: { type: "string", description: "One or two short lines the climber reads in the app" },
        changes: { type: "array", items: { type: "string" }, description: "What changed, one short item each" },
        seen_through: { type: "string", description: "checked_at from start_daily_review (UTC, e.g. 2026-01-31T21:00:00Z)" },
      },
      required: ["outcome"],
    },
    run: async (a, env) => {
      const run = parseRun(a, nowStamp());
      return { id: await recordRun(env.DB, run), ...run };
    },
  },
];
