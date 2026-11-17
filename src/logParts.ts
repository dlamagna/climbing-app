// The Log form's mixed sessions (#108): when more than one type is picked, the minutes spent on each.
// Pure, unit tested in logParts.test.ts. The worker stores the parts as one session per type (worker/sessionParts.ts).

// Same shape as worker/sessionParts.ts's SessionPart (not imported: that file pulls in D1-only worker code).
export interface SessionPart {
  type: string;
  duration_min: number;
}

const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

// Minutes per picked type: what was already set is kept; a newly picked type starts at an even share of
// the session length, so the total stays close to it.
export function partMinutes(types: readonly string[], minutes: Readonly<Record<string, number>>, duration: number): Record<string, number> {
  return Object.fromEntries(types.map((t) => [t, minutes[t] ?? round5(duration / types.length)]));
}

// The parts to send, in the order the types were picked; null for a single-type session.
export function logParts(types: readonly string[], minutes: Readonly<Record<string, number>>): SessionPart[] | null {
  if (types.length < 2) return null;
  return types.map((type) => ({ type, duration_min: minutes[type] }));
}
