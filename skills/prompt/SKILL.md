---
description: Prompt templates and best-practice review for writing Claude Code prompts - bugfix, feature, refactor, research, review templates plus the 10 rules. Use for "/prompt <type>", "help me write a prompt", "review my prompt".
argument-hint: <bugfix|feature|refactor|research|review|rules> [draft]
---

# /prompt — write prompts that land

If the argument names a template, print it filled with whatever is already known from context (blanks where nothing is known). If a draft prompt follows the type — or is pasted alone — review it against the 10 rules: quote each weak spot, then give one rewrite. `rules` prints the rules.

## The 10 rules

1. **Scope precisely** — one outcome per prompt; split anything with an "and also".
2. **Reference with `@path`**, never "this file" — the agent can't see what you're looking at.
3. **Give a verification path** — how will both of you know it worked (a test, a command, a behavior)?
4. **Big task? Plan first** — enter plan mode before code gets written.
5. **Bug prompts carry three things** — symptom, location (or best guess), and "find the root cause, don't suppress the symptom".
6. **Say why** — intent lets the agent make the right tradeoffs when the letter of the ask is ambiguous.
7. **Style or format matters? Show 1–3 examples** — examples beat adjectives.
8. **Label your blocks** — context / task / constraints, so nothing gets read as an instruction that isn't one.
9. **Two failed corrections → restart** — `/clear` and re-prompt beats a third patch on a confused thread.
10. **Broad investigation → subagents** — keep the main thread for decisions, not file dumps.

## Templates

### bugfix
```
Bug: <symptom, exact error text if any>
Where: <@path or best guess>
Repro: <steps or failing command>
Expected: <correct behavior>
Find the root cause — don't suppress the symptom. Prove the fix with <test/command>.
```

### feature
```
Build: <what> — because <why>.
Done when: <observable behavior or passing test>.
Constraints: <stack, patterns to follow, perf/security limits>.
Out of scope: <what NOT to touch>.
```

### refactor
```
Refactor <@path or area>: <goal — e.g. extract X, flatten Y>.
Behavior-invariant: existing tests must stay green, no API changes unless listed.
Prefer structural rewrites (one rule applied everywhere) over per-file hand edits.
```

### research
```
Question: <one sentence>.
Prefer: <docs/sources to trust>.
Output: <format — comparison table, recommendation, cited summary>.
Every claim needs a source or a code citation.
```

### review
```
Review <diff/branch/files> for <correctness|security|performance>.
Report: severity-tagged findings with file:line evidence, most severe first.
Skip style nits unless they change meaning.
```
