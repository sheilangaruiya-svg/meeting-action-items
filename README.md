# Meeting Action Items to Slack

Turn a meeting transcript into a short, reviewed list of action items — with owners and deadlines — and post the recap to Slack in one click.

Lean by design: one Express server, one page, one Slack webhook. No accounts, no database, no meeting archive.

## Run it

```powershell
npm.cmd install        # or: npm install
Copy-Item .env.example .env       # then paste your Slack webhook into .env
npm.cmd start          # http://localhost:3000
```

Windows note: if `npm` fails with *"running scripts is disabled"*, use `npm.cmd` (or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once).

## How it works

1. **Paste a transcript** — speaker turns as `Name: text`. Markdown-ish transcripts work better than raw audio dumps.
2. **Extract** — every sentence with an action word *and* a commitment cue becomes a candidate. Owner comes from first person ("I'll…"), a named assignee ("Bob, can you…", "Bob will…"), or `Unassigned`. Deadlines are captured only when stated.
3. **Review** — every card is editable: task, owner, deadline. Remove what isn't real, add what was missed.
4. **Post** — the preview is exactly what gets sent. One click posts to the configured channel; if Slack isn't configured, *Copy recap* puts it on your clipboard.

## Configure Slack

Channel → **Integrations → Incoming Webhooks → Add New Webhook** → copy the URL into `.env`:

```
PORT=3000
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/xxxx
```

The webhook is read server-side only — it never reaches the browser, and `.env` is gitignored.

## Test

```powershell
npm.cmd test        # 8 checks over the extraction engine
```

## Layout

```
server.js              Express: static hosting, /api/health, /api/slack
public/index.html      transcript · review · preview panels
public/extract.js      extraction engine (window.Recap.extractActions)
public/script.js       UI wiring: review cards, preview, post, copy
public/style.css
test/extract.test.js   node:test suite
docs/                  BRD · PRD · BACKEND · CHANGES · VSCODE
```

## Docs

- [`docs/BRD.md`](docs/BRD.md) — why this exists, success metrics, what is out of scope.
- [`docs/PRD.md`](docs/PRD.md) — every requirement with an ID and its status in the code.
- [`docs/BACKEND.md`](docs/BACKEND.md) — how the server and extractor work, and what changed.
- [`docs/CHANGES.md`](docs/CHANGES.md) — how to apply the fixes to this repo and verify each one.

## Scope

Deliberately **not** included: meeting bots, calendar or transcript capture, user accounts, stored history, reminders, Jira/Notion output, LLM extraction. Each would turn a five-minute tool into a platform — see BRD §4.

