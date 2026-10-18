import { describe, expect, it } from "vitest";
import { baselineNote, benchmarkSeries, formatClock, niceTicks, parseResult, rollingAverage, splitOnGaps } from "./progress";

const pts = (...rows: [string, number][]) => rows.map(([date, value]) => ({ date, value }));
const values = (p: { value: number }[]) => p.map((x) => Math.round(x.value * 100) / 100);

describe("rollingAverage", () => {
  it("averages the trailing 7 calendar days once there are 7 daily points", () => {
    const daily = pts(
      ["2026-03-01", 70],
      ["2026-03-02", 71],
      ["2026-03-03", 72],
      ["2026-03-04", 73],
      ["2026-03-05", 74],
      ["2026-03-06", 75],
      ["2026-03-07", 76],
      ["2026-03-08", 77],
    );
    const avg = rollingAverage(daily);
    expect(avg.map((p) => p.date)).toEqual(daily.map((p) => p.date));
    expect(avg[6].value).toBe(73); // 70..76
    expect(avg[7].value).toBe(74); // 71..77: day 1 dropped out
  });

  it("uses whatever is there with fewer than 7 points", () => {
    expect(values(rollingAverage(pts(["2026-03-01", 70])))).toEqual([70]);
    expect(values(rollingAverage(pts(["2026-03-01", 70], ["2026-03-02", 72])))).toEqual([70, 71]);
    expect(rollingAverage([])).toEqual([]);
  });

  it("averages only the weigh-ins present in the window across gaps", () => {
    // 1st, 3rd, 7th: all inside the 7 days ending the 7th. The 8th drops the 1st. The 20th stands alone.
    const avg = rollingAverage(pts(["2026-03-01", 70], ["2026-03-03", 73], ["2026-03-07", 76], ["2026-03-08", 79], ["2026-03-20", 80]));
    expect(values(avg)).toEqual([70, 71.5, 73, 76, 80]);
  });

  it("sorts unsorted input and keeps the last value for a repeated date", () => {
    const avg = rollingAverage(pts(["2026-03-03", 74], ["2026-03-01", 70], ["2026-03-02", 99], ["2026-03-02", 72]));
    expect(avg.map((p) => p.date)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(values(avg)).toEqual([70, 71, 72]);
  });

  it("counts calendar days across month ends and DST changes", () => {
    const avg = rollingAverage(pts(["2026-03-25", 70], ["2026-03-31", 72], ["2026-04-01", 74]));
    expect(values(avg)).toEqual([70, 71, 73]); // 25 Mar is 7 days before 1 Apr, so it's out
  });

  it("takes a custom window", () => {
    expect(values(rollingAverage(pts(["2026-03-01", 70], ["2026-03-02", 72], ["2026-03-03", 74]), 2))).toEqual([70, 71, 73]);
  });
});

describe("splitOnGaps", () => {
  it("breaks the line where weigh-ins are more than the window apart", () => {
    const parts = splitOnGaps(pts(["2026-03-01", 1], ["2026-03-08", 2], ["2026-03-16", 3], ["2026-03-17", 4]), 7);
    expect(parts.map((p) => p.map((x) => x.value))).toEqual([[1, 2], [3, 4]]);
    expect(splitOnGaps([], 7)).toEqual([]);
  });
});

describe("parseResult", () => {
  it("reads numbers, with or without a unit", () => {
    expect(parseResult("12")).toEqual({ value: 12, clock: false });
    expect(parseResult(" +7.5 ")).toEqual({ value: 7.5, clock: false });
    expect(parseResult("12,5")).toEqual({ value: 12.5, clock: false });
    expect(parseResult("10 kg")).toEqual({ value: 10, clock: false });
    expect(parseResult("45s")).toEqual({ value: 45, clock: false });
    expect(parseResult("-5")).toEqual({ value: -5, clock: false });
  });

  it("reads times as seconds", () => {
    expect(parseResult("24:30")).toEqual({ value: 1470, clock: true });
    expect(parseResult("1:02:15")).toEqual({ value: 3735, clock: true });
  });

  it("leaves grades and text alone", () => {
    for (const s of ["7a+", "V5", "6b", "", "lots", "1:75"]) expect(parseResult(s)).toBeNull();
  });

  it("formats times back", () => {
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(1470)).toBe("24:30");
    expect(formatClock(3735)).toBe("1:02:15");
  });
});

