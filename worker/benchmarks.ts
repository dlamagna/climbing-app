// Expected benchmarks on plan entries (issue #22): validation, storage encoding, results entered with a
// session, and which planned tests were missed. Pure functions; db.ts and mcp.ts only wire them up.

export interface ExpectedBenchmark {
  name: string;
  unit: string;
}

export const MAX_EXPECTED = 10;
const MAX_NAME = 80;
const MAX_UNIT = 30;

// Names match case- and space-insensitively ("Max pull-ups" == "max  pull-ups"), so a result logged by hand
// on the Benchmarks page still counts for the planned test.
export const benchmarkKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

// Validates the expected_benchmarks of one plan entry (from set_plan or the app). Throws with a message
// meant for the caller. Missing / null / [] all mean "no tests". Duplicate names are dropped (first wins).
export function parseExpectedBenchmarks(input: unknown): ExpectedBenchmark[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("expected_benchmarks must be a list of {name, unit}");
  const out: ExpectedBenchmark[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const name = typeof item?.name === "string" ? tidy(item.name) : "";
    const unit = typeof item?.unit === "string" ? tidy(item.unit) : "";
    if (!name) throw new Error("each expected benchmark needs a name");
    if (!unit) throw new Error(`expected benchmark "${name}" needs a unit (e.g. 'reps', 'kg added', 's', 'grade')`);
    if (name.length > MAX_NAME || unit.length > MAX_UNIT) {
      throw new Error(`expected benchmark "${name.slice(0, MAX_NAME)}": name max ${MAX_NAME} characters, unit max ${MAX_UNIT}`);
    }
    const key = benchmarkKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, unit });
  }
  if (out.length > MAX_EXPECTED) throw new Error(`at most ${MAX_EXPECTED} expected benchmarks per plan entry`);
  return out;
}

// plan.expected_benchmarks column: JSON, NULL when there are none.
export const encodeExpected = (list: ExpectedBenchmark[]): string | null => (list.length ? JSON.stringify(list) : null);

// Lenient read of the stored column: anything unreadable counts as no tests rather than breaking a page.
export function decodeExpected(stored: unknown): ExpectedBenchmark[] {
  if (typeof stored !== "string" || !stored) return [];
  try {
    return parseExpectedBenchmarks(JSON.parse(stored));
  } catch {
    return [];
  }
}

export interface BenchmarkResult {
  name: string;
  unit: string | null;
  value: string;
}

// Results sent with a session from the Log page: one input per test shown. A filled-in value is saved
// (upserted per session + name); an empty one means "not done", which also removes a result the session
// had before (cleared while editing). Duplicate names: the first one wins.
export function sessionBenchmarkWrites(input: unknown): { save: BenchmarkResult[]; clear: string[] } {
  if (input === undefined || input === null) return { save: [], clear: [] };
  if (!Array.isArray(input)) throw new Error("benchmarks must be a list of {name, unit, value}");
  const save: BenchmarkResult[] = [];
  const clear: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const name = typeof item?.name === "string" ? tidy(item.name) : "";
    if (!name) throw new Error("each benchmark needs a name");
    const key = benchmarkKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const value = item.value === undefined || item.value === null ? "" : String(item.value).trim();
    const unit = typeof item.unit === "string" && item.unit.trim() ? tidy(item.unit) : null;
    if (value) save.push({ name, unit, value });
    else clear.push(name);
  }
  return { save, clear };
}

export interface MissingBenchmark {
  date: string;
  name: string;
  unit: string;
  plan_title: string;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Planned tests from the `days` days before today (today itself isn't missed yet) with no result of the
// same name logged on the planned day or later, up to today: a test done a day late counts as done.
export function missingBenchmarks(
  plan: { date: string; title: string; expected_benchmarks: ExpectedBenchmark[] }[],
  logged: { date: string; name: string }[],
  today: string,
  days = 7,
): MissingBenchmark[] {
  const from = addDays(today, -days);
  const missing: MissingBenchmark[] = [];
  const seen = new Set<string>();
  for (const entry of [...plan].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.date < from || entry.date >= today) continue;
    for (const b of entry.expected_benchmarks) {
      const key = benchmarkKey(b.name);
      const id = `${entry.date}|${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const done = logged.some((l) => benchmarkKey(l.name) === key && l.date >= entry.date && l.date <= today);
      if (!done) missing.push({ date: entry.date, name: b.name, unit: b.unit, plan_title: entry.title });
    }
  }
  return missing;
}
