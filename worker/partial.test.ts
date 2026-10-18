// The partial-write builders (worker/partial.ts), and the check-in / session / injury-update SQL built
// with them, run against an in-memory SQLite with every migration applied.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CHECKIN_COLUMNS, checkinPatch, checkinUpsertSql } from "./checkins";
import { injuryUpdateSql, parseInjuryUpdate } from "./injuries";
import { allColumns, pickPatch, updateByIdSql, upsertSql, type Sql } from "./partial";
import { SESSION_COLUMNS, SESSION_FIELDS, sessionPatch } from "./sessions";

function migratedDb(): DatabaseSync {
  const dir = join(import.meta.dirname, "..", "migrations");
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

const run = (db: DatabaseSync, { sql, params }: Sql) => db.prepare(sql).all(...(params as (string | number | null)[]));

describe("upsertSql", () => {
  it("writes only the provided columns, null included, undefined skipped", () => {
    const q = upsertSql("checkins", { date: "2026-01-05" }, ["sleep_hours", "feeling", "drinks", "note"], {
      drinks: 3,
      note: null,
      feeling: undefined,
    });
    expect(q.sql).toBe(
      "INSERT INTO checkins (date, drinks, note) VALUES (?, ?, ?) ON CONFLICT (date) DO UPDATE SET drinks = excluded.drinks, note = excluded.note",
    );
    expect(q.params).toEqual(["2026-01-05", 3, null]);
  });

  it("touches a timestamp column and supports composite keys", () => {
    const q = upsertSql("injury_updates", { injury_id: 1, date: "2026-01-05" }, ["pain"], { pain: 2 }, "updated_at");
    expect(q.sql).toContain("ON CONFLICT (injury_id, date) DO UPDATE SET pain = excluded.pain, updated_at = strftime(");
    expect(q.params).toEqual([1, "2026-01-05", 2]);
  });

  it("ignores values for columns outside the whitelist and refuses an empty write", () => {
    expect(upsertSql("checkins", { date: "d" }, ["drinks"], { drinks: 1, evil: "x" }).sql).not.toContain("evil");
    expect(() => upsertSql("checkins", { date: "d" }, ["drinks"], { evil: "x" })).toThrow(/Nothing to write/);
  });
});

describe("updateByIdSql", () => {
  it("sets only the provided columns", () => {
    const q = updateByIdSql("sessions", 7, SESSION_COLUMNS, { rpe: 6, notes: null }, "updated_at");
    expect(q.sql).toBe("UPDATE sessions SET rpe = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? RETURNING *");
    expect(q.params).toEqual([6, null, 7]);
  });
});

describe("pickPatch", () => {
  it("rejects unknown fields so typos aren't silently dropped", () => {
    expect(() => sessionPatch({ id: 1, duration: 60 })).toThrow(/Unknown field\(s\): duration/);
  });

  it("requires at least one field", () => {
    expect(() => sessionPatch({ id: 1 })).toThrow(/at least one/);
    expect(() => checkinPatch({ date: "2026-01-05" })).toThrow(/at least one/);
  });

  it("validates values and allows null only where the column is nullable", () => {
    expect(sessionPatch({ id: 1, rpe: 7, notes: null })).toEqual({ rpe: 7, notes: null });
    expect(() => sessionPatch({ id: 1, rpe: 11 })).toThrow(/rpe/);
    expect(() => sessionPatch({ id: 1, rpe: null })).toThrow(/rpe/);
    expect(() => sessionPatch({ id: 1, type: "yoga" })).toThrow(/type/);
    expect(() => sessionPatch({ id: 1, date: "2026-02-30" })).toThrow(/date/);
    expect(() => sessionPatch({ id: 1, duration_min: 0 })).toThrow(/duration_min/);
    expect(checkinPatch({ date: "x", drinks: 0, protein: null })).toEqual({ drinks: 0, protein: null });
    expect(() => checkinPatch({ feeling: 6 })).toThrow(/feeling/);
    expect(() => checkinPatch({ protein: "lots" })).toThrow(/protein/);
  });

  it("converts with toDb, so a new column can store e.g. a list as text", () => {
    const spec = { ...SESSION_FIELDS, tags: { check: Array.isArray, message: "tags", nullable: true, schema: {}, toDb: (v: unknown) => JSON.stringify(v) } };
    expect(pickPatch(spec, { tags: ["slab"] })).toEqual({ tags: '["slab"]' });
  });
});

describe("against the migrated schema", () => {
  it("a partial check-in keeps the fields logged earlier", () => {
    const db = migratedDb();
    run(db, checkinUpsertSql("2026-01-05", allColumns(CHECKIN_COLUMNS, { sleep_hours: 7, sleep_quality: 2, feeling: 4, drinks: 0, protein: "ok" })));
    run(db, checkinUpsertSql("2026-01-05", checkinPatch({ drinks: 3 })));
    run(db, checkinUpsertSql("2026-01-06", checkinPatch({ note: "made-up" })));
    expect(db.prepare("SELECT date, sleep_hours, sleep_quality, feeling, drinks, protein, note FROM checkins ORDER BY date").all()).toEqual([
      { date: "2026-01-05", sleep_hours: 7, sleep_quality: 2, feeling: 4, drinks: 3, protein: "ok", note: null },
      { date: "2026-01-06", sleep_hours: null, sleep_quality: null, feeling: null, drinks: null, protein: null, note: "made-up" },
    ]);
  });

  it("the app's full save still replaces every field", () => {
    const db = migratedDb();
    run(db, checkinUpsertSql("2026-01-05", allColumns(CHECKIN_COLUMNS, { sleep_hours: 7, feeling: 4, note: "x" })));
    run(db, checkinUpsertSql("2026-01-05", allColumns(CHECKIN_COLUMNS, { feeling: 2 })));
    expect(db.prepare("SELECT sleep_hours, feeling, note FROM checkins").get()).toEqual({ sleep_hours: null, feeling: 2, note: null });
  });

  it("a session update changes only the given columns and marks it edited", () => {
    const db = migratedDb();
    db.exec("INSERT INTO sessions (date, type, duration_min, rpe, max_grade, notes) VALUES ('2026-01-05', 'boulder', 90, 7, '6B', 'n')");
    const [row] = run(db, updateByIdSql("sessions", 1, SESSION_COLUMNS, sessionPatch({ id: 1, rpe: 5, max_grade: null }), "updated_at"));
    expect(row).toMatchObject({ date: "2026-01-05", type: "boulder", duration_min: 90, rpe: 5, max_grade: null, notes: "n" });
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(run(db, updateByIdSql("sessions", 99, SESSION_COLUMNS, { rpe: 5 }))).toEqual([]);
  });

  it("injury updates: one per day, merge keeps earlier fields, replace doesn't", () => {
    const db = migratedDb();
    db.exec("INSERT INTO injuries (body_part, started_on) VALUES ('Finger', '2026-01-01')");
    const morning = parseInjuryUpdate({ injury_id: 1, pain: 3, trend: "better", stiffness: true, red_flags: ["swelling"] });
    run(db, injuryUpdateSql("2026-01-05", morning));
    run(db, injuryUpdateSql("2026-01-05", parseInjuryUpdate({ injury_id: 1, pain: 4, note: "made-up" }), true));
    const cols = "SELECT pain, trend, stiffness, red_flags, note FROM injury_updates";
    expect(db.prepare(cols).all()).toEqual([{ pain: 4, trend: "better", stiffness: 1, red_flags: "swelling", note: "made-up" }]);
    run(db, injuryUpdateSql("2026-01-05", parseInjuryUpdate({ injury_id: 1, pain: 2 })));
    expect(db.prepare(cols).all()).toEqual([{ pain: 2, trend: null, stiffness: null, red_flags: null, note: null }]);
  });
});
