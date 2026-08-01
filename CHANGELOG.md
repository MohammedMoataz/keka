# Changelog

Releases are git tags. One feature per release — that's the whole point.

## v0.1.0 — Memory (2026-08-01)

The foundation slice: memory that compounds across sessions and travels across the team.

- **Session brief** injected on startup/clear: last session's summary + top memories (project/task-affine, type-decayed, char-capped, ids included).
- **Observations**: deterministic one-line records of Edit/Write/Bash, failures marked `FAIL`.
- **Session-end distillation**: one Haiku call → one-line session summary + 0–3 durable learnings (deduped, clamped, opt-out via `learn`).
- **/recall**: FTS5 search with progressive disclosure.
- **/handoff** + **/handoff import**: project-scoped memory handoff over git with a trust roster (`.keka/team.md`). Full-trust memories join the brief; `workspace`-trust memories stay private (capped confidence, never injected, never re-exported) but remain searchable. Re-import applies trust changes in both directions.
- Zero runtime dependencies (`node:sqlite`, Node ≥ 22.5). DB at `~/.keka/keka.db`, failures logged to `~/.keka/log.jsonl`.

Rebuilt from an earlier harness's memory subsystem with its known defects fixed: portable project identity (git remote URL), bounded brief query, read-only search (no decay-clock reset), normalized+indexed dedup, resumed sessions tracked, real session summaries (not the first prompt twice), last-40 (not first-40) observations fed to distillation, observation retention (30 days), tolerant roster parsing, import trust applied from an explicit repo dir, workspace rows excluded from export.
