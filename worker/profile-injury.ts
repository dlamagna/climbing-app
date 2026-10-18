// Injuries are tracked only in the injuries / injury_updates tables (issue #20). Injury text in the
// profile is invisible to the app (no morning injury check, no pain trend), so: MCP update_profile won't
// store it, get_overview warns when the profile mentions an injury that isn't tracked, and the app offers
// to turn it into a tracked injury. Shared by the worker and the app (src/components/profileInjury.tsx).

// Matched against the key split into words: current_injury, injuries, finger_pain, currentInjury, ...
const INJURY_WORD = /(?:^|_)(?:injur(?:y|ies|ed)|pain|tweak(?:s|ed)?|rehab)(?:_|$)/;

export function isInjuryKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return INJURY_WORD.test(words);
}

// Profile entries that hold injury text, as [key, value] (empty values don't count).
export function injuryProfileEntries(profile: Record<string, unknown>): [string, string][] {
  return Object.entries(profile)
    .filter(([k, v]) => isInjuryKey(k) && typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => [k, (v as string).trim()]);
}

// Splits an update_profile call. Injury keys with a value are left out; removing one (null or "") is
// allowed, since that's how stale injury text gets cleared once it is tracked.
export function splitProfileUpdate(values: Record<string, unknown>): {
  allowed: Record<string, string | null>;
  rejected: string[];
} {
  const allowed: Record<string, string | null> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const removing = v === null || v === "";
    if (isInjuryKey(k) && !removing) rejected.push(k);
    else allowed[k] = removing ? null : String(v);
  }
  return { allowed, rejected };
}

export const rejectedProfileWarning = (keys: string[]) =>
  `Not saved: ${keys.join(", ")}. Injuries are tracked only in the injuries table: use report_injury for a new ` +
  `one, add_injury_update for pain / trend, resolve_injury when healed. Training rules for an injury belong in ` +
  `its description or in the plan, not the profile.`;

// For get_overview: profile text describing an injury while nothing is tracked.
export function profileInjuryWarnings(profile: Record<string, unknown>, activeInjuries: number): string[] {
  if (activeInjuries > 0) return [];
  return injuryProfileEntries(profile).map(
    ([key]) =>
      `profile.${key} describes an injury, but active_injuries is empty, so the app shows no injury check and ` +
      `no pain trend is collected. The injuries table is the source of truth. Confirm with the climber whether ` +
      `it is still current; if so record it with report_injury (with resolved_on if it has healed), then clear ` +
      `the profile key with update_profile {"${key}": null}.`,
  );
}
