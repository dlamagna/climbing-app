# Climb Log

[![CI](https://github.com/dlamagna/climbing-app/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dlamagna/climbing-app/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dlamagna/climbing-app)

Personal climbing-training app for the phone: a 3-tap morning check-in (sleep, feeling, drinks, protein),
session logging with automatic training load, a customisable hangboard timer, injury tracking that only
appears when you're injured, and a plan + coach notes that Claude writes for you over MCP.

**Try it: [dlamagna.github.io/climbing-app](https://dlamagna.github.io/climbing-app/)**. The app on a
made-up climber's sample data, running entirely in your browser (see [Public demo](#public-demo)).

Everything runs on Cloudflare's free tier: one Worker serves the app, its API and the MCP server,
with a D1 (SQLite) database. There are no Claude API costs; Claude reads and writes the data through a
custom connector on your normal Claude plan.

```
iPhone (home-screen web app) ──/api──▶ Cloudflare Worker ──▶ D1 database
Claude app / Claude Code ─────/mcp──▶        ″
```

## Deploy your own copy

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, a [GitHub](https://github.com)
account, and a Claude plan that supports custom connectors. Each copy has its own database: nobody else,
including the maintainer, can see your data.

First generate two random tokens and keep them in a password manager. You can't read them back from
Cloudflare later.

```sh
openssl rand -hex 24   # APP_TOKEN: the phone app sends this
openssl rand -hex 24   # MCP_TOKEN: goes in the connector URL you give Claude
```

### Option A: Deploy to Cloudflare button (~5 minutes)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dlamagna/climbing-app)

1. Click the button and sign in to Cloudflare and GitHub.
2. Keep the suggested names. Cloudflare creates a copy of this repo in your GitHub account and a new, empty
   D1 database.
3. Paste your two tokens into `APP_TOKEN` and `MCP_TOKEN`. The worker refuses every request while either still
   holds the `replace-me` placeholder.
4. Keep the build and deploy commands it suggests (`npm run build`, `npm run deploy`) and deploy. The deploy
   command creates the tables, and you get `https://climbing-app.<you>.workers.dev`.

From then on, Cloudflare (Workers Builds) redeploys every push to `main` of your copy, applying new
migrations first. To get updates from this repo:

```sh
git remote add upstream https://github.com/dlamagna/climbing-app   # once
git pull upstream main && git push
```

### Option B: with wrangler (~10 minutes)

Fork the repo, clone your fork, then:

```sh
npm ci
npx wrangler login                        # opens a browser to sign in to Cloudflare
npx wrangler d1 create climbing           # replace the database_id in wrangler.jsonc with the printed one

# Store the two tokens in .tokens (git-ignored) and upload them as secrets.
umask 077; for name in APP_TOKEN MCP_TOKEN; do
  read -rsp "$name: " t; echo; echo "$name=$t" >> .tokens; echo "$t" | npx wrangler secret put $name
done

npm run deploy                            # builds, applies migrations, prints https://climbing-app.<you>.workers.dev
```

Lost a token? Run `npx wrangler secret put APP_TOKEN` (or `MCP_TOKEN`) with a new one.

**Auto-deploy from GitHub Actions.** With two repo secrets in your fork (Settings → Secrets and variables →
Actions), `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a custom token with *Workers Scripts: Edit*
and *D1: Edit*), every push to `main` is deployed by `.github/workflows/ci.yml`: the `build` job runs on
every push and PR, then on `main` the `deploy` job applies D1 migrations and runs `wrangler deploy`. Without
the secrets the deploy job is skipped. Use this or Workers Builds, not both. The worker's own secrets stay
in Cloudflare.

### Then, either way

**On the iPhone:** open the URL in Safari → Share → *Add to Home Screen*. Open it from the home screen
and paste the APP_TOKEN once.

**Claude app (phone + web):** on claude.ai, Settings → Connectors → *Add custom connector*, URL
`https://climbing-app.<you>.workers.dev/mcp/<MCP_TOKEN>`. It then shows up in the iPhone app too.

**Claude Code:**

```sh
claude mcp add --transport http climbing https://climbing-app.<you>.workers.dev/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

Then ask, for example:
- "Fill in my profile: goal is …, trip on …, I can train Mon/Wed/Sat." (or fill it in under More → Profile)
- "Write my training plan up to the trip."
- "How should I train today?" (Claude can save the answer as a coach note on the Coach tab)
- "How did drinking and sleep affect my sessions this month?"

### Optional: file GitHub issues from Claude

Adds `report_issue` and `list_issues` to the connector, so you can say *"log an idea: …"* from the Claude
app. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to
your repo with **Issues: Read and write** (nothing else), set `GITHUB_REPO` in `wrangler.jsonc` to **your own
fork** (it points at this repo by default), then:

```sh
npx wrangler secret put GITHUB_TOKEN
```

Without the secret, the two tools are hidden.

Issues filed this way can carry a priority (`priority: P0`/`P1`/`P2` labels, which must exist in the repo)
and a milestone, and are added to the checklist in the roadmap issue named by `GITHUB_ROADMAP_ISSUE` in
`wrangler.jsonc` (under the milestone's `### <title>` heading, or an inbox section).

### Optional: daily coach review

A Claude run can review your data after each session, or once a day on a schedule, without an API key. It runs as a Claude Code
routine on your own Claude subscription, through the same connector. When nothing new was logged it stops
straight away. Otherwise it:
- adjusts the coming days of the plan around the days you picked to climb, or suggests days from your load
  when you haven't picked any
- may leave a coach note
- may ask you questions, shown as one-tap cards on the Coach tab
- sorts feedback you sent from the app into GitHub issues

Everything coach-related lives on the **Coach** tab: questions, the latest note and review, coach
activity, and notes you send. You choose your climbing days with the weekly pop-up (on Today; it can be
turned off on the Coach tab) or with **Plan my climbing days** on the Coach tab.

**Setup, the routine prompt, testing and troubleshooting: [docs/daily-coach-review.md](docs/daily-coach-review.md).**

### Optional: run the review after each session, or from the app

With the routines' API triggers set up, logging a training session starts the coach review straight away.
When the review finishes, the issue worker (if you have one) starts too, but only when GitHub has open P0
or P1 issues for it, and it's told to work through all of them in one run. A hangboard run counts once you
tap Save and close with *Training session* picked; one saved as a warm-up starts nothing. Coach → Coach
activity shows the last automatic start and can also start either routine by hand.

For each routine, open it at [claude.ai/code/routines](https://claude.ai/code/routines), add an
**API** trigger and generate a token. The token is shown once, next to the trigger's URL. Store both as
worker secrets:

```sh
npx wrangler secret put COACH_REVIEW_FIRE_URL     # https://api.anthropic.com/v1/claude_code/routines/trig_.../fire
npx wrangler secret put COACH_REVIEW_FIRE_TOKEN   # sk-ant-oat01-...
npx wrangler secret put ISSUE_WORKER_FIRE_URL     # optional, same for the issue worker
npx wrangler secret put ISSUE_WORKER_FIRE_TOKEN
```

Without them, the buttons are hidden and nothing starts automatically, so the routines need a schedule of
their own. With them, the routines don't need a schedule: remove it, or they run on both. The issue check
uses `GITHUB_TOKEN`; without it the worker always starts after the review. Each token can only start its
own routine. Runs started this way count against your Claude subscription like
scheduled ones, and each routine can be started up to 30 times an hour.

## Your data stays private

The code is public; the data isn't. Everything you log lives in your own D1 database in your own
Cloudflare account, and every API and MCP request needs one of the two tokens. Those tokens exist only as
Cloudflare secrets and in your git-ignored `.tokens` file. Anyone can deploy their own copy with their
own database, but they can't read yours. The `database_id` in `wrangler.jsonc` is fine to publish: it's
useless without access to the Cloudflare account it belongs to.

## Export and backup

**Export.** More → Profile & settings → *Export my data* downloads one JSON file with every table
(`climbing-export-YYYY-MM-DD.json`). On an iPhone home-screen app it opens the share sheet instead:
pick *Save to Files*. The same file comes from the API:

```sh
curl -H "Authorization: Bearer $APP_TOKEN" -OJ https://climbing-app.<you>.workers.dev/api/export
# one table as CSV, e.g. sessions:
curl -H "Authorization: Bearer $APP_TOKEN" -OJ "https://climbing-app.<you>.workers.dev/api/export?format=csv&table=sessions"
```

The JSON is `{exported_at, schema_version, docs, tables: {name: rows[]}}`. `schema_version` is the last
applied migration and `docs` holds the column descriptions from `worker/schema-docs.ts`, so the file
makes sense on its own. Tables added by later migrations are included automatically.

**Undo a mistake: D1 Time Travel.** D1 keeps a point-in-time history of the database (the last 7 days
on the Workers free plan, 30 days on paid), so a wrong `set_plan` or an accidental delete can be rolled
back. Nothing to set up:

```sh
npx wrangler d1 time-travel info climbing                                     # current bookmark, to undo the restore later
npx wrangler d1 time-travel restore climbing --timestamp=2026-10-01T08:00:00Z # Unix time or RFC 3339
```

A restore **overwrites the whole database** with its state at that moment: everything logged since is
lost (export first if you want to keep it). The restore prints a bookmark you can restore to undo it.

## Develop

```sh
npm ci
cp .dev.vars.example .dev.vars   # then put your own tokens in it
npm run db:migrate:local
npm run serve            # builds, then runs the full app on http://localhost:8787
npm run dev              # optional: Vite hot reload on :5173, proxying /api to :8787
npm test
```

Schema changes: add `migrations/00NN_name.sql`, then run `npm run db:migrate:local`. Every deployed copy
applies it on its next deploy. [CONTRIBUTING.md](CONTRIBUTING.md) has the rules for migrations, tests and
pull requests.

## Public demo

`demo/` is a version you can send to people: the same app and worker code running entirely in the browser,
on a made-up climber's sample data. The worker's Hono app answers `/api` and `/mcp` calls inside the page,
on SQLite compiled to WebAssembly (sql.js) with every migration applied. Changes a visitor makes are saved in
their own browser, and "Reset demo data" puts the sample back. Nothing is sent anywhere: no Cloudflare, no
Claude. The "sample coach" replies are pre-written. They write their output into the demo data through the
same MCP tool code the real connector uses, so visitors can see where coach notes, plans and questions show
up.

On a computer the front page shows the app in a phone frame next to a feature tour and the sample coach.
On a phone the front page has the tour and the sample coach, and its links open the app full screen (which
has a "Sample coach" button too).

```sh
npm run demo         # http://localhost:5173 with hot reload
npm run build:demo   # static files in dist-demo/
```

CI builds it on every push and deploys it to GitHub Pages from `main` (the `demo` job). Sample data lives in
`demo/seed.ts`. It is invented: never copy real logs into it.

## What's where

| | |
|---|---|
| `worker/index.ts` | REST API for the app (bearer `APP_TOKEN`) and MCP routing (`MCP_TOKEN`) |
| `worker/mcp.ts` | MCP server: tools, plus instructions telling Claude how to coach from the data |
| `worker/mcp-writes.ts` | MCP tools that report/update/resolve injuries and edit/delete sessions |
| `worker/coach.ts`, `mcp-coach.ts` | Daily coach review: what changed since the last run, questions, climbing days, run log, app feedback ([docs](docs/daily-coach-review.md)) |
| `worker/injuries.ts`, `sessions.ts`, `checkins.ts` | Validation and writes shared by the REST API and MCP (partial updates via `worker/partial.ts`) |
| `worker/db.ts` | Queries shared by both, including training-load maths |
| `worker/grades.ts` | Grade parsing and conversion (boulder Font <-> V, route French <-> YDS), the ladder index and `get_overview`'s `grade_progress`; also the Log page's grade hint, the grade table and the hardest-grade chart (`src/grades.ts` is the app side) |
| `worker/export.ts` | `GET /api/export` helpers: table list, CSV, filename |
| `migrations/` | Schema and default timer presets (D1 strips SQL comments; column docs for `get_schema` live in `worker/schema-docs.ts`) |
| `src/pages/` | Today, Log, Timer, Coach, History, Plan, Injuries, Benchmarks, Settings, Feedback, Grades (table), GradeProgress (hardest grade over time) |
| `src/timer.ts` | Hangboard phase sequencing, beeps, screen wake lock |
| `demo/` | Public demo: landing page, in-browser D1 (`d1.ts`) and backend (`backend.ts`), sample data (`seed.ts`), sample coach (`coach.ts`) |

Training load = minutes × effort (1-10), compared with your average week over the previous four.
Finger load (boulder, board, lead, top rope, hangboard) is tracked separately.

Offline: the app shell and the timer work without signal; writes made offline are queued and sync later.

## Roadmap

See the pinned [Roadmap issue](https://github.com/dlamagna/climbing-app/issues/14).

## Contributing

Contributions are welcome: bug reports, ideas, docs and code. Read [CONTRIBUTING.md](CONTRIBUTING.md) for
the development setup and how pull requests are reviewed, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
The one hard rule: no real training data in code, fixtures, issues or pull requests.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md), which also has tips for
hardening your own deployment.

## Licence

MIT, see [LICENSE](LICENSE).
