#!/usr/bin/env node
'use strict';
// keka engine: memory + sessions + observations + team seed. Zero dependencies.
// Requires Node >= 22.5 (node:sqlite). DB survives plugin updates (lives in ~/.keka).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = path.join(os.homedir(), '.keka');
// KEKA_DB names the USER-scope database; tenants live beside it under projects/.
// Tests point it at a temp file and get an isolated tree for free.
const DB_PATH = process.env.KEKA_DB || path.join(HOME, 'keka.db');
const ROOT = path.dirname(DB_PATH);
const PROJECTS_DIR = path.join(ROOT, 'projects');
const SCHEMA_PATH = path.join(__dirname, '..', 'memory', 'schema.sql');
const USER_SCHEMA_PATH = path.join(__dirname, '..', 'memory', 'user-schema.sql');
const LOG_PATH = process.env.KEKA_LOG || path.join(HOME, 'log.jsonl');
const PARTNERS_SEEN = path.join(ROOT, 'partners-seen'); // marker: /partners ran once, stop nudging

// failures append here instead of vanishing — "keka just stopped working" must be diagnosable
function log(where, err) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    try { if (fs.statSync(LOG_PATH).size > 512 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.1'); } catch { /* first write */ }
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), where, err: String((err && err.stack) || err) }) + '\n');
  } catch { /* logging must never throw */ }
}

