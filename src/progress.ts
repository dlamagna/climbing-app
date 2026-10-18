// Progress charts (issue #8): benchmark series and bodyweight trend. Pure functions; the Benchmarks page and
// components/LineChart.tsx only draw what these return.

import { benchmarkKey } from "./benchmarkInputs";

export interface Point {
  date: string; // YYYY-MM-DD
  value: number;
  label?: string; // what to show for the value, when not just the number (e.g. the result as typed)
}

// Whole days since the epoch, for calendar maths that ignores DST and the phone's timezone.
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

// ---- Benchmark results -------------------------------------------------------------------------------------

export interface ParsedResult {
  value: number;
  clock: boolean; // typed as a time (m:ss or h:mm:ss); value is in seconds
}

const NUMBER = /^([+-]?\d+(?:[.,]\d+)?)\s*(kg|lbs?|s|secs?|min|mins|reps?|m|km|%)?$/i;
const CLOCK = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/;

// A result is free text. Chartable: plain numbers ("12", "+7.5", "12,5", "10 kg", "45s") and times
// ("24:30", "1:02:15"). Not chartable: grades ("7a+", "V5") and anything else, which stay in the list only.
export function parseResult(raw: string): ParsedResult | null {
  const s = raw.trim();
  const n = NUMBER.exec(s);
  if (n) return { value: Number(n[1].replace(",", ".")), clock: false };
  const c = CLOCK.exec(s);
  if (c) {
    const [a, b, d] = [Number(c[1]), Number(c[2]), c[3] === undefined ? null : Number(c[3])];
    return { value: d === null ? a * 60 + b : a * 3600 + b * 60 + d, clock: true };
  }
  return null;
}

// 90 -> "1:30", 3735 -> "1:02:15"
export function formatClock(seconds: number): string {
  const t = Math.round(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export interface BenchmarkRow {
  id: number;
  date: string;
  name: string;
  value: string;
  unit: string | null;
}

export interface BenchmarkSeries<R extends BenchmarkRow = BenchmarkRow> {
  key: string; // benchmarkKey(name)
  name: string; // spelling of the most recent result
  unit: string | null; // unit of the most recent result that has one
  clock: boolean; // values are times in seconds
  points: Point[]; // chartable results, oldest first
  rows: R[]; // every result, newest first (the list under the chart)
  skipped: number; // results that couldn't be charted (grades, text)
}

// One series per test, matched like the server does (case- and space-insensitive), most recently tested first.
// A time series is charted from its times only; a number series from its numbers only.
export function benchmarkSeries<R extends BenchmarkRow>(rows: R[]): BenchmarkSeries<R>[] {
  const newestFirst = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const groups = new Map<string, R[]>();
  for (const r of newestFirst) {
    const key = benchmarkKey(r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([key, group]) => {
    const parsed = group.map((r) => ({ r, p: parseResult(r.value) }));
    const clocks = parsed.filter((x) => x.p?.clock).length;
    const numbers = parsed.filter((x) => x.p && !x.p.clock).length;
    const clock = clocks > numbers;
    const points = parsed
      .filter((x) => x.p && x.p.clock === clock)
      .map(({ r, p }) => ({ date: r.date, value: p!.value, label: r.value.trim() }))
      .reverse();
    return {
      key,
      name: group[0].name.trim(),
      unit: group.find((r) => r.unit?.trim())?.unit?.trim() ?? null,
      clock,
      points,
      rows: group,
      skipped: group.length - points.length,
    };
  });
}

// ---- Bodyweight ----------------------------------------------------------------------------------------------

// Trailing average per weigh-in: the mean of the weigh-ins present in the `days` calendar days ending that day
// (missed days are simply absent, not zeros). One output point per input date, oldest first; unsorted input
// is fine, and a date given twice uses its last value.
export function rollingAverage(points: Point[], days = 7): Point[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, p.value);
  const sorted = [...byDay].map(([date, value]) => ({ date, value, day: dayNumber(date) })).sort(byDate);
  let start = 0;
  let sum = 0;
  return sorted.map((p, i) => {
    sum += p.value;
    while (sorted[start].day <= p.day - days) sum -= sorted[start++].value;
    return { date: p.date, value: sum / (i - start + 1) };
  });
}

// Splits a date-sorted line where consecutive points are more than `maxGapDays` apart, so a long break in
// weigh-ins shows as a break in the line instead of a straight bridge across it.
export function splitOnGaps(points: Point[], maxGapDays: number): Point[][] {
  const out: Point[][] = [];
  for (const p of points) {
    const last = out.at(-1)?.at(-1);
    if (last && dayNumber(p.date) - dayNumber(last.date) <= maxGapDays) out.at(-1)!.push(p);
    else out.push([p]);
  }
  return out;
}

// ---- Axis ----------------------------------------------------------------------------------------------------

// Clock-friendly steps for times in seconds: 5 s .. 1 h.
const CLOCK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

// Round y ticks spanning the data: about `count` of them at 1/2/2.5/5 x 10^n steps (or whole clock steps for
// times in seconds). A flat series gets a band around its value so the line sits mid-chart instead of on an edge.
export function niceTicks(min: number, max: number, count = 4, clock = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = Math.abs(min) >= 10 ? Math.abs(min) * 0.05 : 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = (clock ? CLOCK_STEPS.find((s) => s >= raw) : undefined) ?? [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step / 1e6; i++) ticks.push(Number((lo + i * step).toFixed(10)));
  return ticks;
}

// ---- Load baseline (issue #24) ---------------------------------------------------------------------------------

// Annotation for the weekly load chart while there's under 4 weeks of history, so early weeks aren't over-read.
// null once the baseline is established.
export function baselineNote(load: { history_days: number; baseline_status: "building" | "partial" | "ok" }): string | null {
  const days = `${Math.min(load.history_days, 28)}/28 days`;
  if (load.baseline_status === "building") return `Building baseline (${days}): early weeks aren't comparable yet.`;
  if (load.baseline_status === "partial") return `Provisional baseline (${days}): treat week-to-week changes as rough.`;
  return null;
}
