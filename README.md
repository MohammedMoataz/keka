<p align="center">
  <img src="assets/logo.png" width="140" alt="keka logo — a slice of cake">
</p>

<h1 align="center">keka</h1>

<p align="center"><b>Memory for Claude Code.</b><br>
<i>keka = piece of cake. The promise is the name: the work should feel easy.</i></p>

---

## Why keka exists

Every session starts cold. You re-explain the same constraint, rediscover the same trap, and lose whatever a teammate already learned on the branch you just checked out.

keka makes memory the thing that carries over — and the thing you can hand to someone else. It records what a session did, distils what was worth keeping, and puts that in front of you the next time you sit down in the same repo.

## One product, however many repositories

A **project** is the product; a **repo** is one repository inside it. A backend and a frontend that belong together share one memory, while each line still records which repo it came from — and your own repo always ranks first. Each project gets its own database, so a busy project can never crowd out a quiet one.

A repo that declares nothing is its own project, so single-repo work needs no setup. To group several, commit the same `.keka/project.md` in each:

```markdown
# Project
name: acme-shop

repos:
  - github.com/acme/shop-api
  - github.com/acme/shop-web
```

Knowledge that belongs to *you* rather than to a product — an environment quirk, a tool trap — is stored globally and appears in every project you open. `/recall --all` searches across all of them.

## Install

Requires Node ≥ 22.5 (`node:sqlite`). Session-end learning distillation additionally needs `claude` on PATH (it degrades gracefully without it).

```
claude plugin marketplace add MohammedMoataz/keka
claude plugin install keka@keka
```

Dev mode without installing: `claude --plugin-dir <clone-directory>`.

## How it works

Zero-dependency SQLite: one database per project under `~/.keka/projects/<name>/`, plus `~/.keka/keka.db` for what belongs to you rather than to a product (your trust settings, your global memories, the list of projects). Errors go to `~/.keka/log.jsonl`, never into your session.

**What happens automatically:**

- **Session brief** — every new session starts with what the last session here did plus the top-ranked memories (project- and task-affine, type-decayed, ≤4K chars). Each line carries its memory id, so a wrong memory can be forgotten on sight.
- **Branch recall** — if anyone has worked on your current branch before, that history opens the brief: their session names, who they are, what they concluded, and the memories scoped to that branch. It gets its own reserved share of the brief, so a busy project can't crowd it out. Work on *other* branches stays where it belongs — behind `/recall`.
- **Named, attributed sessions** — each session is recorded with a name (`<branch>-<username>`, or whatever you set), the author's email and username, their role, and the branch. Claude Code's own session list gets the same name.
- **A seed that stays current** — once you've run `/handoff` in a repo, keka refreshes `.keka/team-seed.jsonl` on `/compact`, on `/clear`, and after each commit. It never creates the file uninvited and never touches git state.
- **Observations** — every Edit/Write/Bash call becomes a one-line deterministic record; failures are marked `FAIL` (the richest learning signal).
- **Session-end learnings** — one Haiku call per session compresses the last 40 observations into a one-line summary and 0–3 durable learnings. Deduped, confidence-clamped, off with `learn: false`.
- **Prompt coach** — vague prompts get a one-line nudge ("name the file", "state what done looks like"). Shown to you only; the critique never enters the model's context. In plan mode, one optional Haiku call scores the prompt and suggests a rewrite — and backs off for an hour if the CLI misbehaves.
- **Secrets guard** — tool calls carrying a real credential (AWS/GitHub/Slack keys, private keys, Azure connection strings) are blocked outright, on writes as well as commands. Secret-*ish* outbound payloads and credential-file reads (`.env`, `id_rsa`, `*.pem`) ask first — `.env.example` and friends are exempt. Fails open by design, but every failure is logged.

**What you drive:**

