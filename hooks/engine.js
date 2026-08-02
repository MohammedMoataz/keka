#!/usr/bin/env node
'use strict';
// keka engine: memory + sessions + observations + team seed. Zero dependencies.
// Requires Node >= 22.5 (node:sqlite). DB survives plugin updates (lives in ~/.keka).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = path.join(os.homedir(), '.keka');
const DB_PATH = process.env.KEKA_DB || path.join(HOME, 'keka.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'memory', 'schema.sql');
const LOG_PATH = process.env.KEKA_LOG || path.join(HOME, 'log.jsonl');
const PARTNERS_SEEN = path.join(path.dirname(DB_PATH), 'partners-seen'); // marker: /partners ran once, stop nudging

// failures append here instead of vanishing — "keka just stopped working" must be diagnosable
function log(where, err) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    try { if (fs.statSync(LOG_PATH).size > 512 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.1'); } catch { /* first write */ }
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), where, err: String((err && err.stack) || err) }) + '\n');
  } catch { /* logging must never throw */ }
}

let _db = null;
function db() {
  if (_db) return _db;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  _db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return _db;
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
const _projCache = new Map();
function project(cwd) {
  const key = String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (_projCache.has(key)) return _projCache.get(key);
  const remote = git('remote get-url origin', key);
  const p = remote ? normalizeRemote(remote)
    : (git('rev-parse --show-toplevel', key) || key).replace(/\\/g, '/').toLowerCase();
  _projCache.set(key, p);
  return p;
}

// trust roster: .keka/team.md lines like "- dev@co — trust: full|workspace"; absent file =
// everyone full trust (fail-open by design — solo use must not require a roster)
function roster(cwd) {
  const map = {};
  try {
    const f = path.join(String(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()), '.keka', 'team.md');
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const email = line.match(/[\w.+-]+@[\w.-]+\w/);
      const trust = line.match(/trust:\s*(full|workspace)/i);
      if (email && trust) map[email[0].toLowerCase()] = trust[1].toLowerCase();
    }
  } catch { /* no roster */ }
  return map;
}

// ---------- memories ----------

const TYPES = new Set(['learning', 'note', 'reference', 'pattern']);
function norm(text) { return String(text).toLowerCase().replace(/\s+/g, ' ').trim(); }

