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

// ---------- upgrade: one shared database splits into user scope + per-project tenants ----------
// Before 0.6 every project lived in one file. This builds that shape by hand — three
// projects plus a global row — and drives the real CLI against it in child processes.
{
  const { DatabaseSync } = require('node:sqlite');
  const { spawnSync } = require('node:child_process');
  const legacyRoot = path.join(tmp, 'legacy');
  fs.mkdirSync(legacyRoot, { recursive: true });
  const oldDb = path.join(legacyRoot, 'keka.db');
  const d = new DatabaseSync(oldDb);
  d.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, type TEXT NOT NULL, text TEXT NOT NULL,
      text_key TEXT NOT NULL, confidence REAL DEFAULT 0.7, project TEXT, source TEXT,
      author TEXT, username TEXT, role TEXT, task TEXT, workspace INTEGER DEFAULT 0,
      created TEXT DEFAULT (datetime('now')), uses INTEGER DEFAULT 0);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project TEXT, author TEXT, username TEXT,
      role TEXT, name TEXT, task TEXT, first_prompt TEXT, summary TEXT,
      created TEXT DEFAULT (datetime('now')), ended TEXT);
    CREATE TABLE observations (id INTEGER PRIMARY KEY, session_id TEXT, tool TEXT,
      target TEXT, digest TEXT, created TEXT DEFAULT (datetime('now')));
    CREATE TABLE trust (email TEXT PRIMARY KEY, level TEXT NOT NULL DEFAULT 'full',
      note TEXT, updated TEXT DEFAULT (datetime('now')));
    CREATE VIRTUAL TABLE memories_fts USING fts5(text, content='memories', content_rowid='id');
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    INSERT INTO memories(type,text,text_key,confidence,project) VALUES
      ('learning','api rounds half up','api rounds half up',0.9,'github.com/acme/api'),
      ('note','api deploy drains the queue','api deploy drains the queue',0.8,'github.com/acme/api'),
      ('note','web uses the design tokens','web uses the design tokens',0.7,'github.com/acme/web'),
      ('learning','powershell has no && chaining','powershell has no && chaining',0.9,NULL);
    INSERT INTO sessions(id,project,summary,task) VALUES
      ('s-api','github.com/acme/api','fixed the rounding','main'),
      ('s-web','github.com/acme/web','shipped the header',NULL);
    INSERT INTO observations(session_id,tool,digest) VALUES
      ('s-api','Edit','edit api/total.js'), ('s-web','Edit','edit web/header.tsx');
    INSERT INTO trust(email,level) VALUES('joiner@example.com','workspace');
  `);
  d.close();

  const childEnv = { ...process.env, KEKA_DB: oldDb, KEKA_LOG: path.join(tmp, 'old-log.jsonl') };
  const runOld = (env, ...args) => spawnSync('node', [path.join(__dirname, 'engine.js'), ...args],
    { encoding: 'utf8', env: { ...childEnv, ...env }, timeout: 20000 });

  let r = runOld({}, 'projects');
  assert.strictEqual(r.status, 0, 'first open splits without error: ' + r.stderr);
  assert.ok(r.stdout.includes('github.com/acme/api') && r.stdout.includes('github.com/acme/web'),
    'both projects registered: ' + r.stdout);
  assert.ok(fs.existsSync(oldDb + '.pre-0.6.0'), 'the original database is kept as an escape hatch');

  // project rows moved out; the global row stayed behind in user scope
  const user = new DatabaseSync(oldDb);
  assert.strictEqual(user.prepare('SELECT COUNT(*) c FROM memories').get().c, 1, 'only the global row remains');
  assert.strictEqual(user.prepare('SELECT text FROM memories').get().text, 'powershell has no && chaining',
    'the global row is the one that stayed');
  assert.strictEqual(user.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0, 'sessions all moved');
  assert.strictEqual(user.prepare("SELECT level FROM trust WHERE email='joiner@example.com'").get().level,
    'workspace', 'trust stays in user scope, untouched');
  user.close();

  // each tenant holds exactly its own rows, with repo backfilled from the old project key
  const apiDb = new DatabaseSync(path.join(legacyRoot, 'projects', 'github.com-acme-api', 'keka.db'));
  assert.strictEqual(apiDb.prepare('SELECT COUNT(*) c FROM memories').get().c, 2, 'api tenant has its two memories');
  assert.strictEqual(apiDb.prepare('SELECT DISTINCT repo r FROM memories').get().r, 'github.com/acme/api',
    'repo backfilled from the old project key');
  assert.strictEqual(apiDb.prepare('SELECT COUNT(*) c FROM observations').get().c, 1, 'observations followed their session');
  assert.strictEqual(apiDb.prepare('SELECT COUNT(*) c FROM repos').get().c, 1, 'the repo is registered in its project');
  apiDb.close();
  const webDb = new DatabaseSync(path.join(legacyRoot, 'projects', 'github.com-acme-web', 'keka.db'));
  assert.strictEqual(webDb.prepare('SELECT COUNT(*) c FROM memories').get().c, 1, 'web tenant has its one memory');
  webDb.close();

  // searching inside a project sees that project plus global knowledge, never a sibling
  r = runOld({ KEKA_PROJECT: 'github.com/acme/api' }, 'search', 'rounds');
  assert.ok(r.stdout.includes('api rounds half up'), 'project memory found in its tenant: ' + r.stdout);
  r = runOld({ KEKA_PROJECT: 'github.com/acme/api' }, 'search', 'powershell');
  assert.ok(r.stdout.includes('powershell'), 'global memory reachable from inside a project');
  r = runOld({ KEKA_PROJECT: 'github.com/acme/api' }, 'search', 'design tokens');
  assert.ok(!r.stdout.includes('design tokens'), 'another project is not visible by default');
  r = runOld({ KEKA_PROJECT: 'github.com/acme/api' }, 'search', 'design tokens', '--all');
  assert.ok(r.stdout.includes('design tokens'), '--all reaches across projects: ' + r.stdout);

  // running again must not re-split or duplicate
  r = runOld({}, 'projects');
  const again = new DatabaseSync(path.join(legacyRoot, 'projects', 'github.com-acme-api', 'keka.db'));
  assert.strictEqual(again.prepare('SELECT COUNT(*) c FROM memories').get().c, 2, 'second run is a no-op');
  again.close();
  assert.ok(!fs.existsSync(path.join(tmp, 'old-log.jsonl')) ||
    !fs.readFileSync(path.join(tmp, 'old-log.jsonl'), 'utf8').includes('"where":"split.backup"'),
    'the split logged no failures');
}

// everything below works inside one project; memories added with no project are global
e.useProject('/demo/proj');

// memory round-trip — these two are global knowledge (no project given)
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

// seed idempotency — a seed carries the project's memories, not your global ones
e.add('note', 'project fact one', 0.7, '/demo/proj', null);
e.add('note', 'project fact two', 0.7, '/demo/proj', null);
e.add('note', 'project fact three', 0.7, '/demo/proj', null);
const seed = path.join(tmp, 'seed.jsonl');
const exported = e.seedExport(seed);
assert.ok(exported.memories >= 3, 'seed exported');
assert.ok(!fs.readFileSync(seed, 'utf8').includes('PowerShell 5.1'), 'global memories never travel in a project seed');
const r1 = e.seedImport(seed, '/demo/proj'); // back into the project it came from
assert.strictEqual(r1.added, 0, 'reimport adds nothing');
assert.strictEqual(r1.dup, exported.memories, 'all dups');

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
e.add('learning', 'task-scoped wisdom about exports', 0.9, '/demo/proj', null, { task: 'orders-v2' });
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
assert.strictEqual(e.seedExport(tseed, { task: 'orders-v2' }).memories, 1, 'task-filtered export');
const trow = JSON.parse(fs.readFileSync(tseed, 'utf8').split('\n')[0]);
assert.strictEqual(trow.author, 'tester@example.com', 'seed row carries author');
assert.strictEqual(trow.task, 'orders-v2', 'seed row carries task');

// roster + workspace import: new joiner capped and held private, unknown author full trust
const teamProj = path.join(tmp, 'teamproj');
fs.mkdirSync(path.join(teamProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(teamProj, '.keka', 'team.md'),
  '# Team\n- architect@example.com — trust: full\n- joiner@example.com — trust: workspace\n');
assert.deepStrictEqual(e.legacyTrust(teamProj),
  { 'architect@example.com': 'full', 'joiner@example.com': 'workspace' }, 'legacy shared trust still read');
assert.deepStrictEqual(e.roster(path.join(tmp, 'no-roster')), {}, 'missing roster = empty');
const mixSeed = path.join(tmp, 'mix-seed.jsonl');
fs.writeFileSync(mixSeed, [
  JSON.stringify({ type: 'learning', text: 'joiner unverified claim', confidence: 0.9, author: 'joiner@example.com', task: 'orders-v2' }),
  JSON.stringify({ type: 'learning', text: 'architect solid decision', confidence: 0.9, author: 'architect@example.com', task: 'orders-v2' }),
  JSON.stringify({ type: 'note', text: 'stranger note', confidence: 0.8, author: 'stranger@example.com' }),
].join('\n') + '\n');
e.useProject(teamProj); // imports land in the project of the repo doing the importing
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

// a project's export contains that project's rows and nothing else — the tenant is the filter
e.useProject('/demo/proj');
const pseed = path.join(tmp, 'proj-seed.jsonl');
const pn = e.seedExport(pseed);
assert.ok(pn.memories >= 1, 'project export non-empty');
for (const line of fs.readFileSync(pseed, 'utf8').trim().split('\n')) {
  const row = JSON.parse(line);
  if (row.kind === 'session') continue;
  assert.strictEqual(row.project, '/demo/proj', 'every exported memory belongs to the project');
}
assert.ok(!fs.readFileSync(pseed, 'utf8').includes('architect solid decision'),
  "another project's imports never leak into this project's seed");

// brief: workspace rows excluded entirely; task-affine boost outranks stronger untasked memory
process.env.KEKA_TASK = 'orders-v2';
e.add('note', 'current-task wisdom', 0.6, '/demo/proj', null, { task: 'orders-v2' });
e.add('note', 'untasked wisdom', 0.7, '/demo/proj', null, { task: null });
const qb = e.brief(8000, '/demo/proj');
assert.ok(qb.indexOf('current-task wisdom') < qb.indexOf('untasked wisdom'), 'task memory ranked first');
e.useProject(teamProj);
assert.ok(!e.brief(8000, teamProj).includes('joiner unverified claim'), 'workspace row never in brief');
delete process.env.KEKA_TASK;

// legacy shared trust seeded the private table on that first import
assert.strictEqual(e.trustList().find((t) => t.email === 'joiner@example.com').level, 'workspace',
  'legacy roster trust migrated into the private table');

// promotion: I raise trust locally, re-import lifts the row into the brief with confidence restored
e.setTrust('joiner@example.com', 'full', 'reviewed their work');
const imp2 = e.seedImport(mixSeed, teamProj);
assert.strictEqual(imp2.added, 0, 'no new rows on re-import');
assert.strictEqual(imp2.promoted, 1, 'joiner promoted');
const lifted = e.search('joiner unverified', { full: true })[0];
assert.strictEqual(lifted.workspace, 0, 'no longer workspace-only');
assert.strictEqual(lifted.confidence, 0.9, 'confidence restored');
assert.ok(e.brief(8000, teamProj).includes('joiner unverified claim'), 'promoted row now reaches the brief');

// and back down: trust lowered, re-import returns the row to the workspace
e.setTrust('joiner@example.com', 'workspace');
const imp3 = e.seedImport(mixSeed, teamProj);
assert.strictEqual(imp3.workspace, 1, 'joiner returned to workspace');
const dropped = e.search('joiner unverified', { full: true })[0];
assert.strictEqual(dropped.workspace, 1, 'flag reapplied');
assert.ok(dropped.confidence <= 0.3, 'confidence capped again');

// parsing tolerates tight punctuation (no space before the dash)
const tightProj = path.join(tmp, 'tight');
fs.mkdirSync(path.join(tightProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(tightProj, '.keka', 'team.md'), '- dev@co.com—trust: workspace\n');
assert.deepStrictEqual(e.legacyTrust(tightProj), { 'dev@co.com': 'workspace' }, 'tolerates missing space');

// ---------- v0.4.0: identity, private trust, naming, branch recall, encryption ----------

// team.md is a directory now: name, email, role — and carries no trust
const dirProj = path.join(tmp, 'dirproj');
fs.mkdirSync(path.join(dirProj, '.keka'), { recursive: true });
fs.writeFileSync(path.join(dirProj, '.keka', 'team.md'),
  '# Team\n\n- Sara Malik <sara@example.com> — role: tech-lead\n- Omar Nabil <omar@example.com> — role: backend\n- lina@example.com — role: qa\n');
const team = e.roster(dirProj);
assert.deepStrictEqual(team['sara@example.com'], { name: 'Sara Malik', role: 'tech-lead' }, 'name + role parsed');
assert.strictEqual(team['omar@example.com'].role, 'backend', 'second member parsed');
assert.deepStrictEqual(team['lina@example.com'], { name: null, role: 'qa' }, 'bare email + role still works');
assert.deepStrictEqual(e.legacyTrust(dirProj), {}, 'the new format carries no trust at all');
assert.strictEqual(e.roleOf('sara@example.com', dirProj), 'tech-lead', 'role resolved by email');

// identity is stamped on every memory and snapshotted, not looked up later
process.env.KEKA_USERNAME = 'Tester Person';
process.env.KEKA_ROLE = 'qa';
e.add('learning', 'flaky checkout under load', 0.8, null, null);
const idRow = e.search('flaky checkout', { full: true })[0];
assert.strictEqual(idRow.username, 'Tester Person', 'username stamped');
assert.strictEqual(idRow.role, 'qa', 'role stamped');
assert.strictEqual(e.search('flaky', { role: 'qa' }).length, 1, 'search --role filters');
assert.strictEqual(e.search('flaky', { user: 'tester person' }).length, 1, 'search --user is case-insensitive');
assert.strictEqual(e.search('flaky', { role: 'tech-lead' }).length, 0, 'wrong role excluded');
delete process.env.KEKA_ROLE;

// trust is private: set locally, never written to the shared file, never exported
e.setTrust('omar@example.com', 'workspace', 'still onboarding');
assert.strictEqual(e.trustLevel('omar@example.com', dirProj), 'workspace', 'local trust honored');
assert.strictEqual(e.trustLevel('sara@example.com', dirProj), 'full', 'unset teammate gets the default');
assert.ok(!fs.readFileSync(path.join(dirProj, '.keka', 'team.md'), 'utf8').includes('trust'),
  'shared roster never gains a trust field');

// sessions get a name, and duplicate labels disambiguate instead of failing
process.env.KEKA_TASK = 'feature/orders';
const n1 = e.sessionStart('n-1', '/demo/named');
assert.strictEqual(n1, 'feature-orders-tester-person', 'auto name from branch + username');
assert.strictEqual(e.sessionStart('n-1', '/demo/named'), n1, 'existing session keeps its name');
const n2 = e.sessionStart('n-2', '/demo/named');
assert.strictEqual(n2, 'feature-orders-tester-person-2', 'collision gets a suffix');
assert.strictEqual(e.nameSession('n-1', 'orders rework'), 'orders rework', 'explicit rename');
e.db().prepare("UPDATE sessions SET name='orders rework', author='other@example.com', username='Other Dev' WHERE id='n-2'").run();
assert.strictEqual(e.sessionLabel(e.db().prepare("SELECT * FROM sessions WHERE id='n-1'").get()),
  'orders rework@Tester Person', 'same label by two authors disambiguates on display');

// branch section: prior work on this branch is recalled without being asked for
e.sessionEnd('n-1', 'reworked the orders totals');
e.add('learning', 'orders totals round half-up', 0.7, '/demo/named', null, { task: 'feature/orders' });
const bb = e.brief(4000, '/demo/named');
assert.ok(bb.includes('On this branch (feature/orders)'), 'branch section present: ' + bb);
assert.ok(bb.includes('reworked the orders totals'), 'prior session on this branch listed');
assert.ok(bb.includes('orders totals round half-up'), 'branch memory recalled');
assert.strictEqual((bb.match(/orders totals round half-up/g) || []).length, 1, 'branch memory not repeated below');
delete process.env.KEKA_TASK;

// sessions travel in the seed, and older importers skip them (no `text` field)
const sseed = path.join(tmp, 'sessions-seed.jsonl');
const sExp = e.seedExport(sseed, { project: '/demo/named' });
assert.ok(sExp.sessions >= 1, 'session rows exported');
const sessionLine = fs.readFileSync(sseed, 'utf8').split('\n').map((l) => l && JSON.parse(l)).find((r) => r && r.kind === 'session');
assert.ok(sessionLine && !sessionLine.text, 'session row has no text, so old importers skip it');
assert.strictEqual(sessionLine.name, 'orders rework', 'session row carries its name');

// encrypted round-trip, and a wrong key fails loudly rather than silently
const encDir = path.join(tmp, 'encproj');
fs.mkdirSync(path.join(encDir, '.keka'), { recursive: true });
fs.writeFileSync(path.join(encDir, '.keka', 'seed.key'), 'correct horse battery staple\n');
const encSeed = path.join(tmp, 'sealed.jsonl.enc');
const encRes = e.seedExport(encSeed, { project: '/demo/named', dir: encDir, encrypt: true });
assert.ok(encRes.encrypted, 'export reports encryption');
const sealedRaw = fs.readFileSync(encSeed, 'utf8');
assert.ok(e.isSealed(sealedRaw), 'file is an envelope');
assert.ok(!sealedRaw.includes('orders totals round half-up'), 'plaintext not readable in the file');
const encImp = e.seedImport(encSeed, encDir);
assert.ok(encImp.encrypted, 'import decrypted it');
fs.writeFileSync(path.join(encDir, '.keka', 'seed.key'), 'wrong key\n');
assert.throws(() => e.seedImport(encSeed, encDir), /could not be decrypted/, 'wrong key fails loudly');
fs.writeFileSync(path.join(encDir, '.keka', 'seed.key'), 'correct horse battery staple\n');
const tampered = JSON.parse(sealedRaw);
tampered.ct = Buffer.from(Buffer.from(tampered.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64');
const tamperFile = path.join(tmp, 'tampered.jsonl.enc');
fs.writeFileSync(tamperFile, JSON.stringify(tampered));
assert.throws(() => e.seedImport(tamperFile, encDir), /could not be decrypted/, 'GCM tag catches tampering');

// auto-seed refreshes an existing seed only — it never creates one
const autoDir = path.join(tmp, 'autoproj');
fs.mkdirSync(path.join(autoDir, '.keka'), { recursive: true });
e.add('note', 'fact belonging to the auto-seed project', 0.7, autoDir, null);
assert.strictEqual(e.autoSeed(autoDir), null, 'no seed file = nothing happens');
fs.writeFileSync(path.join(autoDir, '.keka', 'team-seed.jsonl'), '');
const auto = e.autoSeed(autoDir);
assert.ok(auto && auto.file === 'team-seed.jsonl', 'existing seed refreshed');
assert.ok(fs.readFileSync(path.join(autoDir, '.keka', 'team-seed.jsonl'), 'utf8').includes('auto-seed project'),
  'refresh wrote this project\'s memories');
process.env.KEKA_SEED_AUTO = 'off';
assert.strictEqual(e.autoSeed(autoDir), null, 'seed_auto off disables the refresh');
delete process.env.KEKA_SEED_AUTO;

// ---------- v0.6.0: a project may span several repositories ----------

// resolution ladder: KEKA_PROJECT > .keka/project.md > this repo
const apiRepo = path.join(tmp, 'shop-api');
const webRepo = path.join(tmp, 'shop-web');
for (const d of [apiRepo, webRepo]) fs.mkdirSync(path.join(d, '.keka'), { recursive: true });
const decl = '# Project\nname: acme-shop\n\nrepos:\n  - ' + apiRepo.replace(/\\/g, '/').toLowerCase()
  + '\n  - ' + webRepo.replace(/\\/g, '/').toLowerCase() + '\n';
fs.writeFileSync(path.join(apiRepo, '.keka', 'project.md'), decl);
fs.writeFileSync(path.join(webRepo, '.keka', 'project.md'), decl);

const undeclared = path.join(tmp, 'solo');
fs.mkdirSync(undeclared, { recursive: true });
assert.strictEqual(e.project(undeclared), e.repo(undeclared),
  'an undeclared repo is its own project — single-repo work is unchanged');
assert.strictEqual(e.project(apiRepo), 'acme-shop', 'declaration names the project');
assert.strictEqual(e.projectDecl(apiRepo).repos.length, 2, 'declared members parsed');
process.env.KEKA_PROJECT = 'override-wins';
assert.strictEqual(e.project(path.join(tmp, 'never-seen')), 'override-wins', 'env overrides the declaration');
delete process.env.KEKA_PROJECT;

// two repos, one project: memory written in one is present in the other
e.useProject(apiRepo);
e.add('learning', 'totals round half-up in the api', 0.9, apiRepo, null);
e.registerRepo(e.repo(apiRepo));
e.useProject(webRepo);
e.add('note', 'header uses the shared tokens', 0.8, webRepo, null);
e.registerRepo(e.repo(webRepo));
assert.strictEqual(e.project(apiRepo), e.project(webRepo), 'both repos resolve to one project');
assert.ok(e.search('round half-up').length === 1, 'the api memory is visible from the web repo');
assert.deepStrictEqual(e.repoList().map((r) => r.repo).sort(),
  [e.repo(apiRepo), e.repo(webRepo)].sort(), 'the project knows both of its repos');

// ranking: your own repo first, the sibling service still present
const sharedBrief = e.brief(8000, webRepo);
assert.ok(sharedBrief.includes('header uses the shared tokens'), 'own-repo memory in the brief');
assert.ok(sharedBrief.includes('totals round half-up'), 'sibling-repo memory still reaches the brief');
assert.ok(sharedBrief.indexOf('header uses') < sharedBrief.indexOf('totals round'),
  'own repo outranks the sibling');

// --repo narrows to one service
assert.strictEqual(e.search('tokens', { repo: e.repo(apiRepo) }).length, 0, 'repo filter excludes the sibling');
assert.strictEqual(e.search('tokens', { repo: e.repo(webRepo) }).length, 1, 'repo filter keeps its own');

// starvation: a busy project can no longer push a quiet one out of its own brief
const quiet = path.join(tmp, 'quiet-proj');
e.useProject(quiet);
e.add('learning', 'QUIET CRITICAL: drain the queue before deploying', 0.95, quiet, null);
const busy = path.join(tmp, 'busy-proj');
e.useProject(busy);
for (let i = 0; i < 600; i++) e.add('note', `busy routine note ${i}`, 0.5, busy, null);
assert.ok(e.brief(4000, quiet).includes('QUIET CRITICAL'),
  'a quiet project keeps its own memory even after 600 rows elsewhere');

// handoff: whole project by default, one repo on request
e.useProject(apiRepo);
const shopSeed = path.join(tmp, 'shop-seed.jsonl');
const shopAll = e.seedExport(shopSeed);
assert.strictEqual(shopAll.memories, 2, 'the whole project is handed off by default');
const shopOne = e.seedExport(path.join(tmp, 'shop-api-seed.jsonl'), { repo: e.repo(apiRepo) });
assert.strictEqual(shopOne.memories, 1, '--repo narrows the handoff to one service');

// trust is set once, in user scope, and applies inside every tenant
e.setTrust('shared@example.com', 'workspace', 'set once');
for (const p of [apiRepo, quiet, busy]) {
  e.useProject(p);
  assert.strictEqual(e.trustLevel('shared@example.com', p), 'workspace',
    'one trust decision holds in every project');
}

console.log('engine.test.js: ALL PASS');
