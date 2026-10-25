// Invented demo data: about six weeks of a made-up climber's training, ending yesterday, so every screen
// has something to show. Nothing here comes from real logs. Dates are relative to the visitor's today.

import { addDays, localToday } from "../src/dates";
import type { DemoD1, DemoStatement } from "./d1";

const DAYS = 42;

// Small deterministic PRNG so every fresh demo looks the same (apart from the dates).
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stamp = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString().replace(/\.\d+Z$/, "Z");
const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay(); // 0 = Sunday

const GYMS = ["Northside Boulders", "The Crag Hall"];
const BOULDER = ["6B", "6B+", "6B+", "6C", "6C", "6C+"];
const ROUTE = ["6b", "6b+", "6c", "6c", "6c+", "6c+"];

const BOULDER_NOTES = [
  "Good flow on the new circuit, flashed two 6Bs.",
  "Worked the purple 6C on the cave, one move left.",
  "Volume day, lots of 6A-6B to warm up for the week.",
  "Finally sent the crimpy 6C+ on the slab wall!",
  "Felt heavy, stopped early and stretched.",
];
const LEAD_NOTES = [
  "Pumped on the last two routes, need more endurance.",
  "Clipped everything clean, onsighted a 6c.",
  "Worked the overhanging 6c+, fell at the last clip twice.",
];

interface PlanSlot {
  title: string;
  type: string;
  intensity: string;
  duration_min?: number;
  details: string;
}

// The week the coach keeps writing (Mon = 1). Rest days on the others.
const WEEK: Record<number, PlanSlot> = {
  1: { title: "Limit bouldering", type: "boulder", intensity: "hard", duration_min: 90, details: "Warm up 20 min on easy problems, then 4 projects at your max for 40 min with 3-4 min rests. Finish with 10 min of easy mileage." },
  2: { title: "Max hangs", type: "hangboard", intensity: "moderate", duration_min: 25, details: "Warm-up preset, then Max hangs: 5 x 10 s on 20 mm half crimp, 3 min rest. Add weight only if the last hang still feels clean." },
  3: { title: "Lead endurance", type: "lead", intensity: "moderate", duration_min: 100, details: "6 routes 2 grades below max, rest 5 min between. Then 2 x 4-by-4 on autobelay if the gym allows it." },
  5: { title: "Strength + core", type: "strength", intensity: "moderate", duration_min: 45, details: "Weighted pull-ups 5 x 5, front lever progressions 4 x 8 s, push-ups 3 x 15, antagonists." },
  6: { title: "Bouldering session", type: "boulder", intensity: "hard", duration_min: 120, details: "Long weekend session. Try the board for 20 min after the warm-up, then project." },
};
const REST: PlanSlot = { title: "Rest", type: "rest", intensity: "rest", details: "Walk, mobility, sleep." };

// From today on, the plan the review adjusted for the finger (see the seeded coach note).
const EASED: Record<number, PlanSlot> = {
  1: { ...WEEK[1], title: "Open-hand bouldering", intensity: "moderate", details: "Slopers and pinches only, 6B-6C. No crimps, no board." },
  2: { title: "Abrahangs", type: "hangboard", intensity: "easy", duration_min: 15, details: "10 x 10 s at ~40% effort, feet on. Tendon health, not training." },
  6: { ...WEEK[6], details: "Slab and volume, no board. Stop at pain 2." },
};

