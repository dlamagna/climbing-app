import type { PlanConflict, PlanStatus } from "../worker/plan";
import type { Readiness } from "../worker/readiness";
import type { WeekSummaryView } from "../worker/weekSummary";

export type { PlanConflict, PlanStatus, Readiness };

export interface Checkin {
  date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  feeling: number | null;
  drinks: number | null;
  protein: "low" | "ok" | "high" | null;
  weight_kg: number | null;
  note: string | null;
}

export interface Session {
  id: number;
  date: string;
  type: string;
  duration_min: number;
  rpe: number;
  max_grade: string | null;
  notes: string | null;
  tags?: string | null; // comma-separated style tags, see worker/tags.ts
  outdoor?: number | null; // 1 = outdoors (climbing types only); missing in older cached responses = indoors
  gym?: string | null; // where it was done (#48)
  updated_at?: string | null; // set once edited
  benchmarks?: SessionBenchmark[]; // results entered with it (GET /sessions/:id only)
}

export interface ExpectedBenchmark {
  name: string;
  unit: string;
}

export interface SessionBenchmark {
  name: string;
  value: string;
  unit: string | null;
}

export interface HangLog {
  id: number;
  date: string;
  preset: string;
  on_s: number;
  off_s: number;
  reps: number;
  sets: number;
  set_rest_s: number;
  completed_reps: number;
  edge_mm: number | null;
  grip: string | null;
  added_kg: number | null;
  warmup?: number | null; // 1 = a warm-up for that day's climbing, no session of its own (#50)
}

export interface Preset {
  id?: number;
  name: string;
  prep_s: number;
  on_s: number;
  off_s: number;
  reps: number;
  sets: number;
  set_rest_s: number;
  edge_mm: number | null;
  grip: string | null;
  added_kg: number | null;
  notes: string | null;
  sort?: number;
}

export type Trend = "better" | "same" | "worse" | "gone";
export type RedFlag = "swelling" | "numbness" | "night_pain";

export interface InjuryUpdate {
  date: string;
  pain: number;
  trend: Trend | null;
  stiffness: number | null;
  red_flags: string | null; // comma-separated RedFlag values
  note: string | null;
}

export interface Injury {
  id: number;
  body_part: string;
  side: string | null;
  description: string | null;
  started_on: string;
  resolved_on: string | null;
  session_id?: number | null;
  session_type?: string | null;
  session_date?: string | null;
  updates?: InjuryUpdate[]; // newest first
}

export interface PlanEntry {
  id: number;
  date: string;
  title: string;
  type: string | null;
  intensity: string | null;
  details: string | null;
  duration_min?: number | null;
  // Derived by the server (worker/plan.ts); missing in responses cached by older app versions.
  status?: PlanStatus;
  auto_status?: PlanStatus;
  status_override?: PlanStatus | null;
  session_id?: number | null;
  flags?: PlanConflict[];
  expected_benchmarks?: ExpectedBenchmark[]; // tests planned that day ([] when none)
}

export interface CoachNote {
  id: number;
  date: string;
  text: string;
}

// Questions the daily coach review asks (worker/coach.ts); the Today screen shows the open ones.
export interface CoachQuestion {
  id: number;
  question: string;
  why: string | null;
  options: string[]; // [] = free text
  allow_text: number; // 1 = a typed answer is allowed besides the chips
  expires_on: string | null;
  status: "open" | "answered" | "skipped" | "expired" | "closed";
}

export interface CoachRun {
  id: number;
  outcome: "updated" | "no_change";
  summary: string | null;
  changes: string[];
  created_at: string; // UTC timestamp
}

export interface AppFeedback {
  id: number;
  text: string;
  status: "new" | "filed" | "duplicate" | "declined";
  issue_number: number | null;
  issue_url: string | null;
  reply: string | null;
  created_at: string; // UTC timestamp
}

export interface WeekLoad {
  week_start: string;
  total: number;
  finger: number; // weighted by type and style tags
  finger_raw: number; // unweighted
  sessions: number;
}

export interface LoadStats {
  last7: { total: number; finger: number; finger_raw: number };
  prev28_weekly_avg: { total: number; finger: number; finger_raw: number };
  ratio_total: number | null;
  ratio_finger: number | null;
  history_days: number; // days from the first logged session to today, inclusive
  baseline_status: "building" | "partial" | "ok"; // < 14 days: no ratio; 14-27: provisional; 28+: ok
  ratio_provisional: boolean;
  weeks: WeekLoad[];
}

export interface TodayView {
  today: string;
  checkin: Checkin | null;
  last_checkin: Checkin | null;
  plan: PlanEntry[]; // Monday of this week to 6 days ahead
  plan_conflicts?: PlanConflict[];
  coach_notes: CoachNote[];
  sessions: Session[];
  injuries: Injury[];
  load: LoadStats;
  readiness?: Readiness; // computed by the worker (worker/readiness.ts); missing in older cached responses
  week?: WeekSummaryView; // this week so far (worker/weekSummary.ts); missing in older cached responses
  coach_questions?: CoachQuestion[]; // open questions from the daily review; missing in older cached responses
  coach_update?: CoachRun | null; // the last review that changed something
}

export interface HistoryView {
  sessions: Session[];
  checkins: Checkin[];
  hangs: HangLog[];
  load: LoadStats;
}

export interface Benchmark {
  id: number;
  date: string;
  name: string;
  value: string;
  unit: string | null;
  notes: string | null;
}

export const SESSION_TYPES = [
  { value: "boulder", label: "Boulder" },
  { value: "board", label: "Board" },
  { value: "lead", label: "Lead" },
  { value: "toprope", label: "Top rope" },
  { value: "hangboard", label: "Hangboard" },
  { value: "strength", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "mobility", label: "Mobility" },
  { value: "other", label: "Other" },
];

export const typeLabel = (t: string | null) => SESSION_TYPES.find((s) => s.value === t)?.label ?? t ?? "";

// Groups for the History calendar and mix (rope / boulder / fingers / other); defined once in worker/typeGroups.ts.
export { TYPE_GROUPS, type GroupKey, groupOf, groupInfo } from "../worker/typeGroups";
