// Daily coach review (#52). A scheduled Claude run (a Claude Code routine on the climber's own account, no API
// key) calls start_daily_review, which says what changed since the last run and whether a review is needed.
// When it is, Claude adjusts the coming plan, may leave a coach note and may ask the climber a question; the
// app shows open questions on the Today screen and the answers reach the next run. Every run ends with
// record_coach_run, whose seen_through is where the next run starts looking.
//
// Validation and the "is a review needed" call are pure (coach.test.ts); the D1 queries are below them.

import { BadRequest, NotFound } from "./errors";
import { isIsoDate } from "./injury-dates";
import { addDays } from "./load";

export const MAX_OPEN_QUESTIONS = 3;
export const DEFAULT_EXPIRY_DAYS = 3;
export const MAX_EXPIRY_DAYS = 14;
export const MAX_OPTIONS = 6;
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
  let expires_on: string | null = addDays(today, DEFAULT_EXPIRY_DAYS);
  if (a.expires_on === null) expires_on = null;
  else if (a.expires_on !== undefined) {
    if (!isIsoDate(a.expires_on)) throw new BadRequest("expires_on must be YYYY-MM-DD");
    if (a.expires_on < today) throw new BadRequest("expires_on can't be in the past");
    if (a.expires_on > addDays(today, MAX_EXPIRY_DAYS)) throw new BadRequest(`expires_on must be within ${MAX_EXPIRY_DAYS} days`);
    expires_on = a.expires_on;
  }
  return { question, why, options, allow_text, expires_on };
}

export type AnswerInput = { answer: string } | { skip: true };

// The app's answer: { answer: "..." } or { skip: true }. A chip answer must be one of the options unless free
// text is allowed.
export function parseAnswer(body: unknown, q: Pick<Question, "options" | "allow_text">): AnswerInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.skip === true) return { skip: true };
  const answer = text(b.answer, "answer", MAX_ANSWER, true)!;
  if (!q.allow_text && q.options.length && !q.options.includes(answer)) {
    throw new BadRequest(`answer must be one of ${q.options.join(", ")}`);
  }
  return { answer };
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

4. Plan: keep the next 7 days filled, starting tomorrow. Change only what the new data calls for; if the
   plan still fits, leave it. Rewrite with set_plan and keep_app_entries: true (entries the climber added or
   set a status on stay). Never change today or past days. Put planned tests in expected_benchmarks.

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
      "INSERT INTO coach_questions (question, why, options, allow_text, expires_on, run_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(q.question, q.why, q.options.length ? JSON.stringify(q.options) : null, q.allow_text ? 1 : 0, q.expires_on, run?.id ?? null)
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
  const last = await lastRun(db);
  const [changes, ahead, pending] = await Promise.all([
    changesSince(db, last, today),
    plannedDaysAhead(db, today),
    pendingQuestions(db, today),
  ]);
  const decision = reviewDecision(last, changes, ahead);
  return {
    today,
    checked_at,
    last_run: last,
    ...decision,
    planned_days_ahead: ahead,
    changes,
    open_questions: pending.open,
    instructions: REVIEW_INSTRUCTIONS,
  };
}
