#!/usr/bin/env node
'use strict';
// UserPromptSubmit: session bookkeeping (resumed sessions get no SessionStart, so the
// row is ensured here + first prompt recorded) and the prompt coach — free regex hints
// always, one Haiku review in plan mode only.
// Hints go to systemMessage ONLY (user-facing). The model must not receive a critique
// of the prompt alongside the prompt, or answers drift into meta-commentary.
if (process.env.KEKA_INNER) process.exit(0);

const fs = require('node:fs');
const path = require('node:path');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let engine = null;
  try {
    const data = JSON.parse(raw || '{}');
    engine = require('./engine.js');
    engine.useProject(data.cwd);
    engine.sessionStart(data.session_id, data.cwd); // no-op when the row exists
    const prompt = String(data.prompt || '').trim();
    engine.firstPrompt(data.session_id, prompt);

    if (!engine.optOn('coach', 'on')) process.exit(0);
    if (prompt.length < 25 || prompt.startsWith('/') || prompt.startsWith('!')) process.exit(0);

    const notes = hints(prompt);
    const planMode = (data.permission_mode || data.permissionMode) === 'plan';
    if (planMode && engine.optOn('plan_review', 'on')) {
      const review = haikuReview(engine, prompt);
      if (review) notes.push(review);
    }
    if (notes.length) console.log(JSON.stringify({ systemMessage: '[keka-coach] ' + notes.join(' | ') }));
  } catch (err) {
    try { (engine || require('./engine.js')).log('prompt', err); } catch { /* silent */ }
  }
  process.exit(0);
});

function hints(p) {
  // a "reference" is @path, `code`, or a file-extension token — deliberately NOT any
  // bare a/b/ fragment, which counts prose like "and/or" as a file reference
  const hasRef = /@[\w./\\-]|`[^`]+`|\b[\w-]{2,}\.(?:js|ts|tsx|jsx|py|md|json|yml|yaml|css|html|sql|ps1|sh|go|rs|java|rb|php|c|h|cpp|cs|vue|svelte|toml|txt)\b/.test(p);
  const out = [];
  if (/\b(this|that) (file|function|component|code)\b/i.test(p) && !p.includes('@'))
    out.push('"this file" is ambiguous — reference it with @path.');
  if (/^(fix|improve|update|optimize|clean|refactor|make)\b/i.test(p) && !hasRef)
    out.push('Name the file/function and the symptom (@path refs help).');
  if (/^(build|create|implement|add)\b/i.test(p) && !/\b(test|verify|should|so that|acceptance|done when)\b/i.test(p))
    out.push('State what done looks like — a test, a behavior, an acceptance line.');
  if (p.length > 600 && (p.match(/\b(and|also|then|plus)\b/gi) || []).length > 6)
    out.push('Large multi-part ask — consider plan mode.');
  return out.slice(0, 2);
}

function haikuReview(engine, prompt) {
  const cooldown = path.join(path.dirname(engine.DB_PATH), 'coach-cooldown');
  try {
    // a wedged CLI must not tax every plan-mode prompt: after one failure, skip for 1h
    try { if (Date.now() - fs.statSync(cooldown).mtimeMs < 3600000) return null; } catch { /* no cooldown */ }
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.env.KEKA_CLAUDE_BIN || 'claude', ['-p', '--model', 'claude-haiku-4-5'], {
      input: 'Review this prompt written for an AI coding agent. Reply in at most 700 characters: '
        + 'a score out of 10, what is missing, and — only if the score is below 8 — a better rewrite.\n\nPrompt:\n'
        + prompt.slice(0, 2000),
      encoding: 'utf8',
      timeout: 12000, // inside the hook's 20s budget, unlike a 15s spawn in a 25s hook with no margin
      shell: true,
      env: { ...process.env, KEKA_INNER: '1' },
    });
    if (r.status !== 0 || !r.stdout || !r.stdout.trim()) {
      fs.writeFileSync(cooldown, new Date().toISOString());
      engine.log('coach.haiku', 'claude -p failed: status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 300));
      return null;
    }
    return r.stdout.trim().slice(0, 700);
  } catch (err) {
    try { fs.writeFileSync(cooldown, new Date().toISOString()); } catch { /* best effort */ }
    engine.log('coach.haiku', err);
    return null;
  }
}
