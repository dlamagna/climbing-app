// The roadmap checklist edit done after report_issue files an issue (#52).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./db";
import { INBOX_HEADING, createIssue, deployedEpoch, issueStatus, roadmapWithIssue, withIssueStatus } from "./github";

const ROADMAP = [
  "Planned work, grouped by milestone.",
  "",
  "### v1.1 - Polish",
  "- [x] #1",
  "- [ ] #2",
  "",
  "### v2 - Later",
  "- [ ] #7",
  "",
  "Ideas welcome: open an issue.",
  "",
  "---",
  "_footer_",
].join("\n");

describe("roadmapWithIssue", () => {
  it("adds the issue at the end of its milestone's section", () => {
    const out = roadmapWithIssue(ROADMAP, 60, "v1.1 - Polish").split("\n");
    expect(out.slice(2, 7)).toEqual(["### v1.1 - Polish", "- [x] #1", "- [ ] #2", "- [ ] #60", ""]);
  });

  it("puts issues without a known milestone in a new inbox section before the trailing text", () => {
    const out = roadmapWithIssue(ROADMAP, 61, null);
    expect(out).toContain(`- [ ] #7\n\n${INBOX_HEADING}\n- [ ] #61\n\nIdeas welcome`);
    expect(roadmapWithIssue(ROADMAP, 61, "v9 - Nope")).toBe(out);
    // and reuses it next time
    expect(roadmapWithIssue(out, 62, null)).toContain(`${INBOX_HEADING}\n- [ ] #61\n- [ ] #62\n`);
  });

  it("leaves the body alone when the issue is already listed", () => {
    expect(roadmapWithIssue(ROADMAP, 7, "v1.1 - Polish")).toBe(ROADMAP);
    expect(roadmapWithIssue(ROADMAP, 1, null)).toBe(ROADMAP);
  });

  it("doesn't mistake #70 for #7", () => {
    expect(roadmapWithIssue(ROADMAP, 70, "v2 - Later")).toContain("- [ ] #7\n- [ ] #70\n");
  });

  it("works on an empty body", () => {
    expect(roadmapWithIssue("", 5, null)).toBe(`\n\n${INBOX_HEADING}\n- [ ] #5`);
  });
});

describe("createIssue", () => {
  const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", GITHUB_ROADMAP_ISSUE: "14" } as unknown as Env;
  const calls: { method: string; path: string; body: any }[] = [];
  let roadmap = ROADMAP;

  function mockGithub(fail?: string) {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://api.github.com/repos/o/r", "");
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (fail && path.startsWith(fail)) return new Response(JSON.stringify({ message: "nope" }), { status: 403 });
      if (path.startsWith("/milestones")) return Response.json([{ number: 2, title: "v2 - Later", description: null }]);
      if (path === "/issues" && method === "POST") return Response.json({ number: 60, html_url: "https://github.com/o/r/issues/60" });
      if (path === "/issues/14" && method === "GET") return Response.json({ body: roadmap });
      if (path === "/issues/14" && method === "PATCH") return Response.json({ body: (roadmap = body.body) });
      return new Response("not mocked", { status: 500 });
    });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    roadmap = ROADMAP;
  });

  it("files with priority label and milestone, then lists it in the roadmap", async () => {
    mockGithub();
    const r = await createIssue(env, "Louder timer", "body", { labels: ["enhancement", "not-a-label"], priority: "P2", milestone: "v2 - later" });
    expect(r).toEqual({ number: 60, url: "https://github.com/o/r/issues/60", roadmap: "added to #14" });
    const post = calls.find((c) => c.path === "/issues")!;
    expect(post.body).toMatchObject({ title: "Louder timer", labels: ["enhancement", "priority: P2"], milestone: 2 });
    expect(roadmap).toContain("- [ ] #7\n- [ ] #60\n");
  });

  it("rejects an unknown milestone before filing anything", async () => {
    mockGithub();
    await expect(createIssue(env, "t", "b", { milestone: "v9" })).rejects.toThrow(/No open milestone/);
    expect(calls.some((c) => c.path === "/issues")).toBe(false);
  });

  it("still returns the issue when the roadmap can't be edited, and can skip the roadmap", async () => {
    mockGithub("/issues/14");
    expect((await createIssue(env, "t", "b")).roadmap).toMatch(/not added to #14: GitHub 403/);
    mockGithub();
    expect(await createIssue(env, "t", "b", { addToRoadmap: false })).toEqual({ number: 60, url: "https://github.com/o/r/issues/60" });
    expect(calls.map((c) => c.path)).toEqual(["/issues"]);
  });
});

describe("issueStatus (#70)", () => {
  const deployed = Date.parse("2026-03-10T12:00:00Z") / 1000;
  const closed = (closed_at: string, state_reason = "completed") => ({ number: 5, state: "closed", state_reason, closed_at });

  it("is open while the issue is open", () => {
    expect(issueStatus({ number: 5, state: "open", state_reason: null, closed_at: null }, deployed)).toBe("open");
  });

  it("is live when the issue closed before the deployed commit, allowing a little slack", () => {
    expect(issueStatus(closed("2026-03-09T08:00:00Z"), deployed)).toBe("live");
    expect(issueStatus(closed("2026-03-10T12:01:00Z"), deployed)).toBe("live");
  });

  it("is deploying when the issue closed after the running build", () => {
    expect(issueStatus(closed("2026-03-10T12:30:00Z"), deployed)).toBe("deploying");
  });

  it("is merged when the deployed commit time is unknown", () => {
    expect(issueStatus(closed("2026-03-09T08:00:00Z"), null)).toBe("merged");
  });

  it("is closed when the issue was closed without a fix", () => {
    expect(issueStatus(closed("2026-03-09T08:00:00Z", "not_planned"), deployed)).toBe("closed");
    expect(issueStatus(closed("2026-03-09T08:00:00Z", "duplicate"), deployed)).toBe("closed");
  });

  it("reads the deployed commit time from the env", () => {
    expect(deployedEpoch({ DEPLOYED_COMMIT_EPOCH: "1773144000" } as unknown as Env)).toBe(1773144000);
    expect(deployedEpoch({} as unknown as Env)).toBeNull();
    expect(deployedEpoch({ DEPLOYED_COMMIT_EPOCH: "soon" } as unknown as Env)).toBeNull();
  });
});

describe("withIssueStatus (#70)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", DEPLOYED_COMMIT_EPOCH: String(Date.parse("2026-03-10T12:00:00Z") / 1000) } as unknown as Env;
  const rows = [
    { id: 3, issue_number: 40 },
    { id: 2, issue_number: 41 },
    { id: 1, issue_number: null },
  ];

  it("adds each linked issue's status and skips pull requests", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify([
          { number: 42, state: "open", state_reason: null, closed_at: null, pull_request: {} },
          { number: 41, state: "open", state_reason: null, closed_at: null },
          { number: 40, state: "closed", state_reason: "completed", closed_at: "2026-03-09T08:00:00Z" },
        ]),
      );
    });
    const out = await withIssueStatus(env, rows);
    expect(out.map((r) => r.issue_status)).toEqual(["live", "open", null]);
    expect(calls).toEqual(["https://api.github.com/repos/o/r/issues?state=all&per_page=100&page=1"]);
  });

  it("leaves the status out when GitHub fails or isn't set up", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));
    expect((await withIssueStatus(env, rows)).map((r) => r.issue_status)).toEqual([null, null, null]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await withIssueStatus({} as unknown as Env, rows)).map((r) => r.issue_status)).toEqual([null, null, null]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
