---
description: Guided keka setup for an existing project - detects what's in place, fills gaps in order (/stack, /patterns init, /partners, team handoff), reports status. Use when adopting keka in a running codebase, or re-run anytime for a status report.
argument-hint: [status]
---

# /onboard — set a project up on keka

## Steps

1. **Detect** (read-only) and show as a checklist:
   - `.keka/stack.md` — stack profile
   - `.keka/patterns/00-index.md` — convention manual
   - `.keka/team.md` — trust roster
   - `.keka/team-seed.jsonl` — a teammate's memory seed (offer `/handoff import` if present)
   - `CLAUDE.md` / `AGENTS.md` — not a gap; input for the steps below
2. `status` argument → stop here with the checklist.
3. **Fill gaps, in order**, confirming before each step:
   1. `/stack`
   2. `/patterns init` — the slow one; say so before starting
   3. Offer `/partners` — companion tools, the user picks
   4. **Team** — if others will work in this repo: `/handoff` to export the memory seed, a `.keka/team.md` roster, then commit `.keka/`
4. **Report**: one table — step · done / skipped / failed · note.

## Rules

- Every step is skippable — record it as **skipped**, never as failed.
- A step that errors: report the error, mark it **failed**, continue the chain — one broken step must not abort an onboarding.
- Engine calls always via `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" ...`.
- Re-running is safe: detection means done work is never redone.
