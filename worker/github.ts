// Optional: lets Claude file and list issues on the app's own GitHub repo ("log an idea: ...").
// Enabled only when GITHUB_TOKEN is set: a fine-grained token limited to this repo with Issues: read & write.

import type { Env } from "./db";

// Must already exist in the repo; a token with only Issues permission can't create labels.
export const ISSUE_LABELS = ["enhancement", "bug", "testing", "infra", "health-data", "security", "coach"];

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

export async function createIssue(env: Env, title: string, body: string, labels: string[] = []) {
  const issue = await github<Issue>(env, "/issues", {
    method: "POST",
    body: JSON.stringify({
      title,
      body: `${body}\n\n---\n_Filed from Claude via the climbing-app MCP server._`,
      labels: labels.filter((l) => ISSUE_LABELS.includes(l)),
    }),
  });
  return { number: issue.number, url: issue.html_url };
}
