// "What the coach does": pre-written sample replies showing how Claude uses the app in real life.
// Nothing here talks to Claude or any AI. Each example writes its canned output (a coach note, plan,
// question...) into the visitor's local demo database through the same MCP tool code the real
// connector uses, so it shows up in the app.

import { addDays, localToday } from "../src/dates";
import type { DemoBackend } from "./backend";

interface Step {
  tool: string; // MCP tool name, shown as a chip
  // Fixed, or worked out from the earlier steps' results (null skips the step).
  args?: Record<string, unknown> | ((results: unknown[]) => Record<string, unknown> | null);
}

export interface Example {
  prompt: string;
  steps: Step[];
  reply: (results: unknown[]) => string; // HTML-free text; blank lines split paragraphs
  open?: string; // app route where the result shows
  openLabel?: string;
}

const today = () => localToday();
const nextDays = (n: number) => Array.from({ length: n }, (_, i) => addDays(today(), i + 1));
const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay();

const TODAY_NOTE = `Today: open-hand bouldering, 75 min, RPE 7 max.
Warm-up 15 min easy + Abrahangs (10 x 10 s, feet on).
Main: 5 slopers/pinches problems at 6B-6C, 3 goes each, 3 min rest.
Avoid: crimps, the board, anything that makes the ring finger ache. Stop at pain 2.`;

