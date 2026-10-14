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
  updated_at?: string | null; // set once edited
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

export interface Injury {
  id: number;
  body_part: string;
  side: string | null;
  description: string | null;
  started_on: string;
  resolved_on: string | null;
  updates?: { date: string; pain: number; note: string | null }[];
}

export interface PlanEntry {
  id: number;
  date: string;
  title: string;
  type: string | null;
  intensity: string | null;
  details: string | null;
}

export interface CoachNote {
  id: number;
  date: string;
  text: string;
}

export interface WeekLoad {
  week_start: string;
  total: number;
  finger: number;
  sessions: number;
}

export interface LoadStats {
  last7: { total: number; finger: number };
  prev28_weekly_avg: { total: number; finger: number };
  ratio_total: number | null;
  ratio_finger: number | null;
  weeks: WeekLoad[];
}

export interface TodayView {
  today: string;
  checkin: Checkin | null;
  last_checkin: Checkin | null;
  plan: PlanEntry[];
  coach_notes: CoachNote[];
  sessions: Session[];
  injuries: Injury[];
  load: LoadStats;
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
  { value: "lead", label: "Lead / top rope" },
  { value: "hangboard", label: "Hangboard" },
  { value: "strength", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "mobility", label: "Mobility" },
  { value: "other", label: "Other" },
];

export const typeLabel = (t: string | null) => SESSION_TYPES.find((s) => s.value === t)?.label ?? t ?? "";
