# Changelog

Releases are git tags.

## v0.1.0 — Memory (2026-08-01)

Memory that compounds across sessions and travels across the team.

- **Session brief** injected on startup/clear: last session's summary + top memories (project/task-affine, type-decayed, char-capped, ids included).
- **Observations**: deterministic one-line records of Edit/Write/Bash, failures marked `FAIL`.
- **Session-end distillation**: one Haiku call → one-line session summary + 0–3 durable learnings (deduped, clamped, opt-out via `learn`).
- **/recall**: FTS5 search with progressive disclosure.
- **/handoff** + **/handoff import**: project-scoped memory handoff over git with a trust roster (`.keka/team.md`). Full-trust memories join the brief; `workspace`-trust memories stay private (capped confidence, never injected, never re-exported) but remain searchable. Re-import applies trust changes in both directions.
- Zero runtime dependencies (`node:sqlite`, Node ≥ 22.5). DB at `~/.keka/keka.db`, failures logged to `~/.keka/log.jsonl`.

Design choices worth knowing: project identity is the git remote URL so imported memories rank correctly on any machine; search is read-only and never resets a memory's decay clock; deduplication is normalized and indexed; the brief ranks over a bounded candidate window; resumed sessions are tracked; distillation reads the end of a long session, not its opening; observations are pruned after 30 days; workspace rows are excluded from export.
