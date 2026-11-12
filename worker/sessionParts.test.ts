// Mixed sessions (#108) split into one session per type. Made-up data.
import { describe, expect, it } from "vitest";
import { PARTS_MESSAGE, parseParts, partsCheckType, partsTotal, splitSession } from "./sessionParts";

const parts = [
  { type: "boulder", duration_min: 40 },
  { type: "board", duration_min: 20 },
  { type: "lead", duration_min: 30 },
];

describe("parseParts", () => {
  it("is null when missing, so a normal session is unchanged", () => {
    expect(parseParts(undefined)).toBeNull();
    expect(parseParts(null)).toBeNull();
  });

  it("accepts 2+ different types with whole minutes", () => {
    expect(parseParts(parts)).toEqual(parts);
  });

  it("rejects one part, repeated types, unknown types and bad minutes", () => {
    for (const bad of [
      [],
      [{ type: "boulder", duration_min: 30 }],
      [{ type: "boulder", duration_min: 30 }, { type: "boulder", duration_min: 10 }],
      [{ type: "boulder", duration_min: 30 }, { type: "dancing", duration_min: 10 }],
      [{ type: "boulder", duration_min: 30 }, { type: "lead", duration_min: 0 }],
      [{ type: "boulder", duration_min: 30 }, { type: "lead", duration_min: 12.5 }],
      [{ type: "boulder", duration_min: 30 }, null],
      "boulder,lead",
    ]) {
      expect(() => parseParts(bad)).toThrow(PARTS_MESSAGE);
    }
  });
});

describe("partsTotal / partsCheckType", () => {
  it("sums the minutes", () => expect(partsTotal(parts)).toBe(90));

  it("checks tags and outdoor against the first climbing part", () => {
    expect(partsCheckType(parts)).toBe("boulder");
    expect(partsCheckType([{ type: "hangboard", duration_min: 15 }, { type: "lead", duration_min: 60 }])).toBe("lead");
    expect(partsCheckType([{ type: "strength", duration_min: 30 }, { type: "cardio", duration_min: 20 }])).toBe("strength");
  });
});

describe("splitSession", () => {
  const base = {
    date: "2030-01-02",
    type: "boulder",
    duration_min: 105,
    rpe: 7,
    max_grade: "6B",
    notes: "made-up note",
    plan_id: 3,
    tags: "crimpy",
    outdoor: 1 as const,
    gym: "Test Wall",
  };

  it("makes one session per type sharing date, effort and gym; load adds up to the whole visit", () => {
    const rows = splitSession(base, [...parts, { type: "hangboard", duration_min: 15 }]);
    expect(rows.map((r) => [r.type, r.duration_min])).toEqual([
      ["boulder", 40],
      ["board", 20],
      ["lead", 30],
      ["hangboard", 15],
    ]);
    for (const r of rows) expect([r.date, r.rpe, r.gym]).toEqual(["2030-01-02", 7, "Test Wall"]);
    expect(rows.reduce((sum, r) => sum + r.duration_min * r.rpe, 0)).toBe(105 * 7);
  });

  it("puts grade, notes and plan pin on the first part only", () => {
    const rows = splitSession(base, parts);
    expect(rows.map((r) => [r.max_grade, r.notes, r.plan_id])).toEqual([
      ["6B", "made-up note", 3],
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("keeps tags and outdoor only on the types that take them", () => {
    const rows = splitSession(base, [{ type: "lead", duration_min: 60 }, { type: "hangboard", duration_min: 15 }]);
    expect(rows.map((r) => [r.type, r.tags, r.outdoor])).toEqual([
      ["lead", "crimpy", 1],
      ["hangboard", null, 0],
    ]);
  });
});
