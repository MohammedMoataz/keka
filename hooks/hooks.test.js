#!/usr/bin/env node
'use strict';
// Smoke test: run each hook binary with fake stdin, assert exit codes + outputs.
// KEKA_LEARN=off so no LLM calls are made here.
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keka-hooks-'));
const env = {
  ...process.env,
  KEKA_DB: path.join(tmp, 'h.db'),
  KEKA_LOG: path.join(tmp, 'log.jsonl'),
  KEKA_LEARN: 'off',
  KEKA_AUTHOR: 'tester@example.com',
};
const run = (file, input, extraEnv) => spawnSync('node', [path.join(__dirname, file)], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 20000,
});

// session-start: exit 0 (empty DB -> possibly no output)
let r = run('session-start.js', { session_id: 'hs1', cwd: '/demo/proj' });
assert.strictEqual(r.status, 0, 'session-start exit 0');

// prompt: records first prompt, no output
r = run('prompt.js', { session_id: 'hs1', cwd: '/demo/proj', prompt: 'build the widget' });
assert.strictEqual(r.status, 0, 'prompt exit 0');
assert.strictEqual(r.stdout.trim(), '', 'prompt is silent');

// prompt on a session that never had SessionStart (resume) -> row still created
r = run('prompt.js', { session_id: 'resumed-1', cwd: '/demo/proj', prompt: 'continue the widget' });
assert.strictEqual(r.status, 0, 'prompt (resumed) exit 0');

// observe: success row + failure row (FAIL prefix)
r = run('observe.js', { session_id: 'hs1', tool_name: 'Edit', tool_input: { file_path: '/demo/proj/a.js' } });
assert.strictEqual(r.status, 0, 'observe exit 0');
r = run('observe.js', { session_id: 'hs1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm  test' } });
assert.strictEqual(r.status, 0, 'observe failure exit 0');

// KEKA_INNER short-circuits everything
r = run('observe.js', { session_id: 'hs1', tool_name: 'Edit', tool_input: { file_path: 'y' } }, { KEKA_INNER: '1' });
assert.strictEqual(r.status, 0, 'inner guard exit 0');

// session-end (LEARN off): closes row deterministically
r = run('session-end.js', { session_id: 'hs1', cwd: '/demo/proj' });
assert.strictEqual(r.status, 0, 'session-end exit 0');

// session-start: team-seed nudge when .keka/team-seed.jsonl is committed in the repo
const seedProj = path.join(tmp, 'seedproj');
fs.mkdirSync(path.join(seedProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(seedProj, '.keka', 'team-seed.jsonl'),
  JSON.stringify({ type: 'note', text: 'teammate fact' }) + '\n' + JSON.stringify({ type: 'note', text: 'another fact' }) + '\n');
r = run('session-start.js', { session_id: 'hs2', cwd: seedProj });
assert.strictEqual(r.status, 0, 'session-start seed exit 0');
assert.ok(r.stdout.includes('team-seed.jsonl') && r.stdout.includes('2 entries') && r.stdout.includes('/handoff import'),
  'seed nudge emitted: ' + r.stdout);

// partners: nudge until dismissed; mode-sensitive
r = run('session-start.js', { session_id: 'hp1', cwd: '/demo/proj' });
assert.ok(r.stdout.includes('/partners'), 'partners nudge emitted: ' + r.stdout);
r = run('session-start.js', { session_id: 'hp2', cwd: '/demo/proj' }, { KEKA_PARTNERS: 'off' });
assert.ok(!r.stdout.includes('/partners'), 'partners off = silent');
r = run('session-start.js', { session_id: 'hp3', cwd: '/demo/proj' }, { KEKA_PARTNERS: 'auto' });
assert.ok(r.stdout.includes('partners mode: auto'), 'auto mode restated every session: ' + r.stdout);
r = spawnSync('node', [path.join(__dirname, 'engine.js'), 'partners-seen'], { encoding: 'utf8', env, timeout: 20000 });
assert.strictEqual(r.status, 0, 'partners-seen exit 0: ' + r.stderr);
r = run('session-start.js', { session_id: 'hp4', cwd: '/demo/proj' });
assert.ok(!r.stdout.includes('/partners'), 'nudge gone after partners-seen: ' + r.stdout);

// session-start: brief appears once memory + a previous session exist
r = spawnSync('node', [path.join(__dirname, 'engine.js'), 'add', 'learning', 'hooks smoke memory', '0.9', '--project', '/demo/proj'],
  { encoding: 'utf8', env, timeout: 20000 });
assert.strictEqual(r.status, 0, 'engine add exit 0: ' + r.stderr);
r = run('session-start.js', { session_id: 'hs3', cwd: '/demo/proj' });
assert.ok(r.stdout.includes('## Keka memory brief'), 'brief header emitted: ' + r.stdout);
assert.ok(r.stdout.includes('hooks smoke memory'), 'memory in brief');
assert.ok(r.stdout.includes('Last session here'), 'last session line in brief');
assert.ok(r.stdout.includes('continue the widget'), 'latest session first prompt shown');

// verify DB state via engine (same KEKA_DB)
process.env.KEKA_DB = env.KEKA_DB;
process.env.KEKA_AUTHOR = env.KEKA_AUTHOR;
const e = require('./engine.js');
const act = e.sessionActivity('hs1');
assert.ok(act.session, 'session row exists');
assert.strictEqual(act.session.first_prompt, 'build the widget', 'first prompt recorded');
assert.ok(act.session.ended, 'session closed');
assert.strictEqual(act.session.summary, 'build the widget', 'summary fallback = first prompt');
assert.deepStrictEqual(act.observations.map((o) => o.digest), ['edit demo/proj/a.js', 'FAIL npm test'],
  'two observations, inner-guarded call wrote nothing, failure marked');
const resumed = e.sessionActivity('resumed-1').session;
assert.ok(resumed, 'resumed session row created by prompt hook');
assert.strictEqual(resumed.first_prompt, 'continue the widget', 'resumed first prompt recorded');

console.log('hooks.test.js: ALL PASS');
