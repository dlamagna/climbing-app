import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMER_RPE,
  PRESET_DEFAULT_RPE,
  defaultTimerRpe,
  shouldLogTimerSession,
  timerSessionClientId,
  timerSessionNotes,
} from "./timerSession";

describe("defaultTimerRpe", () => {
  it("prefers the last effort given for the preset", () => {
    expect(defaultTimerRpe("Max hangs", 5)).toBe(5);
    expect(defaultTimerRpe("My own preset", 9)).toBe(9);
  });

  it("falls back to the preset default, then the global one", () => {
    expect(defaultTimerRpe("Max hangs", null)).toBe(PRESET_DEFAULT_RPE["Max hangs"]);
    expect(defaultTimerRpe("Abrahangs", undefined)).toBe(PRESET_DEFAULT_RPE.Abrahangs);
    expect(defaultTimerRpe("My own preset", null)).toBe(DEFAULT_TIMER_RPE);
  });

  it("ignores a last effort outside 1-10", () => {
    expect(defaultTimerRpe("My own preset", 0)).toBe(DEFAULT_TIMER_RPE);
    expect(defaultTimerRpe("My own preset", 11)).toBe(DEFAULT_TIMER_RPE);
    expect(defaultTimerRpe("My own preset", 6.5)).toBe(DEFAULT_TIMER_RPE);
  });

  it("keeps every default a valid rpe", () => {
    for (const v of [DEFAULT_TIMER_RPE, ...Object.values(PRESET_DEFAULT_RPE)]) {
      expect(Number.isInteger(v) && v >= 1 && v <= 10).toBe(true);
    }
  });
});

describe("shouldLogTimerSession", () => {
  it("logs nothing when the run was stopped before a hang finished", () => {
    expect(shouldLogTimerSession(0)).toBe(false);
    expect(shouldLogTimerSession(undefined)).toBe(false);
    expect(shouldLogTimerSession("3")).toBe(false);
  });

  it("logs once at least one hang was completed", () => {
    expect(shouldLogTimerSession(1)).toBe(true);
    expect(shouldLogTimerSession(24)).toBe(true);
  });
});

describe("timerSessionClientId", () => {
  it("derives a stable key that differs from the hang log's", () => {
    const hang = "4b1c2f0e-0000-4000-8000-000000000001";
    expect(timerSessionClientId(hang)).toBe(timerSessionClientId(hang));
    expect(timerSessionClientId(hang)).not.toBe(hang);
    expect(timerSessionClientId(hang)).toBe(`${hang}:session`);
  });

  it("gives different runs different keys", () => {
    expect(timerSessionClientId("a")).not.toBe(timerSessionClientId("b"));
  });
});

it("timerSessionNotes summarises the run", () => {
  expect(timerSessionNotes("Repeaters", 20, 24)).toBe("Repeaters: 20/24 hangs");
});
