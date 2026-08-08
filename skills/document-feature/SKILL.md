---
description: Write or refresh full-stack documentation for a feature slice - domain model, API surface, frontend wiring, permissions, end-to-end flow - grounded in real code. Use for "/document-feature", "document the orders feature", "refresh the docs for X".
argument-hint: "<feature> [an overview of what it does, or what to emphasize]"
---

# /document-feature — the slice, written down

Dispatch the **document-feature** agent, in a fresh context so the code it reads never lands in yours.

## Steps

1. If `.keka/stack.md` is missing, run `/stack` first — it decides where the code lives and where docs go.
2. Take the feature name from the first argument. **Everything after it is the user's overview** — what the feature is for, what matters about it, what to emphasize. Pass it verbatim: it frames the Overview section and orients the search, while every specific still gets verified against code.
3. Launch the agent and wait. It creates the document, or refreshes only the sections whose sources changed.
4. Report where it wrote, which sections changed, and anything it marked as not implemented — those gaps are usually the most useful part.
5. Suggest committing the document; it is for teammates as much as for the agent.

## Related

- The agent records a `reference` memory pointing at the document, so future session briefs know it exists.
- Cross-stack defects are a separate question — that's `/review-feature`.
