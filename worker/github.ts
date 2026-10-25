// Optional: lets Claude file and list issues on the app's own GitHub repo ("log an idea: ...").
// Enabled only when GITHUB_TOKEN is set: a fine-grained token limited to this repo with Issues: read & write.

import type { Env } from "./db";

// Must already exist in the repo; a token with only Issues permission can't create labels.
export const ISSUE_LABELS = ["enhancement", "bug", "testing", "infra", "health-data", "security", "coach"];

// Priority labels ("priority: P1"), also pre-created in the repo.
export const PRIORITIES = ["P0", "P1", "P2"] as const;
export type Priority = (typeof PRIORITIES)[number];
// The same meanings as the app's feedback form (#68): P1 issues are picked up by the issue worker, which runs after the review.
export const PRIORITY_TEXT =
  "P0 = broken or blocking daily use, P1 = worth doing soon (picked up by the issue worker after the next review), P2 = backlog";
export const priorityLabel = (p: Priority) => `priority: ${p}`;

// P2 issues also get this label (pre-created in the repo) and go under the roadmap's BACKLOG_SECTION.
export const BACKLOG_LABEL = "backlog";
export const BACKLOG_SECTION = "Backlog";

// The pinned roadmap issue lists every issue as a "- [ ] #N" line under a "### <milestone>" heading
// (GITHUB_ROADMAP_ISSUE, optional). Issues with no milestone go under INBOX_HEADING.
export const INBOX_HEADING = "### Inbox (filed from the app)";

// The roadmap body with "- [ ] #N" added at the end of the section whose heading starts with `### <section>`
// (the inbox when section is null or not found). Unchanged if #N is already listed.
export function roadmapWithIssue(body: string, issue: number, section: string | null): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (lines.some((l) => new RegExp(`^\\s*- \\[[ x]\\] #${issue}\\b`).test(l))) return body;
  const item = `- [ ] #${issue}`;
  let head = section ? lines.findIndex((l) => l.startsWith(`### ${section}`)) : -1;
  if (head < 0) head = lines.findIndex((l) => l === INBOX_HEADING);
  if (head < 0) {
    // New inbox section before the first line after the last section's list (e.g. "Ideas welcome"), else at the end.
    const lastHead = lines.reduce((acc, l, i) => (l.startsWith("### ") ? i : acc), -1);
    let at = lines.length;
    if (lastHead >= 0) {
      at = lastHead + 1;
      while (at < lines.length && (lines[at].startsWith("- [") || lines[at].trim() === "")) at++;
      while (at > lastHead + 1 && lines[at - 1].trim() === "") at--;
    }
    lines.splice(at, 0, "", INBOX_HEADING, item);
    return lines.join("\n");
  }
  let end = head + 1;
  for (let i = head + 1; i < lines.length && !lines[i].startsWith("### ") && !lines[i].startsWith("---"); i++) {
    if (lines[i].startsWith("- [")) end = i + 1;
  }
  lines.splice(end, 0, item);
  return lines.join("\n");
}

export const githubEnabled = (env: Env) => Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);