- **`/recall <query>`** — FTS search over memory, progressive disclosure (short lines first, `--full` on demand).
- **`/handoff`** — package this project's memories into `.keka/team-seed.jsonl`; commit it, git is the transport.
- **`/handoff import`** — pick up a teammate's memories and session history. Idempotent, and your private trust decides where each one lands.
- **`/project`** — which project this repo belongs to, which repos make it up, and where its memory lives. `declare` groups several repositories into one product.
- **`/team`** — the team directory (who's here, what they do) and your private trust settings.
- **`/name <label>`** — label this session for the people who read the history later.
- **`/partners`** — a curated catalog of tools that pair well with memory. Detects what you have, briefs you on what's missing, installs only what you pick.
- **`/prompt`** — templates (bugfix, feature, refactor, research, review) and the 10 rules for prompts that land; paste a draft and get a review.
- **`/stack`** — capture the project profile (`.keka/stack.md`): roots, build/test/lint commands, conventions. Amends, never overwrites.
- **`/patterns`** — author (`init`) or consult the convention manual at `.keka/patterns/`: how *this* codebase does commands, validation, forms… every pattern cites a real `path:line`.
- **`/onboard`** — adopt keka in an existing repo: detect what's in place, then `/stack` → `/patterns init` → `/partners` → team setup, each step skippable.
- **`/ship`** — staged work out the door in one pass: branch (new or current), a conventional commit matched to your log, push, PR created and self-assigned — and the team seed refreshed and committed alongside the code. Runs on a small model at low effort, because none of it needs a large one.
- **`/ingest`** — documents and web pages in, markdown out to `./docs`, with provenance. A script does the routing, conversion, hashing and indexing; the model only reads PDFs, fetches pages, and cleans up what conversion mangles. Re-ingesting an unchanged source is a no-op.
- **`/review-feature`** — a subagent checks one feature slice for the defects no single file reveals: an endpoint the UI guards but the backend doesn't, validation on one side only, a field the frontend reads and the backend never sends. Every finding cites `file:line`.
- **`/document-feature`** — a subagent writes (or refreshes) full-stack documentation for a slice: domain model, commands and queries, frontend wiring, permissions, one flow traced end to end. Refresh rewrites only the sections whose sources changed.

**Identity is shared; trust is private.** `.keka/team.md` is a directory everyone commits — name, email, role, nothing judgmental:

```markdown
# Team
- Sara Malik <sara@example.com> — role: tech-lead
- Lina Haddad <lina@example.com> — role: qa
```

Roles are snapshotted onto memories as they're written, so `/recall --role qa` keeps meaning "what the testers found" even after someone changes role.

Whom you *trust* is a different question, and it stays on your machine — set with `/team trust <email> full|workspace`, never written to the shared file, never included in a seed. Nobody should have to commit "I don't trust this teammate yet" to a repository. Full-trust memories join your ranked brief like your own; `workspace` ones stay private with capped confidence, never auto-injected and never re-exported, but still findable in `/recall` marked `[workspace]`. It's a holding area, not a penalty box — raise their trust, re-import, and their memories move up with confidence restored.

**Encrypted handoff.** The seed lives in git, so anyone with repo access can read it. Put a shared passphrase in `.keka/seed.key` (gitignored) or `KEKA_SEED_KEY`, hand off with `--encrypt`, and the file becomes an AES-256-GCM envelope. Import detects and decrypts it automatically; a wrong key or an altered file fails loudly rather than quietly — the GCM tag is the tamper check, which is why there's no separate signature to manage.

**Config** (plugin settings, or `KEKA_*` env override): `brief_chars` (default 4000), `learn` (default on), `partners` (`ask` | `auto` | `off`, default `ask`), `coach` (default on), `plan_review` (default on), `guard` (default on), `seed_auto` (default on), `default_trust` (default `full`).

**Tests:** `node hooks/engine.test.js && node hooks/hooks.test.js && node tools/ingest.test.js` — no framework, throwaway DB and output directory.

## Partners

keka bundles nothing beyond memory — but some tools pair well with it. `/partners` is a catalog, not a dependency list: one-line brief per tool, a check for what's already installed, and installs only for what you pick. Each verified install is recorded as a `reference` memory, so the next session's brief already knows the tool exists.

The catalog: **ast-grep** (structural code search and codemods), **graphify** (architecture answers from a code graph), **spec-kit** (spec-driven development flow), **chrome-devtools** (live browser debugging over MCP), **obsidian** (notes vault access over MCP), **pandoc** (document conversion for `/ingest`), **gsd-browser** (browser automation daemon).

Modes, via the `partners` setting:

- `ask` (default) — nothing installs without your pick. A one-line reminder appears at session start until the first `/partners` run.
- `auto` — pre-consent: when a task needs a capability a missing partner provides, it may be installed mid-task, and you're told each time. Restated at every session start so the consent is always visible.
- `off` — silence.

## Design notes

Small enough to read in one sitting: one engine module, eight hook wirings, fourteen skills, two subagents, no runtime dependencies.

- **Project identity travels.** A project is keyed by its git remote URL, not the path it happens to sit at, so an imported memory ranks correctly on every machine.
- **Reading is free.** Search never touches a memory's decay clock — what you grep does not outrank what mattered.
- **Deduplication is normalized and indexed.** Case and whitespace variants of the same fact are the same fact.
- **Nothing is dropped before it is ranked.** Every memory in the project is scored; the character cap decides what reaches the session, and it applies *after* ranking. A strong memory buried under a thousand newer notes still surfaces. (Cost is linear: about 80 ms at 5,000 memories in a project, 380 ms at 20,000.)
- **Search hides nothing when you ask for everything.** The short preview stays small so recall is cheap, but `--full` returns every match rather than a page of them.
- **Trust is set once.** It lives with you, not inside a project, so rating a teammate applies everywhere you work with them.
- **Failures are visible.** A broken hook writes the reason to the log rather than silently doing nothing.
- **The guard scans values, not serializations.** Patterns run against the raw strings inside a tool call, so escape characters can neither hide a secret nor cause a false hit.
- **Coaching is for you, not the model.** Hints surface as user-facing messages only — a critique of the prompt injected next to the prompt steers answers toward meta-commentary.
- **Upgrades widen the database in place.** The schema file can only create what's missing, so every added column is also applied as an explicit migration — an existing database gains the new shape instead of silently ignoring it.
- **Session rows travel without breaking old readers.** They carry no `text` field, and every importer skips rows without one, so an older keka ignores them rather than choking.
