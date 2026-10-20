import { Hono, type Context, type Next } from "hono";
import {
  type Env,
  addDays,
  activeInjuries,
  getPlan,
  getProfile,
  history,
  insertSession,
  knownGyms,
  loadStats,
  moveCheckin,
  resolveGym,
  sessionBenchmarkStmts,
  setPlan,
  sessionsBetween,
  setPlanStatus,
  todayIn,
  todayView,
  updateProfile,
  updateSession,
  upsertCheckin,
} from "./db";
import { parseExpectedBenchmarks, sessionBenchmarkWrites } from "./benchmarks";
import { addClimberNote, addFeedback, answerQuestion, coachActivity, deleteFeedback, editFeedback, listClimberNotes, listFeedback, setClimbingDays } from "./coach";
import { BadRequest, NotFound } from "./errors";
import { withIssueStatus } from "./github";
import { fireRoutine, isRoutineName, routinesAvailable } from "./routines";
import { buildExport, exportFilename, quoteIdent, toCsv, userTables } from "./export";
import {
  type InjuryUpdate,
  type NewInjury,
  addInjuryUpdate,
  checkUpdateDate,
  injuryUpdateStmts,
  insertInjury,
  parseInjuryReport,
  parseInjuryUpdate,
  parseNewInjury,
  reopenInjury,
  reportInjury,
  resolveInjury,
} from "./injuries";
import { tagsColumn, tagsError } from "./tags";
import { handleMcp } from "./mcp";
import { GYM_MESSAGE, isGymInput } from "./gyms";
import { deleteSession, outdoorColumn, outdoorError } from "./sessions";
import { PLAN_STATUSES, isPlanStatus } from "./plan";
import { deleteTimerSession, insertTimerLog, markSessionWarmup, setTimerSessionRpe, setTimerWarmup } from "./timerLog";
import { isRpe } from "./timerSession";

type C = Context<{ Bindings: Env }>;

const encoder = new TextEncoder();

// Fails closed: an unset secret rejects everything.
function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

function bearer(c: C): string | undefined {
  return c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function dateParam(c: C, name: string): string {
  const v = c.req.query(name) ?? c.req.param(name);
  if (!isDate(v)) throw new BadRequest(`${name} must be YYYY-MM-DD`);
  return v;
}

// Sent by the app's outbox so a replayed insert (response lost on bad signal) isn't stored twice.
const clientId = (c: C) => c.req.header("Idempotency-Key") || null;

async function sessionBody(c: C) {
  const s = await c.req.json();
  if (!isDate(s.date) || !s.type || !(s.duration_min > 0) || !(s.rpe >= 1 && s.rpe <= 10)) {
    throw new BadRequest("date, type, duration_min and rpe (1-10) are required");
  }
  if (s.plan_id != null && !Number.isInteger(s.plan_id)) throw new BadRequest("plan_id must be an integer");
  const tagError = tagsError(s.tags, s.type);
  if (tagError) throw new BadRequest(tagError);
  const outError = outdoorError(s.outdoor, s.type);
  if (outError) throw new BadRequest(outError);
  if (s.gym !== undefined && !isGymInput(s.gym)) throw new BadRequest(GYM_MESSAGE);
  if (s.new_injury) parseNewInjury(s.new_injury);
  s.benchmark_writes = badRequestOn(() => sessionBenchmarkWrites(s.benchmarks));
  s.tags = tagsColumn(s.tags); // missing tags clear them on edit, like the other optional fields
  s.outdoor = outdoorColumn(s.outdoor); // missing = indoors (also on edit)
  s.gym = await resolveGym(c.env.DB, s.gym); // missing clears it on edit; known spelling reused (#48)
  return s;
}

// Turns a validation error from a pure helper into a 400.
function badRequestOn<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    throw new BadRequest((e as Error).message);
  }
}

// Results for the plan's expected benchmarks, entered below the session form.
async function sessionBenchmarks(c: C, s: any, sessionId: number) {
  const writes = s.benchmark_writes;
  if (writes.save.length || writes.clear.length) await c.env.DB.batch(sessionBenchmarkStmts(c.env.DB, sessionId, s.date, writes));
}

