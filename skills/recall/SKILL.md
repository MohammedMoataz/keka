---
description: Search keka memory (learnings, references, session history) with progressive disclosure - short lines first, expand on demand. Use for "what do we know about X", "did we hit this before", "find that link".
argument-hint: <query> [--full] [--task <t>] [--author <email>] [--role <r>] [--user <name>] [--repo <r>] [--all]
---

# /recall — query the harness memory

## Steps

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" search "<query terms>"` — returns short lines (`#id [type] first-100-chars (conf)`), ~10 tokens each. This searches the current project (all of its repositories) plus your global knowledge.
2. Only if a hit looks relevant but truncated, expand: add `--full`. Never start with `--full` — progressive disclosure keeps recall cheap.
3. Scope when asked: `--task <branch-or-tag>` limits to one task's memories, `--author <email>` or `--user <name>` to one teammate's, `--role <role>` to everyone with that role ("what did the testers find"). Roles come from the team directory and are snapshotted when a memory is written, so they stay accurate after someone changes role. Results marked `[workspace]` are held privately (from a teammate you trust at `workspace` level) and never enter the session brief — weigh them accordingly.
4. Nothing found? Retry once with synonyms/stems (FTS5 is keyword matching, not semantic — "auth" won't match "login"). Still nothing, and it might have been learned elsewhere? `--all` fans the search across every project you have worked on. `--repo <repo>` goes the other way, narrowing to one repository of this project.
5. Answer the user from the hits, citing memory ids. If memory contradicts current reality (file moved, tool renamed), fix it: `engine.js forget <id>` the stale one, `add` the correction.

## Related

- Add knowledge: `engine.js add <type> "<text>" [confidence] [--project <p>] [--task <t>]` (types: learning | note | reference | pattern; project defaults to the current repo).
- Prior work on your current branch is already in the session brief — no need to recall it.
- Which repositories make up this project: `/project`.
- Pass memories to the team / pick up theirs: `/handoff` and `/handoff import`. Who is on the project and whom you trust: `/team`.