export async function seed(db: DemoD1) {
  const r = rng(7);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const today = localToday();
  const start = addDays(today, -DAYS);
  const progress = (i: number) => Math.min(5, Math.floor((i / DAYS) * 6)); // grade ladder over the block
  // The last hangboard day before today had a max hang test planned and done.
  let testDay = addDays(today, -1);
  while (weekday(testDay) !== 2) testDay = addDays(testDay, -1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const stmts: DemoStatement[] = [];
  const sql = (q: string, ...p: unknown[]) => stmts.push(db.prepare(q).bind(...p));

  const profile: Record<string, string> = {
    goal: "Climb a first 7A boulder and be fit for the spring sport trip",
    trip_date: addDays(today, 45),
    trip_details: "Two weeks of limestone sport climbing, mostly 6b-7a, some long days",
    level: "boulder 6C, lead 6c+",
    weekly_availability: "Mon/Wed gym 2h after work, Sat bouldering, hangboard at home on Tue",
    gym_setup: "Hangboard at home (20 mm edge), gym has a board and a spray wall",
    timezone: tz,
  };
  for (const [k, v] of Object.entries(profile)) sql("INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)", k, v, stamp(start, "20:00"));

  // The plan covers the whole block plus the next 10 days, written by the coach.
  let planId = 0;
  const planIds: Record<string, number> = {};
  for (let i = 0; i <= DAYS + 10; i++) {
    const date = addDays(start, i);
    const slot = (date >= today ? EASED[weekday(date)] : undefined) ?? WEEK[weekday(date)] ?? REST;
    const tests = date === testDay ? JSON.stringify([{ name: "Max hang 20mm 10s", unit: "kg added" }]) : null;
    planId++;
    planIds[date] = planId;
    sql(
      `INSERT INTO plan (id, date, title, type, intensity, details, duration_min, expected_benchmarks, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'coach', ?)`,
      planId, date, slot.title, slot.type, slot.intensity, slot.details, slot.duration_min ?? null, tests, stamp(start, "20:00"),
    );
  }

  let sessionId = 0;
  let hangId = 0;
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(start, i);
    const dow = weekday(date);
    const slot = WEEK[dow];
    const p = progress(i);
    const weekend = dow === 0 || dow === 6;

    // Morning check-in most days (a few skipped, like real life).
    if (r() > 0.12) {
      const drinks = dow === 0 || dow === 6 ? pick([0, 0, 1, 2, 3]) : pick([0, 0, 0, 0, 1]);
      sql(
        `INSERT INTO checkins (date, sleep_hours, sleep_quality, feeling, drinks, protein, weight_kg, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        date,
        Math.round((6 + r() * 2.5) * 2) / 2,
        pick([2, 2, 3, 3, 1]),
        pick([3, 3, 4, 4, 5, 2]),
        drinks,
        pick(["ok", "ok", "high", "low"]),
        i % 7 === 0 ? Math.round((71.8 - i * 0.03 + r() * 0.4) * 10) / 10 : null,
        stamp(date, "07:40"),
      );
    }

    if (!slot) {
      if (dow === 4 && r() > 0.5) addSession(date, "mobility", 30, 3, null, null, null, null, false);
      continue;
    }
    if (r() < 0.1 && date !== testDay) continue; // a missed planned session

    const gym = pick(GYMS);
    if (slot.type === "hangboard") {
      const key = `demo-hang-${date}`;
      hangId++;
      const added = 6 + Math.floor(i / 10) * 2;
      sql(
        `INSERT INTO hang_logs (id, date, preset, on_s, off_s, reps, sets, set_rest_s, completed_reps, edge_mm, grip, added_kg, client_id, created_at)
         VALUES (?, ?, 'Max hangs', 10, 180, 5, 1, 0, ?, 20, 'half crimp', ?, ?, ?)`,
        hangId, date, r() > 0.2 ? 5 : 4, added, key, stamp(date, "19:10"),
      );
      addSession(date, "hangboard", 25, 6, null, null, null, `${key}:session`, false);
      if (date === testDay) {
        sql(
          "INSERT INTO benchmarks (date, name, value, unit, session_id, created_at) VALUES (?, 'Max hang 20mm 10s', ?, 'kg added', ?, ?)",
          date, String(added + 2), sessionId, stamp(date, "19:40"),
        );
      }
      continue;
    }
    const outdoor = slot.type === "boulder" && weekend && i > 20 && r() > 0.4;
    const grade = slot.type === "boulder" ? BOULDER[p] : slot.type === "lead" ? ROUTE[p] : null;
    const tags =
      slot.type === "boulder" ? pick(["crimpy,overhang", "overhang,projecting", "slab,technique", "volume", "crimpy,projecting"])
      : slot.type === "lead" ? pick(["vertical,volume", "overhang"]) : null;
    const notes =
      i === DAYS - 6 ? "Ring finger a bit sore after the crimpy problems, stopped early."
      : slot.type === "boulder" && r() > 0.5 ? pick(BOULDER_NOTES)
      : slot.type === "lead" && r() > 0.5 ? pick(LEAD_NOTES)
      : null;
    const duration = (slot.duration_min ?? 60) + Math.round((r() - 0.5) * 30);
    const rpe = Math.min(10, Math.max(4, (slot.intensity === "hard" ? 8 : 6) + Math.round((r() - 0.5) * 2)));
    addSession(date, slot.type, duration, rpe, grade, tags, notes, null, outdoor, outdoor ? null : gym);
  }

  function addSession(
    date: string, type: string, duration: number, rpe: number, grade: string | null, tags: string | null,
    notes: string | null, clientId: string | null, outdoor: boolean, gym: string | null = null,
  ) {
    sessionId++;
    const linked = planIds[date] && (WEEK[weekday(date)]?.type === type) ? planIds[date] : null;
    sql(
      `INSERT INTO sessions (id, date, type, duration_min, rpe, max_grade, notes, tags, outdoor, gym, plan_id, client_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId, date, type, duration, rpe, grade, notes, tags, outdoor ? 1 : 0, gym, linked, clientId, stamp(date, "21:00"),
    );
  }

  // Benchmarks over the block: pull-ups and hangs going up.
  for (const [ago, pullups, hang] of [[40, 9, 4], [26, 10, 8], [12, 12, 10]] as const) {
    const date = addDays(today, -ago);
    sql("INSERT INTO benchmarks (date, name, value, unit, created_at) VALUES (?, 'Max pull-ups', ?, 'reps', ?)", date, String(pullups), stamp(date, "20:00"));
    sql("INSERT INTO benchmarks (date, name, value, unit, created_at) VALUES (?, 'Max hang 20mm 10s', ?, 'kg added', ?)", date, String(hang), stamp(date, "20:00"));
  }

  // An old elbow niggle that healed, and a mild finger tweak that is getting better.
  sql(
    `INSERT INTO injuries (id, body_part, side, description, started_on, resolved_on, created_at)
     VALUES (1, 'Elbow - inside (golfer''s)', 'right', 'Ache after a long lead day, worse on pinches.', ?, ?, ?)`,
    addDays(today, -34), addDays(today, -22), stamp(addDays(today, -34), "08:00"),
  );
  for (const [ago, pain, trend] of [[34, 3, null], [31, 3, "same"], [28, 2, "better"], [25, 1, "better"], [22, 0, "gone"]] as const) {
    sql("INSERT INTO injury_updates (injury_id, date, pain, trend, created_at) VALUES (1, ?, ?, ?, ?)", addDays(today, -ago), pain, trend, stamp(addDays(today, -ago), "07:40"));
  }
  const tweak = addDays(today, -5);
  sql(
    `INSERT INTO injuries (id, body_part, side, description, started_on, session_id, created_at)
     VALUES (2, 'Finger - ring finger A2 pulley', 'left', 'Sore at the base of the finger after crimping, no pop. Open hand feels fine.', ?, ?, ?)`,
    tweak, null, stamp(tweak, "08:00"),
  );
  for (const [ago, pain, trend, stiffness] of [[5, 3, null, 1], [4, 3, "same", 1], [3, 2, "better", 1], [2, 2, "same", 0], [1, 1, "better", 0]] as const) {
    sql(
      "INSERT INTO injury_updates (injury_id, date, pain, trend, stiffness, created_at) VALUES (2, ?, ?, ?, ?, ?)",
      addDays(today, -ago), pain, trend, stiffness, stamp(addDays(today, -ago), "07:40"),
    );
  }

  // Last night's coach review: a note, a summary of what changed, and a question for the climber.
  const yesterday = addDays(today, -1);
  sql(
    "INSERT INTO coach_notes (date, text, created_at) VALUES (?, ?, ?)",
    yesterday,
    "Finger is trending down (pain 1). Keep crimps off the menu this week: open-hand and slopers only, no board. Max hangs swapped for Abrahangs until it's at 0 for 3 days.",
    stamp(yesterday, "22:31"),
  );
  sql(
    "INSERT INTO coach_runs (outcome, summary, changes, seen_through, created_at) VALUES ('updated', ?, ?, ?, ?)",
    "Finger is improving. Kept the week, but swapped crimpy work for open-hand climbing.",
    JSON.stringify(["Tuesday: Max hangs -> Abrahangs", "Saturday: no board, slab and volume instead", "Asked how the finger feels on open hand"]),
    stamp(yesterday, "22:30"),
    stamp(yesterday, "22:31"),
  );
  sql(
    "INSERT INTO coach_questions (question, why, options, allow_text, expires_on, created_at) VALUES (?, ?, ?, 1, ?, ?)",
    "How does the finger feel on open-hand holds?",
    "Decides whether Saturday can be a full session.",
    JSON.stringify(["No pain", "A little", "Hurts"]),
    addDays(today, 3),
    stamp(yesterday, "22:31"),
  );

  // App feedback: one already triaged into an issue by the review, one still new.
  sql(
    "INSERT INTO app_feedback (text, status, issue_number, reply, handled_at, created_at) VALUES (?, 'filed', 42, ?, ?, ?)",
    "Would love a dark/light toggle for outdoor use in sunlight",
    "Filed as #42 (P2)",
    stamp(addDays(today, -9), "22:31"),
    stamp(addDays(today, -10), "12:00"),
  );
  sql("INSERT INTO app_feedback (text, created_at) VALUES (?, ?)", "Show rest time between hangs louder", stamp(yesterday, "18:00"));

  await db.batch(stmts);
}