// An injury quick-added from the session log starts on the session's date, linked to it unless link is false.
async function sessionInjury(c: C, s: any, sessionId: number) {
  if (!s.new_injury) return;
  const key = clientId(c);
  await insertInjury(c.env.DB, parseNewInjury(s.new_injury), s.date, s.new_injury.link === false ? null : sessionId, key).run();
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

// MCP: the token can go in the path (claude.ai connectors only take a URL) or as a bearer header.
app.all("/mcp/:token", async (c) =>
  tokenMatches(c.req.param("token"), c.env.MCP_TOKEN) ? handleMcp(c.req.raw, c.env) : c.text("Unauthorized", 401),
);
app.all("/mcp", async (c) =>
  tokenMatches(bearer(c), c.env.MCP_TOKEN) ? handleMcp(c.req.raw, c.env) : c.text("Unauthorized", 401),
);

const api = new Hono<{ Bindings: Env }>();

api.use("*", async (c: C, next: Next) => {
  if (!tokenMatches(bearer(c), c.env.APP_TOKEN)) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

api.get("/today", async (c) => c.json(await todayView(c.env.DB, dateParam(c, "date"))));

api.get("/history", async (c) => {
  const to = dateParam(c, "to");
  const from = dateParam(c, "from");
  // only=sessions: just the sessions (the calendar browsing older months needs nothing else).
  if (c.req.query("only") === "sessions") return c.json({ sessions: await sessionsBetween(c.env.DB, from, to) });
  const [h, load] = await Promise.all([history(c.env.DB, from, to), loadStats(c.env.DB, to, 8)]);
  return c.json({ ...h, load });
});

// Weigh-ins from check-ins over a range, oldest first (bodyweight chart on the Benchmarks page).
api.get("/weights", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT date, weight_kg FROM checkins WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date",
  )
    .bind(dateParam(c, "from"), dateParam(c, "to"))
    .all();
  return c.json(results);
});

api.get("/checkins/:date", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM checkins WHERE date = ?").bind(dateParam(c, "date")).first();
  return row ? c.json(row) : c.json({ error: "Check-in not found" }, 404);
});

// The check-in also carries the day's injury follow-ups and any injuries quick-added from it,
// so the whole morning goes in one request (one outbox entry when offline).
// A body.date different from the path moves the check-in to that day. Moving onto a day that already
// has one needs overwrite: true, so a typo doesn't silently replace another morning's entry.
api.put("/checkins/:date", async (c) => {
  const date = dateParam(c, "date");
  const body = await c.req.json();
  const to = body.date ?? date;
  if (!isDate(to)) throw new BadRequest("date must be YYYY-MM-DD");
  const updates: InjuryUpdate[] = (body.injuries ?? []).map(parseInjuryUpdate);
  const added: NewInjury[] = (body.new_injuries ?? []).map(parseNewInjury);
  if (to === date) {
    await upsertCheckin(c.env.DB, date, body);
  } else {
    const taken = await c.env.DB.prepare("SELECT 1 FROM checkins WHERE date = ?").bind(to).first();
    if (taken && !body.overwrite) return c.json({ error: "There's already a check-in on that day" }, 409);
    await moveCheckin(c.env.DB, date, to, body);
  }
  const key = clientId(c);
  const stmts = [
    ...updates.flatMap((u) => injuryUpdateStmts(c.env.DB, to, u)),
    ...added.map((i, n) => insertInjury(c.env.DB, i, to, null, key && `${key}:${n}`)),
  ];
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

api.delete("/checkins/:date", async (c) => {
  await c.env.DB.prepare("DELETE FROM checkins WHERE date = ?").bind(dateParam(c, "date")).run();
  return c.json({ ok: true });
});

api.post("/sessions", async (c) => {
  const s = await sessionBody(c);
  const id = await insertSession(c.env.DB, s, clientId(c));
  await sessionBenchmarks(c, s, id);
  await sessionInjury(c, s, id);
  return c.json({ id });
});

// With the benchmark results entered with it, so editing shows them.
api.get("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
  if (!row) return c.json({ error: "Session not found" }, 404);
  const { results } = await c.env.DB.prepare("SELECT name, value, unit FROM benchmarks WHERE session_id = ? ORDER BY id").bind(id).all();
  return c.json({ ...row, benchmarks: results });
});

api.put("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const s = await sessionBody(c);
  if (!(await updateSession(c.env.DB, id, s))) return c.json({ error: "Session not found" }, 404);
  await sessionBenchmarks(c, s, id);
  await sessionInjury(c, s, id);
  return c.json({ ok: true });
});

