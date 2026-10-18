import { describe, expect, it } from "vitest";
import {
  type PlanRow,
  type SessionRow,
  adherence,
  isHardDay,
  matchSessions,
  planConflicts,
  planStatuses,
  planView,
  typeSimilarity,
  weekSummary,
  weekSummaryText,
} from "./plan";

// Made-up week: Monday 2026-03-02 .. Sunday 2026-03-08.
const MON = "2026-03-02";
const TUE = "2026-03-03";
const WED = "2026-03-04";
const THU = "2026-03-05";
const FRI = "2026-03-06";
const SAT = "2026-03-07";

let nextId = 1;
const entry = (date: string, type: string | null, extra: Partial<PlanRow> = {}): PlanRow => ({
  id: nextId++,
  date,
  title: extra.title ?? `${type ?? "session"} day`,
  type,
  intensity: type === "rest" ? "rest" : "moderate",
  ...extra,
});
const rest = (date: string) => entry(date, "rest", { title: "Rest" });
const session = (date: string, type: string, extra: Partial<SessionRow> = {}): SessionRow => ({
  id: 100 + nextId++,
  date,
  type,
  duration_min: 60,
  rpe: 5,
  ...extra,
});

const statusOf = (entries: PlanRow[], sessions: SessionRow[], today: string) =>
  Object.fromEntries(planStatuses(entries, sessions, today).map((e) => [e.id, e.status]));

describe("typeSimilarity", () => {
  it("ranks exact > same group > untyped entry > different", () => {
    expect(typeSimilarity("boulder", "boulder")).toBe(3);
    expect(typeSimilarity("boulder", "lead")).toBe(2);
    expect(typeSimilarity("strength", "hangboard")).toBe(2);
    expect(typeSimilarity(null, "cardio")).toBe(1);
    expect(typeSimilarity("mobility", "boulder")).toBe(0);
  });
});

describe("matchSessions", () => {
  it("matches the session on the same date and type", () => {
    const e = entry(MON, "boulder");
    const s = session(MON, "boulder");
    expect(matchSessions([e], [s, session(TUE, "boulder")])).toEqual(new Map([[e.id, s.id]]));
  });

  it("never matches across dates", () => {
    expect(matchSessions([entry(MON, "boulder")], [session(TUE, "boulder")]).size).toBe(0);
  });

  it("ambiguous: each session goes to the closest type", () => {
    const strength = entry(MON, "strength");
    const climb = entry(MON, "boulder");
    const hang = session(MON, "hangboard");
    const board = session(MON, "board");
    const links = matchSessions([strength, climb], [hang, board]);
    expect(links.get(strength.id)).toBe(hang.id);
    expect(links.get(climb.id)).toBe(board.id);
  });

  it("exact type beats same group even when listed later", () => {
    const climb = entry(MON, "lead");
    const boulder = session(MON, "boulder", { duration_min: 120 });
    const lead = session(MON, "lead");
    expect(matchSessions([climb], [boulder, lead]).get(climb.id)).toBe(lead.id);
  });

  it("several sessions and entries a day: one-to-one, longer session first on ties", () => {
    const a = entry(MON, "boulder");
    const b = entry(MON, "boulder");
    const short = session(MON, "boulder", { duration_min: 20 });
    const long = session(MON, "boulder", { duration_min: 90 });
    const extra = session(MON, "mobility");
    const links = matchSessions([a, b], [short, long, extra]);
    expect(links.get(a.id)).toBe(long.id);
    expect(links.get(b.id)).toBe(short.id);
    expect([...links.values()]).not.toContain(extra.id);
  });

  it("a session of an unrelated type still takes a free entry that day", () => {
    const e = entry(MON, "strength");
    const s = session(MON, "cardio");
    expect(matchSessions([e], [s]).get(e.id)).toBe(s.id);
  });

  it("rest entries take no session", () => {
    expect(matchSessions([rest(MON)], [session(MON, "boulder")]).size).toBe(0);
  });

  it("a pinned session goes to its entry, even on another date, and is not auto-matched elsewhere", () => {
    const thu = entry(THU, "strength");
    const tue = entry(TUE, "strength");
    const s = session(TUE, "strength", { plan_id: thu.id });
    const links = matchSessions([tue, thu], [s]);
    expect(links.get(thu.id)).toBe(s.id);
    expect(links.has(tue.id)).toBe(false);
  });

  it("a session pinned to an entry outside the set is left alone", () => {
    expect(matchSessions([entry(MON, "boulder")], [session(MON, "boulder", { plan_id: 9999 })]).size).toBe(0);
  });
});

