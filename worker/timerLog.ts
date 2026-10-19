// Hangboard timer writes: the hang log plus the hangboard session that makes it count toward training
// load (#26). Both rows are written in one batch and keyed off the same client_id, so an outbox replay
// can't duplicate either of them.

import { idForClientId } from "./db";
import { BadRequest, NotFound } from "./errors";
import { NOT_HANGBOARD_MESSAGE, NO_TIMER_RUN_MESSAGE, type WarmupHang, pickWarmupHang } from "./warmup";
import { SESSION_KEY_SUFFIX, defaultTimerRpe, shouldLogTimerSession, timerSessionClientId, timerSessionNotes } from "./timerSession";

export interface HangLogInput {
  date: string;
  preset: string;
  on_s: number;
  off_s: number;
  reps: number;
  sets: number;
  set_rest_s: number;
  completed_reps: number;
  edge_mm?: number | null;
  grip?: string | null;
  added_kg?: number | null;
  notes?: string | null;
  // Minutes actually spent in the timer's phases. Sent by app versions that auto-log the session; older
  // cached app versions leave it out and still offer their own "Log session" button, so they get no
  // automatic session (otherwise tapping that button would count the run twice).
  duration_min?: number;
  // A warm-up for that day's climbing (#50): saved as a hang log with warmup = 1 and no session.
  warmup?: boolean;
}

export interface TimerSession {
  id: number;
  rpe: number;
  duration_min: number;
}

// The effort of the most recent timer session for this preset (as last set on the finished screen or in History).
async function lastRpeFor(db: D1Database, preset: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT s.rpe FROM hang_logs h JOIN sessions s ON s.client_id = h.client_id || ?
       WHERE h.preset = ? ORDER BY h.id DESC LIMIT 1`,
    )
    .bind(SESSION_KEY_SUFFIX, preset)
    .first<{ rpe: number }>();
  return row?.rpe ?? null;
}

export async function insertTimerLog(
  db: D1Database,
  h: HangLogInput,
  clientId: string | null,
): Promise<{ id: number; session: TimerSession | null }> {
  const hangInsert = db
    .prepare(
      `INSERT INTO hang_logs (date, preset, on_s, off_s, reps, sets, set_rest_s, completed_reps, edge_mm, grip, added_kg, notes, warmup, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
    )
    .bind(
      h.date, h.preset, h.on_s, h.off_s, h.reps, h.sets, h.set_rest_s, h.completed_reps,
      h.edge_mm ?? null, h.grip ?? null, h.added_kg ?? null, h.notes ?? null, h.warmup ? 1 : 0, clientId,
    );

  const duration = Math.round(Number(h.duration_min));
  if (h.warmup || !(duration >= 1) || !shouldLogTimerSession(h.completed_reps)) {
    const row = await hangInsert.first<{ id: number }>();
    return { id: row?.id ?? (await idForClientId(db, "hang_logs", clientId!)), session: null };
  }

  const rpe = defaultTimerRpe(h.preset, await lastRpeFor(db, h.preset));
  const sessionKey = clientId === null ? null : timerSessionClientId(clientId);
  // Runs before the hang insert, in the same transaction: the session is only created along with a new
  // hang log. A replay of a run that already reached the server leaves the session alone, so one the
  // climber removed on the finished screen isn't brought back.
  const sessionInsert = db
    .prepare(
      `INSERT INTO sessions (date, type, duration_min, rpe, notes, client_id)
       SELECT ?, 'hangboard', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM hang_logs WHERE client_id = ?)
       ON CONFLICT (client_id) DO NOTHING RETURNING id, rpe, duration_min`,
    )
    .bind(h.date, duration, rpe, timerSessionNotes(h.preset, h.completed_reps, h.reps * h.sets), sessionKey, clientId);

  const [s, hang] = await db.batch<{ id: number; rpe: number; duration_min: number }>([sessionInsert, hangInsert]);
  const id = hang.results[0]?.id ?? (await idForClientId(db, "hang_logs", clientId!));
  const session = s.results[0] ?? (sessionKey === null ? null : await timerSessionByKey(db, sessionKey));
  return { id, session: session ? { id: session.id, rpe: session.rpe, duration_min: session.duration_min } : null };
}

