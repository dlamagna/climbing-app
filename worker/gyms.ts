// Gym names on sessions (#48): free text, but previously used names are offered back, so the helpers here keep
// one spelling per gym. Pure (no D1, no DOM) and shared with the app's GymPicker; unit tested in gyms.test.ts.

export const GYM_MAX_LENGTH = 60;
export const GYM_MESSAGE = `gym must be text, at most ${GYM_MAX_LENGTH} characters`;

export interface KnownGym {
  name: string;
  sessions: number;
  last_used: string; // YYYY-MM-DD
}

// Trimmed, inner whitespace collapsed; empty means no gym.
export function normalizeGym(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s : null;
}

export const isGymInput = (v: unknown) => v === null || (typeof v === "string" && v.trim().length <= GYM_MAX_LENGTH);

// Comparison key: case, accents and spacing don't matter ("Sala  Nord" = "sala nórd").
export function gymKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// The stored spelling when the typed name matches a known gym, otherwise the normalized input.
export function canonicalGym(input: unknown, known: readonly string[]): string | null {
  const name = normalizeGym(input);
  if (name === null) return null;
  const key = gymKey(name);
  return known.find((k) => gymKey(k) === key) ?? name;
}

// Dropdown filtering: names starting with the query first, then names where a word starts with it, then names
// containing it. Within each group the given order (most recently used first) is kept. Empty query = all.
export function filterGyms<T extends { name: string }>(query: string, gyms: readonly T[]): T[] {
  const q = gymKey(query);
  if (!q) return [...gyms];
  const rank = (g: T) => {
    const k = gymKey(g.name);
    if (k.startsWith(q)) return 0;
    if (k.split(" ").some((w) => w.startsWith(q))) return 1;
    return k.includes(q) ? 2 : -1;
  };
  return gyms
    .map((g, i) => ({ g, i, r: rank(g) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.g);
}

// Sessions per gym, most first (ties: name order). Sessions without a gym are left out.
export function gymCounts(sessions: readonly { gym?: string | null }[]): { name: string; sessions: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const name = normalizeGym(s.gym);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => ({ name, sessions: n })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

// "Gym A ×3 · Gym B", or null when no session has a gym.
export function gymsText(counts: readonly { name: string; sessions: number }[]): string | null {
  if (!counts.length) return null;
  return counts.map((c) => (c.sessions > 1 ? `${c.name} ×${c.sessions}` : c.name)).join(" · ");
}
