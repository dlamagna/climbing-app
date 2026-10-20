// Run the daily coach review or the nightly issue worker from the app (Settings → Coach activity).
// Both are Claude Code routines with an API trigger. Each trigger has its own URL and token, created
// at claude.ai/code/routines and stored as worker secrets. A token can only start its own routine.
// See https://platform.claude.com/docs/en/api/claude-code/routines-fire

import type { Env } from "./db";
import { BadRequest } from "./errors";

export const ROUTINE_NAMES = ["review", "worker"] as const;
export type RoutineName = (typeof ROUTINE_NAMES)[number];

const ROUTINES: Record<RoutineName, { label: string; url: keyof Env; token: keyof Env }> = {
  review: { label: "coach review", url: "COACH_REVIEW_FIRE_URL", token: "COACH_REVIEW_FIRE_TOKEN" },
  worker: { label: "issue worker", url: "ISSUE_WORKER_FIRE_URL", token: "ISSUE_WORKER_FIRE_TOKEN" },
};

// The URL the routine's API trigger shows. Anything else is refused, so the token only goes to Anthropic.
const FIRE_URL = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;

// Each tap starts a new session (the endpoint has no idempotency key), so a second tap within a minute
// is refused. Best effort: the memory is per worker instance.
export const COOLDOWN_MS = 60_000;
const lastFired = new Map<RoutineName, number>();

export const isRoutineName = (s: string): s is RoutineName => (ROUTINE_NAMES as readonly string[]).includes(s);

function config(env: Env, name: RoutineName): { url: string; token: string } | null {
  const url = (env[ROUTINES[name].url] as string | undefined)?.trim();
  const token = (env[ROUTINES[name].token] as string | undefined)?.trim();
  return url && token && FIRE_URL.test(url) ? { url, token } : null;
}

// Which routines can be run from the app.
export const routinesAvailable = (env: Env): Record<RoutineName, boolean> => ({
  review: config(env, "review") !== null,
  worker: config(env, "worker") !== null,
});

export async function fireRoutine(env: Env, name: RoutineName, now = Date.now()): Promise<{ session_url: string | null }> {
  const { label } = ROUTINES[name];
  const cfg = config(env, name);
  if (!cfg) throw new BadRequest(`The ${label} isn't set up to run from the app (see the README).`);
  const last = lastFired.get(name);
  if (last !== undefined && now - last < COOLDOWN_MS) throw new BadRequest(`The ${label} was started less than a minute ago.`);
  lastFired.set(name, now);

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `Started from the app (Settings → Coach activity).` }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    lastFired.delete(name);
    throw new BadRequest(`Couldn't reach Claude to start the ${label}. Try again in a moment.`);
  }
  if (!res.ok) {
    lastFired.delete(name);
    throw new BadRequest(fireError(res.status, label));
  }
  const data = (await res.json().catch(() => ({}))) as { claude_code_session_url?: string };
  return { session_url: typeof data.claude_code_session_url === "string" ? data.claude_code_session_url : null };
}

export function fireError(status: number, label: string): string {
  switch (status) {
    case 400:
      return `Claude refused to start the ${label}. It may be paused at claude.ai/code/routines.`;
    case 401:
      return `The ${label}'s token was rejected. Generate a new one for its API trigger and update the worker secret.`;
    case 403:
      return `This Claude account can't start routines over the API.`;
    case 404:
      return `The ${label} wasn't found. Check its trigger URL in the worker secrets.`;
    case 429:
      return `The ${label} has been started too often this hour. Try again later.`;
    default:
      return `Claude couldn't start the ${label} (HTTP ${status}). Try again in a moment.`;
  }
}

// For tests: forget recent starts.
export const resetCooldowns = () => lastFired.clear();
