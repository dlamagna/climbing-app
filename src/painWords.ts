// Spots injury talk in free-text session notes, so the app can offer "Add injury" / "Mark healed" after
// saving (and when reviewing old notes). Plain keyword matching: it only ever produces suggestions.

export type HitKind = "tweak" | "healed";

export interface NoteHit {
  kind: HitKind;
  word: string; // the matched keyword, as written in the note (lower-cased)
  part: string | null; // body part category (same names as BODY_PARTS in components/injury.tsx)
  side: "left" | "right" | null;
  snippet: string; // the clause it was found in
}

// Earliest match in the clause wins; on a tie the earlier entry (so "finger tips" is Skin, not Finger).
const PARTS: [string, RegExp][] = [
  ["Skin", /\b(?:skin|finger ?tips?|tips|flappers?|blisters?)\b/],
  ["Finger", /\b(?:fingers?|pulleys?|a[1-5]|thumbs?|pink(?:y|ie)|knuckles?)\b/],
  ["Wrist", /\b(?:wrists?|tfcc)\b/],
  ["Elbow", /\b(?:elbows?|golfer'?s)\b/],
  ["Shoulder", /\b(?:shoulders?|rotator cuff)\b/],
  // Bare "back" is too common ("came back", "back to normal"), so it needs a hint that it's the body part.
  ["Neck / back", /\b(?:neck|traps?|spine|(?:my|lower|upper|mid) back)\b|\bback (?=pain|is|feels|felt|hurts?|sore|tweak)/],
  ["Hip", /\b(?:hips?|groin)\b/],
  ["Knee", /\b(?:knees?|meniscus)\b/],
  ["Ankle", /\b(?:ankles?)\b/],
];

// Enough on their own to suggest a new injury ("popped off" is falling off a hold, not a pulley).
const TWEAK = /\b(?:tweak(?:ed|ing|s|y)?|strain(?:ed)?|twinges?|twingy|pain(?:ful)?|hurt(?:s|ing)?|injured|popped(?! off)|ach(?:e|es|ing|y)|sprain(?:ed)?|inflamed|swollen)\b/;
// Usually ordinary training fatigue ("pulled hard", "forearms sore"), so only counted next to a body part.
const WEAK_TWEAK = /\b(?:sore(?:ness)?|pulled|tender)\b/;
const INJURY = /\binjur(?:y|ies)\b/;
const HEALED = /\b(?:gone|better|healed|recovered|resolved|fine now|all good|back to normal)\b/;
const NOT_HEALED = /\bnot (?:any |yet )?(?:better|gone|healed|recovered)\b|\bstill\b/;
// "No pain in the elbow" reads as healed, not as a new tweak.
const PAIN_FREE = /\b(?:no (?:more )?(?:pain|soreness|twinges?)|pain[- ]free|painless|(?:doesn't|didn't|does not|did not|not|no longer) (?:hurt(?:s|ing)?|sore))\b/;

const CLAUSE = /[.!?;,\n]+|\b(?:but|though|although|however)\b/i;
const MAX_SNIPPET = 90;

export function partOf(text: string): string | null {
  const t = text.toLowerCase();
  let best: { part: string; at: number } | null = null;
  for (const [part, re] of PARTS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { part, at: m.index };
  }
  return best?.part ?? null;
}

export function sideOf(text: string): NoteHit["side"] {
  const t = text.toLowerCase();
  const m = /\b(left|right)\b/.exec(t);
  return (m?.[1] as NoteHit["side"]) ?? null;
}

function snippet(clause: string): string {
  const s = clause.replace(/\s+/g, " ").trim();
  return s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET - 1).trimEnd()}…` : s;
}

function classify(t: string): { kind: HitKind; word: string } | null {
  const hasPart = partOf(t) !== null;
  const painFree = PAIN_FREE.exec(t);
  if (painFree) return hasPart ? { kind: "healed", word: painFree[0] } : null;
  const healed = HEALED.exec(t);
  if (healed && !NOT_HEALED.test(t)) {
    // "Felt better on the board" is not about an injury; "finger better" or "pain gone" is.
    return hasPart || TWEAK.test(t) || WEAK_TWEAK.test(t) || INJURY.test(t) ? { kind: "healed", word: healed[0] } : null;
  }
  const tweak = TWEAK.exec(t) ?? (hasPart ? WEAK_TWEAK.exec(t) : null);
  return tweak ? { kind: "tweak", word: tweak[0] } : null;
}

// Every distinct mention in a note (one per kind and body part), in the order they appear.
export function scanNote(note: string | null | undefined): NoteHit[] {
  if (!note) return [];
  const hits: NoteHit[] = [];
  for (const clause of note.replace(/[‘’]/g, "'").split(CLAUSE)) {
    if (!clause?.trim()) continue;
    const t = clause.toLowerCase();
    const c = classify(t);
    if (!c) continue;
    const hit: NoteHit = { ...c, part: partOf(t), side: sideOf(t), snippet: snippet(clause) };
    if (!hits.some((h) => h.kind === hit.kind && h.part === hit.part)) hits.push(hit);
  }
  return hits;
}

interface InjuryLike {
  id: number;
  body_part: string;
}

// Active injuries a "healed" mention could be about: those of the mentioned body part, or all of them
// when the note names none ("pain gone"). More than one means the app asks which.
export function healedCandidates<T extends InjuryLike>(hit: NoteHit, active: T[]): T[] {
  return hit.part ? active.filter((i) => partOf(i.body_part) === hit.part) : active;
}

export interface NoteSuggestions<T extends InjuryLike> {
  tweaks: NoteHit[];
  healed: { hit: NoteHit; candidates: T[] }[];
}

// What to offer after saving a session. A tweak of a body part that already has an active injury is
// left out (the morning check-in follows that one up), as is a "healed" mention with nothing to heal.
export function noteSuggestions<T extends InjuryLike>(note: string | null | undefined, active: T[]): NoteSuggestions<T> {
  const hits = scanNote(note);
  return {
    tweaks: hits.filter((h) => h.kind === "tweak" && !(h.part && active.some((i) => partOf(i.body_part) === h.part))),
    healed: hits
      .filter((h) => h.kind === "healed")
      .map((hit) => ({ hit, candidates: healedCandidates(hit, active) }))
      .filter((s) => s.candidates.length > 0),
  };
}

export interface SessionNote {
  id: number;
  date: string;
  type: string;
  notes: string;
}

// "Review past notes": every tweak mentioned in old session notes, newest session first.
export function reviewMatches<S extends SessionNote>(sessions: S[]): { session: S; hit: NoteHit }[] {
  return [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .flatMap((session) => scanNote(session.notes).filter((h) => h.kind === "tweak").map((hit) => ({ session, hit })));
}