export const EXAMPLES: Example[] = [
  {
    prompt: "How should I train today?",
    steps: [{ tool: "get_overview" }, { tool: "add_coach_note", args: { text: TODAY_NOTE } }],
    reply: (r) => {
      const o = r[0] as { readiness?: { level: string; reasons: string[] }; active_injuries?: unknown[] };
      const level = o.readiness?.level ?? "amber";
      const reason = o.readiness?.reasons?.[0];
      return `Readiness is ${level}${reason ? ` (${reason.replace(/\.$/, "")})` : ""}. The ring finger is at pain 1 and trending down, so today is about moving well without loading the pulley.

${TODAY_NOTE}

I saved this as today's coach note, so it's on your Coach tab.`;
    },
    open: "coach",
    openLabel: "See it on the Coach tab",
  },
  {
    prompt: "Plan my next week around the finger",
    steps: [
      { tool: "get_overview" },
      {
        tool: "set_plan",
        args: () => ({
          keep_app_entries: true,
          entries: nextDays(7).map((date) => {
            const d = weekday(date);
            if (d === 1) return { date, title: "Open-hand bouldering", type: "boulder", intensity: "moderate", duration_min: 75, details: "Slopers and pinches only, 6B-6C. No crimps, no board." };
            if (d === 2) return { date, title: "Abrahangs", type: "hangboard", intensity: "easy", duration_min: 15, details: "10 x 10 s at ~40% effort, feet on. Tendon health, not training." };
            if (d === 3) return { date, title: "Lead mileage", type: "lead", intensity: "moderate", duration_min: 90, details: "6 routes at 6b, rest 5 min. Pick jugs over crimps." };
            if (d === 5) return { date, title: "Strength + core", type: "strength", intensity: "moderate", duration_min: 45, details: "Pull-ups 5 x 5, front lever 4 x 8 s, antagonists." };
            if (d === 6) return { date, title: "Max hang test + bouldering", type: "boulder", intensity: "hard", duration_min: 110, details: "If pain is 0 for 3 days: test the max hang, then normal session. Otherwise open-hand only.", expected_benchmarks: [{ name: "Max hang 20mm 10s", unit: "kg added" }] };
            return { date, title: "Rest", type: "rest", intensity: "rest", details: "Walk, mobility, sleep." };
          }),
        }),
      },
    ],
    reply: () => `Done: the next 7 days are in your plan.

- Mon: open-hand bouldering, no crimps
- Tue: Abrahangs only (tendon health)
- Wed: lead mileage on jugs
- Fri: strength + core
- Sat: max hang test if the finger has been pain-free for 3 days, else open-hand only

The Saturday test is attached to the plan, so the app asks for the result when you log the session.`,
    open: "plan",
    openLabel: "Open the plan",
  },
  {
    prompt: "Run tonight's coach review",
    steps: [
      { tool: "start_daily_review" },
      {
        tool: "resolve_feedback",
        args: (r) => {
          const fb = (r[0] as { changes?: { new_feedback?: { id: number }[] } }).changes?.new_feedback?.[0];
          return fb ? { id: fb.id, status: "filed", issue_number: 64, reply: "Good idea, filed as #64 for the next release" } : null;
        },
      },
      {
        tool: "ask_question",
        args: { question: "Did Saturday's session feel harder than planned?", why: "Sets next week's volume.", options: ["Easier", "As planned", "Harder"] },
      },
      {
        tool: "record_coach_run",
        args: {
          outcome: "updated",
          summary: "Good week: 4 of 5 planned sessions done, finger improving. Next week stays open-hand.",
          changes: ["Kept next week's plan", "Asked how Saturday felt"],
        },
      },
    ],
    reply: (r) => {
      const s = r[0] as { review_needed?: boolean; reasons?: string[] };
      const why = s.reasons?.length ? s.reasons.join("; ") : "nothing new since last night";
      const filed = r[1] ? " It also filed your app feedback as an issue (see More → App feedback)." : "";
      return `The review runs by itself every evening. It looks at what changed since the last run. This time: ${why}.

It left a summary on the Coach tab and asked you one question there; your answer goes to the next review.${filed}`;
    },
    open: "coach",
    openLabel: "See it on the Coach tab",
  },
  {
    prompt: "Does sleep change how my sessions go?",
    steps: [
      {
        tool: "query",
        args: {
          sql: `SELECT CASE WHEN c.sleep_hours < 7 THEN 'under 7 h' ELSE '7 h or more' END AS sleep,
                       COUNT(*) AS sessions, ROUND(AVG(s.rpe), 1) AS avg_rpe, ROUND(AVG(s.duration_min)) AS avg_min
                FROM sessions s JOIN checkins c ON c.date = s.date
                WHERE s.type IN ('boulder', 'lead', 'board')
                GROUP BY 1 ORDER BY 1`,
        },
      },
    ],
    reply: (r) => {
      const rows = (r[0] as { sleep: string; sessions: number; avg_rpe: number; avg_min: number }[]) ?? [];
      const lines = rows.map((x) => `- ${x.sleep}: ${x.sessions} sessions, average effort ${x.avg_rpe}/10, ${x.avg_min} min`);
      return `I ran a query over your climbing sessions and that morning's check-in:

${lines.join("\n")}

The coach can answer questions like this from any of your data with read-only SQL.`;
    },
  },
  {
    prompt: "I tweaked my shoulder on a dyno",
    steps: [
      {
        tool: "report_injury",
        args: { body_part: "Shoulder - front", side: "right", description: "Twinge catching a dyno, fine at rest, sore reaching overhead.", pain: 3 },
      },
    ],
    reply: () => `Sorry to hear that. I've added it to your injuries, so the morning check-in now asks about the shoulder each day (pain, trend, stiffness, red flags) and readiness takes it into account.

Until it settles: no dynos or big shoulder moves, keep climbing below the shoulder line, and skip overhead pressing.`,
    open: "injuries",
    openLabel: "Open Injuries",
  },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Text with blank-line paragraphs and "- " lists, as safe HTML.
function render(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p>${lines.map(esc).join("<br>")}</p>`;
    })
    .join("");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The panel: example prompts as chips, then the canned conversation. onOpen(route) shows the app there,
// once when the reply arrives (clicked false) and again from its button (clicked true).
export function mountCoachPanel(root: HTMLElement, getBackend: () => Promise<DemoBackend>, onOpen: (route: string, clicked: boolean) => void) {
  root.innerHTML = `
    <div class="coach-log" aria-live="polite"></div>
    <div class="coach-chips"></div>`;
  const log = root.querySelector<HTMLElement>(".coach-log")!;
  const chips = root.querySelector<HTMLElement>(".coach-chips")!;
  let busy = false;

  const add = (cls: string, html: string) => {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  async function play(ex: Example) {
    if (busy) return;
    busy = true;
    chips.classList.add("busy");
    log.innerHTML = "";
    add("msg user", esc(ex.prompt));
    const backend = await getBackend();
    const results: unknown[] = [];
    try {
      for (const step of ex.steps) {
        const args = typeof step.args === "function" ? step.args(results) : step.args;
        if (args === null) {
          results.push(null);
          continue;
        }
        const chip = add("tool", `<span class="tool-dot"></span>${esc(step.tool)}`);
        await wait(450);
        results.push(await backend.mcp(step.tool, args));
        chip.classList.add("done");
      }
      await wait(250);
      const msg = add("msg coach", render(ex.reply(results)));
      if (ex.open) {
        const btn = document.createElement("button");
        btn.className = "coach-open";
        btn.textContent = `${ex.openLabel ?? "Open"} →`;
        btn.onclick = () => onOpen(ex.open!, true);
        msg.append(btn);
        onOpen(ex.open, false);
      }
    } catch (e) {
      add("msg coach error", esc(`Something went wrong in the demo: ${(e as Error).message}`));
    } finally {
      busy = false;
      chips.classList.remove("busy");
    }
  }

  for (const ex of EXAMPLES) {
    const b = document.createElement("button");
    b.className = "coach-chip";
    b.textContent = ex.prompt;
    b.onclick = () => void play(ex);
    chips.append(b);
  }
  add("msg coach intro", render("Pick a question below to see a sample of what the coach does. The replies are pre-written: no AI runs in this demo. Each one saves its result into the demo data, so you can see where it shows up in the app."));
}
