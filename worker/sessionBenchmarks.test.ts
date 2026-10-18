// Benchmark results linked to a session (issue #22): saved with it, kept unique on replays, moved when the
// session's date is edited (app PUT and MCP update_session both go through updateSessionFields) and kept,
// unlinked, when it is deleted. Runs the real SQL on an in-memory SQLite behind a minimal D1 shim.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionBenchmarkWrites } from "./benchmarks";
import { insertSession, sessionBenchmarkStmts } from "./db";
import { deleteSession, sessionPatch, updateSessionFields } from "./sessions";

type Value = string | number | null;

// Just enough of D1Database for the functions under test.
function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, params: Value[] = []) => ({
    bind: (...p: Value[]) => stmt(sql, p),
    first: async () => (db.prepare(sql).get(...params) as unknown) ?? null,
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

const results = () => raw.prepare("SELECT date, name, value, unit, session_id FROM benchmarks ORDER BY name").all();

const session = { date: "2030-02-03", type: "strength", duration_min: 60, rpe: 6 };
const inputs = [
  { name: "Max pull-ups", unit: "reps", value: "12" },
  { name: "Plank", unit: "s", value: "" },
];

async function logWithResults(key = "k1") {
  const id = await insertSession(db, session, key);
  await db.batch(sessionBenchmarkStmts(db, id, session.date, sessionBenchmarkWrites(inputs)));
  return id;
}

describe("session benchmark results", () => {
  it("saves filled-in results only, once even when the request is replayed", async () => {
    const a = await logWithResults();
    const b = await logWithResults(); // outbox replay, same Idempotency-Key
    expect(b).toBe(a);
    expect(results()).toEqual([{ date: "2030-02-03", name: "Max pull-ups", value: "12", unit: "reps", session_id: a }]);
  });

  it("updates, clears and adds results on a re-save", async () => {
    const id = await logWithResults();
    const writes = sessionBenchmarkWrites([
      { name: "Max pull-ups", unit: "reps", value: "" },
      { name: "Plank", unit: "s", value: "75" },
    ]);
    await db.batch(sessionBenchmarkStmts(db, id, session.date, writes));
    expect(results()).toEqual([{ date: "2030-02-03", name: "Plank", value: "75", unit: "s", session_id: id }]);
  });

  it("moves the results when the session's date is edited (MCP update_session patch)", async () => {
    const id = await logWithResults();
    const row = await updateSessionFields(db, id, sessionPatch({ id, date: "2030-02-05" }));
    expect(row).toMatchObject({ id, date: "2030-02-05" });
    expect(results()).toMatchObject([{ date: "2030-02-05", name: "Max pull-ups" }]);

    expect(await updateSessionFields(db, id, sessionPatch({ id, rpe: 7 }))).toMatchObject({ rpe: 7, date: "2030-02-05" });
    expect(await updateSessionFields(db, 999, sessionPatch({ id: 999, date: "2030-02-06" }))).toBeNull();
    expect(results()).toMatchObject([{ date: "2030-02-05" }]);
  });

  it("keeps the results, unlinked, when the session is deleted", async () => {
    const id = await logWithResults();
    expect(await deleteSession(db, id)).toMatchObject({ id });
    expect(results()).toEqual([{ date: "2030-02-03", name: "Max pull-ups", value: "12", unit: "reps", session_id: null }]);
  });
});