// Gyms used so far, most recently used first, for the Log page's picker (#48).
api.get("/gyms", async (c) => c.json(await knownGyms(c.env.DB)));

api.delete("/sessions/:id", async (c) => {
  await deleteSession(c.env.DB, Number(c.req.param("id")));
  return c.json({ ok: true });
});

// Also logs the run as a hangboard session (when the app sends duration_min), see worker/timerLog.ts.
api.post("/hangs", async (c) => {
  const h = await c.req.json();
  if (!isDate(h.date)) throw new BadRequest("date is required");
  return c.json(await insertTimerLog(c.env.DB, h, clientId(c)));
});

// The session logged with a timer run, addressed by the hang log's Idempotency-Key (works offline).
api.patch("/hangs/by-key/:key/session", async (c) => {
  const { rpe } = await c.req.json();
  if (!isRpe(rpe)) throw new BadRequest("rpe (1-10) is required");
  const found = await setTimerSessionRpe(c.env.DB, c.req.param("key"), rpe);
  return found ? c.json({ ok: true }) : c.json({ error: "Session not found" }, 404);
});

api.delete("/hangs/by-key/:key/session", async (c) => {
  await deleteTimerSession(c.env.DB, c.req.param("key"));
  return c.json({ ok: true });
});

// The finished screen's warm-up / training choice (#50): {warmup: true} or {warmup: false, duration_min}.
api.put("/hangs/by-key/:key/warmup", async (c) => {
  const { warmup, duration_min } = await c.req.json();
  if (typeof warmup !== "boolean") throw new BadRequest("warmup must be true or false");
  const session = await setTimerWarmup(c.env.DB, c.req.param("key"), warmup, duration_min);
  return c.json({ ok: true, session });
});

// History's "Mark as warm-up" on a hangboard session (#50).
api.post("/sessions/:id/warmup", async (c) => c.json(await markSessionWarmup(c.env.DB, Number(c.req.param("id")))));

api.delete("/hangs/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM hang_logs WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

const PRESET_FIELDS = ["name", "prep_s", "on_s", "off_s", "reps", "sets", "set_rest_s", "edge_mm", "grip", "added_kg", "notes", "sort"];
const presetValues = (p: Record<string, unknown>) => PRESET_FIELDS.map((f) => p[f] ?? (f === "sort" ? 0 : null));

api.get("/presets", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM timer_presets ORDER BY sort, id").all();
  return c.json(results);
});

