---
description: Curated catalog of tools that pair well with keka memory - detect what's installed, brief the user, install only what they pick, remember the result. Use for "/partners", "what tools do you recommend", "set up recommended tools".
argument-hint: [partner-name]
---

# /partners — recommended tools, not bundled ones

keka ships memory and nothing else. These partners are tools worth having next to it — keka points at them instead of absorbing them. Nothing installs without the user's pick (single exception: `partners` mode `auto`, below).

## Steps

1. **Detect.** Run each partner's check command (batch them into one shell call). Non-zero exit / not found = missing. If the user passed a partner name as argument, check only that one and skip to step 4.
2. **Brief.** Show one compact table: partner, installed?, the one-line why. The why line is the whole pitch — no selling.
3. **Ask.** Let the user pick which missing partners to add (multi-select; picking none is a fine outcome).
4. **Install** each pick with its install command, then re-run its check to verify. A failed install: report the error, don't retry blind, move on.
5. **Remember.** For each verified install: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" add reference "partner installed: <name> — <why line>" 0.8` — the next session's brief will already know the tool exists.
6. **Dismiss the nudge** after the first ever run, whatever was picked: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" partners-seen`.

## Auto mode

When the plugin setting `partners` is `auto` (the session start note says so): if a task needs a capability a missing partner provides, install it without asking, verify, record the memory, and tell the user what was installed and why. Never auto-install gsd-browser — its setup is interactive.

## Catalog

### ast-grep — structural code search and codemods
- Why: syntax-aware search and one-rule multi-file rewrites; the default over grep whenever structure matters.
- Check: `ast-grep --version`
- Install: `npm i -g @ast-grep/cli` (or `cargo install ast-grep`)

### graphify — architecture and codebase-graph answers
- Why: answers "how does X connect to Y" from a code graph instead of grepping call sites.
- Check: `~/.claude/skills/graphify/SKILL.md` exists
- Install: distributed as a skill folder — copy it into `~/.claude/skills/graphify` (ask whoever maintains your team's skills for the source).

### spec-kit — spec-driven development flow
- Why: specify → plan → tasks scaffolding for features that deserve a spec before code.
- Check: `specify check`
- Install: `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git` (needs uv)

### chrome-devtools — live browser debugging (MCP)
- Why: inspect pages, console, network, and performance traces from inside the session.
- Check: `claude mcp list` output contains `chrome-devtools`
- Install: `claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest` (needs Chrome)

### obsidian — notes vault access (MCP)
- Why: search and read an Obsidian vault as a knowledge source next to keka memory.
- Check: `claude mcp list` output contains `obsidian`
- Install: `claude mcp add obsidian --env OBSIDIAN_API_KEY=<key> -- uvx mcp-obsidian` — needs the Obsidian app with the Local REST API community plugin enabled (the key comes from that plugin's settings).

### pandoc — document conversion
- Why: converts `.docx`, `.odt`, `.rtf`, `.html` and `.epub` to markdown; `/ingest` uses it and falls back to nothing without it.
- Check: `pandoc --version`
- Install: `winget install --id JohnMacFarlane.Pandoc` (Windows), `brew install pandoc` (macOS), `apt install pandoc` (Debian/Ubuntu)

### gsd-browser — browser automation daemon
- Why: scripted browsing driven by a persistent daemon, for flows heavier than one-shot page checks.
- Check: `gsd-browser --version`
- Install: follow the project's README. No native Windows binary — on Windows it must run inside an interactive WSL shell; the daemon does not survive one-shot `wsl.exe` calls. Never auto-install this one.

## Rules

- Outside auto mode, never install anything the user didn't pick this run.
- Already installed: say so and skip — no reinstalls, no upgrades unless asked.
- Record a memory only for a verified install, never for an attempt.
