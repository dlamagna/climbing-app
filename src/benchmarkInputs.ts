// The benchmark inputs shown below the session form (issue #22): one per test the plan expects on the
// session's date, plus any result the session already has (editing, or after moving it to another date).

import type { ExpectedBenchmark, PlanEntry, SessionBenchmark } from "./types";

export interface BenchmarkInput {
  name: string;
  unit: string | null;
  value: string; // "" = not done
}

// Same matching as the server (worker/benchmarks.ts): case- and space-insensitive.
export const benchmarkKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

// values holds what was typed, by benchmarkKey; untouched inputs start from the session's saved result.
export function benchmarkInputs(
  plan: PlanEntry[],
  date: string,
  saved: SessionBenchmark[],
  values: Record<string, string>,
): BenchmarkInput[] {
  const expected: (ExpectedBenchmark | SessionBenchmark)[] = plan
    .filter((p) => p.date === date)
    .flatMap((p) => p.expected_benchmarks ?? []);
  const seen = new Set<string>();
  const out: BenchmarkInput[] = [];
  for (const b of [...expected, ...saved]) {
    const key = benchmarkKey(b.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const savedValue = saved.find((s) => benchmarkKey(s.name) === key)?.value ?? "";
    out.push({ name: b.name, unit: b.unit, value: values[key] ?? savedValue });
  }
  return out;
}

// What goes in the session body: every input shown, empty ones too (the server skips them, and removes a
// result the session had for that test). undefined when there are none, which leaves results untouched.
export function benchmarkBody(inputs: BenchmarkInput[]) {
  return inputs.length ? inputs.map((b) => ({ name: b.name, unit: b.unit, value: b.value.trim() })) : undefined;
}

// "Max pull-ups (reps), Plank (s)" for the Today plan card.
export function testsLabel(plan: PlanEntry[]): string {
  const seen = new Set<string>();
  return plan
    .flatMap((p) => p.expected_benchmarks ?? [])
    .filter((b) => !seen.has(benchmarkKey(b.name)) && seen.add(benchmarkKey(b.name)))
    .map((b) => `${b.name} (${b.unit})`)
    .join(", ");
}