function add(type, text, confidence, proj, source, extra) {
  const x = extra || {};
  db().prepare('INSERT INTO memories(type,text,text_key,confidence,project,source,author,task,workspace) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(TYPES.has(type) ? type : 'note', String(text), norm(text),
      confidence == null ? 0.7 : Number(confidence),
      proj ? project(proj) : null, source || null,
      x.author !== undefined ? x.author : author(),
      x.task !== undefined ? x.task : task(null, proj),
      x.workspace ? 1 : 0);
}
function forget(id) {
  const row = db().prepare('SELECT text FROM memories WHERE id = ?').get(Number(id));
  const n = db().prepare('DELETE FROM memories WHERE id = ?').run(Number(id)).changes;
  return n ? row.text : null; // echo what died — terminal history is the trash can
}
function hasText(text) { // dedup is on the normalized key: case/whitespace variants are the same fact
  return !!db().prepare('SELECT 1 FROM memories WHERE text_key = ? LIMIT 1').get(norm(text));
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

function search(q, opts) {
  const { limit = 8, full = false, task: t, author: au } = opts || {};
  const fq = ftsQuery(q);
  if (!fq) return [];
  let sql = `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
     WHERE memories_fts MATCH ?`;
  const params = [fq];
  if (t) { sql += ' AND m.task = ?'; params.push(t); }
  if (au) { sql += ' AND m.author = ?'; params.push(au); }
  sql += ' ORDER BY rank LIMIT ?'; params.push(limit);
  const rows = db().prepare(sql).all(...params);
  const bump = db().prepare('UPDATE memories SET uses = uses + 1 WHERE id = ?'); // counter only; never touches ranking
  for (const r of rows) bump.run(r.id);
  return rows.map((r) => ({ ...r, _display: full ? null : shortLine(r) }));
}

function shortLine(r) {
  const t = r.text.length > 100 ? r.text.slice(0, 100) + '...' : r.text;
  return `#${r.id} [${r.type}]${r.workspace ? ' [workspace]' : ''} ${t} (conf ${Number(r.confidence).toFixed(2)})`;
}

function brief(maxChars, proj) {
  const cap = maxChars || 4000;
  const p = project(proj);
  const out = [];
  let used = 0;
  const push = (line) => { // every line counts against the cap, headers included
    if (used + line.length + 1 > cap) return false;
    out.push(line); used += line.length + 1;
    return true;
  };
  const last = db().prepare(
    `SELECT first_prompt, summary, created FROM sessions
     WHERE project = ? AND (summary IS NOT NULL OR first_prompt IS NOT NULL)
     ORDER BY created DESC, rowid DESC LIMIT 1`
  ).get(p);
  if (last) push(`Last session here (${String(last.created).slice(0, 16)}): ${last.summary || last.first_prompt}`);
  // affine ranking: same-task memories outrank same-project outrank global; workspace rows never enter.
  // ponytail: 500-newest candidate window keeps startup bounded; widen if ranking visibly misses
  const t = task(null, proj);
  const w = (r) => score(r) * (r.project === p ? 1.5 : 1) * (t && r.task === t ? 1.5 : 1);
  const rows = db().prepare('SELECT * FROM memories WHERE workspace IS NOT 1 ORDER BY created DESC, id DESC LIMIT 500').all()
    .sort((a, b) => w(b) - w(a));
  if (rows.length) push('Top memories:');
  for (const r of rows) {
    if (!push(`- [${r.type} #${r.id}] ${r.text}`)) break; // ids so a wrong memory can be forgotten on sight
  }
  return out.join('\n');
}

// ---------- sessions & observations ----------

function sessionStart(id, proj) {
  if (!id) return;
  db().prepare('INSERT OR IGNORE INTO sessions(id, project, author, task) VALUES(?,?,?,?)')
    .run(id, project(proj), author(), task(null, proj));
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

function seedExport(file, opts) {
  const o = opts || {};
  // workspace rows never re-export: they are someone else's claim, held privately, not yours to pass on
  let sql = 'SELECT type, text, confidence, project, source, author, task, created FROM memories WHERE workspace IS NOT 1';
  const params = [];
  if (o.task) { sql += ' AND task = ?'; params.push(o.task); }
  if (o.project) { sql += ' AND project = ?'; params.push(project(o.project)); }
  sql += ' ORDER BY id';
  const rows = db().prepare(sql).all(...params);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  return rows.length;
}

function seedImport(file, dir) {
  const trust = roster(dir); // workspace-trust authors: confidence capped, held private, never in the brief
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const find = db().prepare('SELECT id, author, workspace FROM memories WHERE text_key = ? LIMIT 1');
  let added = 0, dup = 0, workspace = 0, promoted = 0;
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.text) continue;
    const au = r.author ? String(r.author).toLowerCase() : null;
    const w = !!(au && trust[au] === 'workspace');
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
    add(r.type || 'note', r.text, w ? Math.min(conf, 0.3) : r.confidence, r.project, r.source,
      { author: r.author || null, task: r.task || null, workspace: w });
    added++; if (w) workspace++;
  }
  return { added, dup, workspace, promoted };
}

// ---------- CLI ----------

function cli() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case 'init': db(); console.log('db ready:', DB_PATH); break;
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
      const rest = []; let t = null, proj = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '--task') t = a[++i];
        else if (a[i] === '--project') proj = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : process.cwd();
        else rest.push(a[i]);
      }
      const n = seedExport(rest[0] || 'seed.jsonl', { task: t, project: proj });
      console.log('exported', n, 'memories', t ? `(task: ${t})` : proj ? `(project: ${project(proj)})` : '');
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
        + (r.workspace ? ` / ${r.workspace} to workspace` : '')
        + (r.promoted ? ` / ${r.promoted} promoted` : ''));
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
      console.log('usage: engine.js <init|add|forget|search|brief|session-start|session-end|observe|prune|seed-export|seed-import|partners-seen|export>');
  }
}

module.exports = {
  db, log, add, forget, hasText, norm, search, brief, sessionStart, firstPrompt, observe,
  sessionEnd, sessionActivity, pruneObservations, seedExport, seedImport,
  project, normalizeRemote, opt, optOn, DB_PATH, LOG_PATH, PARTNERS_SEEN, author, task, taskSlug, roster,
};
if (require.main === module) cli();
