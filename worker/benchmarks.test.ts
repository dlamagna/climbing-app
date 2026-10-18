import { describe, expect, it } from "vitest";
import {
  MAX_EXPECTED,
  decodeExpected,
  encodeExpected,
  missingBenchmarks,
  parseExpectedBenchmarks,
  sessionBenchmarkWrites,
} from "./benchmarks";

describe("parseExpectedBenchmarks", () => {
  it("treats missing, null and [] as no tests", () => {
    expect(parseExpectedBenchmarks(undefined)).toEqual([]);
    expect(parseExpectedBenchmarks(null)).toEqual([]);
    expect(parseExpectedBenchmarks([])).toEqual([]);
  });

  it("trims names and units and collapses inner spaces", () => {
    expect(parseExpectedBenchmarks([{ name: "  Max   pull-ups ", unit: " reps " }])).toEqual([{ name: "Max pull-ups", unit: "reps" }]);
  });

  it("drops duplicate names case-insensitively, keeping the first", () => {
    expect(
      parseExpectedBenchmarks([
        { name: "Plank", unit: "s" },
        { name: "plank", unit: "min" },
        { name: "Max push-ups", unit: "reps" },
      ]),
    ).toEqual([
      { name: "Plank", unit: "s" },
      { name: "Max push-ups", unit: "reps" },
    ]);
  });

  it("requires a name and a unit", () => {
    expect(() => parseExpectedBenchmarks([{ unit: "reps" }])).toThrow(/name/);
    expect(() => parseExpectedBenchmarks([{ name: "  ", unit: "reps" }])).toThrow(/name/);
    expect(() => parseExpectedBenchmarks([{ name: "Max pull-ups" }])).toThrow(/unit/);
    expect(() => parseExpectedBenchmarks([{ name: "Max pull-ups", unit: 5 }])).toThrow(/unit/);
  });

  it("rejects non-lists, overlong values and too many tests", () => {
    expect(() => parseExpectedBenchmarks("Max pull-ups")).toThrow(/list/);
    expect(() => parseExpectedBenchmarks([{ name: "x".repeat(81), unit: "reps" }])).toThrow(/max 80/);
    expect(() => parseExpectedBenchmarks([{ name: "Plank", unit: "u".repeat(31) }])).toThrow(/max 30/);
    const many = Array.from({ length: MAX_EXPECTED + 1 }, (_, i) => ({ name: `Test ${i}`, unit: "reps" }));
    expect(() => parseExpectedBenchmarks(many)).toThrow(/at most/);
  });
});

describe("encodeExpected / decodeExpected", () => {
  it("round-trips, storing NULL for no tests", () => {
    const list = [{ name: "Max hang 20mm 10s", unit: "kg added" }];
    expect(decodeExpected(encodeExpected(list))).toEqual(list);
    expect(encodeExpected([])).toBeNull();
    expect(decodeExpected(null)).toEqual([]);
  });

  it("reads anything broken as no tests", () => {
    expect(decodeExpected("not json")).toEqual([]);
    expect(decodeExpected('{"name":"Plank"}')).toEqual([]);
    expect(decodeExpected('[{"name":"Plank"}]')).toEqual([]);
  });
});

describe("sessionBenchmarkWrites", () => {
  it("saves filled-in values and clears empty ones", () => {
    expect(
      sessionBenchmarkWrites([
        { name: "Max pull-ups", unit: "reps", value: " 12 " },
        { name: "Plank", unit: "s", value: "" },
        { name: "5 km run", unit: "min:s", value: null },
        { name: "Max hang 20mm 10s", unit: "kg added", value: 0 },
      ]),
    ).toEqual({
      save: [
        { name: "Max pull-ups", unit: "reps", value: "12" },
        { name: "Max hang 20mm 10s", unit: "kg added", value: "0" },
      ],
      clear: ["Plank", "5 km run"],
    });
  });

  it("keeps the first of duplicate names and allows a missing unit", () => {
    expect(
      sessionBenchmarkWrites([
        { name: "Hardest flash", value: "6B" },
        { name: "hardest  flash", unit: "grade", value: "6C" },
      ]),
    ).toEqual({ save: [{ name: "Hardest flash", unit: null, value: "6B" }], clear: [] });
  });

  it("does nothing without a list, and rejects bad input", () => {
    expect(sessionBenchmarkWrites(undefined)).toEqual({ save: [], clear: [] });
    expect(() => sessionBenchmarkWrites({ name: "Plank" })).toThrow(/list/);
    expect(() => sessionBenchmarkWrites([{ value: "3" }])).toThrow(/name/);
  });
});

describe("missingBenchmarks", () => {
  const today = "2030-03-15";
  const plan = [
    { date: "2030-03-07", title: "Too old", expected_benchmarks: [{ name: "Max pull-ups", unit: "reps" }] },
    { date: "2030-03-08", title: "Baseline A", expected_benchmarks: [{ name: "Max pull-ups", unit: "reps" }, { name: "Plank", unit: "s" }] },
    { date: "2030-03-12", title: "Baseline B", expected_benchmarks: [{ name: "5 km run", unit: "min:s" }, { name: "Hardest flash", unit: "grade" }] },
    { date: "2030-03-13", title: "Easy day", expected_benchmarks: [] },
    { date: "2030-03-15", title: "Today", expected_benchmarks: [{ name: "Max push-ups", unit: "reps" }] },
  ];

  it("lists planned tests from the 7 days before today with no result", () => {
    expect(missingBenchmarks(plan, [], today)).toEqual([
      { date: "2030-03-08", name: "Max pull-ups", unit: "reps", plan_title: "Baseline A" },
      { date: "2030-03-08", name: "Plank", unit: "s", plan_title: "Baseline A" },
      { date: "2030-03-12", name: "5 km run", unit: "min:s", plan_title: "Baseline B" },
      { date: "2030-03-12", name: "Hardest flash", unit: "grade", plan_title: "Baseline B" },
    ]);
  });

  it("counts a result on the day or later (any spelling), not one from before", () => {
    const logged = [
      { date: "2030-03-08", name: "max  PULL-UPS" }, // same day, different spelling
      { date: "2030-03-14", name: "Hardest flash" }, // done two days late
      { date: "2030-03-11", name: "5 km run" }, // before the planned day: doesn't count
    ];
    expect(missingBenchmarks(plan, logged, today).map((m) => `${m.date} ${m.name}`)).toEqual([
      "2030-03-08 Plank",
      "2030-03-12 5 km run",
    ]);
  });

  it("lists a test once per day even if two entries that day expect it", () => {
    const twice = [
      { date: "2030-03-10", title: "AM", expected_benchmarks: [{ name: "Plank", unit: "s" }] },
      { date: "2030-03-10", title: "PM", expected_benchmarks: [{ name: "plank", unit: "s" }] },
    ];
    expect(missingBenchmarks(twice, [], today)).toEqual([{ date: "2030-03-10", name: "Plank", unit: "s", plan_title: "AM" }]);
  });
});
