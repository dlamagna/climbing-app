// App side of the grade table and grade-progress chart (#60): every session's grade, and labels for a
// ladder index. The conversion itself is in worker/grades.ts.
import { useApi } from "./api";
import { localToday } from "./dates";
import type { Session } from "./types";
import { type Discipline, type GradeSystem, LADDERS, SYSTEM_NAMES, gradeLabels } from "../worker/grades";

export const DISCIPLINE_NAMES: Record<Discipline, string> = { boulder: "Boulders", route: "Routes" };

// Short system names for chips and table headers ("5.x" is how YDS is usually recognised).
export const SYSTEM_SHORT: Record<GradeSystem, string> = { ...SYSTEM_NAMES, yds: "YDS (5.x)" };

// Every logged session, for grades. Sessions are small rows, so the whole history is one request.
export function useAllSessions() {
  const today = localToday();
  const { data, error } = useApi<{ sessions: Session[] }>(`/history?from=2000-01-01&to=${today}&only=sessions`);
  return { sessions: data?.sessions ?? null, error, today };
}

// The grade at an index in one system, "" off the ladder.
export const gradeIn = (d: Discipline, index: number, system: GradeSystem) => gradeLabels(d, index)[system] ?? "";

// Both systems of the discipline, `first` first: "V5 · Font 6C/6C+", "6c · 5.11a".
export function bothGrades(d: Discipline, index: number, first: GradeSystem = LADDERS[d].finer): string {
  const { finer, coarser } = LADDERS[d];
  const second = first === finer ? coarser : finer;
  return `${gradeIn(d, index, first)} · ${gradeIn(d, index, second)}`;
}
