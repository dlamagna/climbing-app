// Grade conversion (#60): sessions.max_grade is free text in whatever system the gym uses ("6C", "V5",
// "7a+", "5.11b", "6b/6b+"). This parses it and puts it on one ladder per discipline so grades compare
// and sort whatever system they were logged in. Pure (no DOM, no D1) so the app's Log page can import it;
// derived at read time like plan statuses, nothing is stored. Unit tested in grades.test.ts.
//
// Two disciplines, never converted into each other: boulder (Font <-> V) and route (French <-> YDS).
// A boulder grade and a route grade measure different things (one hard move vs sustained climbing), so
// there is no index that compares a 7A boulder with a 7a route.

import { addDays } from "./load";
import { groupOf } from "./typeGroups";

export type Discipline = "boulder" | "route";
export type GradeSystem = "font" | "v" | "french" | "yds";

// --- The tables, all conventions in one place --------------------------------------------------------
// Each ladder has one rung per grade of its finer system (Font for boulders, French for routes), with the
// coarser system's grade(s) for that rung. Standard published equivalences; where the systems don't map
// 1:1 the conventions are:
//   - V has fewer steps than Font: one V grade covers several Font rungs (V3 = 6A/6A+, V4 = 6B/6B+,
//     V5 = 6C/6C+, V8 = 7B/7B+, V0 = 4/4+). A V grade sits at the middle of the rungs it covers (V8 is
//     half way between 7B and 7B+), so its index can end in .5.
//   - Around 6c+ YDS has more steps than French: 6c+ covers 5.11b and 5.11c (both parse to 6c+), and
//     5.7 covers 4c/5a (index between the two).
//   - V grades with a + or - ("V4+") are read as the plain V grade, as are YDS grades below 5.10 ("5.9+").
//   - A YDS grade with no letter is the middle of its a-d range ("5.11" = 6c+); "5.10-" is a/b, "5.10+" c/d.
//   - French grades below 6a without a letter, as many gyms write them: "5-" = 5a, "5" = 5b, "5+" = 5c
//     (same for 4).
type Rung = readonly [finer: string, coarser: readonly string[]];

const BOULDER: readonly Rung[] = [
  ["3", ["VB"]],
  ["4", ["V0"]],
  ["4+", ["V0"]],
  ["5", ["V1"]],
  ["5+", ["V2"]],
  ["6A", ["V3"]],
  ["6A+", ["V3"]],
  ["6B", ["V4"]],
  ["6B+", ["V4"]],
  ["6C", ["V5"]],
  ["6C+", ["V5"]],
  ["7A", ["V6"]],
  ["7A+", ["V7"]],
  ["7B", ["V8"]],
  ["7B+", ["V8"]],
  ["7C", ["V9"]],
  ["7C+", ["V10"]],
  ["8A", ["V11"]],
  ["8A+", ["V12"]],
  ["8B", ["V13"]],
  ["8B+", ["V14"]],
  ["8C", ["V15"]],
  ["8C+", ["V16"]],
  ["9A", ["V17"]],
];

const ROUTE: readonly Rung[] = [
  ["3", ["5.4"]],
  ["4a", ["5.5"]],
  ["4b", ["5.6"]],
  ["4c", ["5.7"]],
  ["5a", ["5.7"]],
  ["5b", ["5.8"]],
  ["5c", ["5.9"]],
  ["6a", ["5.10a"]],
  ["6a+", ["5.10b"]],
  ["6b", ["5.10c"]],
  ["6b+", ["5.10d"]],
  ["6c", ["5.11a"]],
  ["6c+", ["5.11b", "5.11c"]],
  ["7a", ["5.11d"]],
  ["7a+", ["5.12a"]],
  ["7b", ["5.12b"]],
  ["7b+", ["5.12c"]],
  ["7c", ["5.12d"]],
  ["7c+", ["5.13a"]],
  ["8a", ["5.13b"]],
  ["8a+", ["5.13c"]],
  ["8b", ["5.13d"]],
  ["8b+", ["5.14a"]],
  ["8c", ["5.14b"]],
  ["8c+", ["5.14c"]],
  ["9a", ["5.14d"]],
  ["9a+", ["5.15a"]],
  ["9b", ["5.15b"]],
  ["9b+", ["5.15c"]],
  ["9c", ["5.15d"]],
];

export const LADDERS: Record<Discipline, { finer: GradeSystem; coarser: GradeSystem; rungs: readonly Rung[] }> = {
  boulder: { finer: "font", coarser: "v", rungs: BOULDER },
  route: { finer: "french", coarser: "yds", rungs: ROUTE },
};

export const SYSTEM_NAMES: Record<GradeSystem, string> = { font: "Font", v: "V", french: "French", yds: "YDS" };

