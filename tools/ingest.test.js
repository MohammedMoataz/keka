#!/usr/bin/env node
'use strict';
// Checks for the deterministic half of /ingest. No framework, throwaway output dir.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const g = require('./ingest.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keka-ingest-'));
const out = path.join(tmp, 'docs');
const run = (...args) => spawnSync('node', [path.join(__dirname, 'ingest.js'), ...args],
  { encoding: 'utf8', timeout: 20000 });

// routing: each input type goes exactly one way
assert.strictEqual(g.route('notes.md'), 'copy', 'markdown copied');
assert.strictEqual(g.route('README.TXT'), 'copy', 'extension match is case-insensitive');
assert.strictEqual(g.route('spec.docx'), 'pandoc', 'docx via pandoc');
assert.strictEqual(g.route('paper.pdf'), 'read', 'pdf needs the model');
assert.strictEqual(g.route('https://example.com/post'), 'fetch', 'url fetched');
assert.strictEqual(g.route('archive.zip'), 'unsupported', 'unknown type refused, not guessed');

// slugs are filesystem-safe and lose the extension
assert.strictEqual(g.slugify('Q3 Planning Notes.docx'), 'q3-planning-notes', 'slug from a filename');
assert.strictEqual(g.slugify('example.com/a/b?x=1'), 'example-com-a-b-x-1', 'slug from a url');
assert.strictEqual(g.slugify('***'), 'document', 'slug never empty');

// convert: a markdown file lands with provenance frontmatter
const src = path.join(tmp, 'Meeting Notes.md');
fs.writeFileSync(src, '# Notes\n\nDecided to ship on Friday.\n');
let r = run('convert', src, '--out', out);
assert.strictEqual(r.status, 0, 'convert exits 0: ' + r.stderr);
const first = JSON.parse(r.stdout);
assert.ok(first.handled && first.file, 'file written: ' + r.stdout);
const written = fs.readFileSync(first.file, 'utf8');
assert.match(written, /^---\n/, 'frontmatter present');
assert.match(written, /source: .*Meeting Notes\.md/, 'source recorded');
assert.match(written, /sha256: [0-9a-f]{64}/, 'source hash recorded');
assert.match(written, /Decided to ship on Friday\./, 'body preserved verbatim');

// idempotency is by content hash, not filename
r = run('convert', src, '--out', out);
assert.ok(JSON.parse(r.stdout).skipped, 're-ingesting the same file is a no-op');
const renamed = path.join(tmp, 'Same Content Different Name.md');
fs.copyFileSync(src, renamed);
r = run('convert', renamed, '--out', out);
assert.ok(JSON.parse(r.stdout).skipped, 'same bytes under a new name still skipped');

// plan reports without writing anything
const before = fs.readdirSync(out).length;
r = run('plan', src, 'https://example.com/x', 'mystery.zip', '--out', out);
const plan = JSON.parse(r.stdout);
assert.strictEqual(plan.plan.length, 3, 'one plan entry per input');
assert.ok(plan.plan[0].alreadyIngested, 'plan flags an already-ingested source');
assert.strictEqual(plan.plan[1].how, 'fetch', 'url routed to fetch');
assert.strictEqual(plan.plan[2].how, 'unsupported', 'unknown type flagged');
assert.strictEqual(fs.readdirSync(out).length, before, 'plan wrote nothing');

// write: model-produced markdown arrives on stdin and gains frontmatter
r = spawnSync('node', [path.join(__dirname, 'ingest.js'), 'write', 'annual-report',
  '--out', out, '--source', 'annual.pdf', '--summary', 'What the year cost.', '--tags', 'finance,annual'],
  { input: '# Annual report\n\nRevenue was up.\n', encoding: 'utf8', timeout: 20000 });
assert.strictEqual(r.status, 0, 'write exits 0: ' + r.stderr);
const reportFile = JSON.parse(r.stdout).file;
const report = fs.readFileSync(reportFile, 'utf8');
assert.match(report, /source: annual\.pdf/, 'write records the source');
assert.match(report, /summary: What the year cost\./, 'summary stored for the index');
assert.match(report, /tags: finance,annual/, 'tags stored');

// a slug collision from a different source is refused, not silently overwritten
assert.throws(
  () => g.writeDoc(out, 'annual-report', 'other text', { source: 'somewhere-else.docx' }),
  /slug collision/, 'refuses to overwrite a doc from a different source');

// index lists every document with its provenance
r = run('index', '--out', out);
assert.strictEqual(r.status, 0, 'index exits 0: ' + r.stderr);
const index = fs.readFileSync(path.join(out, '00-index.md'), 'utf8');
assert.match(index, /\[annual report\]\(annual-report\.md\)/, 'index links the doc');
assert.match(index, /annual\.pdf/, 'index shows where it came from');
assert.match(index, /What the year cost\./, 'index shows the summary');
assert.ok(!index.includes('00-index.md](00-index'), 'index does not list itself');

console.log('ingest.test.js: ALL PASS');
