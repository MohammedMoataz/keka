---
description: Share this project's memories with the team or import theirs - exports project-scoped memories to .keka/team-seed.jsonl (git is the transport), imports with the .keka/team.md trust roster applied. Use for "share my memories", "export the team seed", "/share import" to load teammate knowledge.
argument-hint: "[import] [--task <t>]"
---

# /share — team memory over git

Memories travel as `.keka/team-seed.jsonl`, committed to the repo. No server, no sync — git is the transport.

## Export mode (default — share what you learned)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-export .keka/team-seed.jsonl --project`
   - Current project's memories only. Add `--task "<branch>"` instead to share one task's memories.
   - Quarantined rows never export — someone else's claim is not yours to share.
2. Tell the user how many memories were exported and remind them to commit `.keka/team-seed.jsonl`.

## Import mode (`/share import` — load teammate knowledge)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-import .keka/team-seed.jsonl --dir "<repo-root>"`
   - Pass the repo root as `--dir` so the trust roster applies (see below).
   - Import is idempotent — re-running never duplicates (dedup is on normalized text).
2. Report the counts exactly as printed: `imported N new / M dup / K quarantined / P promoted`.
3. Quarantined memories get confidence capped at 0.3, are flagged, and never enter the session brief — they only surface in `/recall` marked `[quarantined]`.

## Trust roster — `.keka/team.md`

Optional file in the repo; absent = everyone trusted (solo use needs no ceremony). One line per teammate:

```markdown
# Team
- architect@example.com — trust: full
- intern@example.com — trust: quarantine
```

Changing a teammate's trust and re-running `/share import` applies it to their already-imported rows (promotion lifts the flag and restores confidence; demotion re-quarantines).

## Rules

- Never edit `.keka/team-seed.jsonl` by hand — export regenerates it whole.
- SessionStart already nudges when a team seed exists in the repo; if the user saw that nudge, go straight to import mode.
