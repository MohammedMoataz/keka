---
description: The project's team directory and your private trust settings - register yourself in .keka/team.md, see who else is on the project, and decide whose imported memories you trust. Use for "/team", "add me to the team", "trust this teammate", "who is on this project".
argument-hint: "[register | trust <email> <full|workspace> [note] | sync]"
---

# /team — who is on this project, and who you trust

Two separate things, deliberately:

- **`.keka/team.md`** is a shared directory — name, email, role — committed to the repo. It carries no judgments.
- **Trust is private.** It lives only in your own keka database, never in the shared file, never in a seed. Nobody else can see, or needs to see, how you rated them.

## Steps

**No argument** — show the picture: `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" team-list` (roster joined with your local trust), then `whoami` if you are not listed yet, and offer to register.

**`register`** — add yourself to `.keka/team.md`, creating the file if it does not exist. Take name and email from `whoami` (they come from git config); ask for the role. Format, one member per line:

```markdown
# Team

- Sara Malik <sara@example.com> — role: tech-lead
- Omar Nabil <omar@example.com> — role: backend
- Lina Haddad <lina@example.com> — role: qa
```

Never overwrite the file — append your line and leave everyone else's alone. Then tell the user to commit it.

**`trust <email> <full|workspace> [note]`** — `engine.js trust <email> <level> "<note>"`. Say plainly that this is local to this machine. Levels: `full` (their memories rank in your brief like your own) and `workspace` (held privately, confidence capped, searchable but never auto-injected, never re-exported).

**`sync`** — for each roster member with no trust row, set the default level, leaving existing choices untouched. Report what changed.

## Rules

- Never write a `trust:` field into `.keka/team.md`. Older keka versions kept trust there; if you see those lines, say they are now private, offer to run `trust` for each, and offer to remove them from the shared file.
- Roles are free text (`tech-lead`, `qa`, `backend`, …) and are snapshotted onto memories when written, so `/recall --role qa` keeps working even after someone changes role.
- Registering is per person: never add a teammate on their behalf.