describe("benchmarkSeries", () => {
  let id = 0;
  const row = (date: string, name: string, value: string, unit: string | null = null) => ({ id: ++id, date, name, value, unit });

  it("groups by name case- and space-insensitively, newest spelling and unit win", () => {
    const series = benchmarkSeries([
      row("2026-03-01", "max pull-ups", "8", null),
      row("2026-03-15", "Max  Pull-ups ", "10", "reps"),
      row("2026-03-08", "Max pull-ups", "9", "reps"),
      row("2026-03-10", "Max hang 20mm 10s", "+5", "kg added"),
    ]);
    expect(series.map((s) => s.name)).toEqual(["Max  Pull-ups", "Max hang 20mm 10s"]); // most recently tested first
    const pullups = series[0];
    expect(pullups.unit).toBe("reps");
    expect(pullups.points.map((p) => [p.date, p.value])).toEqual([
      ["2026-03-01", 8],
      ["2026-03-08", 9],
      ["2026-03-15", 10],
    ]);
    expect(pullups.rows.map((r) => r.value)).toEqual(["10", "9", "8"]);
    expect(pullups.skipped).toBe(0);
  });

  it("keeps same-day results in the order they were logged", () => {
    const [s] = benchmarkSeries([row("2026-03-01", "Plank", "60"), row("2026-03-01", "Plank", "75")]);
    expect(s.points.map((p) => p.value)).toEqual([60, 75]);
  });

  it("charts times as times and skips results it can't read", () => {
    const [run] = benchmarkSeries([row("2026-03-01", "5 km run", "26:10", "min"), row("2026-03-20", "5 km run", "25:05", "min"), row("2026-03-10", "5 km run", "dnf")]);
    expect(run.clock).toBe(true);
    expect(run.points.map((p) => p.label)).toEqual(["26:10", "25:05"]);
    expect(run.skipped).toBe(1);
    const [grades] = benchmarkSeries([row("2026-03-01", "Hardest boulder", "6c"), row("2026-03-08", "Hardest boulder", "7a")]);
    expect(grades.points).toEqual([]);
    expect(grades.skipped).toBe(2);
  });
});

describe("niceTicks", () => {
  it("spans the data with round steps", () => {
    expect(niceTicks(71.3, 74.8)).toEqual([70, 72, 74, 76]);
    expect(niceTicks(71.3, 73.9)).toEqual([71, 72, 73, 74]);
    expect(niceTicks(0, 100)).toEqual([0, 50, 100]);
    expect(niceTicks(3, 17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(0.2, 0.9)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("pads a flat series so it sits mid-chart", () => {
    const t = niceTicks(12, 12);
    expect(t[0]).toBeLessThan(12);
    expect(t.at(-1)).toBeGreaterThan(12);
    const w = niceTicks(72, 72);
    expect(w[0]).toBeLessThan(72);
    expect(w.at(-1)).toBeGreaterThan(72);
  });

  it("uses whole clock steps for times", () => {
    expect(niceTicks(25 * 60 + 30, 27 * 60 + 40, 4, true)).toEqual([1500, 1560, 1620, 1680]); // 25:00 .. 28:00
    expect(niceTicks(40, 95, 4, true)).toEqual([30, 60, 90, 120]);
  });

  it("copes with reversed or non-finite input", () => {
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
    expect(niceTicks(NaN, 1)).toEqual([0, 1]);
  });
});

describe("baselineNote", () => {
  it("labels the first 4 weeks and stays quiet after", () => {
    expect(baselineNote({ history_days: 0, baseline_status: "building" })).toMatch(/^Building baseline \(0\/28 days\)/);
    expect(baselineNote({ history_days: 20, baseline_status: "partial" })).toMatch(/^Provisional baseline \(20\/28 days\)/);
    expect(baselineNote({ history_days: 35, baseline_status: "ok" })).toBeNull();
  });
});
