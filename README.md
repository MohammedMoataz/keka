<p align="center">
  <img src="assets/logo.svg" width="140" alt="keka logo — a slice of cake">
</p>

<h1 align="center">keka</h1>

<p align="center"><b>Memory for Claude Code.</b><br>
<i>keka = piece of cake. The promise is the name: the work should feel easy.</i></p>

---

## Why keka exists

Every session starts cold. You re-explain the same constraint, rediscover the same trap, and lose whatever a teammate already learned on the branch you just checked out.

keka makes memory the thing that carries over — and the thing you can hand to someone else. It records what a session did, distils what was worth keeping, and puts that in front of you the next time you sit down in the same repo.

## Install

Requires Node ≥ 22.5 (`node:sqlite`). Session-end learning distillation additionally needs `claude` on PATH (it degrades gracefully without it).

```
claude plugin marketplace add MohammedMoataz/keka
claude plugin install keka@keka
```

Dev mode without installing: `claude --plugin-dir <clone-directory>`.

## How it works

Everything lives in one zero-dependency SQLite DB at `~/.keka/keka.db`; errors go to `~/.keka/log.jsonl`, never into your session.

**What happens automatically:**

- **Session brief** — every new session starts with what the last session here did plus the top-ranked memories (project- and task-affine, type-decayed, ≤4K chars). Each line carries its memory id, so a wrong memory can be forgotten on sight.
- **Observations** — every Edit/Write/Bash call becomes a one-line deterministic record; failures are marked `FAIL` (the richest learning signal).
- **Session-end learnings** — one Haiku call per session compresses the last 40 observations into a one-line summary and 0–3 durable learnings. Deduped, confidence-clamped, off with `learn: false`.
- **Prompt coach** — vague prompts get a one-line nudge ("name the file", "state what done looks like"). Shown to you only; the critique never enters the model's context. In plan mode, one optional Haiku call scores the prompt and suggests a rewrite — and backs off for an hour if the CLI misbehaves.
- **Secrets guard** — tool calls carrying a real credential (AWS/GitHub/Slack keys, private keys, Azure connection strings) are blocked outright, on writes as well as commands. Secret-*ish* outbound payloads and credential-file reads (`.env`, `id_rsa`, `*.pem`) ask first — `.env.example` and friends are exempt. Fails open by design, but every failure is logged.

**What you drive:**

- **`/recall <query>`** — FTS search over memory, progressive disclosure (short lines first, `--full` on demand).
- **`/handoff`** — package this project's memories into `.keka/team-seed.jsonl`; commit it, git is the transport.
- **`/handoff import`** — pick up a teammate's memories. Idempotent, and the trust roster decides where each one lands.
- **`/partners`** — a curated catalog of tools that pair well with memory. Detects what you have, briefs you on what's missing, installs only what you pick.
- **`/prompt`** — templates (bugfix, feature, refactor, research, review) and the 10 rules for prompts that land; paste a draft and get a review.
- **`/stack`** — capture the project profile (`.keka/stack.md`): roots, build/test/lint commands, conventions. Amends, never overwrites.
- **`/patterns`** — author (`init`) or consult the convention manual at `.keka/patterns/`: how *this* codebase does commands, validation, forms… every pattern cites a real `path:line`.
- **`/onboard`** — adopt keka in an existing repo: detect what's in place, then `/stack` → `/patterns init` → `/partners` → team setup, each step skippable.

**Brief or workspace.** Full-trust memories join your ranked session brief like your own. Memories from a teammate marked `workspace` stay private to your machine instead: confidence capped, never auto-injected, never re-exported — but still findable in `/recall`, marked `[workspace]`. It's a holding area, not a penalty box; raise their trust, re-import, and their memories move up into the brief with confidence restored.

**Trust roster** (`.keka/team.md`, optional — absent means everyone trusted):

```markdown
# Team
- architect@example.com — trust: full
- new-joiner@example.com — trust: workspace
```

**Config** (plugin settings, or `KEKA_*` env override): `brief_chars` (default 4000), `learn` (default on), `partners` (`ask` | `auto` | `off`, default `ask`), `coach` (default on), `plan_review` (default on), `guard` (default on).

**Tests:** `node hooks/engine.test.js && node hooks/hooks.test.js` — no framework, throwaway DB.

## Partners

keka bundles nothing beyond memory — but some tools pair well with it. `/partners` is a catalog, not a dependency list: one-line brief per tool, a check for what's already installed, and installs only for what you pick. Each verified install is recorded as a `reference` memory, so the next session's brief already knows the tool exists.

The catalog: **ast-grep** (structural code search and codemods), **graphify** (architecture answers from a code graph), **spec-kit** (spec-driven development flow), **chrome-devtools** (live browser debugging over MCP), **obsidian** (notes vault access over MCP), **gsd-browser** (browser automation daemon).

Modes, via the `partners` setting:

- `ask` (default) — nothing installs without your pick. A one-line reminder appears at session start until the first `/partners` run.
- `auto` — pre-consent: when a task needs a capability a missing partner provides, it may be installed mid-task, and you're told each time. Restated at every session start so the consent is always visible.
- `off` — silence.

## Design notes

Small enough to read in one sitting: one engine module, six hook wirings, seven skills, no runtime dependencies.

- **Project identity travels.** A project is keyed by its git remote URL, not the path it happens to sit at, so an imported memory ranks correctly on every machine.
- **Reading is free.** Search never touches a memory's decay clock — what you grep does not outrank what mattered.
- **Deduplication is normalized and indexed.** Case and whitespace variants of the same fact are the same fact.
- **The brief is bounded.** Ranking runs over a candidate window, so session startup does not slow down as the database grows.
- **Failures are visible.** A broken hook writes the reason to the log rather than silently doing nothing.
- **The guard scans values, not serializations.** Patterns run against the raw strings inside a tool call, so escape characters can neither hide a secret nor cause a false hit.
- **Coaching is for you, not the model.** Hints surface as user-facing messages only — a critique of the prompt injected next to the prompt steers answers toward meta-commentary.
