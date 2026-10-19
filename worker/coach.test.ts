// Daily coach review (#52): the pure rules, then the real SQL (questions, runs, what changed, set_plan's
// keep_app_entries, app feedback) on an in-memory SQLite behind a minimal D1 shim. Made-up data only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_OPEN_QUESTIONS,
  type ReviewChanges,
  addFeedback,
  answerQuestion,
  askQuestion,
  changesSince,
  NOT_THIS_WEEK,
  closeQuestions,
  ensureWeeklyQuestion,
  lastRun,
  lastUpdate,
  listFeedback,
  nowStamp,
  openQuestions,
  parseAnswer,
  parseQuestion,
  parseResolution,
  parseRun,
  pendingQuestions,
  questionStatus,
  recordRun,
  resolveFeedback,
  reviewDecision,
  startReview,
  weeklyQuestion,
} from "./coach";
import { setPlan } from "./db";

const TODAY = "2026-05-10";

describe("parseQuestion", () => {
  it("defaults: free text, expires in 3 days", () => {
    expect(parseQuestion({ question: "  Any trips coming up?  " }, TODAY)).toEqual({
      question: "Any trips coming up?",
      why: null,
      options: [],
      allow_text: true,
      multi: false,
      expires_on: "2026-05-13",
    });
  });

  it("keeps options and allow_text, and a free-text question always allows text", () => {
    const q = parseQuestion({ question: "Days this week?", options: ["2", "3", "4+"], allow_text: false }, TODAY);
    expect(q.options).toEqual(["2", "3", "4+"]);
    expect(q.allow_text).toBe(false);
    expect(parseQuestion({ question: "Anything else?", allow_text: false }, TODAY).allow_text).toBe(true);
  });

  it("allows no expiry, and an expiry within 14 days", () => {
    expect(parseQuestion({ question: "q", expires_on: null }, TODAY).expires_on).toBeNull();
    expect(parseQuestion({ question: "q", expires_on: "2026-05-24" }, TODAY).expires_on).toBe("2026-05-24");
  });

  it.each([
    [{}, /question is required/],
    [{ question: "  " }, /question is required/],
    [{ question: "q", options: ["only one"] }, /at least 2 options/],
    [{ question: "q", options: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }, /at most 8/],
    [{ question: "q", options: ["a", "b"], multi: "yes" }, /multi must be/],
    [{ question: "q", options: ["Yes", "yes"] }, /different/],
    [{ question: "q", options: "a,b" }, /must be a list/],
    [{ question: "q", options: ["a", ""] }, /each option is required/],
    [{ question: "q", expires_on: "2026-05-09" }, /past/],
    [{ question: "q", expires_on: "2026-05-25" }, /within 14 days/],
    [{ question: "q", expires_on: "soon" }, /YYYY-MM-DD/],
    [{ question: "x".repeat(301) }, /too long/],
  ])("rejects %j", (a, msg) => {
    expect(() => parseQuestion(a, TODAY)).toThrow(msg);
  });
});

describe("multi questions", () => {
  it("multi needs options", () => {
    expect(parseQuestion({ question: "q", options: ["a", "b"], multi: true }, TODAY).multi).toBe(true);
    expect(parseQuestion({ question: "q", multi: true }, TODAY).multi).toBe(false);
  });
  it("a chips-only multi answer must list options", () => {
    const q = { options: ["Mon 4", "Tue 5"], allow_text: 0, multi: 1 };
    expect(parseAnswer({ answer: "Mon 4, Tue 5" }, q)).toEqual({ answer: "Mon 4, Tue 5" });
    expect(() => parseAnswer({ answer: "Mon 4, Fri 8" }, q)).toThrow(/some of/);
  });
});

describe("weeklyQuestion", () => {
  // 2026-05-04 is a Monday.
  it("on Monday offers every day of the week and expires on Sunday", () => {
    const q = weeklyQuestion("2026-05-04")!;
    expect(q.options).toEqual(["Mon 4", "Tue 5", "Wed 6", "Thu 7", "Fri 8", "Sat 9", "Sun 10", NOT_THIS_WEEK]);
    expect(q).toMatchObject({ multi: true, allow_text: true, expires_on: "2026-05-10", topic: "week_days:2026-05-04" });
  });
  it("later in the week offers only the remaining days, same topic", () => {
    const q = weeklyQuestion("2026-05-06")!;
    expect(q.options).toEqual(["Wed 6", "Thu 7", "Fri 8", "Sat 9", "Sun 10", NOT_THIS_WEEK]);
    expect(q.topic).toBe("week_days:2026-05-04");
  });
  it("isn't created from Thursday on", () => {
    for (const d of ["2026-05-07", "2026-05-09", "2026-05-10"]) expect(weeklyQuestion(d)).toBeNull();
  });
});

