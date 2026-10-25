# Notes for Claude

## This repo is public: no personal data, ever

The code is public, the training data is private. Nothing that comes from the owner's real data or life goes into this repo, in any form:

- issue and PR titles, bodies and comments (including ones filed through the MCP `report_issue` tool)
- commit messages
- code, comments, test fixtures, seed data, migrations
- README and other docs

Personal data includes anything read through `get_overview` or `query`, or from the owner's messages: session notes (quoted or paraphrased), injuries and body parts, check-in values (sleep, feeling, drinks, protein, weight), how a real week went against the plan, profile facts (city, gym, trip dates or destinations, level, goals, availability), devices, and the deployed worker URL.

- Explain why a change is needed in general terms ("a hard session can be logged on a low-readiness day"), not as an account of what happened ("last week a long session was done after drinks").
- Test data is made up. Don't copy real notes, injuries or numbers into fixtures, even with small changes.
- **Issues, PRs and comments must contain nothing personal.** Before creating or editing one, reread it for details that came from real data. Issues filed from the Claude app through `report_issue` follow the same rule. If an existing one turns out to contain personal data, rewrite it, and tell the owner to delete the old version from its "edited" history, since GitHub keeps every earlier version publicly visible.
- Never commit `.dev.vars`, `.tokens`, database exports or token values.
- CI's `scan` job fails on committed secrets (gitleaks) and on any phrase from the `PERSONAL_DENYLIST` repo secret, checking files and every commit's message and author. To block a new personal phrase, add it to that secret (`gh secret set PERSONAL_DENYLIST`), never to a file in the repo. The check is a safety net, not a substitute for rereading.

## Git

- Claude sessions commit as `Claude <noreply@anthropic.com>` (they sign those commits, so GitHub shows them as Verified). Otherwise commit with the GitHub noreply address (`191261820+dlamagna@users.noreply.github.com`). Never a personal email.
- `main` is protected: changes go through a pull request, and CI's `build` check must pass. Merging to `main` deploys to Cloudflare.
- Run wrangler as `env -u CLOUDFLARE_API_TOKEN npx wrangler ...` locally. The shell exports a token for another project that overrides the wrangler login.
