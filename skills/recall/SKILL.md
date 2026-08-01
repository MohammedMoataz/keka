---
description: Search keka memory (learnings, references, session history) with progressive disclosure - short lines first, expand on demand. Use for "what do we know about X", "did we hit this before", "find that link".
argument-hint: <query> [--full] [--task <t>] [--author <email>]
---

# /recall — query the harness memory

## Steps

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" search "<query terms>"` — returns short lines (`#id [type] first-100-chars (conf)`), ~10 tokens each.
2. Only if a hit looks relevant but truncated, expand: add `--full`. Never start with `--full` — progressive disclosure keeps recall cheap.
3. Scope when asked: `--task <branch-or-tag>` limits to one task's memories, `--author <email>` to one teammate's. Results marked `[workspace]` are held privately (imported from a teammate whose trust is `workspace`) and never enter the session brief — weigh them accordingly.
4. Nothing found? Retry once with synonyms/stems (FTS5 is keyword matching, not semantic — "auth" won't match "login").
5. Answer the user from the hits, citing memory ids. If memory contradicts current reality (file moved, tool renamed), fix it: `engine.js forget <id>` the stale one, `add` the correction.

## Related

- Add knowledge: `engine.js add <type> "<text>" [confidence] [--project <p>] [--task <t>]` (types: learning | note | reference | pattern; project defaults to the current repo).
- Pass memories to the team / pick up theirs: `/handoff` and `/handoff import`.
