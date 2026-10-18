import { describe, expect, it } from "vitest";
import { activeSeconds, buildPhases, sessionMinutes, totalSeconds } from "./timer";
import type { Preset } from "./types";

const preset: Preset = {
  name: "Sample",
  prep_s: 10,
  on_s: 10,
  off_s: 20,
  reps: 3,
  sets: 2,
  set_rest_s: 60,
  edge_mm: 20,
  grip: "half crimp",
  added_kg: 0,
  notes: null,
};

describe("activeSeconds", () => {
  const phases = buildPhases(preset);

  it("counts every hang and rest of a full run, but not the get-ready countdown", () => {
    const full = phases.map((p) => p.duration);
    expect(activeSeconds(phases, full)).toBe(totalSeconds(preset) - preset.prep_s);
  });

  it("only counts the time actually spent in skipped or stopped phases", () => {
    // prep, hang 1, rest, then stopped 4s into hang 2
    expect(activeSeconds(phases, [10, 10, 20, 4])).toBe(34);
    // rest skipped after 5s
    expect(activeSeconds(phases, [10, 10, 5, 10])).toBe(25);
  });

  it("never counts more than a phase's length or less than zero", () => {
    expect(activeSeconds(phases, [10, 15, -3])).toBe(10);
  });

  it("is zero when stopped during get ready", () => {
    expect(activeSeconds(phases, [4])).toBe(0);
  });
});

describe("sessionMinutes", () => {
  it("rounds to whole minutes, at least one", () => {
    expect(sessionMinutes(0)).toBe(1);
    expect(sessionMinutes(29)).toBe(1);
    expect(sessionMinutes(150)).toBe(3);
    expect(sessionMinutes(14 * 60 + 20)).toBe(14);
  });
});
