import { describe, expect, it } from "vitest";
import { defaultStartedOn, injuryDatesError, isIsoDate } from "./injury-dates";

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-03-01")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-3-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(20260301)).toBe(false);
  });
});

describe("injuryDatesError", () => {
  it("accepts an active injury (no healed date)", () => {
    expect(injuryDatesError("2026-03-01")).toBeNull();
    expect(injuryDatesError("2026-03-01", null)).toBeNull();
    expect(injuryDatesError("2026-03-01", "")).toBeNull();
  });

  it("requires a valid start date", () => {
    expect(injuryDatesError(undefined)).toMatch(/Start date/);
    expect(injuryDatesError("01/03/2026")).toMatch(/Start date/);
  });

  it("accepts healed on or after the start date", () => {
    expect(injuryDatesError("2026-03-01", "2026-03-01")).toBeNull();
    expect(injuryDatesError("2026-03-01", "2026-03-09")).toBeNull();
  });

  it("rejects healed before the start date", () => {
    expect(injuryDatesError("2026-03-09", "2026-03-01")).toBe("Healed date can't be before the start date");
  });

  it("rejects a malformed healed date", () => {
    expect(injuryDatesError("2026-03-01", "soon")).toMatch(/Healed date must be/);
  });

  it("rejects future dates only when today is given", () => {
    expect(injuryDatesError("2026-03-10", null, "2026-03-09")).toMatch(/future/);
    expect(injuryDatesError("2026-03-01", "2026-03-10", "2026-03-09")).toMatch(/future/);
    expect(injuryDatesError("2026-03-01", "2026-03-09", "2026-03-09")).toBeNull();
    expect(injuryDatesError("2026-03-10", "2026-03-12")).toBeNull();
  });
});

describe("defaultStartedOn", () => {
  it("defaults to today", () => {
    expect(defaultStartedOn("2026-03-09")).toBe("2026-03-09");
    expect(defaultStartedOn("2026-03-09", null)).toBe("2026-03-09");
  });

  it("uses the session's date when added from a session", () => {
    expect(defaultStartedOn("2026-03-09", "2026-03-02")).toBe("2026-03-02");
  });
});
