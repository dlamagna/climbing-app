// Argument validation shared by the app's /api/injuries routes and the MCP injury tools.
import { describe, expect, it } from "vitest";
import { checkUpdateDate, parseInjuryReport, parseInjuryUpdate, parseNewInjury } from "./injuries";

const TODAY = "2026-03-10";

describe("parseInjuryReport", () => {
  const base = { body_part: "Finger - A2 pulley", started_on: "2026-03-08" };

  it("accepts a minimal report and fills the optional fields with null", () => {
    expect(parseInjuryReport(base, TODAY)).toEqual({
      body_part: "Finger - A2 pulley",
      side: null,
      description: null,
      started_on: "2026-03-08",
      resolved_on: null,
      session_id: null,
      pain: null,
    });
  });

  it("records an already-healed injury in one step", () => {
    expect(parseInjuryReport({ ...base, resolved_on: "2026-03-09" }, TODAY).resolved_on).toBe("2026-03-09");
  });

  it.each([
    [{ started_on: "2026-3-8" }, /Start date must be/],
    [{ started_on: "2026-02-30" }, /Start date must be/],
    [{ started_on: "2026-03-11" }, /future/],
    [{ resolved_on: "2026-03-07" }, /before the start/],
    [{ resolved_on: "2026-03-11" }, /future/],
    [{ pain: 11 }, /pain/],
    [{ pain: -1 }, /pain/],
    [{ pain: 2.5 }, /pain/],
    [{ side: "middle" }, /side/],
    [{ session_id: "3" }, /session_id/],
    [{ body_part: " " }, /body_part/],
  ])("rejects %o", (patch, error) => {
    expect(() => parseInjuryReport({ ...base, ...patch }, TODAY)).toThrow(error);
  });

  it("allows future dates when no today is given (the REST API doesn't know the phone's date)", () => {
    expect(parseInjuryReport({ ...base, started_on: "2026-03-11" }).started_on).toBe("2026-03-11");
  });
});

describe("parseNewInjury", () => {
  it("trims the body part and keeps side and description", () => {
    expect(parseNewInjury({ body_part: " Elbow ", side: "left", description: "made-up" })).toEqual({
      body_part: "Elbow",
      side: "left",
      description: "made-up",
    });
  });
});

describe("parseInjuryUpdate", () => {
  it("requires injury_id and pain 0-10", () => {
    expect(() => parseInjuryUpdate({ pain: 3 })).toThrow(/injury_id/);
    expect(() => parseInjuryUpdate({ injury_id: 1 })).toThrow(/pain/);
    expect(() => parseInjuryUpdate({ injury_id: 1, pain: 11 })).toThrow(/pain/);
    expect(parseInjuryUpdate({ injury_id: 1, pain: 0 })).toEqual({ injury_id: 1, pain: 0 });
  });

  it("checks the trend enum and red flags", () => {
    expect(() => parseInjuryUpdate({ injury_id: 1, pain: 3, trend: "meh" })).toThrow(/trend/);
    expect(() => parseInjuryUpdate({ injury_id: 1, pain: 3, red_flags: ["itchy"] })).toThrow(/red_flags/);
    expect(() => parseInjuryUpdate({ injury_id: 1, pain: 3, red_flags: "swelling" })).toThrow(/red_flags/);
  });

  it("keeps omitted fields undefined (for merging) and normalises stiffness", () => {
    expect(parseInjuryUpdate({ injury_id: 1, pain: 3, trend: "worse", stiffness: true })).toEqual({
      injury_id: 1,
      pain: 3,
      trend: "worse",
      stiffness: 1,
    });
    expect(parseInjuryUpdate({ injury_id: 1, pain: 3, stiffness: 0, red_flags: [], note: null })).toEqual({
      injury_id: 1,
      pain: 3,
      stiffness: 0,
      red_flags: [],
      note: null,
    });
    expect(() => parseInjuryUpdate({ injury_id: 1, pain: 3, stiffness: "yes" })).toThrow(/stiffness/);
  });
});

describe("checkUpdateDate", () => {
  it("needs a real date, not after today when given", () => {
    expect(checkUpdateDate("2026-03-10", TODAY)).toBe("2026-03-10");
    expect(() => checkUpdateDate("2026-03-11", TODAY)).toThrow(/future/);
    expect(() => checkUpdateDate("yesterday")).toThrow(/YYYY-MM-DD/);
  });
});