describe("questionStatus", () => {
  const q = { answered_at: null, skipped_at: null, closed_at: null, expires_on: "2026-05-10" };
  it("is open through the expiry day, then expired", () => {
    expect(questionStatus(q, TODAY)).toBe("open");
    expect(questionStatus(q, "2026-05-11")).toBe("expired");
    expect(questionStatus({ ...q, expires_on: null }, "2030-01-01")).toBe("open");
  });
  it("closed wins, then answered, then skipped", () => {
    const t = "2026-05-10T08:00:00Z";
    expect(questionStatus({ ...q, answered_at: t, closed_at: t }, TODAY)).toBe("closed");
    expect(questionStatus({ ...q, answered_at: t }, "2026-06-01")).toBe("answered");
    expect(questionStatus({ ...q, skipped_at: t }, TODAY)).toBe("skipped");
  });
});

describe("parseAnswer", () => {
  const chips = { options: ["Yes", "No"], allow_text: 0 };
  it("takes an answer or a skip", () => {
    expect(parseAnswer({ answer: " Yes " }, chips)).toEqual({ answer: "Yes" });
    expect(parseAnswer({ skip: true }, chips)).toEqual({ skip: true });
  });
  it("chips-only questions take only a chip", () => {
    expect(() => parseAnswer({ answer: "Maybe" }, chips)).toThrow(/one of Yes, No/);
    expect(parseAnswer({ answer: "Maybe" }, { ...chips, allow_text: 1 })).toEqual({ answer: "Maybe" });
  });
  it("needs an answer", () => {
    expect(() => parseAnswer({}, chips)).toThrow(/answer is required/);
    expect(() => parseAnswer(null, chips)).toThrow(/answer is required/);
  });
});

describe("parseRun", () => {
  const now = "2026-05-10T21:00:30Z";
  it("defaults seen_through to now", () => {
    expect(parseRun({ outcome: "no_change" }, now)).toEqual({ outcome: "no_change", summary: null, changes: [], seen_through: now });
  });
  it("keeps a valid seen_through", () => {
    const r = parseRun({ outcome: "updated", summary: "Moved a session", changes: ["a", "b"], seen_through: "2026-05-10T21:00:00Z" }, now);
    expect(r).toEqual({ outcome: "updated", summary: "Moved a session", changes: ["a", "b"], seen_through: "2026-05-10T21:00:00Z" });
  });
  it.each([
    [{ outcome: "done" }, /outcome must be/],
    [{ outcome: "updated", seen_through: "2026-05-10" }, /UTC timestamp/],
    [{ outcome: "updated", seen_through: "2026-05-11T00:00:00Z" }, /future/],
    [{ outcome: "updated", changes: "a" }, /must be a list/],
  ])("rejects %j", (a, msg) => {
    expect(() => parseRun(a, now)).toThrow(msg);
  });
});

describe("parseResolution", () => {
  it("needs an issue for filed and duplicate, not for declined", () => {
    expect(parseResolution({ status: "declined", reply: "Not about the app" })).toEqual({
      status: "declined",
      issue_number: null,
      issue_url: null,
      reply: "Not about the app",
    });
    expect(() => parseResolution({ status: "filed" })).toThrow(/issue_number is required/);
    expect(parseResolution({ status: "duplicate", issue_number: 12 }).issue_number).toBe(12);
  });
  it.each([
    [{ status: "done" }, /status must be/],
    [{ status: "filed", issue_number: 0 }, /positive integer/],
    [{ status: "filed", issue_number: 3, issue_url: "https://example.com/3" }, /github.com/],
  ])("rejects %j", (a, msg) => {
    expect(() => parseResolution(a)).toThrow(msg);
  });
});

