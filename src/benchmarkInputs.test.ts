import { describe, expect, it } from "vitest";
import { benchmarkBody, benchmarkInputs, testsLabel } from "./benchmarkInputs";
import type { PlanEntry } from "./types";

const entry = (date: string, title: string, expected: { name: string; unit: string }[]): PlanEntry => ({
  id: Math.floor(Math.random() * 1e6),
  date,
  title,
  type: null,
  intensity: null,
  details: null,
  expected_benchmarks: expected,
});

const plan = [
  entry("2030-05-01", "Strength tests", [
    { name: "Max pull-ups", unit: "reps" },
    { name: "Plank", unit: "s" },
  ]),
  entry("2030-05-01", "Board", [{ name: "max pull-ups", unit: "reps" }, { name: "Hardest flash", unit: "grade" }]),
  entry("2030-05-02", "Run", [{ name: "5 km run", unit: "min:s" }]),
];

describe("benchmarkInputs", () => {
  it("shows one empty input per test expected on the date", () => {
    expect(benchmarkInputs(plan, "2030-05-01", [], {})).toEqual([
      { name: "Max pull-ups", unit: "reps", value: "" },
      { name: "Plank", unit: "s", value: "" },
      { name: "Hardest flash", unit: "grade", value: "" },
    ]);
    expect(benchmarkInputs(plan, "2030-05-03", [], {})).toEqual([]);
  });

  it("prefills saved results, adds saved ones the plan no longer expects, and prefers typed values", () => {
    const saved = [
      { name: "5 km run", value: "27:30", unit: "min:s" },
      { name: "Bodyweight", value: "70", unit: "kg" },
    ];
    expect(benchmarkInputs(plan, "2030-05-02", saved, { "5 km run": "26:50" })).toEqual([
      { name: "5 km run", unit: "min:s", value: "26:50" },
      { name: "Bodyweight", unit: "kg", value: "70" },
    ]);
  });

  it("keeps typed values by name when the date changes", () => {
    const typed = { "max pull-ups": "11" };
    expect(benchmarkInputs(plan, "2030-05-01", [], typed)[0].value).toBe("11");
    expect(benchmarkInputs(plan, "2030-05-02", [], typed)).toEqual([{ name: "5 km run", unit: "min:s", value: "" }]);
  });
});

describe("benchmarkBody", () => {
  it("sends every input (trimmed, empty included) and nothing when there are none", () => {
    expect(benchmarkBody([{ name: "Plank", unit: "s", value: " 75 " }, { name: "Max pull-ups", unit: "reps", value: "" }])).toEqual([
      { name: "Plank", unit: "s", value: "75" },
      { name: "Max pull-ups", unit: "reps", value: "" },
    ]);
    expect(benchmarkBody([])).toBeUndefined();
  });
});

describe("testsLabel", () => {
  it("lists the day's tests once each, with units", () => {
    expect(testsLabel(plan.slice(0, 2))).toBe("Max pull-ups (reps), Plank (s), Hardest flash (grade)");
    expect(testsLabel([entry("2030-05-04", "Rest", [])])).toBe("");
  });
});
