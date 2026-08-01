#!/usr/bin/env node
'use strict';
// Smallest runnable check for the engine. Uses a throwaway DB via KEKA_DB.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keka-test-'));
process.env.KEKA_DB = path.join(tmp, 'test.db');
process.env.KEKA_LOG = path.join(tmp, 'log.jsonl');
process.env.KEKA_AUTHOR = 'tester@example.com'; // deterministic identity (no git dependence)
const e = require('./engine.js');

// memory round-trip
e.add('learning', 'PowerShell 5.1 has no && chaining', 0.9, null, 'test');
e.add('note', 'seed files travel in .keka', 0.6);
const hits = e.search('powershell chaining');
assert.ok(hits.length >= 1, 'FTS search finds the learning');
assert.match(hits[0]._display, /#\d+ \[learning\]/, 'short display line');
const full = e.search('powershell', { full: true });
assert.strictEqual(full[0]._display, null, 'full mode: no truncated line');

// normalized dedup: case/whitespace variants are the same fact
assert.strictEqual(e.hasText('PowerShell 5.1 has no && chaining'), true, 'hasText exact hit');
assert.strictEqual(e.hasText('  powershell 5.1 HAS   no && chaining '), true, 'hasText normalized hit');
assert.strictEqual(e.hasText('never stored'), false, 'hasText miss');

// unknown type coerced to note
e.add('bogus', 'weird typed fact', 0.5);
assert.strictEqual(e.search('weird typed', { full: true })[0].type, 'note', 'unknown type coerced to note');

// search is read-only for ranking: uses counter bumps, no decay-clock column exists
e.add('note', 'unique zebra fact', 0.8);
assert.strictEqual(e.search('zebra', { full: true })[0].uses, 0, 'fresh row starts at zero uses');
const zebra = e.search('zebra', { full: true })[0];
assert.strictEqual(zebra.uses, 1, 'uses bumped by the earlier search');
assert.strictEqual(zebra.last_used, undefined, 'no last_used column — decay is from created only');

// brief respects cap on ALL lines
e.add('note', 'X'.repeat(500), 0.9);
const b = e.brief(300);
assert.ok(b.length <= 300, `brief capped (${b.length})`);

// sessions + observations
e.sessionStart('s1', '/demo/proj');
e.sessionStart('s1', '/demo/proj'); // idempotent
e.firstPrompt('s1', 'build the thing');
e.firstPrompt('s1', 'should not overwrite');
e.observe('s1', 'Edit', '/demo/proj/a.js', 'edit proj/a.js');
e.observe('s1', 'Bash', '', 'npm test');
const act = e.sessionActivity('s1');
assert.strictEqual(act.session.first_prompt, 'build the thing', 'first prompt kept');
assert.strictEqual(act.observations.length, 2, 'two observations');
assert.strictEqual(act.observations[0].digest, 'edit proj/a.js', 'oldest-first order');
e.sessionEnd('s1', 'built the thing');

// sessionActivity returns the LAST n (a long session's conclusion holds the learnings)
for (let i = 1; i <= 5; i++) e.observe('s-many', 'Bash', '', 'cmd ' + i);
const lastTwo = e.sessionActivity('s-many', 2).observations;
assert.deepStrictEqual(lastTwo.map((o) => o.digest), ['cmd 4', 'cmd 5'], 'last N, chronological');

// retention: observations older than the window are pruned
e.observe('s1', 'Bash', '', 'ancient command');
e.db().prepare("UPDATE observations SET created = datetime('now','-40 days') WHERE digest = 'ancient command'").run();
assert.ok(e.pruneObservations(30) >= 1, 'old observation pruned');
assert.ok(!e.sessionActivity('s1').observations.some((o) => o.digest === 'ancient command'), 'pruned row gone');

// seed idempotency
const seed = path.join(tmp, 'seed.jsonl');
const n = e.seedExport(seed);
assert.ok(n >= 3, 'seed exported');
const r1 = e.seedImport(seed, tmp);
assert.strictEqual(r1.added, 0, 'reimport adds nothing');
assert.strictEqual(r1.dup, n, 'all dups');

// forget echoes what it deleted; FTS stays in sync
e.add('note', 'wrong fact to delete', 0.9);
const wrongId = e.search('wrong fact')[0].id;
assert.strictEqual(e.forget(wrongId), 'wrong fact to delete', 'forget echoes deleted text');
assert.ok(!e.search('wrong fact').some((r) => r.text === 'wrong fact to delete'), 'FTS synced after forget');
assert.strictEqual(e.forget(99999), null, 'forget missing id -> null');

// portable project identity
assert.strictEqual(e.normalizeRemote('git@github.com:Org/Repo.git'), 'github.com/org/repo', 'ssh remote normalized');
assert.strictEqual(e.normalizeRemote('https://user:token@GitHub.com/Org/Repo.git'), 'github.com/org/repo', 'credentials stripped');
assert.strictEqual(e.normalizeRemote('https://github.com/org/repo'), 'github.com/org/repo', 'plain https normalized');
assert.strictEqual(e.project('/Demo/NoSuchDir'), '/demo/nosuchdir', 'non-repo fallback: lowercased path');

// project-affine brief: same-project memory outranks stronger global one; lines carry ids
e.add('note', 'project-local wisdom', 0.6, '/demo/proj', null);
e.add('note', 'global wisdom', 0.7, null, null);
const pb = e.brief(4000, '/demo/proj');
assert.ok(pb.indexOf('project-local wisdom') < pb.indexOf('global wisdom'), 'project memory ranked first');
assert.match(pb, /- \[note #\d+\] project-local wisdom/, 'brief lines carry ids');
assert.ok(pb.includes('Last session here'), 'brief includes last session line');

// author/task stamping + explicit override
e.add('learning', 'task-scoped wisdom about exports', 0.9, null, null, { task: 'orders-v2' });
const stamped = e.search('task-scoped wisdom', { full: true })[0];
assert.strictEqual(stamped.author, 'tester@example.com', 'author stamped from KEKA_AUTHOR');
assert.strictEqual(stamped.task, 'orders-v2', 'explicit task kept');
assert.strictEqual(e.task('explicit-wins'), 'explicit-wins', 'task() explicit override');
assert.strictEqual(e.taskSlug('feature/orders-v2'), 'feature-orders-v2', 'slug flattens slashes');

// search filters by task / author
assert.ok(e.search('wisdom', { task: 'orders-v2' }).every((r) => r.task === 'orders-v2'), 'task filter');
assert.strictEqual(e.search('wisdom', { author: 'nobody@nowhere' }).length, 0, 'author filter excludes');

// seed-export --task exports only that task's rows, with author+task in the payload
const tseed = path.join(tmp, 'task-seed.jsonl');
assert.strictEqual(e.seedExport(tseed, { task: 'orders-v2' }), 1, 'task-filtered export');
const trow = JSON.parse(fs.readFileSync(tseed, 'utf8').trim());
assert.strictEqual(trow.author, 'tester@example.com', 'seed row carries author');
assert.strictEqual(trow.task, 'orders-v2', 'seed row carries task');

// roster + workspace import: new joiner capped and held private, unknown author full trust
const teamProj = path.join(tmp, 'teamproj');
fs.mkdirSync(path.join(teamProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(teamProj, '.keka', 'team.md'),
  '# Team\n- architect@example.com — trust: full\n- joiner@example.com — trust: workspace\n');
assert.deepStrictEqual(e.roster(teamProj),
  { 'architect@example.com': 'full', 'joiner@example.com': 'workspace' }, 'roster parsed');
assert.deepStrictEqual(e.roster(path.join(tmp, 'no-roster')), {}, 'missing roster = empty');
const mixSeed = path.join(tmp, 'mix-seed.jsonl');
fs.writeFileSync(mixSeed, [
  JSON.stringify({ type: 'learning', text: 'joiner unverified claim', confidence: 0.9, author: 'joiner@example.com', task: 'orders-v2' }),
  JSON.stringify({ type: 'learning', text: 'architect solid decision', confidence: 0.9, author: 'architect@example.com', task: 'orders-v2' }),
  JSON.stringify({ type: 'note', text: 'stranger note', confidence: 0.8, author: 'stranger@example.com' }),
].join('\n') + '\n');
const imp = e.seedImport(mixSeed, teamProj);
assert.strictEqual(imp.added, 3, 'all three imported');
assert.strictEqual(imp.workspace, 1, 'one held in workspace');
const joinerRow = e.search('joiner unverified', { full: true })[0];
assert.strictEqual(joinerRow.workspace, 1, 'joiner row held private');
assert.ok(joinerRow.confidence <= 0.3, 'joiner confidence capped');
const archRow = e.search('architect solid', { full: true })[0];
assert.strictEqual(archRow.workspace, 0, 'roster full = untouched');
assert.strictEqual(archRow.confidence, 0.9, 'confidence kept');
const strangerRow = e.search('stranger note', { full: true })[0];
assert.strictEqual(strangerRow.workspace, 0, 'unknown author = full trust');
assert.ok(e.search('joiner unverified')[0]._display.includes('[workspace]'), 'search marks workspace rows');

// workspace rows never re-export (someone else's claim, held privately, not yours to pass on)
const reseed = path.join(tmp, 'reseed.jsonl');
e.seedExport(reseed);
assert.ok(!fs.readFileSync(reseed, 'utf8').includes('joiner unverified'), 'workspace row excluded from export');

// project-filtered export
const pseed = path.join(tmp, 'proj-seed.jsonl');
const pn = e.seedExport(pseed, { project: '/demo/proj' });
assert.ok(pn >= 1, 'project-filtered export non-empty');
for (const line of fs.readFileSync(pseed, 'utf8').trim().split('\n')) {
  assert.strictEqual(JSON.parse(line).project, '/demo/proj', 'every exported row belongs to the project');
}

// brief: workspace rows excluded entirely; task-affine boost outranks stronger untasked memory
process.env.KEKA_TASK = 'orders-v2';
e.add('note', 'current-task wisdom', 0.6, '/demo/proj', null, { task: 'orders-v2' });
e.add('note', 'untasked wisdom', 0.7, '/demo/proj', null, { task: null });
const qb = e.brief(8000, '/demo/proj');
assert.ok(!qb.includes('joiner unverified claim'), 'workspace row never in brief');
assert.ok(qb.indexOf('current-task wisdom') < qb.indexOf('untasked wisdom'), 'task memory ranked first');
delete process.env.KEKA_TASK;

// promotion: roster raises trust, re-import moves the row into the brief with confidence restored
fs.writeFileSync(path.join(teamProj, '.keka', 'team.md'),
  '# Team\n- architect@example.com — trust: full\n- joiner@example.com — trust: full\n');
const imp2 = e.seedImport(mixSeed, teamProj);
assert.strictEqual(imp2.added, 0, 'no new rows on re-import');
assert.strictEqual(imp2.promoted, 1, 'joiner promoted');
const lifted = e.search('joiner unverified', { full: true })[0];
assert.strictEqual(lifted.workspace, 0, 'no longer workspace-only');
assert.strictEqual(lifted.confidence, 0.9, 'confidence restored');
assert.ok(e.brief(8000, '/demo/proj').includes('joiner unverified claim'), 'promoted row now reaches the brief');

// and back down: trust lowered, re-import returns the row to the workspace
fs.writeFileSync(path.join(teamProj, '.keka', 'team.md'), '- joiner@example.com — trust: workspace\n');
const imp3 = e.seedImport(mixSeed, teamProj);
assert.strictEqual(imp3.workspace, 1, 'joiner returned to workspace');
const dropped = e.search('joiner unverified', { full: true })[0];
assert.strictEqual(dropped.workspace, 1, 'flag reapplied');
assert.ok(dropped.confidence <= 0.3, 'confidence capped again');

// roster parsing tolerates tight punctuation (no space before the dash)
const tightProj = path.join(tmp, 'tight');
fs.mkdirSync(path.join(tightProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(tightProj, '.keka', 'team.md'), '- dev@co.com—trust: workspace\n');
assert.deepStrictEqual(e.roster(tightProj), { 'dev@co.com': 'workspace' }, 'roster tolerates missing space');

console.log('engine.test.js: ALL PASS');
