<p align="center">
  <img src="assets/logo.svg" width="140" alt="keka logo — a slice of cake">
</p>

<h1 align="center">keka</h1>

<p align="center"><b>A harness for Claude Code — served one piece at a time.</b><br>
<i>keka = piece of cake. The promise is the name: the work should feel easy.</i></p>

---

## Why keka exists

An earlier harness proved the ideas — memory that compounds, spec-driven building, verified research, an ambient companion. But it grew into one big plugin doing many unrelated jobs at once. Too much to adopt, too much to test, too much to explain in one sitting.

**keka is that harness, rebuilt one feature at a time.** Each release does *one* pure thing, well. Ship it, let the team feel the change, gather feedback, then ship the next piece. The cake gets built slice by slice — but every slice on its own is a piece of cake to adopt.

## The rule

- **One feature per release.** Nothing bundled. If a release does two unrelated things, it's two releases.
- **Each feature earns its place.** It ships only after it's tested and the value is felt.
- **Feedback between slices.** Leaders and teammates react to each piece before the next lands.

## Install

Requires Node ≥ 22.5 (`node:sqlite`). Session-end learning distillation additionally needs `claude` on PATH (it degrades gracefully without it).

```
claude plugin marketplace add MohammedMoataz/keka
claude plugin install keka@keka
```

Dev mode without installing: `claude --plugin-dir <clone-directory>`.

## v0.1.0 — Memory (current release)

Memory that compounds across sessions and travels across the team. Everything lives in one zero-dependency SQLite DB at `~/.keka/keka.db`; errors go to `~/.keka/log.jsonl`, never into your session.

**What happens automatically:**

- **Session brief** — every new session starts with what the last session here did plus the top-ranked memories (project- and task-affine, type-decayed, ≤4K chars). Each line carries its memory id, so a wrong memory can be forgotten on sight.
- **Observations** — every Edit/Write/Bash call becomes a one-line deterministic record; failures are marked `FAIL` (the richest learning signal).
- **Session-end learnings** — one Haiku call per session compresses the last 40 observations into a one-line summary and 0–3 durable learnings. Deduped, confidence-clamped, off with `learn: false`.

**What you drive:**

- **`/recall <query>`** — FTS search over memory, progressive disclosure (short lines first, `--full` on demand).
- **`/handoff`** — package this project's memories into `.keka/team-seed.jsonl`; commit it, git is the transport.
- **`/handoff import`** — pick up a teammate's memories. Idempotent, and the trust roster decides where each one lands.

**Brief or workspace.** Full-trust memories join your ranked session brief like your own. Memories from a teammate marked `workspace` stay private to your machine instead: confidence capped, never auto-injected, never re-exported — but still findable in `/recall`, marked `[workspace]`. It's a holding area, not a penalty box; raise their trust, re-import, and their memories move up into the brief with confidence restored.

**Trust roster** (`.keka/team.md`, optional — absent means everyone trusted):

```markdown
# Team
- architect@example.com — trust: full
- new-joiner@example.com — trust: workspace
```

**Config** (plugin settings, or `KEKA_*` env override): `brief_chars` (default 4000), `learn` (default on).

**Tests:** `node hooks/engine.test.js && node hooks/hooks.test.js` — no framework, throwaway DB.

Under the hood this is the older harness's memory subsystem, rebuilt with its known bugs fixed: portable project identity (git remote URL, so teammate imports rank correctly on any machine), bounded brief queries, read-only search (recall no longer resets the decay clock), normalized+indexed dedup, resumed-session tracking, real session summaries, observation retention, and failures logged instead of swallowed.

## Roadmap (the cake)

Features to port one at a time. Order is a suggestion, not a commitment — the foundation comes first, the rest follows demand:

1. **Memory** — session brief + observations + session-end learnings, plus `/recall` and `/handoff` with a trust roster. ✅ **v0.1.0**
2. **Prompt coach** — zero-cost hints on vague prompts.
3. **Secrets guard** — block keys/credentials before they reach the model.
4. **Spec flow** — specify → clarify → blueprint → tasks → implement → converge.
5. **Research** — decompose → parallel researchers → adversarial claim gate → cited synthesis.
6. **Graphify** — codebase architecture graphs.
7. **Patterns / Stack / Onboard** — convention manual + stack profile + brownfield setup.
8. **Feature tools** — review-feature / document-feature / commit-pr.
9. **Handoff docs** — written task handoffs on top of the memory handoff that already ships.
10. **Ingest** — documents → markdown.
11. **Buddy** — ambient statusline companion.

Pick the next slice when the last one has landed and been felt. Not before.
