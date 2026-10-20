import { describe, expect, it } from "vitest";
import { planSteps } from "./planDetails";

describe("planSteps", () => {
  it("returns nothing for empty details", () => {
    expect(planSteps(null)).toEqual([]);
    expect(planSteps("  ")).toEqual([]);
  });

  it("gives one step per line and strips bullet markers", () => {
    expect(planSteps("- Warm-up 10 min: easy routes\n• Main: 5 x 4 min laps\n\n3. Cool down")).toEqual([
      { label: "Warm-up 10 min", text: "easy routes" },
      { label: "Main", text: "5 x 4 min laps" },
      { label: null, text: "Cool down" },
    ]);
  });

  it("splits a paragraph into sentences", () => {
    expect(planSteps("Warm-up 20 min: jogging, then drills. Main 30 min: 6 x 3 hangs, 18 mm. Stretch after.")).toEqual([
      { label: "Warm-up 20 min", text: "jogging, then drills" },
      { label: "Main 30 min", text: "6 x 3 hangs, 18 mm" },
      { label: null, text: "Stretch after" },
    ]);
  });

  it("doesn't split on abbreviations or decimals", () => {
    expect(planSteps("Pick a grip, e.g. Half crimp, and hang 2.5 s longer. Rest 3 min.")).toEqual([
      { label: null, text: "Pick a grip, e.g. Half crimp, and hang 2.5 s longer" },
      { label: null, text: "Rest 3 min" },
    ]);
  });

  it("keeps a long lead-in as plain text", () => {
    const long = "This is a very long sentence that happens to contain: a colon";
    expect(planSteps(long)).toEqual([{ label: null, text: long }]);
  });
});
