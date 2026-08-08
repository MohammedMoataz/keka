---
description: Review a feature slice for cross-stack consistency - permission parity, validation coverage, API-contract match between backend and frontend. Use for "/review-feature", "review the orders feature", "audit this slice".
argument-hint: "<feature> [any overview or worry worth steering the review]"
---

# /review-feature — does the whole slice agree with itself?

Dispatch the **review-feature** agent for the named feature, in a fresh context so its file reading never lands in yours.

## Steps

1. If `.keka/stack.md` is missing, run `/stack` first — without it the agent is guessing at where code lives.
2. Take the feature name from the first argument. **Everything after it is the user's steer** — an overview of the feature, a specific worry, a recent change, an area they don't trust. Pass it to the agent verbatim, labeled as a hint to verify rather than a fact to accept.
3. Launch the agent. Wait for it; don't duplicate its work by reading the same files yourself.
4. Relay its report as it came back — findings ranked by severity, each with its `file:line`. Don't soften it, and don't add findings of your own that the agent didn't verify.
5. If it returned no findings, say so plainly. A clean review is a result.

## Related

- Per-file correctness is a different job — this checks only what no single file can show.
- Conventions the review leans on live in `/patterns`; the agent may suggest an addition, but never writes one itself.
