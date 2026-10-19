// Hangboard warm-ups (#50): a timer run that warms up for that day's climbing is part of that session, not
// training of its own. It is kept as a hang log with warmup = 1 and no session, so load, plan matching and the
// weekly card (which read sessions only) leave it out. Pure; unit tested in warmup.test.ts.

import { SESSION_KEY_SUFFIX } from "./timerSession";

// Presets whose runs start out as warm-ups on the timer's finished screen ("Warm-up", "Warmup", "warm up 2").
export const isWarmupPreset = (name: string | null | undefined): boolean => /\bwarm[\s-]?up/i.test(name ?? "");

export const NO_TIMER_RUN_MESSAGE = "No timer run on that day to keep as a warm-up; delete the session instead.";
export const NOT_HANGBOARD_MESSAGE = "Only hangboard sessions can be marked as a warm-up.";

export interface WarmupHang {
  id: number;
  preset: string;
  warmup?: number | null;
  client_id?: string | null;
}

// "Mark as warm-up" on a hangboard session in History: which of that day's hang logs becomes the warm-up.
// 1. the run the timer logged this session with (session client_id = hang log client_id + ':session');
// 2. otherwise a run not already a warm-up and not carrying another session that still exists, a warm-up
//    preset first, then the latest. null = no timer run to keep.
export function pickWarmupHang(
  session: { client_id?: string | null },
  hangs: readonly WarmupHang[],
  otherSessionKeys: readonly string[] = [],
): WarmupHang | null {
  const own = session.client_id?.endsWith(SESSION_KEY_SUFFIX) ? session.client_id.slice(0, -SESSION_KEY_SUFFIX.length) : null;
  const linked = own ? hangs.find((h) => h.client_id === own) : undefined;
  if (linked) return linked;
  const taken = new Set(otherSessionKeys.filter((k) => k.endsWith(SESSION_KEY_SUFFIX)).map((k) => k.slice(0, -SESSION_KEY_SUFFIX.length)));
  const free = hangs.filter((h) => !h.warmup && !(h.client_id && taken.has(h.client_id)));
  if (!free.length) return null;
  return [...free].sort((a, b) => Number(isWarmupPreset(b.preset)) - Number(isWarmupPreset(a.preset)) || b.id - a.id)[0];
}
