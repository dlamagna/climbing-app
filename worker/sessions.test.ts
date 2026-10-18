// Tags through the shared session edit path (SESSION_FIELDS + applyTagRule), used by MCP update_session
// and, as a full replace, by the app's PUT /api/sessions/:id. Made-up data.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { allColumns, updateByIdSql } from "./partial";
import { SESSION_COLUMNS, applyTagRule, sessionPatch } from "./sessions";

function migratedDb(): DatabaseSync {
  const dir = join(import.meta.dirname, "..", "migrations");
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

const boulder = { type: "boulder", tags: null };

describe("session tags in sessionPatch", () => {
  it("stores tags deduplicated in canonical order; [] and null clear them", () => {
    expect(sessionPatch({ id: 1, tags: ["overhang", "crimpy", "crimpy"] })).toEqual({ tags: "crimpy,overhang" });
    expect(sessionPatch({ id: 1, tags: [] })).toEqual({ tags: null });
    expect(sessionPatch({ id: 1, tags: null })).toEqual({ tags: null });
  });

  it("rejects unknown tags and non-lists", () => {
    expect(() => sessionPatch({ id: 1, tags: ["dyno"] })).toThrow(/tags must be a list/);
    expect(() => sessionPatch({ id: 1, tags: "crimpy" })).toThrow(/tags must be a list/);
  });
});

describe("applyTagRule", () => {
  it("allows tags on climbing types, given or stored", () => {
    expect(applyTagRule({ tags: "slab" }, boulder)).toEqual({ tags: "slab" });
    expect(applyTagRule({ type: "lead", tags: "slab" }, { type: "strength", tags: null })).toEqual({ type: "lead", tags: "slab" });
    expect(applyTagRule({ type: "board" }, { type: "boulder", tags: "crimpy" })).toEqual({ type: "board" });
  });

  it("rejects tags on a session that is or becomes non-climbing", () => {
    expect(() => applyTagRule({ tags: "crimpy" }, { type: "hangboard", tags: null })).toThrow(/only for boulder, board, lead/);
    expect(() => applyTagRule({ type: "strength", tags: "crimpy" }, boulder)).toThrow(/only for/);
  });

  it("clears stored tags when the type changes to a non-climbing one", () => {
    expect(applyTagRule({ type: "cardio" }, { type: "boulder", tags: "slab" })).toEqual({ type: "cardio", tags: null });
    expect(applyTagRule({ type: "cardio", tags: null }, { type: "boulder", tags: "slab" })).toEqual({ type: "cardio", tags: null });
    expect(applyTagRule({ type: "cardio" }, { type: "boulder", tags: null })).toEqual({ type: "cardio" });
    expect(applyTagRule({ rpe: 5 }, { type: "strength", tags: null })).toEqual({ rpe: 5 });
  });

  it("leaves a missing session to the update (not found)", () => {
    expect(applyTagRule({ tags: "slab" }, null)).toEqual({ tags: "slab" });
  });
});

describe("session tags in SQL", () => {
  it("a partial update changes the tags only; other edits keep them", () => {
    const db = migratedDb();
    db.exec("INSERT INTO sessions (date, type, duration_min, rpe, tags) VALUES ('2026-01-05', 'boulder', 60, 6, 'slab')");
    const update = (patch: Record<string, unknown>) => {
      const { sql, params } = updateByIdSql("sessions", 1, SESSION_COLUMNS, patch, "updated_at");
      return db.prepare(sql).get(...(params as (string | number | null)[]));
    };
    expect(update(sessionPatch({ id: 1, tags: ["crimpy", "board"] }))).toMatchObject({ tags: "crimpy,board", rpe: 6 });
    expect(update(sessionPatch({ id: 1, rpe: 8 }))).toMatchObject({ tags: "crimpy,board", rpe: 8 });
    expect(update(applyTagRule(sessionPatch({ id: 1, type: "strength" }), { type: "boulder", tags: "crimpy,board" }))).toMatchObject({
      type: "strength",
      tags: null,
    });
  });

  it("the app's full replace writes tags too, and clears them when absent", () => {
    const db = migratedDb();
    db.exec("INSERT INTO sessions (date, type, duration_min, rpe) VALUES ('2026-01-05', 'boulder', 60, 6)");
    const full = (s: Record<string, unknown>) => {
      const { sql, params } = updateByIdSql("sessions", 1, SESSION_COLUMNS, allColumns(SESSION_COLUMNS, s), "updated_at");
      return db.prepare(sql).get(...(params as (string | number | null)[]));
    };
    const base = { date: "2026-01-05", type: "boulder", duration_min: 60, rpe: 6 };
    expect(full({ ...base, tags: "overhang" })).toMatchObject({ tags: "overhang" });
    expect(full(base)).toMatchObject({ tags: null });
  });
});
