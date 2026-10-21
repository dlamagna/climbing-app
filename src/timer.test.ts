import { describe, expect, it } from "vitest";
import { activeSeconds, buildPhases, doneMessage, sessionMinutes, totalSeconds } from "./timer";
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

// Compact view of a phase list: "kind:duration@set.rep".
const shape = (p: Preset) => buildPhases(p).map((ph) => `${ph.kind}:${ph.duration}@${ph.set}.${ph.rep}`);

describe("buildPhases", () => {
  it("lays out prep, hangs, rests between reps and set rest only between sets", () => {
    expect(shape(preset)).toEqual([
      "prep:10@1.1",
      "hang:10@1.1",
      "rest:20@1.2",
      "hang:10@1.2",
      "rest:20@1.3",
      "hang:10@1.3",
      "setrest:60@2.1",
      "hang:10@2.1",
      "rest:20@2.2",
      "hang:10@2.2",
      "rest:20@2.3",
      "hang:10@2.3",
    ]);
  });

  it("ends on the last hang: no trailing rest or set rest", () => {
    const phases = buildPhases(preset);
    expect(phases.at(-1)).toEqual({ kind: "hang", duration: 10, set: 2, rep: 3 });
    expect(phases.filter((ph) => ph.kind === "setrest")).toHaveLength(preset.sets - 1);
    expect(phases.filter((ph) => ph.kind === "rest")).toHaveLength(preset.sets * (preset.reps - 1));
  });

  it("labels a rest with the rep it leads into and a set rest with the set it leads into", () => {
    const phases = buildPhases(preset);
    const before = (i: number) => phases[i - 1]; // prep, rest or set rest
    phases.forEach((ph, i) => {
      if (ph.kind !== "hang" || i === 0) return;
      expect([before(i).set, before(i).rep]).toEqual([ph.set, ph.rep]);
    });
  });

  it("skips the prep phase when prep_s is 0", () => {
    const phases = buildPhases({ ...preset, prep_s: 0 });
    expect(phases[0]).toEqual({ kind: "hang", duration: 10, set: 1, rep: 1 });
    expect(phases.some((ph) => ph.kind === "prep")).toBe(false);
  });

  it("puts hangs back to back when off_s is 0, still with set rest between sets", () => {
    expect(shape({ ...preset, prep_s: 0, off_s: 0 })).toEqual([
      "hang:10@1.1",
      "hang:10@1.2",
      "hang:10@1.3",
      "setrest:60@2.1",
      "hang:10@2.1",
      "hang:10@2.2",
      "hang:10@2.3",
    ]);
  });

  it("has no set rest with a single set, or when set_rest_s is 0", () => {
    expect(shape({ ...preset, prep_s: 0, sets: 1 })).toEqual(["hang:10@1.1", "rest:20@1.2", "hang:10@1.2", "rest:20@1.3", "hang:10@1.3"]);
    expect(buildPhases({ ...preset, set_rest_s: 0 }).some((ph) => ph.kind === "setrest")).toBe(false);
  });

  it("goes straight from hang to set rest with one rep per set", () => {
    expect(shape({ ...preset, reps: 1, sets: 3, set_rest_s: 120 })).toEqual([
      "prep:10@1.1",
      "hang:10@1.1",
      "setrest:120@2.1",
      "hang:10@2.1",
      "setrest:120@3.1",
      "hang:10@3.1",
    ]);
  });

  it("totalSeconds is the sum of every phase", () => {
    // 10 prep + 6 hangs x 10 + 4 rests x 20 + 1 set rest x 60
    expect(totalSeconds(preset)).toBe(10 + 60 + 80 + 60);
    expect(totalSeconds({ ...preset, prep_s: 0, off_s: 0, sets: 1 })).toBe(30);
  });
});

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

describe("doneMessage (#83)", () => {
  it("confirms what was stored, and says when it will sync later", () => {
    expect(doneMessage("saved", "warmup", 12)).toBe("Saved as a warm-up for today's climbing");
    expect(doneMessage("saved", "training", 12)).toBe("Saved as a 12 min hangboard session");
    expect(doneMessage("queued", "training", 5)).toBe("Saved as a 5 min hangboard session offline - will sync later");
    expect(doneMessage("skipped", "training", 1)).toBe("Nothing saved - no hangs completed");
  });

  it("has no confirmation while the run isn't stored", () => {
    expect(doneMessage("error", "warmup", 3)).toBeNull();
    expect(doneMessage("saving", "training", 3)).toBeNull();
  });
});
