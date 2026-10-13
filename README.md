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
- "How should I train today?" (Claude can save the answer as a coach note on the Today screen)
- "How did drinking and sleep affect my sessions this month?"

## Your data stays private

The code is public; the data isn't. Everything you log lives in your own D1 database in your own
Cloudflare account, and every API and MCP request needs one of the two tokens. Those tokens exist only as
Cloudflare secrets and in your git-ignored `.tokens` file. Anyone can deploy their own copy with their
own database, but they can't read yours. The `database_id` in `wrangler.jsonc` is fine to publish: it's
useless without access to the Cloudflare account it belongs to.

## Develop

```sh
npm run db:migrate:local
npm run serve            # builds, then runs the full app on http://localhost:8787 (tokens in .dev.vars)
npm run dev              # optional: Vite hot reload on :5173, proxying /api to :8787
```

Schema changes: add `migrations/000N_name.sql`, then run `npm run db:migrate:local` / `db:migrate:remote`.

## What's where

| | |
|---|---|
| `worker/index.ts` | REST API for the app (bearer `APP_TOKEN`) and MCP routing (`MCP_TOKEN`) |
| `worker/mcp.ts` | MCP server: tools, plus instructions telling Claude how to coach from the data |
| `worker/db.ts` | Queries shared by both, including training-load maths |
| `migrations/` | Schema (column comments are what Claude sees via `get_schema`) and default timer presets |
| `src/pages/` | Today, Log, Timer, History, Plan, Injuries, Benchmarks, Settings |
| `src/timer.ts` | Hangboard phase sequencing, beeps, screen wake lock |

Training load = minutes × effort (1-10), compared with your average week over the previous four.
Finger load (boulder, board, lead, hangboard) is tracked separately.

Offline: the app shell and the timer work without signal; writes made offline are queued and sync later.

## Roadmap

See the pinned [Roadmap issue](https://github.com/dlamagna/climbing-app/issues/14).

## Licence

MIT, see [LICENSE](LICENSE).