describe("reviewDecision", () => {
  const none: ReviewChanges = {
    sessions: [],
    new_injuries: [],
    injury_updates: [],
    profile_keys: [],
    plan_entries_added_by_hand: [],
    answered_questions: [],
    skipped_questions: [],
    new_feedback: [],
    checkins: 2,
    benchmarks: 1,
  };
  const last = { seen_through: "2026-05-09T21:00:00Z" };

  it("needs nothing when only check-ins and benchmarks came in and the plan is filled", () => {
    expect(reviewDecision(last, none, 7)).toEqual({ review_needed: false, reasons: [] });
  });

  it("always reviews the first time", () => {
    expect(reviewDecision(null, none, 7)).toEqual({ review_needed: true, reasons: ["first review"] });
  });

  it("names every reason", () => {
    const c: ReviewChanges = {
      ...none,
      sessions: [
        { id: 1, date: "2026-05-10", type: "boulder", duration_min: 60, rpe: 7, edited: false },
        { id: 2, date: "2026-05-09", type: "lead", duration_min: 90, rpe: 6, edited: true },
      ],
      profile_keys: ["goal"],
      answered_questions: [{} as never],
      new_feedback: [{ id: 1, text: "x", created_at: "" }],
    };
    expect(reviewDecision(last, c, 2).reasons).toEqual([
      "1 session logged",
      "1 session edited",
      "profile changed (goal)",
      "1 app feedback item to triage",
      "1 question answered",
      "only 2 of the next 7 days planned",
    ]);
  });

  it("only reviews injury updates that got worse, have a red flag or healed", () => {
    const u = { injury_id: 1, date: TODAY, pain: 2, trend: "same", red_flags: null };
    expect(reviewDecision(last, { ...none, injury_updates: [u, { ...u, trend: "better" }] }, 7).review_needed).toBe(false);
    for (const x of [{ trend: "worse" }, { trend: "gone" }, { red_flags: "swelling" }]) {
      expect(reviewDecision(last, { ...none, injury_updates: [{ ...u, ...x }] }, 7).review_needed).toBe(true);
    }
  });
});

// --- SQL --------------------------------------------------------------------------------------------

type Value = string | number | null;

