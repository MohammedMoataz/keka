---
description: Show or declare which project this repository belongs to - a project can span several repositories (a backend and a frontend, or a fleet of services) and they share one memory. Use for "/project", "group these repos", "which project is this", "list my projects".
argument-hint: "[declare <name> | register [<repo>] | list]"
---

# /project — one product, however many repositories

A **project** is the product. A **repo** is one repository inside it. Memory is stored per project, so a backend and a frontend that belong together share what they learn — while each memory still records which repo it came from, and your own repo always ranks first.

A repo that declares nothing is its own project, which is why single-repo work needs no setup at all.

## Steps

**No argument** — `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" project`. Report the resolved project, this repo, whether the project is declared or implicit, its declared and registered repos, and where the database lives. If the project is implicit, mention that `declare` groups repos together.

**`declare <name>`** — write `.keka/project.md` in this repo, then tell the user to **commit it and add the same file to every sibling repository** — the grouping only works when every member declares the same name.

```markdown
# Project
name: acme-shop

repos:
  - github.com/acme/shop-api
  - github.com/acme/shop-web
```

Get this repo's identity from `engine.js project` and put it in the list. Add siblings the user names; the list is documentation and a consistency check, not a gate.

**`register [<repo>]`** — `engine.js project register [<repo>]`, for a repo that belongs to the project but isn't listed yet.

**`list`** — `engine.js projects` shows every project keka knows and where each database sits; `engine.js repos` shows the repos of the current one.

## Rules

- Renaming a project starts a new, empty one. To carry the old memories over, use `engine.js rekey <old> <new>` — and say plainly that it moves rows, since it is not undoable.
- `.keka/project.md` is committed: the grouping is a fact about the product, the same for everyone.
- Working in a repo the declaration doesn't list is fine — keka records it and mentions it once. Never treat it as an error.

## Related

- Knowledge that belongs to *you* rather than to a product — an environment quirk, a tool trap — is stored globally and shows up in every project. `/recall --all` searches across every project.
- `/handoff` exports the whole project by default; `--repo` narrows it to one service.
