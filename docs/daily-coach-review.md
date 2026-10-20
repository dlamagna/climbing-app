# Daily coach review

A scheduled Claude run that reviews your training data once a day and keeps the app up to date between
conversations. It runs as a [Claude Code routine](https://claude.ai/code/routines) on your own Claude
subscription, so there is no API key and no extra cost. It reads and writes your data through the same MCP
connector you use in the Claude app.

## What a run does

Every run starts with the connector's `start_daily_review` tool. That tool returns what was written since
the last run, a `review_needed` flag with the reasons, and the steps for the run to follow. Those steps live
in the server code, in `REVIEW_INSTRUCTIONS` in [`worker/coach.ts`](../worker/coach.ts), so the routine's
prompt never needs to change.

- **Nothing new** (no sessions logged or edited, no answers, no feedback, plan still filled): the run
  records a `no_change` run and stops. Most rest days end here after a few seconds.
- **Something changed:** the run reads `get_overview` and then:
  - **adjusts the plan** for the next 7 days starting tomorrow, or further when your picked days reach past
    them. It never touches past days, and it
    keeps plan entries you added or marked by hand (`set_plan` with `keep_app_entries`).
  - **fixes today when it doesn't match your pick.** If today is a picked climbing day but today's plan
    has no climbing session (or the other way round), `start_daily_review` returns `today_check`, counts
    it as a reason to review, and the run rewrites today too. It leaves today alone once you've logged a
    climbing session or added or marked today's entry yourself.
  - **plans around your climbing days.** Days you picked are fixed, and the days between them stay light.
    After the last fixed session, including a single one, it plans forward from the next day. With nothing
    picked, it suggests days from your load, readiness and availability, and titles those sessions
    "Suggested: ...".
  - **may leave a coach note** for tomorrow.
  - **may ask you a question** the data can't answer, such as your plans for the week or a trip. It asks at
    most a couple per run and keeps no more than 3 open. They show on the Coach tab as one-tap cards, and Today links there while any are waiting.
  - **sorts app feedback** you sent under More → App feedback. Each item is marked as a duplicate of an
    existing issue, declined, or filed as a GitHub issue with a priority and milestone and added to the
    roadmap issue. Filing needs the [GitHub token](../README.md#optional-file-github-issues-from-claude).
- Every run ends with `record_coach_run`, which logs the outcome. Its timestamp is where the next run starts
  looking for new data. The Coach tab shows what the last review changed.

### Your input in the app

| Where | What | Used by the review |
|---|---|---|
| Coach → *Coach asks* | Questions from the review. Tap an answer, type one, or skip | The next run uses the answer, then closes the question |
| Weekly pop-up (Monday to Wednesday) | *Which days do you plan to climb this week?* | The week's climbing goes on those days |
| Coach → *Plan my climbing days* | Pick days from today to 9 days ahead, with an optional note, any time | Same as the weekly question; the latest pick wins |
| More → App feedback | Bugs and ideas about the app | Sorted into GitHub issues |
| Coach → Weekly pop-up | Turns the weekly pop-up off. The question still shows as a card on the Coach tab | - |
| Coach → *Send a note to the coach* | Free-text context, e.g. a busy week or a goal | Read in the next run |

Answers reach the review the same night. A pick made in the morning changes the plan from tomorrow on,
because the review never rewrites today.

## Set it up

You need:
- your own deployed copy of the app (see [Deploy](../README.md#deploy-one-time-10-minutes))
- the climbing-app connector added in the Claude app (Settings → Connectors). The routine uses the same
  connector.
- a Claude plan that includes Claude Code routines. Each run uses some of your plan's usage, like any Claude
  Code session.
- optionally, the GitHub token, for filing feedback as issues

### With `/schedule` in Claude Code

Run `/schedule` in Claude Code, choose *Create a routine*, and give it:

| Setting | Value |
|---|---|
| Name | e.g. *Climbing daily coach review* |
| Schedule | Daily, after you usually train. The schedule is in **UTC**: for 22:30 at UTC+1, use `30 21 * * *`. Summer time shifts it by an hour, so pick the time for the part of the year you care about most |
| Model | A Sonnet model is plenty. The run reads data and adjusts a plan |
| Environment | Any cloud environment |
| Repository | Your fork of this repo. Routines need a checkout, but the run doesn't change it |
| Connector | Your climbing-app connector |
| Prompt | Below |

You can also create the routine from the web, at [claude.ai/code/routines](https://claude.ai/code/routines),
with the same settings.

### The prompt

```text
Run the daily coach review for the climbing app.

Use the climbing-app MCP connector: call its start_daily_review tool and follow the instructions it
returns exactly. Those instructions say when to stop early (nothing new since the last run), how to
adjust the plan, leave a coach note, ask the climber questions, triage app feedback into GitHub issues,
and that every run must end with record_coach_run.

Rules:
- Work only through the climbing-app tools. Nobody is watching this session, so don't wait for replies;
  questions for the climber go through ask_question.
- Don't change the git repository: no edits, commits, branches or pull requests. The checkout is only
  there because routines need one.
- The GitHub repo is public. Any issue you file with report_issue must be written in general terms with
  nothing personal (no training data, health details, places, dates, trips, names or devices), and must
  never quote the feedback text.
- If a climbing-app tool fails, retry once. If it still fails, stop, and if record_coach_run works,
  record a no_change run whose summary says which tool failed.
- At the end, reply with a 2-3 line summary of what the run did.
```

The short version is also the connector's `daily_review` prompt, so you can start a review by hand from
any Claude chat that has the connector.

### Test it

1. Run the routine once by hand: *Run now* on the routine's page, or `/schedule` → *Run a routine now*.
2. The first run always does a full review (reason: "first review"). It will probably write the coming
   week's plan, and it may ask you something.
3. Open the run from the routine's page and check that it called `start_daily_review` and ended with
   `record_coach_run`, with no permission prompts or tool errors.
4. In the app, check the plan, the coach card ("Daily review · today: ...") and any questions.

## Checking on it

- **In the app:** the Coach tab shows the last review that changed something (*What changed* lists the
  changes) and the coach activity history.
- **In Claude:** ask "when did the daily review last run and what did it do?". `get_overview` returns
  `coach.last_run`. With the `query` tool you can list all runs:
  `SELECT created_at, outcome, summary FROM coach_runs ORDER BY id DESC LIMIT 10`.
- **Run logs:** on the routine's page, or with `/schedule` → list → the routine.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The run can't find `start_daily_review` | The connector isn't attached to the routine, or the deployed app is older than this feature |
| Every run says "no_change" though you trained | The session was logged after the run started; it will be picked up the next night. Or the run failed before `record_coach_run`; check the run log |
| A review on a day with nothing new | Fewer than 3 of the next 7 days had a plan entry, so the run filled them |
| Questions never show up | The run asked none (it only asks when the answer would change the plan), or they expired. They last 3 days by default |
| The weekly pop-up doesn't appear | The pop-up is off on the Coach tab, it's Thursday or later, or this week's question was already answered or replaced by *Plan my climbing days* |
| Feedback stays "waiting for review" | No GitHub token is set, so the run can't file issues |

## Privacy

The review runs in your Claude account and talks only to your own deployed app. Your data stays in your D1
database. The only thing that leaves it is GitHub issues filed from app feedback, and those go to a public
repo. The instructions require them to be written in general terms, with nothing from your training data,
health or life, and never quoting your feedback. Still, glance at what gets filed.

## How it fits together

- `coach_runs`: one row per run. `seen_through` is where the next run starts looking.
- `coach_questions`: questions and answers. `topic` marks the ones the server creates: `week_days:<Monday>`
  for the weekly question and `climb_days:<date>` for *Plan my climbing days*.
- `app_feedback`: feedback and what the review did with it.
- `plan.source`: `coach` or `app`, so the review only rewrites its own entries.
- MCP tools in [`worker/mcp-coach.ts`](../worker/mcp-coach.ts); logic and the review instructions in
  [`worker/coach.ts`](../worker/coach.ts).