// schema.sql is CREATE ... IF NOT EXISTS throughout, so a new COLUMN in it is silently
// ignored on a database that already exists. Every added column must also land here, or
// upgrading installs keep the old shape and every insert naming the column throws.
function migrate(d, tables) {
  const has = (t, c) => d.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  const add = (t, c, decl) => { if (!has(t, c)) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${decl}`); };
  add('memories', 'username', 'TEXT');
  add('memories', 'role', 'TEXT');
  add('memories', 'repo', 'TEXT');
  if (tables !== 'user') {
    add('sessions', 'username', 'TEXT');
    add('sessions', 'role', 'TEXT');
    add('sessions', 'name', 'TEXT');
    add('sessions', 'repo', 'TEXT');
  }
}

function open(file, schemaPath, kind) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  d.exec(fs.readFileSync(schemaPath, 'utf8')); // creates anything missing
  migrate(d, kind);                            // widens anything that predates it
  return d;
}

// ---------- the two scopes ----------
// user scope: trust, the project registry, and global memories (knowledge that belongs
// to you rather than to any product). One file, always the same path.
let _userDb = null;
function userDb() {
  if (_userDb) return _userDb;
  _userDb = open(DB_PATH, USER_SCHEMA_PATH, 'user');
  try { splitLegacy(_userDb); } catch (err) { log('split', err); } // one-time, see below
  return _userDb;
}

// tenant scope: one database per project. Every hook process serves exactly one project,
// so the active tenant is resolved once and db() keeps its zero-argument signature.
const _tenants = new Map();
let _active = null;
function openTenant(key) {
  const dir = tenantDir(key);
  const file = path.join(dir, 'keka.db');
  if (_tenants.has(file)) return _tenants.get(file);
  const d = open(file, SCHEMA_PATH, 'project');
  _tenants.set(file, d);
  return d;
}
function db() {
  return openTenant(active().project);
}

function tenantSlug(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
}
function tenantDir(key) {
  const known = userDb().prepare('SELECT dir FROM projects WHERE key = ?').get(key);
  if (known) return known.dir;
  let slug = tenantSlug(key);
  const taken = userDb().prepare('SELECT key FROM projects WHERE dir = ?');
  let dir = path.join(PROJECTS_DIR, slug), n = 2;
  while (taken.get(dir)) { dir = path.join(PROJECTS_DIR, slug + '-' + n); n++; } // slug collision
  userDb().prepare('INSERT OR IGNORE INTO projects(key, dir) VALUES(?,?)').run(key, dir);
  return dir;
}

// resolve identity for this process: which repo we are in, and which project it belongs to
function useProject(cwd) {
  const r = repo(cwd);
  _active = { project: project(cwd), repo: r, cwd: cwd || null };
  return _active;
}
function active() {
  return _active || useProject();
}

// ---------- the one-time split (pre-0.6 single database -> user scope + tenants) ----------
// Before 0.6 every project shared ~/.keka/keka.db. That file becomes the user-scope
// database, so the upgrade evacuates its project-scoped rows into per-project tenants
// and leaves the global ones behind. Runs once, guarded by an empty registry.
function splitLegacy(d) {
  const hasSessions = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!hasSessions) return null; // fresh install: nothing to split
  const registered = d.prepare('SELECT COUNT(*) c FROM projects').get().c;
  if (registered) return null;   // already split
  const keys = d.prepare('SELECT DISTINCT project FROM memories WHERE project IS NOT NULL').all()
    .map((r) => r.project)
    .concat(d.prepare('SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL').all().map((r) => r.project));
  const projects = [...new Set(keys)];
  if (!projects.length) return null;

  // escape hatch first, and checkpoint so the copy is not missing the WAL
  try {
    d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(DB_PATH, DB_PATH + '.pre-0.6.0');
  } catch (err) { log('split.backup', err); }

  const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
  const memCols = cols('memories').filter((c) => c !== 'id');
  const sesCols = cols('sessions');
  let moved = 0;
  for (const key of projects) {
    const t = openTenant(key);
    const mem = d.prepare(`SELECT ${memCols.join(',')} FROM memories WHERE project = ?`).all(key);
    const insMem = t.prepare(`INSERT INTO memories(${memCols.join(',')}) VALUES(${memCols.map(() => '?').join(',')})`);
    for (const row of mem) { insMem.run(...memCols.map((c) => (c === 'repo' ? row.repo || key : row[c]))); moved++; }

    const ses = d.prepare(`SELECT ${sesCols.join(',')} FROM sessions WHERE project = ?`).all(key);
    const insSes = t.prepare(`INSERT OR IGNORE INTO sessions(${sesCols.join(',')}) VALUES(${sesCols.map(() => '?').join(',')})`);
    const obsCols = cols('observations').filter((c) => c !== 'id');
    const insObs = t.prepare(`INSERT INTO observations(${obsCols.join(',')}) VALUES(${obsCols.map(() => '?').join(',')})`);
    for (const row of ses) {
      insSes.run(...sesCols.map((c) => (c === 'repo' ? row.repo || key : row[c])));
      for (const o of d.prepare(`SELECT ${obsCols.join(',')} FROM observations WHERE session_id = ?`).all(row.id)) {
        insObs.run(...obsCols.map((c) => o[c]));
      }
    }
    // repo column is correct by construction: before 0.6 the project key WAS the repo key
    t.prepare('INSERT OR IGNORE INTO repos(repo) VALUES(?)').run(key);
    d.prepare('DELETE FROM observations WHERE session_id IN (SELECT id FROM sessions WHERE project = ?)').run(key);
    d.prepare('DELETE FROM sessions WHERE project = ?').run(key);
    d.prepare('DELETE FROM memories WHERE project = ?').run(key);
  }
  log('split', `moved ${moved} memories into ${projects.length} project databases; backup at ${path.basename(DB_PATH)}.pre-0.6.0`);
  return { projects: projects.length, memories: moved };
}

// option lookup: KEKA_<KEY> env (power-user override) > plugin userConfig
// (CLAUDE_PLUGIN_OPTION_<key>, set by Claude Code from plugin.json userConfig) > default
function opt(key, fallback) {
  const v = process.env['KEKA_' + key.toUpperCase()]
    ?? process.env['CLAUDE_PLUGIN_OPTION_' + key]
    ?? process.env['CLAUDE_PLUGIN_OPTION_' + key.toUpperCase()];
  return v == null || v === '' ? fallback : v;
}
function optOn(key, def) { // boolean options; 'off'/'false'/'0' all mean off
  const v = String(opt(key, def)).toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0' || v === 'no');
}

// ---------- identity, task, project ----------

function git(args, cwd) {
  try {
    return require('node:child_process')
      .execSync('git ' + args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch { return null; }
}

let _author;
function author() {
  if (process.env.KEKA_AUTHOR) return process.env.KEKA_AUTHOR;
  if (_author !== undefined) return _author;
  _author = git('config user.email');
  return _author;
}

let _username;
function username() { // display identity; the email stays the key everything joins on
  if (process.env.KEKA_USERNAME) return process.env.KEKA_USERNAME;
  if (_username !== undefined) return _username;
  _username = git('config user.name');
  return _username;
}

const _taskCache = new Map();
function task(explicit, cwd) {
  if (explicit) return String(explicit);
  if (process.env.KEKA_TASK) return process.env.KEKA_TASK;
  const key = String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (_taskCache.has(key)) return _taskCache.get(key);
  const b = git('rev-parse --abbrev-ref HEAD', key);
  const t = b && b !== 'main' && b !== 'master' && b !== 'HEAD' ? b : null; // mainline/detached = not a task
  _taskCache.set(key, t);
  return t;
}
function taskSlug(t) { // branch names contain slashes; filenames must not
  return String(t).replace(/[^\w.-]+/g, '-');
}

// project identity is portable: the git remote URL when there is one (same repo = same
// project on every teammate's machine), else the repo-root path. Raw-cwd identity broke
// imports (teammate's absolute path never matched yours) and Windows case differences.
function normalizeRemote(url) {
  let u = String(url).trim().toLowerCase().replace(/\.git$/, '');
  const ssh = u.match(/^[\w.+-]+@([^:/]+):(.+)$/); // git@host:org/repo
  if (ssh) return ssh[1] + '/' + ssh[2];
  return u.replace(/^[a-z+]+:\/\//, '').replace(/^[^@/]+@/, ''); // scheme, then credentials
}
const _repoCache = new Map();
function repo(cwd) { // identity of ONE repository
  const key = String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (_repoCache.has(key)) return _repoCache.get(key);
  const remote = git('remote get-url origin', key);
  const p = remote ? normalizeRemote(remote)
    : (git('rev-parse --show-toplevel', key) || key).replace(/\\/g, '/').toLowerCase();
  _repoCache.set(key, p);
  return p;
}

// A project is a product, which may be several repositories: a backend and a frontend,
// or a fleet of services. Each repo declares its project in a committed .keka/project.md;
// an undeclared repo is its own project, so single-repo work behaves exactly as before.
function projectFile(cwd) {
  return path.join(String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()), '.keka', 'project.md');
}
function projectDecl(cwd) {
  const out = { name: null, repos: [] };
  try {
    for (const line of fs.readFileSync(projectFile(cwd), 'utf8').split('\n')) {
      const n = line.match(/^\s*name:\s*(.+?)\s*$/i);
      if (n) { out.name = n[1].toLowerCase(); continue; }
      const r = line.match(/^\s*[-*]\s*(\S+)\s*$/); // members of the `repos:` list
      if (r) out.repos.push(r[1].toLowerCase());
    }
  } catch { /* undeclared — the repo is its own project */ }
  return out;
}
const _projCache = new Map();
function project(cwd) { // identity of the TENANT: env > .keka/project.md > this repo
  const key = String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (_projCache.has(key)) return _projCache.get(key);
  const p = (process.env.KEKA_PROJECT || projectDecl(cwd).name || repo(cwd)).toLowerCase();
  _projCache.set(key, p);
  return p;
}

// repos are members of a project, recorded inside the tenant so the project knows its
// own shape. Auto-registered on first sight: never a blocker, only a record.
function registerRepo(r, name) {
  if (!r) return null;
  db().prepare('INSERT OR IGNORE INTO repos(repo, name) VALUES(?,?)').run(String(r).toLowerCase(), name || null);
  return r;
}
function repoList() {
  return db().prepare('SELECT * FROM repos ORDER BY added, repo').all();
}
function projectList() {
  return userDb().prepare('SELECT * FROM projects ORDER BY key').all();
}

// ---------- team directory (shared) and trust (private) ----------

function teamFile(cwd) {
  return path.join(String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()), '.keka', 'team.md');
}

// .keka/team.md is a shared DIRECTORY — who is on this project and what they do:
//   - Sara Malik <sara@example.com> — role: tech-lead
// It carries no judgments. Trust is private (see below): "this teammate is not trusted
// yet" is not something anyone should have to commit to a shared repository.
function roster(cwd) {
  const map = {};
  try {
    for (const line of fs.readFileSync(teamFile(cwd), 'utf8').split('\n')) {
      const email = line.match(/[\w.+-]+@[\w.-]+\w/);
      if (!email) continue;
      const name = line.match(/^\s*[-*]\s*([^<(]+?)\s*[<(]/);
      const role = line.match(/role:\s*([\w-]+)/i);
      map[email[0].toLowerCase()] = {
        name: name ? name[1].trim() : null,
        role: role ? role[1].toLowerCase() : null,
      };
    }
  } catch { /* no roster — solo work needs no ceremony */ }
  return map;
}

function roleOf(email, cwd) {
  if (process.env.KEKA_ROLE) return process.env.KEKA_ROLE;
  const r = roster(cwd)[String(email || '').toLowerCase()];
  return (r && r.role) || null;
}

// pre-0.4 rosters carried "— trust: full|workspace" in the shared file. Still read, once,
// to seed the private table; after that the local value is authoritative.
function legacyTrust(cwd) {
  const map = {};
  try {
    for (const line of fs.readFileSync(teamFile(cwd), 'utf8').split('\n')) {
      const email = line.match(/[\w.+-]+@[\w.-]+\w/);
      const t = line.match(/trust:\s*(full|workspace)/i);
      if (email && t) map[email[0].toLowerCase()] = t[1].toLowerCase();
    }
  } catch { /* none */ }
  return map;
}

// Trust lives in USER scope, not in a tenant: you rate a person once, and that judgment
// holds in every project you share with them.
const TRUST_LEVELS = new Set(['full', 'workspace']);
function setTrust(email, level, note) {
  const lvl = TRUST_LEVELS.has(String(level).toLowerCase()) ? String(level).toLowerCase() : 'full';
  userDb().prepare(`INSERT INTO trust(email, level, note, updated) VALUES(?,?,?,datetime('now'))
     ON CONFLICT(email) DO UPDATE SET level = excluded.level, note = excluded.note, updated = datetime('now')`)
    .run(String(email).toLowerCase(), lvl, note || null);
  return lvl;
}
function trustList() { return userDb().prepare('SELECT * FROM trust ORDER BY email').all(); }

// private table wins; a legacy shared-roster value seeds a missing entry; then the default
function trustLevel(email, cwd, legacy) {
  const fallback = String(opt('default_trust', 'full')).toLowerCase();
  if (!email) return fallback;
  const em = String(email).toLowerCase();
  const row = userDb().prepare('SELECT level FROM trust WHERE email = ?').get(em);
  if (row) return row.level;
  const old = (legacy || legacyTrust(cwd))[em];
  if (old) { setTrust(em, old, 'seeded from .keka/team.md (shared trust is deprecated)'); return old; }
  return fallback;
}

// ---------- memories ----------

const TYPES = new Set(['learning', 'note', 'reference', 'pattern']);
function norm(text) { return String(text).toLowerCase().replace(/\s+/g, ' ').trim(); }

// `proj` is a WORKING DIRECTORY, not an identity. Pass explicit identity through
// `extra.project` / `extra.repo` (imports do, so they never shell out to git per row).
// No project at all = a global memory: it belongs to you, not to a product.
function add(type, text, confidence, proj, source, extra) {
  const x = extra || {};
  const au = x.author !== undefined ? x.author : author();
  const p = x.project !== undefined ? x.project : (proj ? project(proj) : null);
  const r = x.repo !== undefined ? x.repo : (proj ? repo(proj) : null);
  const target = p ? openTenant(p) : userDb();
  if (p) registerRepoIn(target, r);
  target.prepare('INSERT INTO memories(type,text,text_key,confidence,project,repo,source,author,username,role,task,workspace) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(TYPES.has(type) ? type : 'note', String(text), norm(text),
      confidence == null ? 0.7 : Number(confidence),
      p, r, source || null, au,
      x.username !== undefined ? x.username : username(),
      // snapshot the role: grouping by "what the testers found" must not shift when
      // someone's role later changes in the roster
      x.role !== undefined ? x.role : roleOf(au, proj),
      x.task !== undefined ? x.task : task(null, proj),
      x.workspace ? 1 : 0);
}
function registerRepoIn(d, r) {
  if (!r) return;
  try { d.prepare('INSERT OR IGNORE INTO repos(repo) VALUES(?)').run(String(r).toLowerCase()); } catch { /* older tenant */ }
}
function forget(id) { // ids are per-database, so try the tenant, then user scope
  for (const d of [db(), userDb()]) {
    const row = d.prepare('SELECT text FROM memories WHERE id = ?').get(Number(id));
    if (!row) continue;
    d.prepare('DELETE FROM memories WHERE id = ?').run(Number(id));
    return row.text; // echo what died — terminal history is the trash can
  }
  return null;
}
function hasText(text) { // dedup is on the normalized key: case/whitespace variants are the same fact
  const k = norm(text);
  return [db(), userDb()].some((d) => !!d.prepare('SELECT 1 FROM memories WHERE text_key = ? LIMIT 1').get(k));
}

function ftsQuery(q) {
  const terms = String(q).match(/[A-Za-z0-9_.\-]+/g) || [];
  return terms.length ? terms.map((t) => '"' + t + '"').join(' OR ') : null;
}

function ageDays(row) { // decay from created only — reading a memory must not reset its clock
  const ref = String(row.created || '').replace(' ', 'T');
  const t = Date.parse(ref + (ref.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(t) ? 0 : Math.max(0, (Date.now() - t) / 86400000);
}
// type-based decay: durable knowledge fades slower than perishable pointers
const DECAY_DAYS = { learning: 90, pattern: 90, reference: 45 }; // default 30 (notes etc.)
function score(row) {
  return (row.confidence == null ? 0.5 : row.confidence)
    * Math.exp(-ageDays(row) / (DECAY_DAYS[row.type] || 30));
}

// Searches this project plus your global memories — the environment traps that belong to
// you, not to a product, must stay findable from inside any project. `all` fans out over
// every registered project; `repo` narrows to one repository of this one.
function search(q, opts) {
  const { limit = 8, full = false, task: t, author: au, role: rl, user: un, repo: rp, all = false } = opts || {};
  const fq = ftsQuery(q);
  if (!fq) return [];
  let sql = `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
     WHERE memories_fts MATCH ?`;
  const params = [fq];
  if (t) { sql += ' AND m.task = ?'; params.push(t); }
  if (au) { sql += ' AND m.author = ?'; params.push(au); }
  if (rl) { sql += ' AND lower(m.role) = ?'; params.push(String(rl).toLowerCase()); }
  if (un) { sql += ' AND lower(m.username) = ?'; params.push(String(un).toLowerCase()); }
  if (rp) { sql += ' AND lower(m.repo) = ?'; params.push(String(rp).toLowerCase()); }
  sql += ' ORDER BY rank LIMIT ?'; params.push(limit);

  const scopes = all
    ? [userDb(), ...projectList().map((p) => openTenant(p.key))]
    : [db(), userDb()];
  const seen = new Set();
  const rows = [];
  for (const d of scopes) {
    let hit = [];
    try { hit = d.prepare(sql).all(...params); } catch (err) { log('search', err); continue; }
    const bump = d.prepare('UPDATE memories SET uses = uses + 1 WHERE id = ?'); // counter only; never ranking
    for (const r of hit) {
      bump.run(r.id);
      const k = r.text_key || norm(r.text);
      if (seen.has(k)) continue; // the same fact known in two scopes is one hit
      seen.add(k);
      rows.push(r);
    }
  }
  return rows.sort((a, b) => score(b) - score(a)).slice(0, limit)
    .map((r) => ({ ...r, _display: full ? null : shortLine(r) }));
}

function shortLine(r) {
  const t = r.text.length > 100 ? r.text.slice(0, 100) + '...' : r.text;
  return `#${r.id} [${r.type}]${r.workspace ? ' [workspace]' : ''} ${t} (conf ${Number(r.confidence).toFixed(2)})`;
}

const BRANCH_SHARE = 0.4; // reserved slice of the cap — general memories must not crowd out
                          // the history of the branch you just checked out

function brief(maxChars, proj) {
  const cap = maxChars || 4000;
  if (proj) useProject(proj); // the tenant must match the directory we were asked about
  const p = project(proj);
  const r = repo(proj);
  const t = task(null, proj);
  const out = [];
  let used = 0;
  const push = (line, budget) => { // every line counts against the cap, headers included
    if (used + line.length + 1 > (budget || cap)) return false;
    out.push(line); used += line.length + 1;
    return true;
  };
  const last = db().prepare(
    `SELECT first_prompt, summary, created FROM sessions
     WHERE project = ? AND (summary IS NOT NULL OR first_prompt IS NOT NULL)
     ORDER BY created DESC, rowid DESC LIMIT 1`
  ).get(p);
  if (last) push(`Last session here (${String(last.created).slice(0, 16)}): ${last.summary || last.first_prompt}`);

  // branch section: prior work on THIS branch is recalled automatically — that is the
  // context you cannot be expected to ask for, because you do not know it exists yet
  const shown = new Set();
  if (t) {
    const prior = db().prepare(
      `SELECT id, project, name, username, author, role, summary, first_prompt, created FROM sessions
       WHERE project = ? AND task = ? AND (summary IS NOT NULL OR first_prompt IS NOT NULL)
       ORDER BY created DESC, rowid DESC LIMIT 5`
    ).all(p, t);
    const branchMem = db().prepare(
      `SELECT * FROM memories WHERE workspace IS NOT 1 AND project = ? AND task = ?
       ORDER BY created DESC, id DESC LIMIT 20`
    ).all(p, t);
    if (prior.length || branchMem.length) {
      const budget = used + Math.floor(cap * BRANCH_SHARE);
      push(`On this branch (${t}):`, budget);
      for (const s of prior) {
        const who = s.username || s.author || 'unknown';
        if (!push(`- ${sessionLabel(s)} · ${who}${s.role ? ' (' + s.role + ')' : ''} · ${s.summary || s.first_prompt}`, budget)) break;
      }
      for (const m of branchMem) {
        if (!push(`- [${m.type} #${m.id}] ${m.text}`, budget)) break;
        shown.add(m.id);
      }
    }
  }

  // Affine ranking within the project: your own repo outranks a sibling service, which
  // outranks your global knowledge. Workspace rows never enter.
  // The candidate window is per-database, so a busy project can no longer push a quiet
  // one out of its own brief — before 0.6 this query scanned every project at once.
  const w = (m) => score(m) * (m.repo === r ? 1.5 : 1) * (t && m.task === t ? 1.5 : 1);
  const window = 'SELECT * FROM memories WHERE workspace IS NOT 1 ORDER BY created DESC, id DESC LIMIT 500';
  const rows = db().prepare(window).all()
    .concat(userDb().prepare(window).all()) // global memories travel into every project
    .filter((m) => !shown.has(m.id))
    .sort((a, b) => w(b) - w(a));
  if (rows.length) push('Top memories:');
  for (const m of rows) {
    if (!push(`- [${m.type} #${m.id}] ${m.text}`)) break; // ids so a wrong memory can be forgotten on sight
  }
  return out.join('\n');
}

// ---------- sessions & observations ----------

function sessionStart(id, proj, name) {
  if (!id) return null;
  if (proj) useProject(proj);
  const existing = db().prepare('SELECT name FROM sessions WHERE id = ?').get(id);
  if (existing) { // resumed or mid-session call — never re-stamp identity
    if (name) return nameSession(id, name);
    return existing.name;
  }
  const p = project(proj), r = repo(proj), au = author(), t = task(null, proj);
  const label = name || autoName(p, t);
  registerRepoIn(db(), r); // the project learns its own shape as repos show up
  db().prepare('INSERT INTO sessions(id, project, repo, author, username, role, name, task) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, p, r, au, username(), roleOf(au, proj), label, t);
  return label;
}

// a session always has a name — an unnamed one is invisible in a team's history
function autoName(p, t) {
  const who = String(username() || String(author() || 'dev').split('@')[0]).toLowerCase();
  const base = `${taskSlug(t || 'main')}-${taskSlug(who)}`;
  const taken = db().prepare('SELECT name FROM sessions WHERE project = ? AND name LIKE ?').all(p, base + '%')
    .map((r) => r.name);
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(base + '-' + n)) n++;
  return base + '-' + n;
}
function nameSession(id, label) {
  const l = String(label).trim().slice(0, 80);
  db().prepare('UPDATE sessions SET name = ? WHERE id = ?').run(l, id);
  return l;
}
// two teammates may pick the same label; the name is a label, not a key, so disambiguate
// on display rather than refusing the name
function sessionLabel(row) {
  if (!row.name) return String(row.id || '').slice(0, 8);
  const clash = db().prepare(
    "SELECT 1 FROM sessions WHERE project = ? AND name = ? AND IFNULL(author,'') <> IFNULL(?,'') LIMIT 1"
  ).get(row.project, row.name, row.author);
  return clash ? `${row.name}@${row.username || row.author || 'unknown'}` : row.name;
}
function firstPrompt(id, prompt) {
  if (!id || !prompt) return;
  db().prepare('UPDATE sessions SET first_prompt = ? WHERE id = ? AND first_prompt IS NULL')
    .run(String(prompt).slice(0, 300), id);
}
function observe(sessionId, tool, target, digest) {
  db().prepare('INSERT INTO observations(session_id, tool, target, digest) VALUES(?,?,?,?)')
    .run(sessionId || null, tool || '', String(target || '').slice(0, 300), String(digest || '').slice(0, 300));
}
function sessionEnd(id, summary) {
  if (!id) return;
  db().prepare("UPDATE sessions SET summary = COALESCE(?, summary), ended = datetime('now') WHERE id = ?")
    .run(summary ? String(summary).slice(0, 500) : null, id);
}
function sessionActivity(id, maxRows) {
  const s = db().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  // last N, oldest-first — a long session's conclusion is where the learnings live
  const obs = db().prepare('SELECT tool, target, digest FROM observations WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(id, maxRows || 40).reverse();
  return { session: s, observations: obs };
}
function pruneObservations(days) { // observations are session fuel, not knowledge — they expire
  return db().prepare("DELETE FROM observations WHERE created < datetime('now', ?)")
    .run('-' + (Number(days) || 30) + ' days').changes;
}

// ---------- team seed (git is the transport) ----------

// The seed is committed to a repository, so it is readable by everyone with repo access.
// AES-256-GCM with a shared passphrase closes that; the auth tag doubles as the tamper
// check, which is why there is no separate signature.
function seedKey(dir) {
  if (process.env.KEKA_SEED_KEY) return process.env.KEKA_SEED_KEY;
  try {
    const k = fs.readFileSync(path.join(String(dir || process.cwd()), '.keka', 'seed.key'), 'utf8').trim();
    return k || null;
  } catch { return null; }
}
function seal(text, pass) {
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return JSON.stringify({
    v: 1, alg: 'aes-256-gcm', kdf: 'scrypt',
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64'),
  }) + '\n';
}
function unseal(raw, pass) {
  const crypto = require('node:crypto');
  const env = JSON.parse(raw);
  const d = crypto.createDecipheriv('aes-256-gcm',
    crypto.scryptSync(pass, Buffer.from(env.salt, 'base64'), 32), Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8');
}
function isSealed(raw) {
  try { const o = JSON.parse(String(raw).trim()); return !!(o && o.alg === 'aes-256-gcm' && o.ct); } catch { return false; }
}

// Exports the WHOLE project by default — a teammate picking up any repo of a product
// should get the whole picture. `repo` narrows it to one service.
function seedExport(file, opts) {
  const o = opts || {};
  // workspace rows never re-export: they are someone else's claim, held privately, not yours to pass on
  let sql = 'SELECT type, text, confidence, project, repo, source, author, username, role, task, created FROM memories WHERE workspace IS NOT 1';
  const params = [];
  if (o.task) { sql += ' AND task = ?'; params.push(o.task); }
  if (o.repo) { sql += ' AND lower(repo) = ?'; params.push(String(o.repo).toLowerCase()); }
  sql += ' ORDER BY id';
  const rows = db().prepare(sql).all(...params);
  const lines = rows.map((r) => JSON.stringify(r));

  // session rows carry who did what on which branch. Tagged with `kind`; they have no
  // `text`, and every importer skips rows without one, so older keka versions ignore them.
  let sessions = [];
  if (o.sessions !== false) {
    let ssql = `SELECT id, name, username, author, role, repo, task, summary, created FROM sessions
       WHERE summary IS NOT NULL`;
    const sp = [];
    if (o.task) { ssql += ' AND task = ?'; sp.push(o.task); }
    if (o.repo) { ssql += ' AND lower(repo) = ?'; sp.push(String(o.repo).toLowerCase()); }
    ssql += ' ORDER BY created DESC, rowid DESC LIMIT 200';
    sessions = db().prepare(ssql).all(...sp);
    for (const s of sessions) lines.push(JSON.stringify({ kind: 'session', ...s }));
  }

  const body = lines.join('\n') + (lines.length ? '\n' : '');
  const pass = o.encrypt ? seedKey(o.dir || process.cwd()) : null;
  if (o.encrypt && !pass) throw new Error('encryption requested but no key: set KEKA_SEED_KEY or create .keka/seed.key');
  fs.writeFileSync(file, pass ? seal(body, pass) : body);
  return { memories: rows.length, sessions: sessions.length, encrypted: !!pass };
}

function seedImport(file, dir) {
  let raw = fs.readFileSync(file, 'utf8');
  let encrypted = false;
  if (isSealed(raw)) {
    const pass = seedKey(dir);
    if (!pass) throw new Error('seed is encrypted but no key: set KEKA_SEED_KEY or create .keka/seed.key');
    try { raw = unseal(raw, pass); } catch { throw new Error('seed could not be decrypted — wrong key, or the file was altered'); }
    encrypted = true;
  }
  const legacy = legacyTrust(dir); // read once, not per row
  if (dir) useProject(dir);
  const here = project(dir);       // imported rows join the project doing the importing
  const lines = raw.split('\n').filter((l) => l.trim());
  const find = db().prepare('SELECT id, author, workspace FROM memories WHERE text_key = ? LIMIT 1');
  const findSession = db().prepare('SELECT id FROM sessions WHERE id = ?');
  let added = 0, dup = 0, workspace = 0, promoted = 0, sessions = 0;
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { continue; }

    if (r.kind === 'session') { // teammate session history: identity only, never a memory
      if (!r.id || findSession.get(r.id)) continue;
      db().prepare('INSERT INTO sessions(id, project, repo, author, username, role, name, task, summary, created) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(r.id, here, r.repo || null, r.author || null, r.username || null, r.role || null,
          r.name || null, r.task || null, r.summary || null, r.created || new Date().toISOString().slice(0, 19).replace('T', ' '));
      sessions++;
      continue;
    }

    if (!r.text) continue;
    const au = r.author ? String(r.author).toLowerCase() : null;
    const w = trustLevel(au, dir, legacy) === 'workspace';
    const conf = r.confidence == null ? 0.7 : Number(r.confidence);
    const row = find.get(norm(r.text));
    if (row) {
      dup++;
      // trust changed since the last import? apply it to the existing row (both directions)
      if (row.author && au && String(row.author).toLowerCase() === au && !!row.workspace !== w) {
        db().prepare('UPDATE memories SET workspace = ?, confidence = ? WHERE id = ?')
          .run(w ? 1 : 0, w ? Math.min(conf, 0.3) : conf, row.id);
        if (w) workspace++; else promoted++;
      }
      continue;
    }
    // pass identity explicitly: r.project is a stored key, never a path, so it must not
    // be handed to add() as a working directory (that shelled out to git on every row)
    add(r.type || 'note', r.text, w ? Math.min(conf, 0.3) : r.confidence, null, r.source,
      { project: here, repo: r.repo || null, author: r.author || null, username: r.username || null,
        role: r.role || null, task: r.task || null, workspace: w });
    added++; if (w) workspace++;
  }
  return { added, dup, workspace, promoted, sessions, encrypted };
}

// Keeps an existing seed current on /compact, /clear and after a commit. Never creates the
// file — running /handoff once is the opt-in — and never touches git state.
function autoSeed(cwd) {
  if (!optOn('seed_auto', 'on')) return null;
  const dir = String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const plain = path.join(dir, '.keka', 'team-seed.jsonl');
  const enc = plain + '.enc';
  const target = fs.existsSync(enc) ? enc : (fs.existsSync(plain) ? plain : null);
  if (!target) return null;
  useProject(dir);
  const r = seedExport(target, { dir, encrypt: target === enc });
  return { file: path.basename(target), ...r };
}

// ---------- CLI ----------

function cli() {
  const [cmd, ...a] = process.argv.slice(2);
  // every CLI invocation serves one project; resolve it before touching a database
  const cwdFlag = a.indexOf('--project') >= 0 && a[a.indexOf('--project') + 1] && !a[a.indexOf('--project') + 1].startsWith('--')
    ? a[a.indexOf('--project') + 1] : null;
  useProject(cwdFlag || a[a.indexOf('--dir') + 1] || process.cwd());
  switch (cmd) {
    case 'init': db(); console.log('project db ready:', path.join(tenantDir(active().project), 'keka.db')); break;
    case 'add': {
      const rest = []; let proj = null, t = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '--project') proj = a[++i];
        else if (a[i] === '--task') t = a[++i];
        else rest.push(a[i]);
      }
      // default project = current repo — a memory added here belongs here unless told otherwise
      add(rest[0], rest[1], rest[2], proj || process.cwd(), rest[3] || null, t ? { task: t } : undefined);
      console.log('added');
      break;
    }
    case 'forget': { const t = forget(a[0]); console.log(t ? `forgotten #${a[0]}: ${t}` : 'no memory #' + a[0]); break; }
    case 'search': {
      const flags = { full: false };
      const rest = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '--full') flags.full = true;
        else if (a[i] === '--task') flags.task = a[++i];
        else if (a[i] === '--author') flags.author = a[++i];
        else if (a[i] === '--role') flags.role = a[++i];
        else if (a[i] === '--user') flags.user = a[++i];
        else if (a[i] === '--repo') flags.repo = a[++i];
        else if (a[i] === '--all') flags.all = true;
        else rest.push(a[i]);
      }
      const rows = search(rest.join(' '), { ...flags, limit: flags.full ? 20 : 8 });
      if (!rows.length) console.log('no matches');
      for (const r of rows) console.log(flags.full
        ? `#${r.id} [${r.type}]${r.workspace ? ' [workspace]' : ''} (conf ${r.confidence}) ${r.author ? '@' + r.author + ' ' : ''}${r.source ? '<' + r.source + '> ' : ''}${r.text}`
        : r._display);
      break;
    }
    case 'brief': console.log(brief(Number(a[0]) || 4000, a[1])); break;
    case 'session-start': sessionStart(a[0], a[1]); break;
    case 'session-end': sessionEnd(a[0], a.slice(1).join(' ')); break;
    case 'observe': observe(a[0], a[1], a[2], a.slice(3).join(' ')); break;
    case 'prune': console.log('pruned', pruneObservations(a[0]), 'observations'); break;
    case 'seed-export': {
      const rest = []; let t = null, proj = null, encrypt = false, dir = null, rp = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '--task') t = a[++i];
        else if (a[i] === '--project') proj = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : process.cwd();
        else if (a[i] === '--repo') rp = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : active().repo;
        else if (a[i] === '--encrypt') encrypt = true;
        else if (a[i] === '--dir') dir = a[++i];
        else rest.push(a[i]);
      }
      const r = seedExport(rest[0] || 'seed.jsonl', { task: t, repo: rp, dir: dir || proj, encrypt });
      console.log(`exported ${r.memories} memories / ${r.sessions} sessions`
        + (r.encrypted ? ' (encrypted)' : '')
        + ` (project: ${active().project}${rp ? `, repo: ${rp}` : ''}${t ? `, task: ${t}` : ''})`);
      break;
    }
    case 'seed-import': {
      const rest = []; let dir = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '--dir') dir = a[++i];
        else rest.push(a[i]);
      }
      const r = seedImport(rest[0] || 'seed.jsonl', dir || process.cwd());
      console.log(`imported ${r.added} new / ${r.dup} dup`
        + (r.sessions ? ` / ${r.sessions} sessions` : '')
        + (r.workspace ? ` / ${r.workspace} to workspace` : '')
        + (r.promoted ? ` / ${r.promoted} promoted` : '')
        + (r.encrypted ? ' (decrypted)' : ''));
      break;
    }
    case 'auto-seed': {
      const r = autoSeed(a[0]);
      console.log(r ? `refreshed ${r.file}: ${r.memories} memories / ${r.sessions} sessions${r.encrypted ? ' (encrypted)' : ''}`
        : 'no seed file in this project — run /handoff once to opt in');
      break;
    }
    case 'name': {
      const label = nameSession(a[0], a.slice(1).join(' '));
      console.log('session named:', label);
      break;
    }
    case 'trust': {
      if (!a[0]) { console.log('usage: engine.js trust <email> <full|workspace> [note]'); break; }
      const lvl = setTrust(a[0], a[1] || 'full', a.slice(2).join(' '));
      console.log(`trust set (private, this machine only): ${a[0]} -> ${lvl}`);
      break;
    }
    case 'trust-list': {
      const rows = trustList();
      if (!rows.length) console.log('no explicit trust set — everyone defaults to', opt('default_trust', 'full'));
      for (const r of rows) console.log(`${r.email} -> ${r.level}${r.note ? '  (' + r.note + ')' : ''}`);
      break;
    }
    case 'team-list': {
      const team = roster(a[0]);
      const emails = Object.keys(team);
      if (!emails.length) console.log('no .keka/team.md in this project');
      for (const em of emails) {
        const t = db().prepare('SELECT level FROM trust WHERE email = ?').get(em);
        console.log(`${team[em].name || em} <${em}>${team[em].role ? ' — role: ' + team[em].role : ''}`
          + `  [trust: ${t ? t.level : 'default ' + opt('default_trust', 'full')}]`);
      }
      break;
    }
    case 'whoami':
      console.log(JSON.stringify({
        username: username(), author: author(), role: roleOf(author(), a[0]),
        project: active().project, repo: active().repo, task: task(null, a[0]),
      }, null, 2));
      break;
    case 'project': {
      if (a[0] === 'register') { registerRepo(a[1] || active().repo, a[2]); console.log('repo registered:', a[1] || active().repo); break; }
      const decl = projectDecl(active().cwd || process.cwd());
      console.log(JSON.stringify({
        project: active().project,
        repo: active().repo,
        declared: !!decl.name,
        declaredRepos: decl.repos,
        registeredRepos: repoList().map((r) => r.repo),
        db: path.join(tenantDir(active().project), 'keka.db'),
      }, null, 2));
      break;
    }
    case 'repos':
      for (const r of repoList()) console.log(`${r.repo}${r.name ? '  (' + r.name + ')' : ''}`);
      break;
    case 'projects': {
      const rows = projectList();
      if (!rows.length) console.log('no projects recorded yet');
      for (const p of rows) console.log(`${p.key}  ->  ${p.dir}`);
      break;
    }
    case 'rekey': { // adopt rows stranded under an old identity (a repo that gained a remote later)
      const [from, to] = a;
      if (!from || !to) { console.log('usage: engine.js rekey <old-key> <new-key>'); break; }
      const src = openTenant(from), dst = openTenant(to);
      const cols = src.prepare('PRAGMA table_info(memories)').all().map((r) => r.name).filter((c) => c !== 'id');
      const rows = src.prepare(`SELECT ${cols.join(',')} FROM memories`).all();
      const ins = dst.prepare(`INSERT INTO memories(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
      for (const row of rows) ins.run(...cols.map((c) => (c === 'project' ? to : row[c])));
      src.prepare('DELETE FROM memories').run();
      console.log(`moved ${rows.length} memories: ${from} -> ${to}`);
      break;
    }
    case 'partners-seen':
      fs.mkdirSync(path.dirname(PARTNERS_SEEN), { recursive: true });
      fs.writeFileSync(PARTNERS_SEEN, new Date().toISOString() + '\n');
      console.log('partners nudge dismissed');
      break;
    case 'export': console.log(JSON.stringify({
      memories: db().prepare('SELECT * FROM memories').all(),
      sessions: db().prepare('SELECT * FROM sessions').all(),
      observations: db().prepare('SELECT * FROM observations').all(),
    }, null, 2)); break;
    default:
      console.log('usage: engine.js <init|add|forget|search|brief|session-start|session-end|name|observe|prune|'
        + 'seed-export|seed-import|auto-seed|trust|trust-list|team-list|whoami|project|repos|projects|rekey|partners-seen|export>');
  }
}

module.exports = {
  db, userDb, openTenant, useProject, active, log, add, forget, hasText, norm, search, brief,
  sessionStart, firstPrompt, observe, sessionEnd, sessionActivity, pruneObservations,
  seedExport, seedImport, autoSeed, project, repo, projectDecl, projectFile, registerRepo,
  repoList, projectList, tenantDir, tenantSlug, splitLegacy, normalizeRemote, opt, optOn,
  DB_PATH, ROOT, PROJECTS_DIR, LOG_PATH, PARTNERS_SEEN, author, username,
  task, taskSlug, roster, roleOf, legacyTrust, setTrust, trustList, trustLevel,
  nameSession, sessionLabel, autoName, seal, unseal, isSealed, seedKey,
};
if (require.main === module) cli();
