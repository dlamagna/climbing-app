// Optional: lets Claude file and list issues on the app's own GitHub repo ("log an idea: ...").
// Enabled only when GITHUB_TOKEN is set: a fine-grained token limited to this repo with Issues: read & write.

import type { Env } from "./db";

// Must already exist in the repo; a token with only Issues permission can't create labels.
export const ISSUE_LABELS = ["enhancement", "bug", "testing", "infra", "health-data", "security", "coach"];

// Priority labels ("priority: P1"), also pre-created in the repo.
export const PRIORITIES = ["P0", "P1", "P2"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_TEXT = "P0 = broken or blocking daily use, P1 = worth doing soon, P2 = nice to have";
export const priorityLabel = (p: Priority) => `priority: ${p}`;

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
      const next = roadmapWithIssue(current.body ?? "", issue.number, milestone?.title ?? null);
      if (next !== current.body) await github(env, `/issues/${roadmap}`, { method: "PATCH", body: JSON.stringify({ body: next }) });
      result.roadmap = `added to #${roadmap}`;
    } catch (e) {
      result.roadmap = `not added to #${roadmap}: ${(e as Error).message}`; // the issue itself was filed
    }
  }
  return result;
}
