// Mixed sessions (#108): one visit that mixes several types (e.g. boulder, board and lead) is logged with a
// `parts` list, the minutes spent on each type. It is stored as one session per type, so the type mix and
// the type-weighted finger load stay right without a schema change. Shared by POST /api/sessions and the MCP
// log_session tool. Pure; unit tested in sessionParts.test.ts.

import { SESSION_TYPES } from "./sessions";
import { TAG_TYPES } from "./tags";
import { isClimbingType } from "./typeGroups";

export interface SessionPart {
  type: string;
  duration_min: number;
}

export const PARTS_MESSAGE = `parts must be a list of 2 or more {type, duration_min} with different types (${SESSION_TYPES.join(", ")}) and whole minutes above 0`;

// Validates parts. Missing = null (a normal single-type session); anything else invalid throws.
export function parseParts(input: unknown): SessionPart[] | null {
  if (input == null) return null;
  if (!Array.isArray(input) || input.length < 2) throw new Error(PARTS_MESSAGE);
  const parts = input.map((p) => {
    const { type, duration_min } = (p ?? {}) as Record<string, unknown>;
    if (typeof type !== "string" || !SESSION_TYPES.includes(type)) throw new Error(PARTS_MESSAGE);
    if (!Number.isInteger(duration_min) || (duration_min as number) <= 0) throw new Error(PARTS_MESSAGE);
    return { type, duration_min: duration_min as number };
  });
  if (new Set(parts.map((p) => p.type)).size !== parts.length) throw new Error(PARTS_MESSAGE);
  return parts;
}

export const partsTotal = (parts: readonly SessionPart[]) => parts.reduce((sum, p) => sum + p.duration_min, 0);

// The type the shared tags and outdoor flag are checked against: the first part they can apply to (the
// climbing types, which are also the tag types), else the first part.
export const partsCheckType = (parts: readonly SessionPart[]) => (parts.find((p) => isClimbingType(p.type)) ?? parts[0]).type;

interface SplittableSession {
  type: string;
  duration_min: number;
  tags?: string | null;
  outdoor?: 0 | 1 | boolean | null;
  max_grade?: string | null;
  notes?: string | null;
  plan_id?: number | null;
}

// One session per part. Date, effort and gym are shared. Tags and outdoor go only on the parts whose type
// takes them. The hardest grade, notes and plan pin go on the first part only, so they are not shown or
// counted several times.
export function splitSession<T extends SplittableSession>(s: T, parts: readonly SessionPart[]): T[] {
  return parts.map((p, n) => ({
    ...s,
    type: p.type,
    duration_min: p.duration_min,
    tags: TAG_TYPES.includes(p.type) ? (s.tags ?? null) : null,
    outdoor: isClimbingType(p.type) ? s.outdoor : 0,
    max_grade: n === 0 ? (s.max_grade ?? null) : null,
    notes: n === 0 ? (s.notes ?? null) : null,
    plan_id: n === 0 ? (s.plan_id ?? null) : null,
  }));
}
