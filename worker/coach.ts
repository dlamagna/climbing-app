// Daily coach review (#52). A scheduled Claude run (a Claude Code routine on the climber's own account, no API
// key) calls start_daily_review, which says what changed since the last run and whether a review is needed.
// When it is, Claude adjusts the coming plan, may leave a coach note and may ask the climber a question; the
// app shows open questions on the Today screen and the answers reach the next run. Every run ends with
// record_coach_run, whose seen_through is where the next run starts looking.
//
// Validation and the "is a review needed" call are pure (coach.test.ts); the D1 queries are below them.

import { BadRequest, NotFound } from "./errors";
import { CLIMB_DAYS_AHEAD, CLIMB_DAYS_TOPIC, NOT_THIS_WEEK, NO_CLIMBING, WEEK_TOPIC } from "./coachTopics";
import { isIsoDate } from "./injury-dates";
import { addDays, daysBetween, mondayOf } from "./load";
import { isClimbingType } from "./typeGroups";

export { CLIMB_DAYS_AHEAD, CLIMB_DAYS_TOPIC, NOT_THIS_WEEK, NO_CLIMBING, WEEK_TOPIC };

export const MAX_OPEN_QUESTIONS = 3;
export const DEFAULT_EXPIRY_DAYS = 3;
export const MAX_EXPIRY_DAYS = 14;
export const MAX_OPTIONS = 8;
const MAX_QUESTION = 300;
const MAX_OPTION = 40;
const MAX_ANSWER = 1000;
const MAX_SUMMARY = 300;
const MAX_CHANGES = 20;
// A review is also needed when fewer days than this have something planned in the next 7.
export const MIN_PLANNED_DAYS_AHEAD = 3;

export const RUN_OUTCOMES = ["updated", "no_change"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export type QuestionStatus = "open" | "answered" | "skipped" | "expired" | "closed";

export interface QuestionRow {
  id: number;
  question: string;
  why: string | null;
  options: string | null; // JSON array
  allow_text: number;
  multi: number; // 1 = several chips can be picked
  topic: string | null; // set on questions the server creates (WEEK_TOPIC)
  expires_on: string | null;
  answer: string | null;
  answered_at: string | null;
  skipped_at: string | null;
  closed_at: string | null;
  run_id: number | null;
  created_at: string;
}

export interface Question extends Omit<QuestionRow, "options"> {
  options: string[];
  status: QuestionStatus;
}

export interface NewQuestion {
  question: string;
  why: string | null;
  options: string[];
  allow_text: boolean;
  multi: boolean;
  expires_on: string | null;
}

export interface CoachRun {
  outcome: RunOutcome;
  summary: string | null;
  changes: string[];
  seen_through: string;
}

// UTC timestamps in the same shape as the created_at columns, so they compare as strings.
export const nowStamp = (d = new Date()) => `${d.toISOString().slice(0, 19)}Z`;
const isStamp = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s);