// --- Index and labels ---------------------------------------------------------------------------------

// Rounded to the nearest half step (a half step is "between two rungs"); halves round up, to the harder side.
const toHalf = (x: number) => Math.round(x * 2) / 2;

function finerIndex(d: Discipline, label: string): number | null {
  const i = LADDERS[d].rungs.findIndex((r) => r[0] === label);
  return i < 0 ? null : i;
}

// A coarser grade covering several rungs sits at their middle.
function coarserIndex(d: Discipline, label: string): number | null {
  const hits = LADDERS[d].rungs.flatMap((r, i) => (r[1].includes(label) ? [i] : []));
  return hits.length ? toHalf((hits[0] + hits[hits.length - 1]) / 2) : null;
}

// "V4/5", "5.11b/c": how gyms write a coarser grade spanning two values. Font/French stay in full ("6B+/6C").
function joinCoarser(system: GradeSystem, labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (system === "v" && !labels.includes("VB")) return `V${labels.map((l) => l.slice(1)).join("/")}`;
  const base = labels[0].replace(/[a-d]$/, "");
  if (system === "yds" && labels.every((l) => /[a-d]$/.test(l) && l.slice(0, -1) === base)) {
    return base + labels.map((l) => l.slice(-1)).join("/");
  }
  return labels.join("/");
}

// The grade at an index in both systems of the discipline; a half index shows the two rungs it sits between.
export function gradeLabels(d: Discipline, index: number): Partial<Record<GradeSystem, string>> {
  const { finer, coarser, rungs } = LADDERS[d];
  const lo = rungs[Math.floor(index)];
  const hi = rungs[Math.ceil(index)];
  if (!lo || !hi) return {};
  return {
    [finer]: lo === hi ? lo[0] : `${lo[0]}/${hi[0]}`,
    [coarser]: joinCoarser(coarser, [...new Set([...lo[1], ...hi[1]])]),
  };
}

// --- Parsing ------------------------------------------------------------------------------------------

export interface Grade {
  discipline: Discipline;
  system: GradeSystem; // the system it was written in
  index: number; // position on the discipline's ladder (0 = easiest; .5 = between two rungs), for comparing
  font?: string; // the same grade in each system of its discipline
  v?: string;
  french?: string;
  yds?: string;
}

// A session type (boulder/board = boulder, lead/toprope = route, via worker/typeGroups.ts) or a discipline
// name tells "6c" (Font on a boulder session) from "6c" (French on a lead session). Other types say nothing.
export function disciplineOf(context: unknown): Discipline | null {
  if (context === "route") return "route";
  if (typeof context !== "string") return null;
  const group = groupOf(context);
  return group === "rope" ? "route" : group === "boulder" ? "boulder" : null;
}

type Parsed = { discipline: Discipline; system: GradeSystem; index: number };

// One grade, no slash. `raw` keeps its case: with no context, an uppercase letter means Font ("6C") and a
// lowercase one French ("6c"), the usual way of writing them. A V or YDS grade names its own discipline,
// whatever the session type.
function parseOne(raw: string, context: Discipline | null): Parsed | null {
  const t = raw.toLowerCase();

  const v = /^v(b|\d{1,2})[+-]?$/.exec(t);
  if (v) {
    const index = coarserIndex("boulder", v[1] === "b" ? "VB" : `V${Number(v[1])}`);
    return index === null ? null : { discipline: "boulder", system: "v", index };
  }

  const yds = /^5\.(\d{1,2})([a-d])?([+-])?$/.exec(t);
  if (yds) {
    const n = Number(yds[1]);
    const letters = n < 10 ? [""] : yds[2] ? [yds[2]] : yds[3] === "-" ? ["a", "b"] : yds[3] === "+" ? ["c", "d"] : ["a", "b", "c", "d"];
    if (n < 10 && yds[2]) return null;
    const hits = letters.map((l) => coarserIndex("route", `5.${n}${l}`));
    if (hits.some((i) => i === null)) return null;
    const idx = hits as number[];
    return { discipline: "route", system: "yds", index: toHalf((Math.min(...idx) + Math.max(...idx)) / 2) };
  }

  const fr = /^([3-9])([a-c])?([+-])?$/.exec(t);
  if (fr) {
    const [, digit, letter, mod = ""] = fr;
    const discipline = context ?? (letter ? (/[A-C]/.test(raw) ? "boulder" : "route") : null);
    if (discipline === "boulder") {
      const index = finerIndex("boulder", `${digit}${letter ? letter.toUpperCase() : ""}${mod}`);
      return index === null ? null : { discipline, system: "font", index };
    }
    if (discipline === "route") {
      const label =
        letter || (digit !== "4" && digit !== "5")
          ? `${digit}${letter ?? ""}${mod}`
          : `${digit}${mod === "-" ? "a" : mod === "+" ? "c" : "b"}`;
      const index = finerIndex("route", label);
      return index === null ? null : { discipline, system: "french", index };
    }
  }
  return null;
}

