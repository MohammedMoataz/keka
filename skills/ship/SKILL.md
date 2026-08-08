---
description: Commit staged work and open a PR in one pass - branch (new or current), conventional commit message from the diff, push, PR created and self-assigned, and the team seed refreshed and included. Use for "/ship", "commit and PR this", "ship my staged work".
argument-hint: "[new [<branch-name>] | current]"
model: haiku
effort: low
allowed-tools: Bash, Read, AskUserQuestion
---

# /ship — staged work out the door

One input (what you staged), two outputs: a pull request, and a team seed that carries what this session learned.

Budget: under five minutes. Stay deterministic — the only judgment calls are the branch name and the commit message.

## Rules that matter

- **One git command per Bash call.** No `cd` prefix, no `&&` chaining — compound git invocations trip a repository-security prompt and cost you the time budget.
- **Never** `reset --hard`, `push --force`, `checkout --`, `clean`, or unstage anything. Never stage files the user didn't stage, except the seed in step 4.
- Don't re-scan for secrets — the guard hook already did that on every write.

## Steps

1. **Look**, one call each: `git status` · `git diff --cached --stat` · `git diff --cached` · `git log --oneline -5` · `git branch --show-current`.
   Nothing staged? Say so, show what's unstaged, and stop.

2. **Build gate, only if `.keka/stack.md` defines `build_cmd`.** Run it (for a `services` section, only the owning service — nearest root above the changed files). On failure: make the minimal fix, `git add` just those files, re-run once. No `build_cmd`, no gate — skip it.

3. **Branch.** `new` → derive a conventional name from the diff (`feat/…`, `fix/…`), then `git checkout -b <name>`. `current` → stay. No argument → one AskUserQuestion offering new vs. the current branch. Creating a branch with `-b` is fine; never `checkout` an *existing* branch without asking.

4. **Refresh the seed** so the knowledge ships with the code:
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" auto-seed "<repo-root>"`
   - It only touches a seed that already exists. If the output says the project never opted in, mention `/handoff` once and carry on — this step is never a blocker.
   - If it did refresh, `git add` the seed file so it lands in this commit.

5. **Commit.** Write a conventional message whose *type vocabulary matches the recent log* (read step 1's `git log`, don't assume a fixed list). Subject line, blank line, one or two lines of why — not what; the diff says what.

   ```bash
   git commit -m "$(cat <<'EOF'
   <type>: <summary>

   <why, 1-2 lines>

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
   EOF
   )"
   ```

6. **Push**: `git push -u origin HEAD`.

7. **PR.** Check `gh --version` first. Then `gh pr create --fill --assignee @me`. Add `--base <branch>` only if the user named one. If a PR already exists for this branch, say so and skip rather than failing. No `gh` installed → print the compare URL derived from `git remote get-url origin`.

8. **Report**: branch · commit SHA · PR URL · assignee · whether the seed was refreshed and included.
