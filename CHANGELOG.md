# Changelog

Releases are git tags.

## v0.6.0 — Multi-tenant projects (2026-08-08)

A project is now the **product**, and a repository is a member of it. A backend repo and a frontend repo that belong together share one memory.

- **Database per project** — `~/.keka/projects/<name>/keka.db`, with `~/.keka/keka.db` reduced to user scope: your trust settings, your global memories, and the project registry.
- **`.keka/project.md`** — a committed declaration grouping repositories into one product. Resolution ladder: `KEKA_PROJECT` → `.keka/project.md` → the repo itself, so an undeclared repo is its own project and single-repo work is unchanged.
- **`repo` column** on memories and sessions, plus a `repos` table inside each project recording its members (declared, or auto-registered on first sight). Brief ranking is now own-repo ×1.5 · same-branch ×1.5, so a sibling service stays visible but never outranks your own.
- **`/project`** — show the resolved project, declare one, register a repo, list projects.
- **`/recall`** gains `--repo` (narrow to one service) and `--all` (fan out across every project). By default it searches this project plus your global memories, so environment traps stay reachable everywhere.
- **`/handoff`** exports the whole project by default; `--repo` narrows it.
- **Starvation fixed** — the brief's candidate window had no project filter, so a busy project could push a quiet one out of its own brief. Per-project databases remove the failure mode entirely.
- **Import no longer shells out per row** — `seedImport` was passing a stored project key into `add()`'s working-directory parameter, spawning two failing git processes for every imported memory; identity is now passed explicitly.
- **Upgrade splits automatically** — the existing shared database is backed up to `keka.db.pre-0.6.0` (after a WAL checkpoint), each project's memories, sessions and observations move into their own tenant, `repo` is backfilled from the old project key, and global rows stay in user scope. Idempotent, and covered by a test that drives the CLI against a hand-built pre-0.6 database.
- New CLI: `project`, `project register`, `repos`, `projects`, `rekey <old> <new>` (adopt rows stranded under an old identity, such as a repo that gained a remote after keka had already learned things).

## v0.5.0 — Ship, ingest, feature agents (2026-08-08)

- **`/ship`** — staged work to a pull request in one pass: optional build gate from `.keka/stack.md`, branch (new or current, as an argument), conventional commit matched to the recent log, push, `gh pr create --fill --assignee @me`. Second output: refreshes the team seed and stages it, so knowledge ships with the code. Pinned to `model: haiku` / `effort: low`; one git command per call, since compound git invocations trip a repository-security prompt.
- **`/ingest`** — documents and pages in, markdown out to `./docs`. New `tools/ingest.js` handles routing, pandoc conversion, source hashing, frontmatter and the index without the model; the model reads PDFs (20-page batches), fetches URLs, and refines rough conversions. Idempotent by source hash, refuses slug collisions across different sources, and records a `reference` memory per document. Covered by `tools/ingest.test.js`.
- **`review-feature` subagent** + **`/review-feature`** — cross-stack consistency for one slice: permission parity, validation coverage, API-contract match. Every finding cites `file:line`, and findings must survive an attempt to disprove them. Accepts a free-text steer from the user, treated as a hint to verify rather than a fact.
- **`document-feature` subagent** + **`/document-feature`** — full-stack documentation for a slice (domain model, commands and queries, frontend wiring, permissions, one end-to-end flow), grounded in citations. Refresh re-derives only sections whose sources changed. Accepts a free-text overview.
- **pandoc** added to the `/partners` catalog, since `/ingest` degrades without it.

## v0.4.0 — Identity, sessions, and private trust (2026-08-03)

