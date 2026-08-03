---
description: Author or consult the project's convention manual at .keka/patterns/ - a numbered library of how THIS codebase handles each concern (commands, validation, forms, styling...). Use for "how do we write X here", "set up patterns", or before implementing/reviewing to load the relevant convention.
argument-hint: [init | <topic>]
---

# /patterns — how this codebase does things

A numbered manual at `.keka/patterns/`: `00-index.md` as the hub, one `NN-<concern>.md` per concern. Grounded in real code — every pattern cites a live `path:line`.

## Modes

**`init`** — author the manual:

1. If `.keka/stack.md` is missing, run `/stack` first.
2. Identify the repo's recurring concerns (commands, validation, data access, forms, styling, errors, tests…) by reading real code — parallel Explore subagents, one per concern area, returning conventions with citations.
3. Write `00-index.md`: stack summary, project-wide CRITICAL rules, and a **Manual** section listing a link per concern file. Then one `NN-<concern>.md` per concern following `references/skeleton.md`. A pattern without a real `path:line` citation doesn't go in — no invented examples.
4. Record it: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" add reference "patterns manual at .keka/patterns/ — consult before implementing or reviewing" 0.8` — future session briefs will know the manual exists.
5. Suggest committing `.keka/patterns/`.

**`<topic>`** — consult: read `00-index.md` only, follow the matching link in its **Manual** section, load that one concern file. Never bulk-load the whole manual — that's what the index is for.

**no argument** — print the Manual list from `00-index.md`, or suggest `init` if the manual doesn't exist yet.

## Rules

- Links go one way: index → concern files. The index's link section and the skeleton's back-link section share one name — **Manual** — so authoring and consulting always agree.
- When a convention changes in code, update the concern file in the same PR. A stale manual is worse than none.
- Numbering is authorship order, nothing more; the index is the only lookup path.