const text = (v: unknown, name: string, max: number, required = false): string | null => {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    if (required) throw new BadRequest(`${name} is required`);
    return null;
  }
  if (typeof v !== "string") throw new BadRequest(`${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new BadRequest(`${name} is too long (max ${max} characters)`);
  return t;
};

// Closed wins (Claude is done with it), then what the climber did, then the expiry.
export function questionStatus(q: Pick<QuestionRow, "answered_at" | "skipped_at" | "closed_at" | "expires_on">, today: string): QuestionStatus {
  if (q.closed_at) return "closed";
  if (q.answered_at) return "answered";
  if (q.skipped_at) return "skipped";
  if (q.expires_on && q.expires_on < today) return "expired";
  return "open";
}

export function decodeQuestion(row: QuestionRow, today: string): Question {
  let options: string[] = [];
  try {
    const parsed = row.options ? JSON.parse(row.options) : [];
    if (Array.isArray(parsed)) options = parsed.map(String);
  } catch {
    // a broken value shows as a free-text question
  }
  return { ...row, options, status: questionStatus(row, today) };
}

// ask_question's arguments. A question without options is free text; with options the climber taps one, and
// allow_text (default true) also offers a short free-text answer.
export function parseQuestion(a: Record<string, unknown>, today: string): NewQuestion {
  const question = text(a.question, "question", MAX_QUESTION, true)!;
  const why = text(a.why, "why", MAX_QUESTION);
  if (a.options !== undefined && a.options !== null && !Array.isArray(a.options)) throw new BadRequest("options must be a list");
  const options = ((a.options as unknown[] | undefined) ?? []).map((o) => text(o, "each option", MAX_OPTION, true)!);
  if (options.length === 1) throw new BadRequest("give at least 2 options, or none for a free-text question");
  if (options.length > MAX_OPTIONS) throw new BadRequest(`at most ${MAX_OPTIONS} options`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new BadRequest("options must be different");
  if (a.allow_text !== undefined && typeof a.allow_text !== "boolean") throw new BadRequest("allow_text must be true or false");
  const allow_text = options.length === 0 ? true : a.allow_text !== false;
  if (a.multi !== undefined && typeof a.multi !== "boolean") throw new BadRequest("multi must be true or false");
  const multi = options.length > 0 && a.multi === true;
  let expires_on: string | null = addDays(today, DEFAULT_EXPIRY_DAYS);
  if (a.expires_on === null) expires_on = null;
  else if (a.expires_on !== undefined) {
    if (!isIsoDate(a.expires_on)) throw new BadRequest("expires_on must be YYYY-MM-DD");
    if (a.expires_on < today) throw new BadRequest("expires_on can't be in the past");
    if (a.expires_on > addDays(today, MAX_EXPIRY_DAYS)) throw new BadRequest(`expires_on must be within ${MAX_EXPIRY_DAYS} days`);
    expires_on = a.expires_on;
  }
  return { question, why, options, allow_text, multi, expires_on };
}

export type AnswerInput = { answer: string } | { skip: true };

// The app's answer: { answer: "..." } or { skip: true }. A chip answer must be one of the options (a multi
// question: a comma-separated list of them) unless free text is allowed.
export function parseAnswer(body: unknown, q: Pick<Question, "options" | "allow_text" | "multi">): AnswerInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.skip === true) return { skip: true };
  const answer = text(b.answer, "answer", MAX_ANSWER, true)!;
  if (!q.allow_text && q.options.length) {
    const picked = q.multi ? answer.split(",").map((x) => x.trim()) : [answer];
    if (!picked.every((x) => q.options.includes(x))) throw new BadRequest(`answer must be ${q.multi ? "some" : "one"} of ${q.options.join(", ")}`);
  }
  return { answer };
}

// The weekly question (#54): created by the server on the first app open (or review) from Monday to
// WEEKLY_LAST_OFFSET days later, once per week, with a chip per remaining day; it expires on Sunday.
export const WEEKLY_LAST_OFFSET = 2; // Wednesday
export const WEEKLY_QUESTION = "Which days do you plan to climb this week?";

// "Mon 19", in English like the rest of the server's text.
export const dayChip = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

export function weeklyQuestion(today: string): (NewQuestion & { topic: string }) | null {
  const monday = mondayOf(today);
  const offset = daysBetween(monday, today);
  if (offset > WEEKLY_LAST_OFFSET) return null;
  const days = Array.from({ length: 7 - offset }, (_, i) => dayChip(addDays(today, i)));
  return {
    question: WEEKLY_QUESTION,
    why: "The coach plans this week's climbing on those days. Add a note for anything else (evenings only, a day outdoors...).",
    options: [...days, NOT_THIS_WEEK],
    allow_text: true,
    multi: true,
    expires_on: addDays(monday, 6),
    topic: `${WEEK_TOPIC}:${monday}`,
  };
}

// Climbing days picked with Today's "Plan my climbing days" button (#56). Stored as an answered coach question
// (topic climb_days:<today>, set again the same day = replaced), so the review handles it like the weekly
// answer. No days = no climbing in that window.
const CLIMB_DAYS_QUESTION = "Which days do you plan to climb?";
const MAX_NOTE = 300;

export interface ClimbingDays {
  days: string[]; // dates, sorted
  note: string | null;
}

export function parseClimbingDays(body: unknown, today: string): ClimbingDays {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.days)) throw new BadRequest("days must be a list of dates (an empty list = no climbing)");
  const last = addDays(today, CLIMB_DAYS_AHEAD - 1);
  for (const d of b.days) {
    if (!isIsoDate(d)) throw new BadRequest("each day must be YYYY-MM-DD");
    if (d < today || d > last) throw new BadRequest(`days must be from ${today} to ${last}`);
  }
  return { days: [...new Set(b.days as string[])].sort(), note: text(b.note, "note", MAX_NOTE) };
}

// "Wed 21, Sat 24 - evenings only"; "No climbing" when no days are picked.
export const climbingDaysAnswer = (c: ClimbingDays) =>
  [c.days.length ? c.days.map(dayChip).join(", ") : NO_CLIMBING, c.note].filter(Boolean).join(" - ");

export async function setClimbingDays(db: D1Database, body: unknown, today: string) {
  const c = parseClimbingDays(body, today);
  const answer = climbingDaysAnswer(c);
  const now = nowStamp();
  const window = Array.from({ length: CLIMB_DAYS_AHEAD }, (_, i) => dayChip(addDays(today, i)));
  await db.batch([
    db
      .prepare(
        `INSERT INTO coach_questions (question, why, options, allow_text, multi, expires_on, topic, answer, answered_at)
         VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)
         ON CONFLICT (topic) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at,
           skipped_at = NULL, closed_at = NULL,
           -- the window too, so a row first saved under a shorter window doesn't keep cutting days off (#75)
           question = excluded.question, options = excluded.options, expires_on = excluded.expires_on`,
      )
      .bind(
        `${CLIMB_DAYS_QUESTION} (${window[0]} to ${window[window.length - 1]})`,
        "Set with Plan my climbing days on the Today screen",
        JSON.stringify([...window, NO_CLIMBING]),
        addDays(today, CLIMB_DAYS_AHEAD - 1),
        `${CLIMB_DAYS_TOPIC}:${today}`,
        answer,
        now,
      ),
    // This answer replaces the weekly question if it is still open, and earlier days' picks.
    db
      .prepare(
        `UPDATE coach_questions SET closed_at = ?
         WHERE closed_at IS NULL AND ((topic LIKE '${WEEK_TOPIC}:%' AND answered_at IS NULL) OR (topic LIKE '${CLIMB_DAYS_TOPIC}:%' AND topic <> ?))`,
      )
      .bind(now, `${CLIMB_DAYS_TOPIC}:${today}`),
  ]);
  return { ...c, answer };
}

// The climbing days picked most recently (weekly question or the button) that still cover today, for the
// Today screen.
export async function currentClimbingDays(db: D1Database, today: string) {
  return db
    .prepare(
      `SELECT answer, answered_at, topic, expires_on FROM coach_questions
       WHERE (topic LIKE '${WEEK_TOPIC}:%' OR topic LIKE '${CLIMB_DAYS_TOPIC}:%') AND answered_at IS NOT NULL
         AND (expires_on IS NULL OR expires_on >= ?)
       ORDER BY answered_at DESC, id DESC LIMIT 1`,
    )
    .bind(today)
    .first<{ answer: string; answered_at: string; topic: string; expires_on: string | null }>();
}

// The latest pick as dates, for the review (start_daily_review and get_overview's coach): which days the
// climber will climb from `from` to `to`. Chips are matched against that window's dates; a typed answer
// with no chip is kept as the note.
export interface ClimbingDaysContext {
  source: "weekly question" | "Plan my climbing days";
  set_at: string;
  from: string;
  to: string;
  days: string[];
  no_climbing: boolean;
  note: string | null;
  answer: string;
}

export function climbingDaysContext(
  row: { answer: string; answered_at: string; topic: string; expires_on: string | null } | null,
): ClimbingDaysContext | null {
  if (!row) return null;
  const [prefix, from] = row.topic.split(":");
  const to = row.expires_on ?? addDays(from, 6);
  const window: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) window.push(d);
  const [head, ...rest] = row.answer.split(" - ");
  const tokens = head.split(",").map((t) => t.trim());
  const days = window.filter((d) => tokens.includes(dayChip(d)));
  const no_climbing = tokens.includes(NOT_THIS_WEEK) || tokens.includes(NO_CLIMBING);
  const chipped = days.length > 0 || no_climbing;
  const note = chipped ? rest.join(" - ").trim() || null : row.answer;
  return {
    source: prefix === WEEK_TOPIC ? "weekly question" : "Plan my climbing days",
    set_at: row.answered_at,
    from,
    to,
    days,
    no_climbing,
    note,
    answer: row.answer,
  };
}

// Today against the latest pick (#75). The review plans from tomorrow, so a day picked for today (or today
// dropped from the picks) would otherwise never reach today's plan. Returns what is off, or null when today
// fits the pick, isn't covered by it, already has a climbing session logged, or has a plan entry the climber
// added by hand or set a status on (those are theirs).
export interface TodayPlanEntry {
  id: number;
  type: string | null;
  source: string | null;
  status_override: string | null;
}

export interface TodayCheck {
  issue: "picked_but_not_planned" | "planned_but_not_picked";
  plan_ids: number[]; // today's entries the review may replace
  message: string;
}

export function todayCheck(
  today: string,
  picked: ClimbingDaysContext | null,
  entries: TodayPlanEntry[],
  sessionTypes: string[],
): TodayCheck | null {
  if (!picked || today < picked.from || today > picked.to) return null;
  if (sessionTypes.some(isClimbingType)) return null;
  if (entries.some((e) => e.source === "app" || e.status_override)) return null;
  const climbing = entries.some((e) => isClimbingType(e.type));
  const plan_ids = entries.map((e) => e.id);
  if (picked.days.includes(today) && !climbing)
    return {
      issue: "picked_but_not_planned",
      plan_ids,
      message: "Today is a picked climbing day but today's plan has no climbing session",
    };
  if (!picked.days.includes(today) && climbing)
    return {
      issue: "planned_but_not_picked",
      plan_ids,
      message: "Today's plan has a climbing session but today isn't a picked climbing day",
    };
  return null;
}

async function todayPlanAndSessions(db: D1Database, today: string) {
  const [plan, sessions] = await Promise.all([
    db.prepare("SELECT id, type, source, status_override FROM plan WHERE date = ?").bind(today).all<TodayPlanEntry>(),
    db.prepare("SELECT type FROM sessions WHERE date = ?").bind(today).all<{ type: string }>(),
  ]);
  return { entries: plan.results ?? [], sessionTypes: (sessions.results ?? []).map((s) => s.type) };
}

export async function ensureWeeklyQuestion(db: D1Database, today: string): Promise<void> {
  const q = weeklyQuestion(today);
  if (!q) return;
  await db
    .prepare(
      `INSERT INTO coach_questions (question, why, options, allow_text, multi, expires_on, topic) VALUES (?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT (topic) DO NOTHING`,
    )
    .bind(q.question, q.why, JSON.stringify(q.options), q.expires_on, q.topic)
    .run();
}

export function parseRun(a: Record<string, unknown>, now: string): CoachRun {
  if (!RUN_OUTCOMES.includes(a.outcome as RunOutcome)) throw new BadRequest(`outcome must be one of ${RUN_OUTCOMES.join(", ")}`);
  const summary = text(a.summary, "summary", MAX_SUMMARY);
  if (a.changes !== undefined && a.changes !== null && !Array.isArray(a.changes)) throw new BadRequest("changes must be a list");
  const changes = ((a.changes as unknown[] | undefined) ?? []).map((c) => text(c, "each change", MAX_SUMMARY, true)!);
  if (changes.length > MAX_CHANGES) throw new BadRequest(`at most ${MAX_CHANGES} changes`);
  let seen_through = now;
  if (a.seen_through !== undefined && a.seen_through !== null) {
    if (!isStamp(a.seen_through)) throw new BadRequest("seen_through must be a UTC timestamp like 2026-01-31T21:00:00Z (use checked_at from start_daily_review)");
    if (a.seen_through > now) throw new BadRequest("seen_through can't be in the future");
    seen_through = a.seen_through;
  }
  return { outcome: a.outcome as RunOutcome, summary, changes, seen_through };
}

export const FEEDBACK_OUTCOMES = ["filed", "duplicate", "declined"] as const;
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];
const MAX_FEEDBACK = 2000;

export interface FeedbackRow {
  id: number;
  text: string;
  status: "new" | FeedbackOutcome;
  issue_number: number | null;
  issue_url: string | null;
  reply: string | null;
  handled_at: string | null;
  created_at: string;
}

export const parseFeedback = (body: unknown): string =>
  text(((body ?? {}) as Record<string, unknown>).text, "feedback", MAX_FEEDBACK, true)!;

export interface FeedbackResolution {
  status: FeedbackOutcome;
  issue_number: number | null;
  issue_url: string | null;
  reply: string | null;
}

// resolve_feedback's arguments: filed and duplicate need the issue number.
export function parseResolution(a: Record<string, unknown>): FeedbackResolution {
  if (!FEEDBACK_OUTCOMES.includes(a.status as FeedbackOutcome)) throw new BadRequest(`status must be one of ${FEEDBACK_OUTCOMES.join(", ")}`);
  const status = a.status as FeedbackOutcome;
  const issue_number = a.issue_number ?? null;
  if (issue_number !== null && !(Number.isInteger(issue_number) && (issue_number as number) > 0)) throw new BadRequest("issue_number must be a positive integer");
  if (status !== "declined" && issue_number === null) throw new BadRequest(`issue_number is required for ${status}`);
  const issue_url = text(a.issue_url, "issue_url", 300);
  if (issue_url !== null && !/^https:\/\/github\.com\//.test(issue_url)) throw new BadRequest("issue_url must be a github.com link");
  return { status, issue_number: issue_number as number | null, issue_url, reply: text(a.reply, "reply", MAX_SUMMARY) };
}

export interface ChangedSession {
  id: number;
  date: string;
  type: string;
  duration_min: number;
  rpe: number;
  edited: boolean; // logged before the last run, changed since
}

export interface ReviewChanges {
  sessions: ChangedSession[];
  new_injuries: { id: number; body_part: string; started_on: string; resolved_on: string | null }[];
  injury_updates: { injury_id: number; date: string; pain: number; trend: string | null; red_flags: string | null }[];
  profile_keys: string[];
  plan_entries_added_by_hand: { id: number; date: string; title: string }[];
  answered_questions: Question[];
  skipped_questions: Question[];
  new_feedback: Pick<FeedbackRow, "id" | "text" | "created_at">[];
  checkins: number;
  benchmarks: number;
}

// Whether the run should do a full review, and why. Check-ins and benchmarks alone don't need one (the app
// already turns a check-in into today's readiness); an injury update only does when it got worse, has a red
// flag or healed.
export function reviewDecision(
  lastRun: { seen_through: string } | null,
  c: ReviewChanges,
  plannedDaysAhead: number,
  today: TodayCheck | null = null,
): { review_needed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!lastRun) reasons.push("first review");
  const logged = c.sessions.filter((s) => !s.edited).length;
  const edited = c.sessions.length - logged;
  if (logged) reasons.push(`${logged} session${logged === 1 ? "" : "s"} logged`);
  if (edited) reasons.push(`${edited} session${edited === 1 ? "" : "s"} edited`);
  if (c.new_injuries.length) reasons.push("injury recorded");
  const notable = c.injury_updates.filter((u) => u.trend === "worse" || u.trend === "gone" || Boolean(u.red_flags));
  if (notable.length) reasons.push("injury got worse, has a red flag or healed");
  if (c.profile_keys.length) reasons.push(`profile changed (${c.profile_keys.join(", ")})`);
  if (c.plan_entries_added_by_hand.length) reasons.push("plan entries added by hand");
  if (c.new_feedback.length) reasons.push(`${c.new_feedback.length} app feedback item${c.new_feedback.length === 1 ? "" : "s"} to triage`);
  if (c.answered_questions.length) reasons.push(`${c.answered_questions.length} question${c.answered_questions.length === 1 ? "" : "s"} answered`);
  if (plannedDaysAhead < MIN_PLANNED_DAYS_AHEAD) reasons.push(`only ${plannedDaysAhead} of the next 7 days planned`);
  if (today) reasons.push(today.message.charAt(0).toLowerCase() + today.message.slice(1));
  return { review_needed: reasons.length > 0, reasons };
}

export const REVIEW_INSTRUCTIONS = `You are running the climber's scheduled daily coach review. Nobody is watching: don't ask
the climber anything in chat, work only through these tools.

1. If review_needed is false: call record_coach_run with outcome "no_change", seen_through = checked_at and no
   summary, then stop. Don't add notes, questions or plan changes.

2. Otherwise call get_overview (days 14) and review what changed (the reasons and changes above). Weigh it as
   the server instructions describe: injuries and pain trend first, sleep / feeling / alcohol, load ratios
   (respect baseline_status), consecutive hard days, plan_adherence and plan_conflicts, the profile (goals,
   trips, availability) and the climber's answers below.

3. Answers: use each answered question. Lasting facts (a trip, availability, a goal, a gym) go to the profile
   with update_profile; short-lived ones (this week's intentions, how a session felt) go straight into the
   plan. Then call close_questions with the ids you used. Close skipped questions too.
   The weekly question (topic "${WEEK_TOPIC}:<Monday>", "${WEEKLY_QUESTION}") is created by the app every
   week: its answer lists day chips like "Tue 20" (dates of that week), maybe "${NOT_THIS_WEEK}", and maybe a
   note after " - ". Put that week's climbing sessions on those days only, and keep the other days for rest or
   light non-climbing work; "${NOT_THIS_WEEK}" means no climbing sessions that week. It is this week's
   availability, not a lasting fact: don't save it to the profile. Don't ask it yourself. The climber can also
   pick days any time with the app's "Plan my climbing days" button (topic "${CLIMB_DAYS_TOPIC}:<date>", days
   within the ${CLIMB_DAYS_AHEAD} days from that date, "${NO_CLIMBING}" = none). You don't need to decode these
   answers: climbing_days (in this result and in get_overview's coach) is the latest pick that still applies,
   already as dates, and stays there after you close the question.

4. Plan: keep the next 7 days filled, starting tomorrow, and further when climbing_days.to reaches past them
   (up to that day). Change only what the new data calls for; if the
   plan still fits, leave it. Rewrite with set_plan and keep_app_entries: true (entries the climber added or
   set a status on stay). Never change past days, and change today only when today_check is set: then
   rewrite today too, so it matches the pick ("picked_but_not_planned": a climbing session that suits
   today's readiness; "planned_but_not_picked": rest or light non-climbing work instead). Put planned
   tests in expected_benchmarks.
   Fixed sessions are the days in climbing_days.days and plan entries the climber added by hand (source
   'app') or set a status on. Plan around them:
   - Picked days: put the climbing sessions on them; days between them get rest, mobility or light
     non-finger work, never extra climbing. no_climbing: no climbing sessions from climbing_days.from to .to.
   - After the last fixed session (one picked day, a single session in the calendar, or the end of the
     picks), start planning from the day after it: fill the rest of the planning window with what you suggest.
     Keep the days before a lone fixed session light, so they arrive fresh.
   - Nothing fixed (climbing_days is null or out of date): suggest the days yourself from the current load
     (ratio_total / ratio_finger and baseline_status), readiness, recent hard days and recovery, the
     profile's weekly_availability and goals.
   - Title every session you chose the day for (not picked by the climber) "Suggested: <title>", and say in
     the coach note that they can change the days with Plan my climbing days.

5. Coach note: if something is worth saying (why the plan changed, tomorrow's focus, a load or injury
   warning), add one short note with add_coach_note dated tomorrow. Skip it when there's nothing new.

6. Questions: ask with ask_question only when the answer would change the plan and the data can't tell you
   (intentions for the week, upcoming trips or time off, a constraint, what a vague session note meant). At
   most 1-2 per run and ${MAX_OPEN_QUESTIONS} open in total; give 2-5 short options when you can. Don't ask what the
   morning check-in already records (sleep, feeling, drinks, protein, pain) or anything already answered or
   recently skipped. Withdraw open questions that no longer matter with close_questions. A pain or injury
   word in a session note: ask about it rather than recording an injury yourself.

7. App feedback (changes.new_feedback, typed by the climber in the app about the app itself): decide for each
   one. A real bug or a useful idea: call list_issues; if an open issue already covers it, resolve_feedback
   "duplicate" with that issue_number (and say so in the reply). Otherwise file it with report_issue: labels
   (bug / enhancement / ...), a priority (P0 = broken or blocking daily use, P1 = worth doing soon, P2 = nice
   to have), a milestone when one fits (it is then listed in the roadmap), then resolve_feedback "filed" with
   the issue number and url. Not actionable, unclear or not about the app: resolve_feedback "declined" with a
   short reply (training information in it still counts as input for the plan). The repo is PUBLIC: write
   the issue in general terms, never quote the feedback, and leave out anything personal (training data,
   health, places, dates, trips, names, devices). If report_issue isn't available, leave the feedback as it is
   and say so in the summary.

8. Finish with record_coach_run: outcome "updated" if you changed anything (plan, note, profile, questions,
   feedback), else "no_change"; a one or two line summary the climber reads in the app ("Moved Thursday's board session
   to Friday after two hard days"); changes as a short list; seen_through = checked_at.

Never log, edit or delete sessions, check-ins or injuries in a review, and file GitHub issues only for app
feedback (step 7).`;

// --- D1 ---------------------------------------------------------------------------------------------

async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

const OPEN_SQL = "closed_at IS NULL AND answered_at IS NULL AND skipped_at IS NULL AND (expires_on IS NULL OR expires_on >= ?)";

// Shown in the app, oldest first so a question doesn't jump around when a new one is asked.
export async function openQuestions(db: D1Database, today: string): Promise<Question[]> {
  const rows = await all<QuestionRow>(db, `SELECT * FROM coach_questions WHERE ${OPEN_SQL} ORDER BY id`, today);
  return rows.map((r) => decodeQuestion(r, today));
}

// What the coach still has to deal with: open ones and answered ones not closed yet.
export async function pendingQuestions(db: D1Database, today: string) {
  const rows = await all<QuestionRow>(
    db,
    `SELECT * FROM coach_questions WHERE closed_at IS NULL AND (answered_at IS NOT NULL OR (${OPEN_SQL})) ORDER BY id`,
    today,
  );
  const qs = rows.map((r) => decodeQuestion(r, today));
  return { open: qs.filter((q) => q.status === "open"), answered: qs.filter((q) => q.status === "answered") };
}

export async function getQuestion(db: D1Database, id: number, today: string): Promise<Question | null> {
  const row = await db.prepare("SELECT * FROM coach_questions WHERE id = ?").bind(id).first<QuestionRow>();
  return row ? decodeQuestion(row, today) : null;
}

// Asking the same open question twice returns the first one instead of adding a copy.
export async function askQuestion(db: D1Database, q: NewQuestion, today: string): Promise<{ id: number; existing: boolean }> {
  const open = await openQuestions(db, today);
  const same = open.find((o) => o.question.toLowerCase() === q.question.toLowerCase());
  if (same) return { id: same.id, existing: true };
  if (open.length >= MAX_OPEN_QUESTIONS) {
    throw new BadRequest(`${open.length} questions are already open (max ${MAX_OPEN_QUESTIONS}); close one with close_questions first`);
  }
  const run = await db.prepare("SELECT id FROM coach_runs ORDER BY id DESC LIMIT 1").first<{ id: number }>();
  const row = await db
    .prepare(
      "INSERT INTO coach_questions (question, why, options, allow_text, multi, expires_on, run_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(q.question, q.why, q.options.length ? JSON.stringify(q.options) : null, q.allow_text ? 1 : 0, q.multi ? 1 : 0, q.expires_on, run?.id ?? null)
    .first<{ id: number }>();
  return { id: row!.id, existing: false };
}

// The climber's answer (or skip) from the app. Answering again before Claude has used it replaces the answer.
export async function answerQuestion(db: D1Database, id: number, body: unknown, today: string): Promise<Question> {
  const q = await getQuestion(db, id, today);
  if (!q) throw new NotFound(`Question ${id} not found`);
  if (q.status === "closed") throw new BadRequest("This question was closed by the coach");
  const input = parseAnswer(body, q);
  const now = nowStamp();
  if ("skip" in input) {
    await db.prepare("UPDATE coach_questions SET skipped_at = ?, answer = NULL, answered_at = NULL WHERE id = ?").bind(now, id).run();
  } else {
    await db.prepare("UPDATE coach_questions SET answer = ?, answered_at = ?, skipped_at = NULL WHERE id = ?").bind(input.answer, now, id).run();
  }
  return (await getQuestion(db, id, today))!;
}

export async function closeQuestions(db: D1Database, ids: unknown): Promise<{ closed: number[]; not_found_or_already_closed: number[] }> {
  if (!Array.isArray(ids) || !ids.length || !ids.every((i) => Number.isInteger(i))) throw new BadRequest("ids must be a list of question ids");
  const now = nowStamp();
  const results = await db.batch(
    (ids as number[]).map((id) => db.prepare("UPDATE coach_questions SET closed_at = ? WHERE id = ? AND closed_at IS NULL").bind(now, id)),
  );
  const closed = (ids as number[]).filter((_, i) => results[i].meta.changes > 0);
  return { closed, not_found_or_already_closed: (ids as number[]).filter((id) => !closed.includes(id)) };
}

export interface CoachRunRow {
  id: number;
  outcome: RunOutcome;
  summary: string | null;
  changes: string[];
  seen_through: string;
  created_at: string;
}

const decodeRun = (row: (Omit<CoachRunRow, "changes"> & { changes: string | null }) | null): CoachRunRow | null => {
  if (!row) return null;
  let changes: string[] = [];
  try {
    changes = row.changes ? JSON.parse(row.changes) : [];
  } catch {
    // keep []
  }
  return { ...row, changes };
};

export const lastRun = async (db: D1Database) =>
  decodeRun(await db.prepare("SELECT * FROM coach_runs ORDER BY id DESC LIMIT 1").first());

// The last run that changed something, for the Today screen (a "nothing new" run would hide it otherwise).
export const lastUpdate = async (db: D1Database) =>
  decodeRun(await db.prepare("SELECT * FROM coach_runs WHERE outcome = 'updated' ORDER BY id DESC LIMIT 1").first());

export async function recordRun(db: D1Database, run: CoachRun): Promise<number> {
  const row = await db
    .prepare("INSERT INTO coach_runs (outcome, summary, changes, seen_through) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(run.outcome, run.summary, run.changes.length ? JSON.stringify(run.changes) : null, run.seen_through)
    .first<{ id: number }>();
  return row!.id;
}

export const FIRST_RUN_LOOKBACK_DAYS = 14;

// Everything written since the last run (null = the first run, which looks at the last FIRST_RUN_LOOKBACK_DAYS
// days). Rows the climber writes are compared with seen_through, inclusive (a row written in the same second
// as the last run's read is reviewed again rather than missed). Profile keys are compared with the time the
// run was recorded instead, so the run's own update_profile calls don't trigger the next review.
export async function changesSince(
  db: D1Database,
  last: Pick<CoachRunRow, "seen_through" | "created_at"> | null,
  today: string,
): Promise<ReviewChanges> {
  const s = last?.seen_through ?? nowStamp(new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 86_400_000));
  const p = last?.created_at ?? s;
  const [sessions, newInjuries, updates, profile, planByHand, answered, skipped, feedback, checkins, benchmarks] = await Promise.all([
    all<ChangedSession & { created_at: string }>(
      db,
      `SELECT id, date, type, duration_min, rpe, created_at FROM sessions
       WHERE created_at >= ? OR updated_at >= ? ORDER BY date, id`,
      s, s,
    ),
    all<ReviewChanges["new_injuries"][number]>(
      db, "SELECT id, body_part, started_on, resolved_on FROM injuries WHERE created_at >= ? ORDER BY id", s,
    ),
    all<ReviewChanges["injury_updates"][number]>(
      db, "SELECT injury_id, date, pain, trend, red_flags FROM injury_updates WHERE created_at >= ? ORDER BY date, id", s,
    ),
    all<{ key: string }>(db, "SELECT key FROM profile WHERE updated_at > ? ORDER BY key", p),
    all<{ id: number; date: string; title: string }>(
      db, "SELECT id, date, title FROM plan WHERE source = 'app' AND created_at >= ? ORDER BY date, id", s,
    ),
    all<QuestionRow>(db, "SELECT * FROM coach_questions WHERE closed_at IS NULL AND answered_at IS NOT NULL ORDER BY id"),
    all<QuestionRow>(db, "SELECT * FROM coach_questions WHERE closed_at IS NULL AND skipped_at IS NOT NULL ORDER BY id"),
    all<ReviewChanges["new_feedback"][number]>(db, "SELECT id, text, created_at FROM app_feedback WHERE status = 'new' ORDER BY id"),
    db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE updated_at >= ?").bind(s).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM benchmarks WHERE created_at >= ?").bind(s).first<{ n: number }>(),
  ]);
  return {
    sessions: sessions.map(({ created_at, ...x }) => ({ ...x, edited: created_at < s })),
    new_injuries: newInjuries,
    injury_updates: updates,
    profile_keys: profile.map((r) => r.key).filter((k) => k !== "timezone"), // the app keeps timezone in sync
    plan_entries_added_by_hand: planByHand,
    answered_questions: answered.map((r) => decodeQuestion(r, today)),
    skipped_questions: skipped.map((r) => decodeQuestion(r, today)),
    new_feedback: feedback,
    checkins: checkins?.n ?? 0,
    benchmarks: benchmarks?.n ?? 0,
  };
}

// The app's feedback list, newest first.
export const listFeedback = (db: D1Database) =>
  all<FeedbackRow>(
    db,
    "SELECT id, text, status, issue_number, issue_url, reply, handled_at, created_at FROM app_feedback ORDER BY id DESC LIMIT 50",
  );

// clientId makes a replayed offline submit return the first row instead of adding a copy.
export async function addFeedback(db: D1Database, body: unknown, clientId: string | null): Promise<number> {
  const t = parseFeedback(body);
  const row = await db
    .prepare("INSERT INTO app_feedback (text, client_id) VALUES (?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id")
    .bind(t, clientId)
    .first<{ id: number }>();
  if (row) return row.id;
  return (await db.prepare("SELECT id FROM app_feedback WHERE client_id = ?").bind(clientId).first<{ id: number }>())!.id;
}

export async function resolveFeedback(db: D1Database, id: unknown, r: FeedbackResolution) {
  if (!Number.isInteger(id)) throw new BadRequest("id is required (integer)");
  const row = await db
    .prepare(
      "UPDATE app_feedback SET status = ?, issue_number = ?, issue_url = ?, reply = ?, handled_at = ? WHERE id = ? RETURNING id, status, issue_number, issue_url, reply",
    )
    .bind(r.status, r.issue_number, r.issue_url, r.reply, nowStamp(), id)
    .first();
  if (!row) throw new NotFound(`Feedback ${id} not found`);
  return row;
}

// Days from tomorrow to a week ahead that have at least one plan entry (rest days count: they are planned).
export async function plannedDaysAhead(db: D1Database, today: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT date) AS n FROM plan WHERE date BETWEEN ? AND ?")
    .bind(addDays(today, 1), addDays(today, 7))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// start_daily_review: the cheap first call of every run.
export async function startReview(db: D1Database, today: string) {
  const checked_at = nowStamp();
  await ensureWeeklyQuestion(db, today);
  const last = await lastRun(db);
  const [changes, ahead, pending, picked, todayRows] = await Promise.all([
    changesSince(db, last, today),
    plannedDaysAhead(db, today),
    pendingQuestions(db, today),
    currentClimbingDays(db, today),
    todayPlanAndSessions(db, today),
  ]);
  const climbing_days = climbingDaysContext(picked);
  const today_check = todayCheck(today, climbing_days, todayRows.entries, todayRows.sessionTypes);
  const decision = reviewDecision(last, changes, ahead, today_check);
  return {
    today,
    checked_at,
    last_run: last,
    ...decision,
    planned_days_ahead: ahead,
    climbing_days,
    today_check,
    changes,
    open_questions: pending.open,
    instructions: REVIEW_INSTRUCTIONS,
  };
}