describe("planStatuses", () => {
  it("done: same type matched", () => {
    const e = entry(MON, "boulder");
    expect(statusOf([e], [session(MON, "boulder")], TUE)[e.id]).toBe("done");
  });

  it("done: entry without a type matched by anything", () => {
    const e = entry(MON, null);
    expect(statusOf([e], [session(MON, "cardio")], TUE)[e.id]).toBe("done");
  });

  it("swapped: a different type that day (same group included)", () => {
    const e = entry(MON, "strength");
    const f = entry(TUE, "boulder");
    const st = statusOf([e, f], [session(MON, "boulder"), session(TUE, "board")], WED);
    expect(st[e.id]).toBe("swapped");
    expect(st[f.id]).toBe("swapped");
  });

  it("partial: under 60% of a known planned duration, counting same-type extras that day", () => {
    const e = entry(MON, "hangboard", { duration_min: 60 });
    expect(statusOf([e], [session(MON, "hangboard", { duration_min: 30 })], TUE)[e.id]).toBe("partial");
    expect(statusOf([e], [session(MON, "hangboard", { duration_min: 40 })], TUE)[e.id]).toBe("done");
    // Two short timer runs add up.
    const runs = [session(MON, "hangboard", { duration_min: 20 }), session(MON, "hangboard", { duration_min: 20 })];
    expect(statusOf([e], runs, TUE)[e.id]).toBe("done");
  });

  it("no duration planned: never partial", () => {
    const e = entry(MON, "boulder");
    expect(statusOf([e], [session(MON, "boulder", { duration_min: 5 })], TUE)[e.id]).toBe("done");
  });

  it("skipped once the day is over, planned today and later", () => {
    const past = entry(MON, "boulder");
    const today = entry(TUE, "boulder");
    const future = entry(WED, "boulder");
    const st = statusOf([past, today, future], [], TUE);
    expect(st).toEqual({ [past.id]: "skipped", [today.id]: "planned", [future.id]: "planned" });
  });

  it("rest days: done once passed, swapped when trained on, planned until then", () => {
    const r1 = rest(MON);
    const r2 = rest(TUE);
    const r3 = rest(WED);
    const s = session(TUE, "boulder");
    const view = planStatuses([r1, r2, r3], [s], WED);
    expect(view.map((e) => e.status)).toEqual(["done", "swapped", "planned"]);
    expect(view[1].session_id).toBe(s.id);
  });

  it("a session matched to another entry that day doesn't spoil the rest entry", () => {
    const r = rest(MON);
    const e = entry(MON, "mobility");
    const st = statusOf([r, e], [session(MON, "mobility")], TUE);
    expect(st[r.id]).toBe("done");
    expect(st[e.id]).toBe("done");
  });

  it("a pinned session counts as done even with another type", () => {
    const e = entry(THU, "strength");
    const s = session(TUE, "hangboard", { plan_id: e.id });
    expect(statusOf([e], [s], FRI)[e.id]).toBe("done");
  });

  it("override wins and keeps the automatic status alongside; null goes back to auto", () => {
    const e = entry(MON, "boulder", { status_override: "done" });
    const [v] = planStatuses([e], [], TUE);
    expect(v.status).toBe("done");
    expect(v.auto_status).toBe("skipped");
    const [auto] = planStatuses([{ ...e, status_override: null }], [], TUE);
    expect(auto.status).toBe("skipped");
  });

  it("an unknown override value is ignored", () => {
    const e = entry(MON, "boulder", { status_override: "maybe" });
    expect(statusOf([e], [], TUE)[e.id]).toBe("skipped");
  });

  it("a session logged two days late flips skipped to done", () => {
    const e = entry(MON, "strength");
    const today = WED;
    expect(statusOf([e], [], today)[e.id]).toBe("skipped");
    // Logged on Wednesday, dated Monday.
    const late = session(MON, "strength");
    expect(statusOf([e], [late], today)[e.id]).toBe("done");
  });

  it("editing a session's date moves the match; deleting it brings back skipped", () => {
    const mon = entry(MON, "boulder");
    const tue = entry(TUE, "boulder");
    const s = session(MON, "boulder");
    expect(statusOf([mon, tue], [s], WED)).toEqual({ [mon.id]: "done", [tue.id]: "skipped" });
    expect(statusOf([mon, tue], [{ ...s, date: TUE }], WED)).toEqual({ [mon.id]: "skipped", [tue.id]: "done" });
    expect(statusOf([mon, tue], [], WED)).toEqual({ [mon.id]: "skipped", [tue.id]: "skipped" });
  });
});

