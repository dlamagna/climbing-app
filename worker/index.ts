import { Hono, type Context, type Next } from "hono";
import {
  type Env,
  type InjuryUpdate,
  type NewInjury,
  INJURY_TRENDS,
  RED_FLAGS,
  addDays,
  activeInjuries,
  getPlan,
  getProfile,
  history,
  idForClientId,
  injuryUpdateStmts,
  insertInjury,
  insertSession,
  loadStats,
  setPlan,
  todayView,
  updateProfile,
  updateSession,
  upsertCheckin,
} from "./db";
import { handleMcp } from "./mcp";

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

class BadRequest extends Error {}

// Sent by the app's outbox so a replayed insert (response lost on bad signal) isn't stored twice.
const clientId = (c: C) => c.req.header("Idempotency-Key") || null;

async function sessionBody(c: C) {
  const s = await c.req.json();
  if (!isDate(s.date) || !s.type || !(s.duration_min > 0) || !(s.rpe >= 1 && s.rpe <= 10)) {
    throw new BadRequest("date, type, duration_min and rpe (1-10) are required");
  }
  if (s.new_injury) newInjury(s.new_injury);
  return s;
}

function newInjury(i: any): NewInjury {
  if (!i?.body_part) throw new BadRequest("body_part is required");
  return i;
}

function injuryUpdate(u: any): InjuryUpdate {
  if (!Number.isInteger(u?.injury_id) || !(u.pain >= 0 && u.pain <= 10)) {
    throw new BadRequest("injury_id and pain (0-10) are required");
  }
  if (u.trend != null && !INJURY_TRENDS.includes(u.trend)) throw new BadRequest(`trend must be one of ${INJURY_TRENDS}`);
  if (u.red_flags != null && !(Array.isArray(u.red_flags) && u.red_flags.every((f: string) => RED_FLAGS.includes(f)))) {
    throw new BadRequest(`red_flags must be a list of ${RED_FLAGS}`);
  }
  return u;
}

// An injury quick-added from the session log starts on the session's date, linked to it unless link is false.
async function sessionInjury(c: C, s: any, sessionId: number) {
  if (!s.new_injury) return;
  const key = clientId(c);
  await insertInjury(c.env.DB, s.new_injury, s.date, s.new_injury.link === false ? null : sessionId, key).run();
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
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
  const [h, load] = await Promise.all([history(c.env.DB, from, to), loadStats(c.env.DB, to, 8)]);
  return c.json({ ...h, load });
});

// The check-in also carries the day's injury follow-ups and any injuries quick-added from it,
// so the whole morning goes in one request (one outbox entry when offline).
api.put("/checkins/:date", async (c) => {
  const date = dateParam(c, "date");
  const body = await c.req.json();
  const updates: InjuryUpdate[] = (body.injuries ?? []).map(injuryUpdate);
  const added: NewInjury[] = (body.new_injuries ?? []).map(newInjury);
  const key = clientId(c);
  await upsertCheckin(c.env.DB, date, body);
  const stmts = [
    ...updates.flatMap((u) => injuryUpdateStmts(c.env.DB, date, u)),
    ...added.map((i, n) => insertInjury(c.env.DB, i, date, null, key && `${key}:${n}`)),
  ];
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

api.post("/sessions", async (c) => {
  const s = await sessionBody(c);
  const id = await insertSession(c.env.DB, s, clientId(c));
  await sessionInjury(c, s, id);
  return c.json({ id });
});

api.get("/sessions/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(Number(c.req.param("id"))).first();
  return row ? c.json(row) : c.json({ error: "Session not found" }, 404);
});

api.put("/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const s = await sessionBody(c);
  if (!(await updateSession(c.env.DB, id, s))) return c.json({ error: "Session not found" }, 404);
  await sessionInjury(c, s, id);
  return c.json({ ok: true });
});

api.delete("/sessions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

api.post("/hangs", async (c) => {
  const h = await c.req.json();
  if (!isDate(h.date)) throw new BadRequest("date is required");
  const key = clientId(c);
  const row = await c.env.DB.prepare(
    `INSERT INTO hang_logs (date, preset, on_s, off_s, reps, sets, set_rest_s, completed_reps, edge_mm, grip, added_kg, notes, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
  )
    .bind(
      h.date, h.preset, h.on_s, h.off_s, h.reps, h.sets, h.set_rest_s, h.completed_reps,
      h.edge_mm ?? null, h.grip ?? null, h.added_kg ?? null, h.notes ?? null, key,
    )
    .first<{ id: number }>();
  return c.json({ id: row?.id ?? (await idForClientId(c.env.DB, "hang_logs", key!)) });
});

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

api.get("/injuries", async (c) => {
  const [active, { results: resolved }] = await Promise.all([
    activeInjuries(c.env.DB),
    c.env.DB.prepare("SELECT * FROM injuries WHERE resolved_on IS NOT NULL ORDER BY resolved_on DESC LIMIT 20").all(),
  ]);
  return c.json({ active, resolved });
});

api.post("/injuries", async (c) => {
  const i = await c.req.json();
  if (!isDate(i.started_on)) throw new BadRequest("started_on is required");
  const key = clientId(c);
  const row = await insertInjury(c.env.DB, newInjury(i), i.started_on, null, key).first<{ id: number }>();
  if (!row) return c.json({ id: (await idForClientId(c.env.DB, "injuries", key!)) }); // replayed
  if (typeof i.pain === "number") {
    await c.env.DB.batch(injuryUpdateStmts(c.env.DB, i.started_on, { injury_id: row.id, pain: i.pain }));
  }
  return c.json({ id: row.id });
});

// One update per injury per day: re-rating the same day replaces the earlier one.
api.post("/injuries/:id/updates", async (c) => {
  const u = await c.req.json();
  if (!isDate(u.date)) throw new BadRequest("date is required");
  await c.env.DB.batch(injuryUpdateStmts(c.env.DB, u.date, injuryUpdate({ ...u, injury_id: Number(c.req.param("id")) })));
  return c.json({ ok: true });
});

api.post("/injuries/:id/resolve", async (c) => {
  const { date } = await c.req.json();
  if (!isDate(date)) throw new BadRequest("date is required");
  await c.env.DB.prepare("UPDATE injuries SET resolved_on = ? WHERE id = ?").bind(date, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// Makes a healed injury active again. With undo_date (the undo toast after tapping "gone"), that day's
// "gone" update is dropped too, since it was a mis-tap rather than a real recovery.
api.post("/injuries/:id/reopen", async (c) => {
  const id = Number(c.req.param("id"));
  const { undo_date } = await c.req.json();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE injuries SET resolved_on = NULL WHERE id = ?").bind(id),
    ...(isDate(undo_date)
      ? [c.env.DB.prepare("DELETE FROM injury_updates WHERE injury_id = ? AND date = ? AND trend = 'gone'").bind(id, undo_date)]
      : []),
  ]);
  return c.json({ ok: true });
});

api.get("/plan", async (c) => {
  const from = dateParam(c, "from");
  return c.json(await getPlan(c.env.DB, from, c.req.query("to") ?? addDays(from, 27)));
});

api.post("/plan", async (c) => {
  const e = await c.req.json();
  if (!isDate(e.date) || !e.title) throw new BadRequest("date and title are required");
  await setPlan(c.env.DB, [e], false);
  return c.json({ ok: true });
});

api.delete("/plan/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM plan WHERE id = ?").bind(Number(c.req.param("id"))).run();
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

app.route("/api", api);

export default app;