const timerSessionByKey = (db: D1Database, sessionKey: string) =>
  db.prepare("SELECT id, rpe, duration_min FROM sessions WHERE client_id = ?").bind(sessionKey).first<TimerSession>();

// Effort picked on the finished screen. Addressed by the hang log's client_id so it also works when the
// run is still in the offline outbox (the outbox replays in order, so the insert lands first). Not marked
// as edited: this is still part of logging the run.
export async function setTimerSessionRpe(db: D1Database, hangClientId: string, rpe: number): Promise<boolean> {
  const { meta } = await db
    .prepare("UPDATE sessions SET rpe = ? WHERE client_id = ?")
    .bind(rpe, timerSessionClientId(hangClientId))
    .run();
  return meta.changes > 0;
}

// "Don't count it" on older app versions' finished screen: the run was a warm-up. The hang log stays,
// marked as one.
export async function deleteTimerSession(db: D1Database, hangClientId: string) {
  await setTimerWarmup(db, hangClientId, true);
}

// The finished screen's "Warm-up for today's climbing" / "Training session" choice (#50), addressed by the hang
// log's client_id so it works offline (the outbox replays in order). Warm-up: the session goes and the hang log
// is marked. Training: the mark goes and the session is created if missing (duration from the app, effort from
// the preset's last or default). Idempotent either way. Returns the session (training) or null.
export async function setTimerWarmup(
  db: D1Database,
  hangClientId: string,
  warmup: boolean,
  durationMin?: number,
): Promise<TimerSession | null> {
  const sessionKey = timerSessionClientId(hangClientId);
  if (warmup) {
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE client_id = ?").bind(sessionKey),
      db.prepare("UPDATE hang_logs SET warmup = 1 WHERE client_id = ?").bind(hangClientId),
    ]);
    return null;
  }
  const hang = await db
    .prepare("SELECT preset, completed_reps, reps, sets FROM hang_logs WHERE client_id = ?")
    .bind(hangClientId)
    .first<{ preset: string; completed_reps: number; reps: number; sets: number }>();
  if (!hang) throw new NotFound("Timer run not found");
  const duration = Math.max(1, Math.round(Number(durationMin) || 1));
  const rpe = defaultTimerRpe(hang.preset, await lastRpeFor(db, hang.preset));
  await db.batch([
    db.prepare("UPDATE hang_logs SET warmup = 0 WHERE client_id = ?").bind(hangClientId),
    db
      .prepare(
        `INSERT INTO sessions (date, type, duration_min, rpe, notes, client_id)
         SELECT date, 'hangboard', ?, ?, ?, ? FROM hang_logs WHERE client_id = ?
         ON CONFLICT (client_id) DO NOTHING`,
      )
      .bind(duration, rpe, timerSessionNotes(hang.preset, hang.completed_reps, hang.reps * hang.sets), sessionKey, hangClientId),
  ]);
  return timerSessionByKey(db, sessionKey);
}

// "Mark as warm-up" on a hangboard session in History (#50): the session goes and that day's timer run (see
// pickWarmupHang) is kept as a warm-up. Returns the hang log's id.
export async function markSessionWarmup(db: D1Database, sessionId: number): Promise<{ hang_log_id: number }> {
  const session = await db
    .prepare("SELECT id, date, type, client_id FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ id: number; date: string; type: string; client_id: string | null }>();
  if (!session) throw new NotFound(`Session ${sessionId} not found`);
  if (session.type !== "hangboard") throw new BadRequest(NOT_HANGBOARD_MESSAGE);
  const [hangs, others] = await db.batch([
    db.prepare("SELECT id, preset, warmup, client_id FROM hang_logs WHERE date = ?").bind(session.date),
    db.prepare("SELECT client_id FROM sessions WHERE date = ? AND id != ? AND client_id IS NOT NULL").bind(session.date, session.id),
  ]);
  const hang = pickWarmupHang(
    session,
    hangs.results as unknown as WarmupHang[],
    (others.results as { client_id: string }[]).map((r) => r.client_id),
  );
  if (!hang) throw new BadRequest(NO_TIMER_RUN_MESSAGE);
  await db.batch([
    db.prepare("UPDATE hang_logs SET warmup = 1 WHERE id = ?").bind(hang.id),
    db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id),
  ]);
  return { hang_log_id: hang.id };
}
