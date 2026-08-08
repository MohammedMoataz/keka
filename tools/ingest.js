#!/usr/bin/env node
'use strict';
// Documents in, markdown out. The deterministic half of /ingest: routing, conversion by
// pandoc where it applies, source hashing for idempotency, frontmatter, and the index.
// Anything needing judgment (PDFs, live pages, refining a rough conversion) is left to
// the model, which hands the result back through `write`.
//
//   ingest.js plan   <file|url>...            what would happen, as JSON (no writes)
//   ingest.js convert <file> [--out <dir>]    convert what pandoc/copy can handle
//   ingest.js write  <slug>  [--out <dir>] --source <s> [--title <t>] [--sha <h>]
//                                             body arrives on stdin (model-produced)
//   ingest.js index  [--out <dir>]            rebuild <dir>/00-index.md

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const COPY = new Set(['.md', '.markdown', '.txt', '.text']);
const PANDOC = new Set(['.docx', '.odt', '.rtf', '.html', '.htm', '.epub', '.tex']);
const MODEL = new Set(['.pdf']); // needs reading, not converting

const isUrl = (s) => /^https?:\/\//i.test(String(s));

function route(input) {
  if (isUrl(input)) return 'fetch';
  const ext = path.extname(String(input)).toLowerCase();
  if (COPY.has(ext)) return 'copy';
  if (PANDOC.has(ext)) return 'pandoc';
  if (MODEL.has(ext)) return 'read';
  return 'unsupported';
}

function slugify(s) {
  return String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function have(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: true });
  return r.status === 0;
}

// frontmatter is the memory of what came from where — it makes re-ingesting a no-op
function readFrontmatter(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (kv) out[kv[1]] = kv[2].trim();
    }
    return out;
  } catch { return {}; }
}

function docs(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '00-index.md')
      .map((f) => ({ file: f, ...readFrontmatter(path.join(dir, f)) }));
  } catch { return []; }
}

// already ingested? same bytes under any name means there is nothing to do
function existingFor(dir, sha) {
  return sha ? docs(dir).find((d) => d.sha256 === sha) : null;
}

function frontmatter(fields) {
  const order = ['title', 'source', 'converted', 'sha256', 'summary', 'tags'];
  const lines = order.filter((k) => fields[k]).map((k) => `${k}: ${fields[k]}`);
  return '---\n' + lines.join('\n') + '\n---\n\n';
}

function writeDoc(dir, slug, body, fields) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug + '.md');
  const prior = readFrontmatter(file);
  // a slug collision between two different sources must not silently overwrite
  if (prior.source && fields.source && prior.source !== fields.source) {
    throw new Error(`slug collision: ${slug}.md already came from ${prior.source}`);
  }
  fs.writeFileSync(file, frontmatter(fields) + String(body).trim() + '\n');
  return file;
}

function today() { return new Date().toISOString().slice(0, 10); }

function buildIndex(dir) {
  const list = docs(dir).sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
  if (!list.length) return null;
  const lines = ['# Documents', '',
    'Converted with `/ingest`. Each entry records where it came from.', ''];
  for (const d of list) {
    const title = d.title || d.file.replace(/\.md$/, '');
    lines.push(`- [${title}](${d.file}) — ${d.source || 'unknown source'}${d.converted ? ` · ${d.converted}` : ''}`);
    if (d.summary) lines.push(`  - ${d.summary}`);
  }
  const file = path.join(dir, '00-index.md');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function cli() {
  const [cmd, ...a] = process.argv.slice(2);
  const flag = (name, def) => { const i = a.indexOf('--' + name); return i >= 0 ? a[i + 1] : def; };
  const rest = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) i++; else rest.push(a[i]);
  }
  const out = path.resolve(flag('out', 'docs'));

  switch (cmd) {
    case 'plan': {
      const plan = rest.map((input) => {
        const how = route(input);
        let sha = null, skip = null;
        if (how !== 'fetch' && how !== 'unsupported') {
          try { sha = sha256(fs.readFileSync(input)); } catch { return { input, how: 'missing' }; }
          const dup = existingFor(out, sha);
          if (dup) skip = dup.file;
        }
        return { input, how, slug: slugify(isUrl(input) ? input.replace(/^https?:\/\//, '') : path.basename(input)), sha256: sha, alreadyIngested: skip };
      });
      console.log(JSON.stringify({ out, pandoc: have('pandoc'), plan }, null, 2));
      break;
    }
    case 'convert': {
      const input = rest[0];
      if (!input) { console.error('usage: ingest.js convert <file> [--out <dir>]'); process.exitCode = 1; break; }
      const how = route(input);
      if (how === 'fetch' || how === 'read' || how === 'unsupported') {
        console.log(JSON.stringify({ input, how, handled: false,
          note: how === 'unsupported' ? 'no route for this type' : 'needs the model — fetch/read it, then pipe markdown to `write`' }));
        break;
      }
      const buf = fs.readFileSync(input);
      const sha = sha256(buf);
      const dup = existingFor(out, sha);
      if (dup) { console.log(JSON.stringify({ input, handled: true, skipped: dup.file, reason: 'identical source already ingested' })); break; }
      const slug = slugify(path.basename(input));
      let body;
      if (how === 'copy') {
        body = buf.toString('utf8');
      } else {
        if (!have('pandoc')) {
          console.log(JSON.stringify({ input, how, handled: false, note: 'pandoc not installed — see /partners' }));
          break;
        }
        const r = spawnSync('pandoc', [input, '-t', 'gfm', '--wrap=none'], { encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 });
        if (r.status !== 0) {
          console.log(JSON.stringify({ input, how, handled: false, note: 'pandoc failed: ' + String(r.stderr || '').slice(0, 300) }));
          break;
        }
        body = r.stdout;
      }
      const file = writeDoc(out, slug, body, {
        title: slug.replace(/-/g, ' '), source: input, converted: today(), sha256: sha,
      });
      console.log(JSON.stringify({ input, how, handled: true, file, slug, sha256: sha }));
      break;
    }
    case 'write': {
      const slug = slugify(rest[0] || '');
      let body = '';
      try { body = fs.readFileSync(0, 'utf8'); } catch { /* empty stdin */ }
      if (!body.trim()) { console.error('write: markdown body expected on stdin'); process.exitCode = 1; break; }
      const file = writeDoc(out, slug, body, {
        title: flag('title', slug.replace(/-/g, ' ')),
        source: flag('source', 'unknown'),
        converted: today(),
        sha256: flag('sha', null),
        summary: flag('summary', null),
        tags: flag('tags', null),
      });
      console.log(JSON.stringify({ file, slug }));
      break;
    }
    case 'index': {
      const file = buildIndex(out);
      console.log(file ? 'index written: ' + file : 'no documents in ' + out);
      break;
    }
    default:
      console.log('usage: ingest.js <plan|convert|write|index> [inputs...] [--out <dir>]');
  }
}

module.exports = { route, slugify, sha256, readFrontmatter, writeDoc, buildIndex, existingFor, docs };
if (require.main === module) cli();
