Add dsh-anatomy — live architecture map of DeepSeek Harness

## What it is

`dsh-anatomy` renders the running DeepSeek Harness as a live architecture
diagram: five layers and fourteen component domains (Web UI, Agent Loop, LLM,
subagents/workflows, tool runner, read/search, write/terminal, network/MCP,
session log, context/token, memory/skills, Cordis kernel, sandbox/permissions,
credentials/auth). Runtime tool calls, model calls, session events, approval
and filesystem activity are drawn as moving dots along the real call edges,
with rates in the last 120 s.

## Why it qualifies

- `package.json` declares both `dsh.bundle` (with `cordis.patch.yml`) and
  `dsh.client`; the repo contains the complete Host (`index.js`) and Client
  (`client.js`) halves. No build step, no runtime dependencies.
- Zero third-party dependencies: Host half uses only Node built-ins and the
  Cordis context; Client half only consumes the platform `react` seed module.
- All data comes from read-only, side-channel observation of the running
  Harness (Cordis topology plus tool/model/session events). It does not modify
  sessions, change tool behaviour, or write user data.
- Verified on DSH 0.2.1-rc.5 (desktop profile): Host endpoints, snapshot and
  NDJSON stream checks pass, and the Client registers both the sidebar entry
  and the full-page panel.

## Notes for reviewers

- Repo root is the plugin package itself (`package.json` + `cordis.patch.yml`
  next to each other), so `dsh plugin add github:h2298511604-ops/dsh-anatomy`
  works from source.
- The description is intentionally narrow: the plugin is an observability /
  visualization surface, not a model, theme, or install bundle.
