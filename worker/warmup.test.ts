// Hangboard warm-ups (#50): the pure rules, then the real SQL (timer insert, the finished screen's switch,
// History's "Mark as warm-up") on an in-memory SQLite behind a minimal D1 shim. Made-up data only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { insertSession } from "./db";
import { insertTimerLog, markSessionWarmup, setTimerWarmup } from "./timerLog";
import { isWarmupPreset, pickWarmupHang } from "./warmup";

describe("isWarmupPreset", () => {
  it("matches warm-up preset names", () => {
    for (const name of ["Warm-up", "warmup", "Warm up", "Fingers warm-up 2"]) expect(isWarmupPreset(name)).toBe(true);
  });
  it("leaves training presets alone", () => {
    for (const name of ["Max hangs", "Repeaters", "Abrahangs", "Swarmy", "", null, undefined]) expect(isWarmupPreset(name)).toBe(false);
  });
});

describe("pickWarmupHang", () => {
  const hangs = [
    { id: 1, preset: "Max hangs", client_id: "a" },
    { id: 2, preset: "Warm-up", client_id: "b" },
    { id: 3, preset: "Repeaters", client_id: "c" },
  ];
  it("takes the run the timer logged this session with", () => {
    expect(pickWarmupHang({ client_id: "c:session" }, hangs)?.id).toBe(3);
  });
  it("otherwise prefers a warm-up preset, then the latest run", () => {
    expect(pickWarmupHang({ client_id: "manual-key" }, hangs)?.id).toBe(2);
    expect(pickWarmupHang({ client_id: null }, hangs.filter((h) => h.id !== 2))?.id).toBe(3);
  });
  it("skips runs that are already warm-ups or carry another existing session", () => {
    const h = [
      { id: 1, preset: "Warm-up", client_id: "a", warmup: 1 },
      { id: 2, preset: "Warm-up", client_id: "b" },
      { id: 3, preset: "Max hangs", client_id: "c" },
    ];
    expect(pickWarmupHang({ client_id: null }, h, ["b:session"])?.id).toBe(3);
  });
  it("returns null when there is no timer run to keep", () => {
    expect(pickWarmupHang({ client_id: null }, [])).toBeNull();
    expect(pickWarmupHang({ client_id: null }, [{ id: 1, preset: "Warm-up", warmup: 1 }])).toBeNull();
  });
});

type Value = string | number | null;

// Just enough of D1Database for the functions under test.
function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, params: Value[] = []) => ({
    bind: (...p: Value[]) => stmt(sql, p),
    first: async (col?: string) => {
      const row = (db.prepare(sql).get(...params) as Record<string, unknown> | undefined) ?? null;
      return col && row ? row[col] : row;
    },
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: ReturnType<typeof stmt>[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.all());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

let raw: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  const dir = join(import.meta.dirname, "..", "migrations");
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) raw.exec(readFileSync(join(dir, f), "utf8"));
  db = d1(raw);
});

const DAY = "2030-04-02";
const run = (preset: string, extra: Record<string, unknown> = {}) => ({
  date: DAY,
  preset,
  on_s: 7,
  off_s: 3,
  reps: 6,
  sets: 1,
  set_rest_s: 0,
  completed_reps: 6,
  duration_min: 2,
  ...extra,
});
const sessions = () => raw.prepare("SELECT id, type, duration_min, client_id FROM sessions ORDER BY id").all() as Record<string, Value>[];
const hangLogs = () => raw.prepare("SELECT id, preset, warmup FROM hang_logs ORDER BY id").all() as Record<string, Value>[];

describe("timer insert", () => {
  it("saves a warm-up as a hang log only, marked", async () => {
    const r = await insertTimerLog(db, run("Warm-up", { warmup: true }), "k1");
    expect(r.session).toBeNull();
    expect(sessions()).toEqual([]);
    expect(hangLogs()).toEqual([{ id: 1, preset: "Warm-up", warmup: 1 }]);
  });
  it("still logs a training run with its session", async () => {
    const r = await insertTimerLog(db, run("Max hangs"), "k1");
    expect(r.session).not.toBeNull();
    expect(sessions()).toHaveLength(1);
    expect(hangLogs()[0].warmup).toBe(0);
  });
});

describe("finished screen switch", () => {
  it("turns a training run into a warm-up and back, without duplicates", async () => {
    await insertTimerLog(db, run("Max hangs"), "k1");
    await setTimerWarmup(db, "k1", true);
    await setTimerWarmup(db, "k1", true); // replay
    expect(sessions()).toEqual([]);
    expect(hangLogs()[0].warmup).toBe(1);

    const s = await setTimerWarmup(db, "k1", false, 2);
    await setTimerWarmup(db, "k1", false, 2); // replay
    expect(s).toMatchObject({ duration_min: 2 });
    expect(sessions()).toEqual([{ id: expect.any(Number), type: "hangboard", duration_min: 2, client_id: "k1:session" }]);
    expect(hangLogs()[0].warmup).toBe(0);
  });
  it("can count a run saved as a warm-up after all", async () => {
    await insertTimerLog(db, run("Warm-up", { warmup: true }), "k1");
    await setTimerWarmup(db, "k1", false, 3);
    expect(sessions()).toHaveLength(1);
    expect(hangLogs()[0].warmup).toBe(0);
  });
  it("rejects an unknown run", async () => {
    await expect(setTimerWarmup(db, "nope", false, 2)).rejects.toThrow("not found");
  });
});

describe("Mark as warm-up (History)", () => {
  it("removes a timer-made hangboard session and marks its run", async () => {
    await insertTimerLog(db, run("Max hangs"), "k1");
    const id = sessions()[0].id as number;
    expect(await markSessionWarmup(db, id)).toEqual({ hang_log_id: 1 });
    expect(sessions()).toEqual([]);
    expect(hangLogs()).toEqual([{ id: 1, preset: "Max hangs", warmup: 1 }]);
  });
  it("finds the day's run for a hangboard session logged by hand, leaving the climbing session alone", async () => {
    await insertTimerLog(db, run("Warm-up", { duration_min: undefined }), "k1"); // older app: hang log only
    const hb = await insertSession(db, { date: DAY, type: "hangboard", duration_min: 4, rpe: 5 }, "manual");
    await insertSession(db, { date: DAY, type: "boulder", duration_min: 90, rpe: 7 }, "climb");
    await markSessionWarmup(db, hb);
    expect(sessions().map((s) => s.type)).toEqual(["boulder"]);
    expect(hangLogs()[0].warmup).toBe(1);
  });
  it("refuses when there is no timer run that day, or the session isn't hangboard", async () => {
    const hb = await insertSession(db, { date: DAY, type: "hangboard", duration_min: 10, rpe: 6 }, "m1");
    await expect(markSessionWarmup(db, hb)).rejects.toThrow("delete the session instead");
    const climb = await insertSession(db, { date: DAY, type: "boulder", duration_min: 60, rpe: 6 }, "m2");
    await expect(markSessionWarmup(db, climb)).rejects.toThrow("Only hangboard");
    expect(sessions()).toHaveLength(2);
  });
});