// The second half of a slash grade written in short: "V4/5", "5.11b/c", "6b/+", "6A/B".
function expandShort(first: string, system: GradeSystem, part: string): string {
  if (system === "v" && /^\d+$/.test(part)) return `v${part}`;
  if (system === "yds" && /^[a-d]$/i.test(part)) return first.replace(/[a-d]$/i, "") + part;
  if ((system === "font" || system === "french") && part === "+") return `${first}+`;
  if ((system === "font" || system === "french") && /^[a-c]\+?$/i.test(part)) return first[0] + part;
  return part;
}

// Parses a free-text grade; null for text it can't read ("project", "flash") or that is ambiguous
// without context ("5+" with no session type). `context` is the session type or "boulder" / "route".
// Slash grades ("6b/6b+", "V4/5") take the midpoint of the two, rounded up to a half step: a grade
// between two rungs, not the harder one. Both halves must be the same discipline.
export function parseGrade(text: unknown, context?: unknown): Grade | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, "");
  if (!t) return null;
  const parts = t.split("/");
  if (parts.length > 2) return null;
  const ctx = disciplineOf(context);
  const first = parseOne(parts[0], ctx);
  if (!first) return null;
  let index = first.index;
  if (parts.length === 2) {
    const second = parseOne(expandShort(parts[0], first.system, parts[1]), ctx ?? first.discipline);
    if (!second || second.discipline !== first.discipline) return null;
    index = toHalf((first.index + second.index) / 2);
  }
  return { discipline: first.discipline, system: first.system, index, ...gradeLabels(first.discipline, index) };
}

// The Log page's hint, e.g. "Font 6C = V5", "V5 = Font 6C/6C+", "French 6c+ = YDS 5.11b/c".
export function gradeHint(g: Grade): string {
  const { finer, coarser } = LADDERS[g.discipline];
  const other = g.system === finer ? coarser : finer;
  const named = (s: GradeSystem) => (s === "v" ? g[s]! : `${SYSTEM_NAMES[s]} ${g[s]}`);
  return `${named(g.system)} = ${named(other)}`;
}

// --- Progress -----------------------------------------------------------------------------------------

export interface GradedSession {
  date: string;
  type: string;
  max_grade: string | null;
}

export type BestGrade = { date: string; index: number } & Partial<Record<GradeSystem, string>>;

export interface GradeProgress {
  last_28_days: BestGrade | null;
  previous_28_days: BestGrade | null; // the 28 days before those
  best_ever: BestGrade;
  change: number | null; // last_28_days vs previous_28_days in ladder steps (+ = harder); null if either is missing
}

// get_overview's grade_progress: per discipline, the hardest readable max_grade in the last 28 days (ending
// today), the 28 before and ever; ties go to the most recent session. Disciplines with no readable grade
// are left out. Sessions after today are ignored.
export function gradeProgress(sessions: readonly GradedSession[], today: string): Partial<Record<Discipline, GradeProgress>> {
  const recentFrom = addDays(today, -27);
  const previousFrom = addDays(today, -55);
  type Best = { date: string; index: number } | null;
  const better = (best: Best, s: { date: string; index: number }) =>
    !best || s.index > best.index || (s.index === best.index && s.date > best.date) ? s : best;
  const acc: Partial<Record<Discipline, { recent: Best; previous: Best; ever: Best }>> = {};
  for (const s of sessions) {
    if (s.date > today) continue;
    const g = parseGrade(s.max_grade, s.type);
    if (!g) continue;
    const a = (acc[g.discipline] ??= { recent: null, previous: null, ever: null });
    const hit = { date: s.date, index: g.index };
    a.ever = better(a.ever, hit);
    if (s.date >= recentFrom) a.recent = better(a.recent, hit);
    else if (s.date >= previousFrom) a.previous = better(a.previous, hit);
  }
  const out: Partial<Record<Discipline, GradeProgress>> = {};
  for (const [d, a] of Object.entries(acc) as [Discipline, NonNullable<(typeof acc)[Discipline]>][]) {
    const view = (b: Best): BestGrade | null => b && { ...b, ...gradeLabels(d, b.index) };
    out[d] = {
      last_28_days: view(a.recent),
      previous_28_days: view(a.previous),
      best_ever: view(a.ever)!,
      change: a.recent && a.previous ? a.recent.index - a.previous.index : null,
    };
  }
  return out;
}
