export interface PlanStep {
  /** Short lead-in such as "Warm-up 15 min", shown bold; null when the step has none. */
  label: string | null;
  text: string;
}

const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/;
// Words whose trailing dot doesn't end a sentence.
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|approx|vs|min|max|sec|incl)\.$/i;
const MAX_LABEL = 40;

/**
 * Turns coach-written text (plan details, coach notes, review summaries) into short steps for a bullet list.
 * Line-separated text (the format the coach is asked for) gives one step per line; older text written as one
 * paragraph is split into sentences and at semicolons. A short lead-in before ": " becomes the step's label.
 */
export function textSteps(text: string | null | undefined): PlanStep[] {
  if (!text?.trim()) return [];
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean);
  const parts = lines.length > 1 ? lines : splitSentences(lines[0]).flatMap(splitClauses);
  return parts.map(toStep);
}

export const planSteps = textSteps;

// "Tomorrow is rest; tests moved to Thursday" reads as two points.
function splitClauses(sentence: string): string[] {
  return sentence
    .split(/;\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c, i) => (i === 0 ? c : c[0].toUpperCase() + c.slice(1)));
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of text.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)) {
    current = current ? `${current} ${piece}` : piece;
    if (!ABBREVIATIONS.test(current)) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function toStep(part: string): PlanStep {
  const text = part.replace(/\.$/, "");
  const i = text.indexOf(": ");
  if (i > 0 && i <= MAX_LABEL) {
    const rest = text.slice(i + 2).trim();
    if (rest) return { label: text.slice(0, i).trim(), text: rest };
  }
  return { label: null, text };
}
