// Optional style tags on climbing sessions (#25) and how they weight finger load. Pure, shared by the
// worker and the app (src/components/TagPicker.tsx), unit tested in tags.test.ts.
//
// Stored in sessions.tags as a comma-separated list in SESSION_TAGS order ("crimpy,overhang"), NULL
// when there are none. Same format as injury_updates.red_flags, so SQL can filter with LIKE.

export const SESSION_TAGS = [
  "crimpy",
  "open-hand",
  "slab",
  "vertical",
  "overhang",
  "board",
  "technique",
  "projecting",
  "volume",
] as const;

export type SessionTag = (typeof SESSION_TAGS)[number];

// Session types that can carry tags (the climbing ones; hangboard has its own grip/edge detail).
export const TAG_TYPES = ["boulder", "board", "lead", "toprope"];

// --- Finger-load weights: the ONLY place these numbers live. ---
//
// weight = clamp(type weight x tag weight, FINGER_WEIGHT_MIN, FINGER_WEIGHT_MAX)
//
// Type weight: finger load per minute at the same effort differs by discipline (a board session loads
// fingers more than lead). Tag weight: the HIGHEST weight among the session's tags, 1 when untagged. So a
// low tag weight only applies when every tag is low ("slab,technique" = 0.6), any neutral tag lifts it
// back to 1 ("slab,overhang" = 1), and any high tag wins ("slab,crimpy" = 1.2): a session that was
// partly crimpy is never counted as easy on the fingers. A tag naming the session's own type (the "board"
// tag on a board session) adds nothing, since the type weight already covers it. The clamp keeps stacked
// weights in a sane range (board + crimpy = 1.44, lead + slab = 0.42 -> 0.5).

// Only FINGER_TYPES (worker/load.ts) are weighted; other types add no finger load at all.
export const TYPE_FINGER_WEIGHTS: Record<string, number> = {
  board: 1.2,
  boulder: 1,
  hangboard: 1,
  lead: 0.7,
  toprope: 0.6, // less than lead: no clipping, more rests on the rope (#33)
};

export const FINGER_WEIGHT_MIN = 0.5;
export const FINGER_WEIGHT_MAX = 1.5;

export const TAG_FINGER_WEIGHTS: Record<SessionTag, number> = {
  crimpy: 1.2,
  board: 1.2,
  "open-hand": 1,
  overhang: 1,
  projecting: 1,
  volume: 1,
  slab: 0.6,
  technique: 0.6,
  vertical: 0.6,
};

const isTag = (t: unknown): t is SessionTag => typeof t === "string" && (SESSION_TAGS as readonly string[]).includes(t);
export const isTagList = (v: unknown): v is SessionTag[] => Array.isArray(v) && v.every(isTag);
export const TAG_LIST_MESSAGE = `tags must be a list of ${SESSION_TAGS.join(", ")}`;
export const TAG_TYPE_MESSAGE = `tags are only for ${TAG_TYPES.join(", ")} sessions`;

// Reads the stored column (or a list) into known tags, in canonical order; unknown values are ignored.
export function parseTags(value: string | readonly string[] | null | undefined): SessionTag[] {
  if (!value) return [];
  const list = typeof value === "string" ? value.split(",").map((t) => t.trim()) : value;
  return SESSION_TAGS.filter((t) => list.includes(t));
}

// Validates tags sent by the app or MCP: null/undefined or a list of SESSION_TAGS values, only on
// TAG_TYPES. Returns an error message, or null when fine.
export function tagsError(input: unknown, type: string): string | null {
  if (input == null) return null;
  if (!isTagList(input)) return TAG_LIST_MESSAGE;
  if (input.length && !TAG_TYPES.includes(type)) return TAG_TYPE_MESSAGE;
  return null;
}

// Validated input -> column value (deduplicated, canonical order, NULL when empty).
export function tagsColumn(input: readonly string[] | null | undefined): string | null {
  const tags = parseTags(input ?? []);
  return tags.length ? tags.join(",") : null;
}

// Multiplier for a finger-load session's load (see the weights block above). Tags only count on TAG_TYPES.
export function fingerWeight(type: string, tags: string | readonly string[] | null | undefined): number {
  const parsed = TAG_TYPES.includes(type) ? parseTags(tags).filter((t) => t !== type) : [];
  const tagWeight = parsed.length ? Math.max(...parsed.map((t) => TAG_FINGER_WEIGHTS[t])) : 1;
  const w = (TYPE_FINGER_WEIGHTS[type] ?? 1) * tagWeight;
  return Math.round(Math.min(FINGER_WEIGHT_MAX, Math.max(FINGER_WEIGHT_MIN, w)) * 1000) / 1000;
}