- **Session identity** — sessions and memories now carry `username` and `role` alongside the author's email and branch. Roles are snapshotted when written, so `/recall --role qa` keeps meaning "what the testers found" after someone changes role. `/recall` gains `--role` and `--user`.
- **Named sessions** — every session gets a name (`<branch>-<username>`, collisions suffixed), settable with **`/name`**, adopted from Claude Code's `/rename` when you've set one, and published back as the session title. Two teammates may use the same label; display disambiguates as `label@username` rather than refusing it.
- **Branch recall** — prior sessions and memories on your current branch open the brief automatically, with a reserved share of the character budget so general memories can't crowd them out. Other branches stay manual via `/recall`.
- **Identity shared, trust private** — `.keka/team.md` becomes a committed directory (name, email, role) with no trust field. Trust moves into a local `trust` table set with **`/team trust`**: never written to the shared file, never exported. Pre-0.4 rosters still work — their `trust:` values seed the private table once, then local values win.
- **Self-refreshing seed** — `.keka/team-seed.jsonl` is kept current on `/compact`, `/clear` and after each commit. Only ever refreshes a seed that already exists (running `/handoff` is the opt-in) and never stages or commits. Setting: `seed_auto`.
- **Sessions in the seed** — handoffs carry session history, not just memories. Session rows have no `text` field, so v0.1–0.3 importers skip them instead of failing.
- **Encrypted handoff** — `seed-export --encrypt` seals the seed as an AES-256-GCM envelope (scrypt-derived key from `KEKA_SEED_KEY` or a gitignored `.keka/seed.key`). Import auto-detects and decrypts; a wrong key or altered file fails loudly. The GCM auth tag is the tamper check, so there is no separate signature.
- **Schema migrations** — `schema.sql` can only create what's missing, so added columns are now also applied via explicit `ALTER TABLE` probes on open. Upgrading from v0.1–0.3 widens the existing database instead of silently ignoring the new shape; covered by a test that drives the CLI against a hand-built v0.3.0 database.
- New settings: `seed_auto` (default on), `default_trust` (default `full`). New skills: `/team`, `/name`. New hook: `PreCompact`, plus a `Bash` PostToolUse wiring for post-commit refresh.

## v0.3.0 — Coach, Guard, Conventions (2026-08-03)

- **Prompt coach** — regex hints on vague prompts (user-facing only, never injected into model context); in plan mode one Haiku call scores the prompt and suggests a rewrite, with a 1h cooldown after any CLI failure and a `KEKA_CLAUDE_BIN` override that makes the tier testable. Settings: `coach`, `plan_review`.
- **Secrets guard** — PreToolUse on Bash/WebFetch/Read/Write/Edit/NotebookEdit. Real credentials (AWS/STS, GitHub, Slack, OpenAI-style, private keys, Azure connection strings, Slack webhooks) block everywhere including file writes; secret-ish payloads ask on outbound tools only; credential-file paths ask on Read *and* inside Bash commands, with `.example`/`.sample`/`.template`/`.dist` exempt. Scans raw values rather than serialized JSON, so escapes can't evade it. Fails open, logged. Setting: `guard`.
- **/prompt** — five templates + the 10 rules, with draft review.
- **/stack** — project profile at `.keka/stack.md`; amends, never overwrites; values kept free of example prose.
- **/patterns** — convention manual at `.keka/patterns/` (index + numbered concern files, every pattern cites `path:line`); `init` records a reference memory so future briefs know the manual exists.
- **/onboard** — detect what's in place, then `/stack` → `/patterns init` → `/partners` → team setup; every step skippable, errors reported without aborting the chain.

## v0.2.0 — Partners (2026-08-02)

A curated catalog, not a bundle — keka still ships zero dependencies.

- **/partners** — six recommended companion tools (ast-grep, graphify, spec-kit, chrome-devtools, obsidian, gsd-browser), each with a one-line why, an installed-check, and an install command. Installs only what the user picks, verifies, and records each install as a `reference` memory so future session briefs know the tool exists.
- **`partners` setting** — `ask` (default, pick-to-install), `auto` (a missing partner may be installed when a task needs it; stated at every session start and reported each time), `off`.
- **One-time nudge** — session start mentions `/partners` once, until the first run dismisses it (`engine.js partners-seen`).

## v0.1.0 — Memory (2026-08-01)

Memory that compounds across sessions and travels across the team.

- **Session brief** injected on startup/clear: last session's summary + top memories (project/task-affine, type-decayed, char-capped, ids included).
- **Observations**: deterministic one-line records of Edit/Write/Bash, failures marked `FAIL`.
- **Session-end distillation**: one Haiku call → one-line session summary + 0–3 durable learnings (deduped, clamped, opt-out via `learn`).
- **/recall**: FTS5 search with progressive disclosure.
- **/handoff** + **/handoff import**: project-scoped memory handoff over git with a trust roster (`.keka/team.md`). Full-trust memories join the brief; `workspace`-trust memories stay private (capped confidence, never injected, never re-exported) but remain searchable. Re-import applies trust changes in both directions.
- Zero runtime dependencies (`node:sqlite`, Node ≥ 22.5). DB at `~/.keka/keka.db`, failures logged to `~/.keka/log.jsonl`.

Design choices worth knowing: project identity is the git remote URL so imported memories rank correctly on any machine; search is read-only and never resets a memory's decay clock; deduplication is normalized and indexed; the brief ranks over a bounded candidate window; resumed sessions are tracked; distillation reads the end of a long session, not its opening; observations are pruned after 30 days; workspace rows are excluded from export.