async function github<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "climbing-app-mcp", // GitHub rejects requests without one
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`GitHub ${res.status}: ${err?.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface Issue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: { name: string }[];
  milestone: { title: string } | null;
  pull_request?: unknown;
}

export async function listIssues(env: Env, state: "open" | "closed" | "all") {
  const issues = await github<Issue[]>(env, `/issues?state=${state}&per_page=100`);
  return issues
    .filter((i) => !i.pull_request) // the issues endpoint also returns PRs
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels.map((l) => l.name),
      milestone: i.milestone?.title ?? null,
      url: i.html_url,
    }));
}

// The issue worker's own selection rules (its routine prompt), so the app only starts it when it has work.
export const WORKER_PRIORITIES = [priorityLabel("P0"), priorityLabel("P1")];
export const WORKER_SKIP_LABELS = ["backlog", "needs-owner", "wontfix", "duplicate", "question"];

interface OpenItem {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
  pull_request?: unknown;
}

// Issues the worker would pick up from the open issues and PRs (the issues endpoint returns both): opened by
// the repo owner, labelled P0 or P1, none of the skip labels, not the roadmap issue, and not mentioned as #N by
// an open PR. Pure, for tests.
export function workerIssueNumbers(items: OpenItem[], owner: string, roadmap: number | null): number[] {
  const referenced = new Set(
    items
      .filter((i) => i.pull_request)
      .flatMap((p) => [...`${p.title}\n${p.body ?? ""}`.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]))),
  );
  return items
    .filter((i) => {
      if (i.pull_request || i.number === roadmap || referenced.has(i.number)) return false;
      if (i.user?.login.toLowerCase() !== owner.toLowerCase()) return false;
      const labels = i.labels.map((l) => l.name);
      return labels.some((l) => WORKER_PRIORITIES.includes(l)) && !labels.some((l) => WORKER_SKIP_LABELS.includes(l));
    })
    .map((i) => i.number)
    .sort((a, b) => a - b);
}

export async function workerIssues(env: Env): Promise<number[]> {
  const items = await github<OpenItem[]>(env, "/issues?state=open&per_page=100");
  const roadmap = Number(env.GITHUB_ROADMAP_ISSUE);
  return workerIssueNumbers(items, env.GITHUB_REPO!.split("/")[0], Number.isInteger(roadmap) && roadmap > 0 ? roadmap : null);
}

export async function listMilestones(env: Env) {
  const ms = await github<{ number: number; title: string; description: string | null }[]>(env, "/milestones?state=open&per_page=100");
  return ms.map((m) => ({ number: m.number, title: m.title, description: m.description }));
}

export interface IssueOptions {
  labels?: string[];
  priority?: Priority;
  milestone?: string; // an open milestone's title
  addToRoadmap?: boolean; // default true when GITHUB_ROADMAP_ISSUE is set
}

export async function createIssue(env: Env, title: string, body: string, opts: IssueOptions = {}) {
  if (opts.priority !== undefined && !PRIORITIES.includes(opts.priority)) throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
  let milestone: { number: number; title: string } | undefined;
  if (opts.milestone) {
    milestone = (await listMilestones(env)).find((m) => m.title.toLowerCase() === opts.milestone!.toLowerCase());
    if (!milestone) throw new Error(`No open milestone "${opts.milestone}" (list_issues shows the milestones)`);
  }
  const labels = (opts.labels ?? []).filter((l) => ISSUE_LABELS.includes(l));
  if (opts.priority) labels.push(priorityLabel(opts.priority));
  const backlog = opts.priority === "P2";
  if (backlog) labels.push(BACKLOG_LABEL);
  const issue = await github<Issue>(env, "/issues", {
    method: "POST",
    body: JSON.stringify({
      title,
      body: `${body}\n\n---\n_Filed from Claude via the climbing-app MCP server._`,
      labels,
      ...(milestone ? { milestone: milestone.number } : {}),
    }),
  });
  const result: { number: number; url: string; roadmap?: string } = { number: issue.number, url: issue.html_url };
  const roadmap = Number(env.GITHUB_ROADMAP_ISSUE);
  if (opts.addToRoadmap !== false && Number.isInteger(roadmap) && roadmap > 0) {
    try {
      const current = await github<{ body: string | null }>(env, `/issues/${roadmap}`);
      const next = roadmapWithIssue(current.body ?? "", issue.number, backlog ? BACKLOG_SECTION : (milestone?.title ?? null));
      if (next !== current.body) await github(env, `/issues/${roadmap}`, { method: "PATCH", body: JSON.stringify({ body: next }) });
      result.roadmap = `added to #${roadmap}`;
    } catch (e) {
      result.roadmap = `not added to #${roadmap}: ${(e as Error).message}`; // the issue itself was filed
    }
  }
  return result;
}

// --- Feedback issue status (#70) ----------------------------------------------------------------------

// Where a feedback item's issue stands. "merged" is a fix whose deploy status is unknown (no
// DEPLOYED_COMMIT_EPOCH, e.g. local dev); "deploying" is merged but newer than the running build.
export type IssueStatus = "open" | "merged" | "deploying" | "live" | "closed";

export interface IssueState {
  number: number;
  state: string; // "open" | "closed"
  state_reason: string | null; // "completed" | "not_planned" | "duplicate" | "reopened" | null
  closed_at: string | null;
}

// An issue closes a moment after its PR's merge commit is made, so allow a little slack.
const CLOSE_SLACK_SECONDS = 120;

// CI passes the deployed build's commit time (unix seconds) as a var on every deploy.
export function deployedEpoch(env: Env): number | null {
  const n = Number(env.DEPLOYED_COMMIT_EPOCH);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function issueStatus(i: IssueState, deployed: number | null): IssueStatus {
  if (i.state !== "closed") return "open";
  if (i.state_reason === "not_planned" || i.state_reason === "duplicate") return "closed";
  if (deployed === null || !i.closed_at) return "merged";
  return Date.parse(i.closed_at) / 1000 <= deployed + CLOSE_SLACK_SECONDS ? "live" : "deploying";
}

// The states of the given issues, newest first, a page of 100 at a time (at most 3 pages).
export async function issueStates(env: Env, numbers: number[]): Promise<Map<number, IssueState>> {
  const want = new Set(numbers);
  const found = new Map<number, IssueState>();
  for (let page = 1; page <= 3 && found.size < want.size; page++) {
    const issues = await github<(IssueState & { pull_request?: unknown })[]>(
      env,
      `/issues?state=all&per_page=100&page=${page}`,
      { signal: AbortSignal.timeout(4000) },
    );
    for (const i of issues) {
      if (!i.pull_request && want.has(i.number)) {
        found.set(i.number, { number: i.number, state: i.state, state_reason: i.state_reason ?? null, closed_at: i.closed_at ?? null });
      }
    }
    if (issues.length < 100) break;
  }
  return found;
}

// Feedback rows with their issue's status added. Leaves it null when GitHub is off or can't be reached,
// so the feedback page never fails because of it.
export async function withIssueStatus<T extends { issue_number: number | null }>(
  env: Env,
  rows: T[],
): Promise<(T & { issue_status: IssueStatus | null })[]> {
  const numbers = [...new Set(rows.map((r) => r.issue_number).filter((n): n is number => n !== null))];
  let states = new Map<number, IssueState>();
  if (numbers.length > 0 && githubEnabled(env)) {
    try {
      states = await issueStates(env, numbers);
    } catch {
      // status is optional
    }
  }
  const deployed = deployedEpoch(env);
  return rows.map((r) => {
    const s = r.issue_number === null ? undefined : states.get(r.issue_number);
    return { ...r, issue_status: s ? issueStatus(s, deployed) : null };
  });
}
