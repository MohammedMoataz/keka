---
description: Hand your session's memory to the team, or pick up theirs - exports this project's memories to .keka/team-seed.jsonl (git is the transport) and imports a teammate's with the .keka/team.md trust roster applied. Use for "hand this off", "share what I learned", "/handoff import" to load teammate knowledge.
argument-hint: "[import] [--task <t>]"
---

# /handoff — pass memory between teammates

Memories travel as `.keka/team-seed.jsonl`, committed to the repo. No server, no sync — git is the transport, so knowledge moves with the branch.

## Hand off (default — you did the work)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-export .keka/team-seed.jsonl --project`
   - Current project's memories only. Add `--task "<branch>"` instead to hand off one task's memories.
   - Workspace-only memories never leave — see below.
2. Tell the user how many memories were packaged and remind them to commit `.keka/team-seed.jsonl`.

## Pick up (`/handoff import` — you're taking the work over)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-import .keka/team-seed.jsonl --dir "<repo-root>"`
   - Pass the repo root as `--dir` so the trust roster applies.
   - Import is idempotent — re-running never duplicates (dedup is on normalized text).
2. Report the counts exactly as printed: `imported N new / M dup / K to workspace / P promoted`.
3. Continue the work from what the imported memories tell you; cite ids when you rely on one.

## Workspace vs. brief

Every imported memory lands in one of two places:

- **Brief** — full-trust memories join your ranked session brief, exactly like your own.
- **Workspace** — memories from a teammate marked `workspace` in the roster stay private to your machine: confidence capped at 0.3, never auto-injected into a session, never re-exported when you hand off. They are still yours to find — `/recall` shows them marked `[workspace]`.

Workspace is a holding area, not a penalty box: raise someone's trust and re-import, and their memories move up into the brief with their original confidence restored (the counts report it as `promoted`). Lowering trust moves them back.

## Trust roster — `.keka/team.md`

Optional file in the repo; absent = everyone trusted (solo use needs no ceremony). One line per teammate:

```markdown
# Team
- architect@example.com — trust: full
- new-joiner@example.com — trust: workspace
```

## Rules

- Never edit `.keka/team-seed.jsonl` by hand — handing off regenerates it whole.
- SessionStart already nudges when a team seed exists in the repo; if the user saw that nudge, go straight to import.
