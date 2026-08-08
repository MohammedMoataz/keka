---
description: Name the current session so it is findable in team history - "/name <label>". Use for "name this session", "rename this session", "label this work".
argument-hint: <label>
---

# /name — label this session

Every session gets an automatic name (`<branch>-<username>`), which is fine for solo work and useless in a team history. A real label — what this session is *for* — is what teammates read later.

## Steps

1. No argument? Show the current name (`engine.js whoami` for identity, and the session brief already shows recent names) and ask what to call it.
2. `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" name "${CLAUDE_SESSION_ID}" "<label>"`.
3. Confirm the stored label.

## Rules

- Names are labels, not keys. If a teammate already used the same label on this project, both are kept and display disambiguates them as `label@username` — never refuse or auto-rename because of a collision.
- Keep it about the work (`orders-rounding-fix`), not the day (`tuesday`).
- Claude Code's own `/rename` is separate; keka adopts that name at session start when you have set one.