describe("planConflicts", () => {
  const conflicts = (entries: PlanRow[], sessions: SessionRow[], today: string) =>
    planConflicts(planStatuses(entries, sessions, today), sessions, today);

  it("isHardDay: effort or total load over the thresholds", () => {
    expect(isHardDay([session(MON, "boulder", { rpe: 8, duration_min: 30 })])).toBe(true);
    expect(isHardDay([session(MON, "boulder", { rpe: 5, duration_min: 120 })])).toBe(true);
    expect(isHardDay([session(MON, "boulder", { rpe: 5, duration_min: 60 }), session(MON, "cardio", { rpe: 4, duration_min: 30 })])).toBe(false);
  });

  it("session on a rest day is flagged on the next planned day", () => {
    const r = rest(TUE);
    const next = entry(THU, "boulder");
    const s = session(TUE, "lead", { duration_min: 150, rpe: 6 });
    const [c] = conflicts([r, entry(WED, "rest"), next], [s], WED);
    expect(c).toMatchObject({ kind: "rest_day_session", date: TUE, entry_id: r.id, flag_date: THU, flag_entry_id: next.id, session_ids: [s.id] });
  });

  it("an easy session on a rest day is swapped but not a conflict", () => {
    const r = rest(TUE);
    const s = session(TUE, "mobility", { duration_min: 30, rpe: 3 });
    expect(statusOf([r], [s], WED)[r.id]).toBe("swapped");
    expect(conflicts([r, entry(THU, "boulder")], [s], WED)).toEqual([]);
  });

  it("a rest day trained on long ago is no longer flagged", () => {
    expect(conflicts([rest(MON), entry(SAT, "boulder")], [session(MON, "boulder", { duration_min: 120 })], FRI)).toEqual([]);
  });

  it("hard day before a planned hard day", () => {
    const easy = entry(TUE, "boulder", { intensity: "easy" });
    const hard = entry(WED, "board", { intensity: "hard" });
    const s = session(TUE, "boulder", { rpe: 9, duration_min: 90 });
    const [c] = conflicts([easy, hard], [s], TUE);
    expect(c).toMatchObject({ kind: "hard_before_hard", date: TUE, entry_id: hard.id, flag_date: WED, flag_entry_id: hard.id });
  });

  it("no hard-before-hard flag when the hard day was planned hard, or the next day isn't hard", () => {
    const s = session(TUE, "boulder", { rpe: 9 });
    expect(conflicts([entry(TUE, "boulder", { intensity: "hard" }), entry(WED, "board", { intensity: "hard" })], [s], TUE)).toEqual([]);
    expect(conflicts([entry(TUE, "boulder", { intensity: "easy" }), entry(WED, "cardio", { intensity: "easy" })], [s], TUE)).toEqual([]);
  });

  it("yesterday's hard day flags today's planned hard session", () => {
    const hard = entry(WED, "board", { intensity: "hard" });
    const [c] = conflicts([hard], [session(TUE, "lead", { rpe: 8 })], WED);
    expect(c).toMatchObject({ kind: "hard_before_hard", flag_date: WED });
  });

  it("skipped strength day and swapped test day", () => {
    const strength = entry(MON, "strength");
    const test = entry(TUE, "other", { title: "Baseline tests" });
    const next = entry(THU, "boulder");
    const cs = conflicts([strength, test, next], [session(TUE, "boulder")], WED);
    expect(cs.map((c) => [c.kind, c.entry_id, c.flag_entry_id])).toEqual([
      ["key_session_missed", strength.id, next.id],
      ["key_session_missed", test.id, next.id],
    ]);
  });

  it("an entry with expected benchmarks is a test day whatever its title (#22)", () => {
    const tests = entry(MON, "cardio", { title: "Easy run", expected_benchmarks: [{ name: "5 km run" }] });
    const plain = entry(TUE, "cardio", { title: "Easy run", expected_benchmarks: [] });
    const next = entry(THU, "boulder");
    const cs = conflicts([tests, plain, next], [], WED);
    expect(cs.map((c) => [c.kind, c.entry_id])).toEqual([["key_session_missed", tests.id]]);
  });

  it("an override to done clears the missed-strength conflict; a late log does too", () => {
    const strength = entry(MON, "strength");
    expect(conflicts([{ ...strength, status_override: "done" }, entry(THU, "boulder")], [], WED)).toEqual([]);
    expect(conflicts([strength, entry(THU, "boulder")], [session(MON, "strength")], WED)).toEqual([]);
  });

  it("no upcoming planned day: flag_date is null", () => {
    const [c] = conflicts([entry(MON, "strength")], [], WED);
    expect(c.flag_date).toBeNull();
  });

  it("planView attaches flags to the flagged entry", () => {
    const strength = entry(MON, "strength");
    const next = entry(THU, "boulder");
    const view = planView([strength, next], [], WED);
    expect(view.entries.find((e) => e.id === next.id)!.flags).toHaveLength(1);
    expect(view.entries.find((e) => e.id === strength.id)!.flags).toHaveLength(0);
  });
});

