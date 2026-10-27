# Contributing to Climb Log

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome. This is a small project run in
spare time, so a short, focused change with a clear reason is the easiest thing to review and merge.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through
[SECURITY.md](SECURITY.md), not public issues.

## Ways to help

- **Report a bug or a deployment problem** with the [issue forms](https://github.com/dlamagna/climbing-app/issues/new/choose).
  Say what you did, what you expected and what happened. Leave out your own training data (see
  [Privacy](#privacy-the-one-hard-rule)).
- **Suggest a feature.** Check the [roadmap issue](https://github.com/dlamagna/climbing-app/issues/14) and
  open issues first. For anything bigger than a small change, open an issue to agree on the approach
  before writing code, so nobody's work is wasted.
- **Pick up an issue** labelled `good first issue` or `help wanted`. Comment that you're on it so two people
  don't do the same thing.
- **Improve the docs**, especially anything that tripped you up while deploying your own copy.

## Development setup

You need Node.js 22.13 or later (CI uses 24) and npm. A Cloudflare account is **not** needed to develop:
`wrangler dev` runs the Worker and a local D1 database on your machine.

```sh
git clone https://github.com/<you>/climbing-app && cd climbing-app
npm ci
cp .dev.vars.example .dev.vars     # then replace both tokens, e.g. with `openssl rand -hex 24`
npm run db:migrate:local           # creates the local database with every migration
npm run serve                      # builds, then serves app + API + MCP on http://localhost:8787
npm run dev                        # optional: Vite hot reload on :5173, proxying /api to :8787
```

The worker rejects every request while a token still starts with `replace-me`, so set real values in
`.dev.vars` before you open the app.

To try the MCP server locally from Claude Code:

```sh
claude mcp add --transport http climbing-local http://localhost:8787/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Before you push, run what CI runs:

```sh
npm test            # vitest: worker logic, SQL against every migration, app helpers
npm run build       # typechecks the app and the worker, then builds dist/
npm run build:demo  # the public demo must keep building
```

[README → What's where](README.md#whats-where) maps the code.

## How the code is organised

- **One Worker, three front doors.** `worker/index.ts` serves the phone app's REST API (`APP_TOKEN`) and
  routes `/mcp` to the MCP server (`MCP_TOKEN`). Validation and writes shared by both live in their own
  modules (`worker/sessions.ts`, `injuries.ts`, `checkins.ts`, ...). Put new logic there, not in a route
  handler, so the app and Claude behave the same.
- **MCP tool descriptions and server instructions are product.** They are what Claude reads to decide how to
  coach. Changes to their wording deserve the same care as code, and a sentence in the PR on why.
- **Tests sit next to the code** as `*.test.ts` and run under Node with vitest. SQL is tested against an
  in-memory SQLite with every migration applied (see `worker/partial.test.ts`). Pure functions are preferred
  so they can be tested without the Workers runtime.
- **The demo** (`demo/`) runs the same worker code in the browser on sql.js. If you add a table, an API
  route or an MCP tool, check the demo still works with `npm run demo`.

## Database migrations

Every deployed copy applies new migrations automatically on its next deploy, against data you can't see.
So:

- Add a new file, `migrations/00NN_short_name.sql`, numbered after the last one. **Never edit a migration
  that has been merged**; deployed databases have already applied it.
- Prefer additive changes (new tables, new nullable columns or columns with a default). A destructive change
  (dropping or renaming columns, rewriting rows) needs an issue first and a note in the PR on how existing
  data is carried over.
- Document every new column in `worker/schema-docs.ts`. `worker/schema-docs.test.ts` fails if one is missing,
  and Claude reads these docs through `get_schema`.
- D1 strips SQL comments when applying, so comments in migration files are for developers only.

PRs that touch `migrations/` are always merged by hand by the maintainer.

## Privacy: the one hard rule

The code is public; everyone's training data is private. Nothing from a real person's training log goes into
the repository, issues or pull requests: no session notes, injuries, check-in values, places, dates, goals
or deployment URLs, not even lightly edited.

- Test fixtures and demo data (`demo/seed.ts`) are invented.
- Explain why a change is needed in general terms ("a session can be logged on a low-readiness day"), not as
  an account of someone's week.
- Never commit `.dev.vars`, `.tokens`, database exports or token values. CI's `scan` job runs gitleaks on
  every push and pull request.

## Pull requests

1. Fork, then branch from `main`.
2. Keep the PR to one change. Unrelated fixes go in their own PR.
3. Write commit messages and the PR title as `area: what changes`, in the imperative, for example
   `timer: keep the screen awake during rest` or `docs: explain token rotation`.
4. Fill in the PR template: what changes, why, and how you tested it. Add a screenshot for UI changes.
5. CI (`build` and `scan`) must pass. The maintainer reviews, then squash-merges.

Merging to `main` deploys the upstream maintainer's own copy, so the bar for `main` is "safe to run in
production for real users". Self-hosters pick up changes by syncing their fork.

### AI-assisted contributions

Using Claude or another assistant is welcome; the project is built that way. [CLAUDE.md](CLAUDE.md) holds the
repo's instructions for Claude Code and applies to your sessions too. You are still the author: read and
understand the change, run the checks, and make sure nothing personal ended up in it. Say in the PR if an
assistant wrote most of it.

## Issues, labels and automation

- `bug`, `enhancement`, `documentation`, `good first issue` and `help wanted` are for everyone.
- `priority: P0` / `P1` / `P2` and `backlog` are the maintainer's planning labels.
- The maintainer's deployment can file issues from in-app feedback and run an automated Claude issue
  worker. That worker only acts on issues **opened by the repository owner**, so issues and comments from
  anyone else are never executed as instructions by an agent; they are triaged by a person.

## Licence

The project is [MIT-licensed](LICENSE). By submitting a contribution you agree that it is licensed under the
same terms.
