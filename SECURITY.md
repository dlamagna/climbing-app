# Security policy

Climb Log is self-hosted: everyone who deploys it runs their own Worker and their own D1 database in their
own Cloudflare account. A vulnerability in the code can therefore affect every copy, and a fix only reaches a
copy when its owner syncs their fork and redeploys.

## Supported versions

Only the latest `main` is supported. There are no release branches; fixes land on `main`.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/dlamagna/climbing-app/security/advisories/new).

Include what an attacker can do, the steps to reproduce, and the commit you tested. This is a spare-time
project: expect an acknowledgement within a week. Once a fix is merged, the advisory is published so that
self-hosters know to update. Credit is given unless you'd rather not be named.

### In scope

- Getting past the `APP_TOKEN` / `MCP_TOKEN` checks, or reading or writing data without a valid token
- Anything that lets content stored in the database (session notes, feedback, plan text) make Claude take
  actions the owner didn't ask for, beyond what the tools are documented to do
- Personal data leaving the owner's database unintentionally, for example through issues filed by
  `report_issue`, logs, error messages or the export
- Weaknesses in the GitHub Actions workflows, such as secrets exposed to pull requests from forks

### Out of scope

- A deployment whose tokens were shared, committed or otherwise leaked by its owner
- Bugs in Cloudflare, GitHub or Claude themselves (report those to the vendor)
- The public demo, which runs entirely in the visitor's browser on sample data

## Hardening your own deployment

- Generate both tokens with `openssl rand -hex 24`, keep them in a password manager, and rotate one with
  `npx wrangler secret put <NAME>` if it might have leaked. The worker rejects all requests while a token
  still holds the `replace-me` placeholder from `.dev.vars.example`.
- The Claude connector URL contains `MCP_TOKEN`: treat the whole URL as a secret.
- Give the optional `GITHUB_TOKEN` access to your own fork only, with **Issues: Read and write** and nothing
  else, and set `GITHUB_REPO` in `wrangler.jsonc` to that fork.
- The Cloudflare API token used by CI needs only *Workers Scripts: Edit* and *D1: Edit*.
- D1 Time Travel can roll the database back up to 7 days (30 on paid plans); export regularly if you want a
  longer history.
