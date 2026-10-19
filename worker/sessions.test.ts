// Tags and outdoor through the shared session edit path (SESSION_FIELDS + applyTypeRules), used by MCP update_session
// and, as a full replace, by the app's PUT /api/sessions/:id. Made-up data.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { allColumns, updateByIdSql } from "./partial";
import { SESSION_COLUMNS, applyTypeRules, outdoorColumn, outdoorError, sessionPatch } from "./sessions";

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

describe("applyTypeRules", () => {
  it("allows tags on climbing types, given or stored", () => {
    expect(applyTypeRules({ tags: "slab" }, boulder)).toEqual({ tags: "slab" });
    expect(applyTypeRules({ type: "lead", tags: "slab" }, { type: "strength", tags: null })).toEqual({ type: "lead", tags: "slab" });
    expect(applyTypeRules({ type: "board" }, { type: "boulder", tags: "crimpy" })).toEqual({ type: "board" });
  });

  it("rejects tags on a session that is or becomes non-climbing", () => {
    expect(() => applyTypeRules({ tags: "crimpy" }, { type: "hangboard", tags: null })).toThrow(/only for boulder, board, lead, toprope/);
    expect(() => applyTypeRules({ type: "strength", tags: "crimpy" }, boulder)).toThrow(/only for/);
  });

  it("clears stored tags when the type changes to a non-climbing one", () => {
    expect(applyTypeRules({ type: "cardio" }, { type: "boulder", tags: "slab" })).toEqual({ type: "cardio", tags: null });
    expect(applyTypeRules({ type: "cardio", tags: null }, { type: "boulder", tags: "slab" })).toEqual({ type: "cardio", tags: null });
    expect(applyTypeRules({ type: "cardio" }, { type: "boulder", tags: null })).toEqual({ type: "cardio" });
    expect(applyTypeRules({ rpe: 5 }, { type: "strength", tags: null })).toEqual({ rpe: 5 });
  });

  it("leaves a missing session to the update (not found)", () => {
    expect(applyTypeRules({ tags: "slab" }, null)).toEqual({ tags: "slab" });
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
    expect(update(applyTypeRules(sessionPatch({ id: 1, type: "strength" }), { type: "boulder", tags: "crimpy,board" }))).toMatchObject({
      type: "strength",
      tags: null,
    });
  });

  it("the app's full replace writes tags too, and clears them when absent", () => {
    const db = migratedDb();
    db.exec("INSERT INTO sessions (date, type, duration_min, rpe) VALUES ('2026-01-05', 'boulder', 60, 6)");
    // Like db.updateSession: every column, outdoor as 0/1 (missing = indoors).
    const full = (s: Record<string, unknown>) => {
      const values = { ...allColumns(SESSION_COLUMNS, s), outdoor: outdoorColumn(s.outdoor) };
      const { sql, params } = updateByIdSql("sessions", 1, SESSION_COLUMNS, values, "updated_at");
      return db.prepare(sql).get(...(params as (string | number | null)[]));
    };
    const base = { date: "2026-01-05", type: "boulder", duration_min: 60, rpe: 6 };
    expect(full({ ...base, tags: "overhang" })).toMatchObject({ tags: "overhang" });
    expect(full(base)).toMatchObject({ tags: null });
  });
});

describe("outdoor", () => {
  it("sessionPatch stores a boolean (or 0/1) as 0/1 and rejects anything else", () => {
    expect(sessionPatch({ id: 1, outdoor: true })).toEqual({ outdoor: 1 });
    expect(sessionPatch({ id: 1, outdoor: false })).toEqual({ outdoor: 0 });
    expect(sessionPatch({ id: 1, outdoor: 1 })).toEqual({ outdoor: 1 });
    expect(() => sessionPatch({ id: 1, outdoor: "yes" })).toThrow(/outdoor must be true or false/);
    expect(() => sessionPatch({ id: 1, outdoor: null })).toThrow(/outdoor must be true or false/);
  });

  it("outdoorError: missing is fine, outdoor only on climbing types", () => {
    expect(outdoorError(undefined, "cardio")).toBeNull();
    expect(outdoorError(false, "cardio")).toBeNull();
    expect(outdoorError(true, "toprope")).toBeNull();
    expect(outdoorError(true, "boulder")).toBeNull();
    expect(outdoorError(true, "hangboard")).toMatch(/only for boulder, board, lead, toprope/);
    expect(outdoorError("outside", "lead")).toMatch(/true or false/);
    expect(outdoorColumn(undefined)).toBe(0);
    expect(outdoorColumn(true)).toBe(1);
  });

  it("applyTypeRules rejects outdoor on a non-climbing session and resets it when the type changes", () => {
    const outdoorLead = { type: "lead", tags: null, outdoor: 1 };
    expect(applyTypeRules({ outdoor: 1 }, { type: "boulder", tags: null, outdoor: 0 })).toEqual({ outdoor: 1 });
    expect(applyTypeRules({ type: "toprope" }, outdoorLead)).toEqual({ type: "toprope" });
    expect(() => applyTypeRules({ outdoor: 1 }, { type: "cardio", tags: null, outdoor: 0 })).toThrow(/outdoor is only for/);
    expect(() => applyTypeRules({ type: "strength", outdoor: 1 }, outdoorLead)).toThrow(/outdoor is only for/);
    expect(applyTypeRules({ type: "strength" }, outdoorLead)).toEqual({ type: "strength", outdoor: 0 });
    expect(applyTypeRules({ type: "strength", outdoor: 0 }, outdoorLead)).toEqual({ type: "strength", outdoor: 0 });
    expect(applyTypeRules({ type: "cardio" }, { type: "boulder", tags: "slab", outdoor: 1 })).toEqual({ type: "cardio", tags: null, outdoor: 0 });
  });

  it("old rows read as indoor; partial and full updates write the flag", () => {
    const db = migratedDb();
    db.exec("INSERT INTO sessions (date, type, duration_min, rpe) VALUES ('2026-01-05', 'lead', 60, 6)");
    expect(db.prepare("SELECT outdoor FROM sessions WHERE id = 1").get()).toEqual({ outdoor: 0 });
    const update = (patch: Record<string, unknown>) => {
      const { sql, params } = updateByIdSql("sessions", 1, SESSION_COLUMNS, patch, "updated_at");
      return db.prepare(sql).get(...(params as (string | number | null)[]));
    };
    expect(update(sessionPatch({ id: 1, type: "toprope", outdoor: true }))).toMatchObject({ type: "toprope", outdoor: 1 });
    expect(update(sessionPatch({ id: 1, rpe: 4 }))).toMatchObject({ outdoor: 1, rpe: 4 });
    const full = { ...allColumns(SESSION_COLUMNS, { date: "2026-01-05", type: "toprope", duration_min: 60, rpe: 4 }), outdoor: outdoorColumn(undefined) };
    expect(update(full)).toMatchObject({ outdoor: 0 });
  });
});
