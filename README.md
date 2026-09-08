# Quorum

A private local AI council platform. Point it at whatever AI CLIs you have installed and
authenticated — it ships configured for [Codex](https://github.com/openai/codex) and
[Claude Code](https://github.com/anthropics/claude-code), but neither is required: **any
non-interactive CLI that takes a prompt and prints an answer works**, and you don't need
both of the shipped ones. Only have Codex and one other tool? Delete the Claude entry (or
never add it) in `agents.config.mjs` and Quorum adapts everywhere — courts, the sidebar,
health checks, all of it.

## Setup

Requires Node 20+, and a working local install of at least one supported CLI, already
logged in.

```powershell
npm install
npm start
```

The server listens only on `127.0.0.1:9977`. On Windows, double-click **Quorum** on
the desktop, or run:

```powershell
powershell -ExecutionPolicy Bypass -File launcher.ps1
```

`DUET_COUNCIL_PORT` changes the listen port. Per-agent command overrides
(`DUET_CODEX_COMMAND`, `DUET_CLAUDE_COMMAND`, `DUET_COMMAND` for the optional `duet` CLI
used by Implement) are documented in `agents.config.mjs`.

## Adding or removing an agent

Two ways to add an agent, depending on what you're adding:

- **Local CLI tools** (like Codex/Claude Code — full project file access, can implement
  changes) are declared in **`agents.config.mjs`**. That file has a full field reference
  and worked examples in comments: give it an id, a command to run, args for a version
  check and for asking a question, and whether the prompt goes in as an argument or over
  stdin. No changes to `server.mjs` or the frontend needed.
- **Hosted models via [OpenRouter](https://openrouter.ai)** (Claude, GPT, Gemini, Llama,
  Grok, and hundreds more, through one API key) are added from the UI — click **+ Add
  Agent** in the sidebar, paste an OpenRouter key the first time (reused for every agent
  after that), search for a model, and it's live immediately, no restart. These agents
  only see the conversation text — they can't read your project files or implement
  changes the way Codex/Claude Code can. Remove one by hovering its row and clicking the
  ✕. The key and added-agent list live in `.data/dynamic-agents.json`, which is
  gitignored — never commit it.

If a fresh clone has a sibling `AICouncil` folder with its own `.env` containing
`OPENROUTER_API_KEY=...`, Quorum borrows that key automatically on first run instead of
asking for one.

Either way, courts, the sidebar, and health checks all pick up the change automatically.

## Courts

Quorum organizes agents into courts. Which agents sit on a court is decided by tags — an
agent sits on a court if it shares at least one tag (or the court is Supreme Court, which
seats everyone). The sidebar shows who's actually in session for the active court, and
everyone else sits in the **Holding Cell**. A court with zero matching agents just shows
empty — nothing breaks.

- **Supreme Court** — every agent, for general or high-stakes calls.
- **Circuit Court** — coding and engineering.
- **The Gallery** — image creation. Empty until an image-capable agent is added.
- **The Foundry** — STL / 3D fabrication. Empty until a 3D-capable agent is added.

Add courts (or change which tags seat an agent where) by editing the `COUNCILS` array in
`server.mjs`.

## Workflow

- **Convene** runs every member of the active court read-only, then asks a chair (Claude
  Code if present, otherwise whichever member answered first) to synthesize a consensus.
  A single-member court skips synthesis entirely. If one member errors (not installed,
  crashed, timed out), the rest still respond — Quorum only gives up if every member on
  the court fails.
- **Run Benchmark** runs a short, court-specific task set through each member, has a
  chair score every agent's answers 1–10, and stores a rolling average per court in
  `.data/rankings.json` (local only, not committed).
- **Leaderboard** (top-right button) shows those scores across every court at once, plus
  an overall composite ranking per agent.
- **Implement Last Request** invokes the installed `duet` CLI: Codex implements, Claude
  Code reviews, and Codex receives one revision pass. This requires Codex specifically to
  be seated on the active court — it's disabled (client- and server-side) on courts
  without Codex, such as an empty Gallery or Foundry. `duet` is a separate CLI, not
  bundled here; the button errors clearly if it isn't installed.
- The project field determines the workspace available to the agents.

## Session history

Codex and Claude Code both persist their sessions locally (no `--ephemeral` /
`--no-session-persistence` flags), so anything run through Quorum shows up in that tool's
own local session history — `claude --resume` / `--continue` for Claude Code, and
`codex exec resume --last` for Codex. This does **not** reach the claude.ai or chatgpt.com
website chat history — those are separate accounts tied to the web app, not the local CLI.
Whether an agent you add persists sessions this way depends on that tool.

Local CLI agents (Codex, Claude Code, and anything else added via `agents.config.mjs`)
need no API key stored here — they rely on whatever login that CLI already has.
OpenRouter agents added through the UI are the exception: that key is stored locally in
`.data/dynamic-agents.json` (gitignored) and used only to call `openrouter.ai` — it's
never sent anywhere else and never returned to the browser once saved.

## Development

```powershell
npm test    # node's built-in test runner, no extra deps needed
npm run lint
npm run format
```

The whole app is a single Node HTTP server (`server.mjs`) plus a dependency-free static
frontend (`public/`) — no build step, no framework.

## License

MIT — see [LICENSE](LICENSE).