// Just enough of D1Database for the functions under test. batch runs statements without RETURNING through
// run(), so their results carry meta.changes like D1's.
function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, params: Value[] = []) => ({
    sql,
    bind: (...p: Value[]) => stmt(sql, p),
    first: async () => (db.prepare(sql).get(...params) as Record<string, unknown> | undefined) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: ReturnType<typeof stmt>[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(/^\s*select|returning/i.test(s.sql) ? await s.all() : await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  db = d1(sqlite);
});

const exec = (sql: string, ...p: Value[]) => sqlite.prepare(sql).run(...p);
const rows = (sql: string, ...p: Value[]) => sqlite.prepare(sql).all(...p) as Record<string, unknown>[];

describe("questions", () => {
  it("asks, dedupes the same open question and caps open ones", async () => {
    const first = await askQuestion(db, parseQuestion({ question: "Any trips coming up?" }, TODAY), TODAY);
    expect(first.existing).toBe(false);
    expect(await askQuestion(db, parseQuestion({ question: "any trips coming up?" }, TODAY), TODAY)).toEqual({ id: first.id, existing: true });
    for (let i = 1; i < MAX_OPEN_QUESTIONS; i++) await askQuestion(db, parseQuestion({ question: `q${i}` }, TODAY), TODAY);
    await expect(askQuestion(db, parseQuestion({ question: "one more" }, TODAY), TODAY)).rejects.toThrow(/already open/);
    expect((await openQuestions(db, TODAY)).map((q) => q.question)).toEqual(["Any trips coming up?", "q1", "q2"]);
  });

  it("links a question to the last run and stores options as JSON", async () => {
    const run = await recordRun(db, parseRun({ outcome: "updated" }, nowStamp()));
    const { id } = await askQuestion(db, parseQuestion({ question: "Days?", options: ["2", "3"] }, TODAY), TODAY);
    expect(rows("SELECT options, run_id FROM coach_questions WHERE id = ?", id)[0]).toEqual({ options: '["2","3"]', run_id: run });
    expect((await openQuestions(db, TODAY))[0].options).toEqual(["2", "3"]);
  });

  it("answers, re-answers and skips; answered ones wait for the coach until closed", async () => {
    const { id } = await askQuestion(db, parseQuestion({ question: "Days?", options: ["2", "3"] }, TODAY), TODAY);
    expect((await answerQuestion(db, id, { answer: "3" }, TODAY)).status).toBe("answered");
    expect((await answerQuestion(db, id, { answer: "2" }, TODAY)).answer).toBe("2");
    expect(await openQuestions(db, TODAY)).toEqual([]);
    expect((await pendingQuestions(db, TODAY)).answered.map((q) => q.answer)).toEqual(["2"]);

    expect(await closeQuestions(db, [id, 99])).toEqual({ closed: [id], not_found_or_already_closed: [99] });
    expect(await pendingQuestions(db, TODAY)).toEqual({ open: [], answered: [] });
    await expect(answerQuestion(db, id, { answer: "3" }, TODAY)).rejects.toThrow(/closed by the coach/);
    await expect(answerQuestion(db, 99, { answer: "3" }, TODAY)).rejects.toThrow(/not found/);

    const other = await askQuestion(db, parseQuestion({ question: "Trip?" }, TODAY), TODAY);
    expect((await answerQuestion(db, other.id, { skip: true }, TODAY)).status).toBe("skipped");
    expect(await openQuestions(db, TODAY)).toEqual([]);
  });

  it("hides expired questions from the app", async () => {
    await askQuestion(db, parseQuestion({ question: "q", expires_on: TODAY }, TODAY), TODAY);
    expect(await openQuestions(db, TODAY)).toHaveLength(1);
    expect(await openQuestions(db, "2026-05-11")).toEqual([]);
  });

  it("creates the weekly question once per week, even after it was answered", async () => {
    await ensureWeeklyQuestion(db, "2026-05-04");
    await ensureWeeklyQuestion(db, "2026-05-05");
    const [q] = await openQuestions(db, "2026-05-05");
    expect(q).toMatchObject({ topic: "week_days:2026-05-04", multi: 1, options: expect.arrayContaining(["Mon 4", NOT_THIS_WEEK]) });
    await answerQuestion(db, q.id, { answer: "Tue 5, Thu 7 - evenings only" }, "2026-05-05");
    await ensureWeeklyQuestion(db, "2026-05-06");
    expect(rows("SELECT COUNT(*) AS n FROM coach_questions")).toEqual([{ n: 1 }]);
    await ensureWeeklyQuestion(db, "2026-05-07"); // Thursday: too late to ask
    await ensureWeeklyQuestion(db, "2026-05-11"); // next Monday
    expect(rows("SELECT topic FROM coach_questions ORDER BY id")).toEqual([{ topic: "week_days:2026-05-04" }, { topic: "week_days:2026-05-11" }]);
  });

  it("start_daily_review creates the weekly question too", async () => {
    const r = await startReview(db, "2026-05-04");
    expect(r.open_questions.map((q) => q.topic)).toEqual(["week_days:2026-05-04"]);
  });

  it("rejects a bad close list", async () => {
    await expect(closeQuestions(db, [])).rejects.toThrow(/list of question ids/);
    await expect(closeQuestions(db, ["1"])).rejects.toThrow(/list of question ids/);
  });
});

describe("runs and what changed", () => {
  const T0 = "2026-05-09T21:00:00Z";

  it("returns the last run and the last one that changed something", async () => {
    expect(await lastRun(db)).toBeNull();
    await recordRun(db, { outcome: "updated", summary: "Moved a session", changes: ["moved"], seen_through: T0 });
    await recordRun(db, { outcome: "no_change", summary: null, changes: [], seen_through: "2026-05-10T21:00:00Z" });
    expect((await lastRun(db))!.outcome).toBe("no_change");
    expect(await lastUpdate(db)).toMatchObject({ summary: "Moved a session", changes: ["moved"] });
  });

  it("finds sessions logged or edited since the last run, and the rest of the changes", async () => {
    const last = { seen_through: T0, created_at: "2026-05-09T21:02:00Z" };
    exec("INSERT INTO sessions (date, type, duration_min, rpe, created_at) VALUES ('2026-05-08', 'boulder', 60, 6, '2026-05-08T19:00:00Z')"); // old
    exec("INSERT INTO sessions (date, type, duration_min, rpe, created_at, updated_at) VALUES ('2026-05-07', 'lead', 90, 5, '2026-05-07T19:00:00Z', '2026-05-10T08:00:00Z')"); // edited
    exec("INSERT INTO sessions (date, type, duration_min, rpe, created_at) VALUES ('2026-05-10', 'board', 45, 8, '2026-05-10T18:00:00Z')"); // new
    exec("INSERT INTO profile (key, value, updated_at) VALUES ('goal', 'x', '2026-05-09T21:01:00Z')"); // written by the run itself
    exec("INSERT INTO profile (key, value, updated_at) VALUES ('availability', 'x', '2026-05-10T07:00:00Z')");
    exec("INSERT INTO profile (key, value, updated_at) VALUES ('timezone', 'Europe/Paris', '2026-05-10T07:00:00Z')");
    exec("INSERT INTO plan (date, title, source, created_at) VALUES ('2026-05-12', 'By hand', 'app', '2026-05-10T07:00:00Z')");
    exec("INSERT INTO plan (date, title, source, created_at) VALUES ('2026-05-13', 'Coach', 'coach', '2026-05-10T07:00:00Z')");
    exec("INSERT INTO checkins (date, updated_at) VALUES ('2026-05-10', '2026-05-10T07:00:00Z')");
    exec("INSERT INTO app_feedback (text) VALUES ('The timer is too quiet')");
    exec("INSERT INTO app_feedback (text, status) VALUES ('old one', 'filed')");

    const c = await changesSince(db, last, TODAY);
    expect(c.sessions.map((s) => [s.type, s.edited])).toEqual([["lead", true], ["board", false]]);
    expect(c.profile_keys).toEqual(["availability"]);
    expect(c.plan_entries_added_by_hand.map((p) => p.title)).toEqual(["By hand"]);
    expect(c.new_feedback.map((f) => f.text)).toEqual(["The timer is too quiet"]);
    expect(c.checkins).toBe(1);
  });

  it("start_daily_review: nothing new after a run means no review", async () => {
    for (let i = 1; i <= 7; i++) exec("INSERT INTO plan (date, title) VALUES (date(?, ?), 'x')", TODAY, `+${i} days`);
    const first = await startReview(db, TODAY);
    expect(first.review_needed).toBe(true);
    expect(first.reasons).toEqual(["first review"]);
    expect(first.planned_days_ahead).toBe(7);
    expect(first.instructions).toContain("record_coach_run");
    await recordRun(db, { outcome: "no_change", summary: null, changes: [], seen_through: nowStamp(new Date(Date.now() + 1000)) });
    exec("UPDATE coach_runs SET created_at = ?", nowStamp(new Date(Date.now() + 1000)));

    const second = await startReview(db, TODAY);
    expect(second).toMatchObject({ review_needed: false, reasons: [] });
  });
});

describe("set_plan keep_app_entries", () => {
  it("replaces only coach entries without a status picked by hand", async () => {
    exec("INSERT INTO plan (date, title, source) VALUES ('2026-05-12', 'Old coach', 'coach')");
    exec("INSERT INTO plan (date, title, source) VALUES ('2026-05-12', 'Before sources', NULL)");
    exec("INSERT INTO plan (date, title, source) VALUES ('2026-05-12', 'Added by hand', 'app')");
    exec("INSERT INTO plan (date, title, source, status_override) VALUES ('2026-05-12', 'Marked done', 'coach', 'done')");
    await setPlan(db, [{ date: "2026-05-12", title: "New coach" }], true, { source: "coach", keepAppEntries: true });
    expect(rows("SELECT title, source FROM plan ORDER BY id")).toEqual([
      { title: "Added by hand", source: "app" },
      { title: "Marked done", source: "coach" },
      { title: "New coach", source: "coach" },
    ]);
  });

  it("replaces everything on the date without it, and records the source", async () => {
    exec("INSERT INTO plan (date, title, source) VALUES ('2026-05-12', 'Added by hand', 'app')");
    await setPlan(db, [{ date: "2026-05-12", title: "New" }], true, { source: "coach" });
    expect(rows("SELECT title, source FROM plan")).toEqual([{ title: "New", source: "coach" }]);
    await setPlan(db, [{ date: "2026-05-12", title: "Mine" }], false, { source: "app" });
    expect(rows("SELECT title, source FROM plan ORDER BY id")).toEqual([
      { title: "New", source: "coach" },
      { title: "Mine", source: "app" },
    ]);
  });
});

describe("app feedback", () => {
  it("adds feedback once per client id and lists it newest first", async () => {
    const id = await addFeedback(db, { text: " Bigger buttons please " }, "k1");
    expect(await addFeedback(db, { text: "Bigger buttons please" }, "k1")).toBe(id);
    await addFeedback(db, { text: "Second" }, null);
    expect((await listFeedback(db)).map((f) => [f.text, f.status])).toEqual([["Second", "new"], ["Bigger buttons please", "new"]]);
    await expect(addFeedback(db, { text: "  " }, null)).rejects.toThrow(/feedback is required/);
  });

  it("records what the coach did with it", async () => {
    const id = await addFeedback(db, { text: "Dark mode" }, null);
    const r = parseResolution({ status: "filed", issue_number: 61, issue_url: "https://github.com/o/r/issues/61", reply: "Filed as #61 (P2)" });
    expect(await resolveFeedback(db, id, r)).toMatchObject({ status: "filed", issue_number: 61, reply: "Filed as #61 (P2)" });
    expect((await changesSince(db, null, TODAY)).new_feedback).toEqual([]);
    await expect(resolveFeedback(db, 999, r)).rejects.toThrow(/not found/);
  });
});