api.post("/presets", async (c) => {
  const row = await c.env.DB.prepare(
    `INSERT INTO timer_presets (${PRESET_FIELDS.join(", ")}) VALUES (${PRESET_FIELDS.map(() => "?").join(", ")}) RETURNING id`,
  )
    .bind(...presetValues(await c.req.json()))
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

api.put("/presets/:id", async (c) => {
  await c.env.DB.prepare(`UPDATE timer_presets SET ${PRESET_FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...presetValues(await c.req.json()), Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

api.delete("/presets/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM timer_presets WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// Session notes not linked to an injury yet, for "Review past notes" on the Injuries screen.
// The app runs the keyword matcher (src/painWords.ts) on them; nothing is created here.
api.get("/session-notes", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, date, type, notes FROM sessions
     WHERE notes IS NOT NULL AND TRIM(notes) != ''
       AND id NOT IN (SELECT session_id FROM injuries WHERE session_id IS NOT NULL)
     ORDER BY date DESC, id DESC LIMIT 1000`,
  ).all();
  return c.json(results);
});

api.get("/injuries", async (c) => {
  const [active, { results: resolved }] = await Promise.all([
    activeInjuries(c.env.DB),
    c.env.DB.prepare("SELECT * FROM injuries WHERE resolved_on IS NOT NULL ORDER BY resolved_on DESC LIMIT 20").all(),
  ]);
  return c.json({ active, resolved });
});

// Can be backdated, and with resolved_on an injury that has already healed is recorded in one go.
// session_id links it to the session it happened in (e.g. added from an old session note).
// Validation and queries are shared with the MCP tools (worker/injuries.ts).
api.post("/injuries", async (c) => {
  return c.json(await reportInjury(c.env.DB, parseInjuryReport(await c.req.json()), clientId(c)));
});

// One update per injury per day: re-rating the same day replaces the earlier one.
api.post("/injuries/:id/updates", async (c) => {
  const u = await c.req.json();
  const date = checkUpdateDate(u.date);
  await addInjuryUpdate(c.env.DB, date, parseInjuryUpdate({ ...u, injury_id: Number(c.req.param("id")) }));
  return c.json({ ok: true });
});

// date may be in the past (healed a while ago), but not before the injury started.
api.post("/injuries/:id/resolve", async (c) => {
  const { date } = await c.req.json();
  await resolveInjury(c.env.DB, Number(c.req.param("id")), checkUpdateDate(date));
  return c.json({ ok: true });
});

// Makes a healed injury active again; undo_date also drops that day's "gone" update (undo toast).
api.post("/injuries/:id/reopen", async (c) => {
  const { undo_date } = await c.req.json();
  await reopenInjury(c.env.DB, Number(c.req.param("id")), undo_date);
  return c.json({ ok: true });
});

// Entries carry status, auto_status, session_id and flags (worker/plan.ts). `today` is the phone's date;
// app versions that don't send it get today in the profile's timezone.
api.get("/plan", async (c) => {
  const from = dateParam(c, "from");
  const today = c.req.query("today") ? dateParam(c, "today") : todayIn((await getProfile(c.env.DB)).timezone);
  return c.json((await getPlan(c.env.DB, from, c.req.query("to") ?? addDays(from, 27), today)).entries);
});

// One-tap status from Plan / Today; status null goes back to automatic.
api.put("/plan/:id/status", async (c) => {
  const { status } = await c.req.json();
  if (status !== null && !isPlanStatus(status)) throw new BadRequest(`status must be null or one of ${PLAN_STATUSES}`);
  const found = await setPlanStatus(c.env.DB, Number(c.req.param("id")), status);
  return found ? c.json({ ok: true }) : c.json({ error: "Plan entry not found" }, 404);
});

api.post("/plan", async (c) => {
  const e = await c.req.json();
  if (!isDate(e.date) || !e.title) throw new BadRequest("date and title are required");
  e.expected_benchmarks = badRequestOn(() => parseExpectedBenchmarks(e.expected_benchmarks));
  await setPlan(c.env.DB, [e], false, { source: "app" });
  return c.json({ ok: true });
});

api.delete("/plan/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM plan WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// The climber's answer to a coach question (#52): { answer } or { skip: true }.
api.put("/coach/questions/:id", async (c) => {
  const today = todayIn((await getProfile(c.env.DB)).timezone);
  return c.json(await answerQuestion(c.env.DB, Number(c.req.param("id")), await c.req.json(), today));
});

// Notes to the coach (#65): free text sent from Today; the next daily review reads them.
api.get("/coach/notes", async (c) => c.json(await listClimberNotes(c.env.DB)));
api.post("/coach/notes", async (c) => c.json({ id: await addClimberNote(c.env.DB, await c.req.json(), clientId(c)) }));

// Coach activity for Settings (#64): last run, when the next one is expected, and past runs.
api.get("/coach/runs", async (c) => c.json(await coachActivity(c.env.DB, Number(c.req.query("limit") ?? 30))));

// Start the coach review or the issue worker now, from Settings → Coach activity (needs the routine's
// API trigger secrets; see worker/routines.ts).
api.get("/coach/routines", (c) => c.json(routinesAvailable(c.env)));
api.post("/coach/routines/:name/run", async (c) => {
  const name = c.req.param("name");
  if (!isRoutineName(name)) throw new NotFound(`No routine "${name}"`);
  return c.json(await fireRoutine(c.env, name));
});

// Climbing days picked with Today's "Plan my climbing days" button (#56): { days: [dates], note }.
api.put("/coach/climbing-days", async (c) => {
  const today = todayIn((await getProfile(c.env.DB)).timezone);
  return c.json(await setClimbingDays(c.env.DB, await c.req.json(), today));
});

// App feedback (#52): typed in the app, triaged into GitHub issues by the daily coach review.
api.get("/feedback", async (c) => c.json(await withIssueStatus(c.env, await listFeedback(c.env.DB))));
api.post("/feedback", async (c) => c.json({ id: await addFeedback(c.env.DB, await c.req.json(), clientId(c)) }));
api.put("/feedback/:id", async (c) => {
  await editFeedback(c.env.DB, Number(c.req.param("id")), await c.req.json());
  return c.json({ ok: true });
});
api.delete("/feedback/:id", async (c) => {
  await deleteFeedback(c.env.DB, Number(c.req.param("id")));
  return c.json({ ok: true });
});

api.get("/benchmarks", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM benchmarks ORDER BY date DESC, id DESC").all();
  return c.json(results);
});

api.post("/benchmarks", async (c) => {
  const b = await c.req.json();
  if (!isDate(b.date) || !b.name || b.value === undefined) throw new BadRequest("date, name and value are required");
  await c.env.DB.prepare("INSERT INTO benchmarks (date, name, value, unit, notes) VALUES (?, ?, ?, ?, ?)")
    .bind(b.date, b.name, String(b.value), b.unit ?? null, b.notes ?? null)
    .run();
  return c.json({ ok: true });
});

api.delete("/benchmarks/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM benchmarks WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

api.get("/profile", async (c) => c.json(await getProfile(c.env.DB)));

api.put("/profile", async (c) => {
  await updateProfile(c.env.DB, await c.req.json());
  return c.json(await getProfile(c.env.DB));
});

// Backup: every user table as JSON, or ?format=csv&table=<name> for one table.
api.get("/export", async (c) => {
  const db = c.env.DB;
  const format = c.req.query("format") ?? "json";
  if (format !== "json" && format !== "csv") throw new BadRequest("format must be json or csv");
  const { results: master } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>();
  const tables = userTables(master.map((r) => r.name));
  const date = todayIn((await getProfile(db)).timezone);

  if (format === "csv") {
    const table = c.req.query("table");
    if (!table || !tables.includes(table)) throw new BadRequest(`table must be one of: ${tables.join(", ")}`);
    const [info, rows] = await db.batch([
      db.prepare(`PRAGMA table_info(${quoteIdent(table)})`),
      db.prepare(`SELECT * FROM ${quoteIdent(table)}`),
    ]);
    const columns = (info.results as { name: string }[]).map((col) => col.name);
    return c.body(toCsv(columns, rows.results as Record<string, unknown>[]), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(date, "csv", table)}"`,
      "Cache-Control": "no-store",
    });
  }

  const rows = tables.length ? await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${quoteIdent(t)}`))) : [];
  // d1_migrations is created by wrangler; a database set up some other way may not have it.
  const lastMigration = await db
    .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
    .first<string>("name")
    .catch(() => null);
  const file = buildExport(
    Object.fromEntries(tables.map((t, i) => [t, rows[i].results as Record<string, unknown>[]])),
    lastMigration,
    new Date(),
  );
  return c.body(JSON.stringify(file, null, 2), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${exportFilename(date)}"`,
    "Cache-Control": "no-store",
  });
});

app.route("/api", api);

export default app;
