---
description: Hand your session's memory to the team, or pick up theirs - exports this project's memories and session history to .keka/team-seed.jsonl (git is the transport, optionally encrypted) and imports a teammate's with your private trust applied. Use for "hand this off", "share what I learned", "/handoff import" to load teammate knowledge.
argument-hint: "[import] [--task <t>] [--repo <r>] [--encrypt]"
---

# /handoff — pass memory between teammates

Memories and session history travel as `.keka/team-seed.jsonl`, committed to the repo. No server, no sync — git is the transport, so knowledge moves with the branch.

## Hand off (default — you did the work)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-export .keka/team-seed.jsonl`
   - The **whole project** — every repository that belongs to it — because whoever picks up any one repo should get the full picture. Narrow with `--repo` (just this service) or `--task "<branch>"`.
   - Your global memories never travel: they belong to you, not to the product.
   - Session rows travel too: who worked on which branch, under what session name, and what they concluded.
   - Workspace-only memories never leave — see below.
2. Report the counts as printed (`exported N memories / M sessions`) and remind the user to commit the file.
3. First handoff in this repo? Mention that from now on keka keeps the file current by itself — on `/compact`, on `/clear`, and after each commit.

## Pick up (`/handoff import` — you're taking the work over)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" seed-import .keka/team-seed.jsonl --dir "<repo-root>"`
   - Pass the repo root as `--dir` so trust and the key location resolve.
   - Idempotent — re-running never duplicates (dedup is on normalized text).
2. Report the counts exactly as printed.
3. Continue the work from what the imported memories tell you; cite ids when you rely on one.

## Encryption

The seed sits in git, readable by anyone with repo access. To close that:

1. Put a shared passphrase in `.keka/seed.key` (or the `KEKA_SEED_KEY` environment variable) — **and make sure `.keka/seed.key` is gitignored**; offer to add it if the repo has no rule for it.
2. Export with `--encrypt` to `.keka/team-seed.jsonl.enc`.

Import auto-detects an encrypted seed and decrypts it. Wrong key, or a file altered in transit, fails loudly — AES-GCM authenticates the contents, so tampering is detected, not silently accepted. Never write a decrypted copy back into the repo.

## Workspace vs. brief

Every imported memory lands in one of two places:

- **Brief** — full-trust memories join your ranked session brief, exactly like your own.
- **Workspace** — memories from someone you trust at `workspace` level stay private to your machine: confidence capped at 0.3, never auto-injected, never re-exported when you hand off. Still yours to find — `/recall` shows them marked `[workspace]`.

Workspace is a holding area, not a penalty box: raise their trust with `/team trust <email> full`, re-import, and their memories move up into the brief with their original confidence restored (reported as `promoted`). Lowering trust moves them back.

**Trust is private** — your own database, never the shared roster, never a seed. See `/team`.

## Rules

- Never edit the seed by hand — handing off regenerates it whole.
- SessionStart nudges when a team seed exists in the repo; if the user saw that nudge, go straight to import.
