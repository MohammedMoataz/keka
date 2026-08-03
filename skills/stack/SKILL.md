---
description: Capture or update the project's stack profile (.keka/stack.md) - roots, build/test/lint commands, conventions - that skills and teammates read instead of rediscovering. Use once per repo, or when structure changes.
argument-hint: [notes about the stack]
---

# /stack — the project's profile

One file, `.keka/stack.md`, holding what every task otherwise rediscovers: where the code lives, how it builds, how it's tested.

## Steps

1. Read `.keka/stack.md` if present — a run **amends, never overwrites**.
2. Gather values, precedence: the user's argument text → repo evidence (package.json, *.csproj, go.mod, Cargo.toml, CI configs, lockfiles) → ask the user. Confirm inferred values instead of silently guessing.
3. Write `.keka/stack.md` with the fields below. Omit rows that don't apply. **Values only** — no commentary, placeholders, or "e.g." text inside a value.
4. Suggest committing it — the file serves teammates as much as the agent.

## Fields

```
# Stack

- backend_root: <path>
- frontend_root: <path>
- build_cmd: <command>
- test_cmd: <command>
- lint_cmd: <command>
- docs_dir: <path>
- conventions:
  - <one line each>
- services:            # multi-service repos only
  - <name>: root <path> · build <cmd> · test <cmd>
```

Example — structure only, never copy the values:

```
# Stack

- backend_root: api
- frontend_root: web
- build_cmd: npm run build
- test_cmd: npm test
- lint_cmd: npm run lint
- docs_dir: docs
- conventions:
  - REST handlers thin; logic in services/
  - migrations never edited after merge
```

Multi-service repos: a file belongs to the service with the **nearest root** above it.