describe("weekSummary", () => {
  it("counts Monday to today, leaving out rest days taken as planned", () => {
    const entries = [
      entry(MON, "boulder"), // done
      entry(TUE, "strength"), // swapped (boulder)
      rest(WED), // done rest: not counted
      entry(THU, "mobility"), // skipped
      entry(FRI, "hangboard"), // today, planned
      entry(SAT, "boulder"), // future: not counted
      entry("2026-02-27", "boulder"), // last week: not counted
    ];
    const sessions = [session(MON, "boulder"), session(TUE, "boulder")];
    const s = weekSummary(planStatuses(entries, sessions, FRI), FRI);
    expect(s).toEqual({ week_start: MON, done: 1, partial: 0, skipped: 1, swapped: 1, planned: 1 });
    expect(weekSummaryText(s)).toBe("This week so far: 1 done, 1 swapped, 1 skipped");
  });

  it("a rest day trained on counts as swapped", () => {
    const s = weekSummary(planStatuses([rest(MON)], [session(MON, "boulder")], TUE), TUE);
    expect(s.swapped).toBe(1);
  });

  it("no text before anything happened", () => {
    expect(weekSummaryText(weekSummary(planStatuses([entry(MON, "boulder")], [], MON), MON))).toBeNull();
  });
});

describe("adherence", () => {
  it("one row per day with entries or sessions, with matched and unplanned sessions", () => {
    const e = entry(MON, "boulder");
    const matched = session(MON, "boulder");
    const extra = session(MON, "hangboard");
    const unplannedDay = session(WED, "cardio");
    const days = adherence(planStatuses([e], [matched, extra, unplannedDay], THU), [matched, extra, unplannedDay], MON, THU);
    expect(days).toEqual([
      {
        date: MON,
        entries: [{ id: e.id, title: e.title, type: "boulder", intensity: "moderate", status: "done", auto_status: "done", session_id: matched.id }],
        unplanned_session_ids: [extra.id],
      },
      { date: WED, entries: [], unplanned_session_ids: [unplannedDay.id] },
    ]);
  });
});
