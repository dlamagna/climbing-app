# Climb Log

Personal climbing-training app for the phone: a 3-tap morning check-in (sleep, feeling, drinks, protein),
session logging with automatic training load, a customisable hangboard timer, injury tracking that only
appears when you're injured, and a plan + coach notes that Claude writes for you over MCP.

Everything runs on Cloudflare's free tier: one Worker serves the app, its API and the MCP server,
with a D1 (SQLite) database. There are no Claude API costs; Claude reads and writes the data through a
custom connector on your normal Claude plan.

```
iPhone (home-screen web app) ──/api──▶ Cloudflare Worker ──▶ D1 database
Claude app / Claude Code ─────/mcp──▶        ″
```

## Deploy (one time, ~10 minutes)

```sh
npm install
npx wrangler login                        # opens a browser to sign in to (free) Cloudflare
npx wrangler d1 create climbing           # replace the database_id in wrangler.jsonc with the printed one
npm run db:migrate:remote                 # create the tables

# Generate the two access tokens, save them to .tokens (git-ignored) and upload them as secrets.
umask 077; for name in APP_TOKEN MCP_TOKEN; do
  t=$(openssl rand -hex 24); echo "$name=$t" >> .tokens; echo "$t" | npx wrangler secret put $name
done

npm run deploy                            # prints https://climbing-app.<you>.workers.dev
```

**Auto-deploy.** After the first manual deploy, every push to `main` is deployed by GitHub Actions
(`.github/workflows/ci.yml`): the `build` job runs on every push and PR, and on `main` the `deploy`
job then applies D1 migrations and runs `wrangler deploy`. It needs two repo secrets (Settings →
Secrets and variables → Actions): `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` (a custom
token with *Workers Scripts: Edit* and *D1: Edit*). The worker's own secrets stay in Cloudflare.

`cat .tokens` shows both tokens; keep them in a password manager. A secret can't be read back from
Cloudflare. If you lose one, run the loop again for that name.

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
your repo with **Issues: Read and write** (nothing else), set `GITHUB_REPO` in `wrangler.jsonc`, then:

```sh
npx wrangler secret put GITHUB_TOKEN
```

Without the secret, the two tools are hidden.

Issues filed this way can carry a priority (`priority: P0`/`P1`/`P2` labels, which must exist in the repo)
and a milestone, and are added to the checklist in the roadmap issue named by `GITHUB_ROADMAP_ISSUE` in
`wrangler.jsonc` (under the milestone's `### <title>` heading, or an inbox section).

### Optional: daily coach review

A scheduled Claude run can review your data once a day without an API key. It runs as a Claude Code
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

With the routines' API triggers set up, the coach review starts by itself about 30 minutes after you log
a training session, and the issue worker (if you have one) starts once the review has finished. A hangboard
run saved as a warm-up isn't a session, so it starts nothing. If you log several sessions close together,
the review waits until 30 minutes after the last one. Coach → Coach activity shows when the next start is
due and can also start either routine by hand.

For each routine, open it at [claude.ai/code/routines](https://claude.ai/code/routines), add an
**API** trigger and generate a token. The token is shown once, next to the trigger's URL. Store both as
worker secrets:

```sh
npx wrangler secret put COACH_REVIEW_FIRE_URL     # https://api.anthropic.com/v1/claude_code/routines/trig_.../fire
npx wrangler secret put COACH_REVIEW_FIRE_TOKEN   # sk-ant-oat01-...
npx wrangler secret put ISSUE_WORKER_FIRE_URL     # optional, same for the issue worker
npx wrangler secret put ISSUE_WORKER_FIRE_TOKEN
```

Without them, the buttons are hidden and nothing starts automatically. The routines then need a schedule
of their own. With them, the routines don't need a schedule: remove it, or they run on both. A cron
trigger in `wrangler.jsonc` checks every 5 minutes, so a start can come up to 5 minutes late. Each token
can only start its own routine. Runs started this way count against your Claude subscription like
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
npm run db:migrate:local
npm run serve            # builds, then runs the full app on http://localhost:8787 (tokens in .dev.vars)
npm run dev              # optional: Vite hot reload on :5173, proxying /api to :8787
```

Schema changes: add `migrations/000N_name.sql`, then run `npm run db:migrate:local`. Merging to `main` applies it remotely.

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

Training load = minutes × effort (1-10), compared with your average week over the previous four.
Finger load (boulder, board, lead, top rope, hangboard) is tracked separately.

Offline: the app shell and the timer work without signal; writes made offline are queued and sync later.

## Roadmap

See the pinned [Roadmap issue](https://github.com/dlamagna/climbing-app/issues/14).

## Licence

MIT, see [LICENSE](LICENSE).
