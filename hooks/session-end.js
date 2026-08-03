#!/usr/bin/env node
'use strict';
// SessionEnd: close the session row + ONE Haiku call compressing the session's last
// observations into a one-line summary and 0-3 durable learnings.
// Opt-out: KEKA_LEARN=off. KEKA_INNER guards against claude -p recursion.
if (process.env.KEKA_INNER) process.exit(0);

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let engine = null;
  try {
    const data = JSON.parse(raw || '{}');
    engine = require('./engine.js');
    const id = data.session_id;
    if (!id) process.exit(0);

    const act = engine.sessionActivity(id, 40); // LAST 40 — the conclusion is where learnings live
    const first = (act.session && act.session.first_prompt) || '';
    const obsLines = act.observations.map((o) => '- ' + (o.digest || o.target)).join('\n');
    // close the row first so a killed hook still leaves a usable "last session" line
    engine.sessionEnd(id, first ? first.slice(0, 200) : null);

    if (engine.optOn('learn', 'on') && (first || act.observations.length >= 3)) {
      const out = haikuCompress(engine, first, obsLines);
      if (out.summary) engine.sessionEnd(id, out.summary); // upgrade fallback to a real summary
      for (const l of out.learnings) {
        // dedup: repeated sessions rediscovering the same lesson must not pile up rows
        if (l && l.text && !engine.hasText(l.text)) {
          engine.add('learning', l.text, clamp(l.confidence), engine.project(data.cwd), id);
        }
      }
    }
    engine.pruneObservations(30); // observations are session fuel, not knowledge
  } catch (err) {
    try { (engine || require('./engine.js')).log('session-end', err); } catch { /* silent */ }
  }
  process.exit(0);
});

function clamp(c) { const n = Number(c); return Number.isFinite(n) ? Math.min(0.95, Math.max(0.3, n)) : 0.6; }

function haikuCompress(engine, firstPrompt, obsLines) {
  const none = { summary: null, learnings: [] };
  try {
    const { spawnSync } = require('node:child_process');
    const instructions =
      'Compress this coding session. Output ONLY one JSON object: ' +
      '{"summary":"one line, max 120 chars, what was accomplished","learnings":[{"text":"one-sentence durable learning","confidence":0.5}]} ' +
      'with 0-3 learnings. Durable = useful in FUTURE sessions (environment quirks, decisions made, ' +
      'gotchas discovered). NOT task narration. Empty learnings array if nothing durable.\n\n' +
      'First prompt: ' + firstPrompt + '\nActions:\n' + obsLines;
    const r = spawnSync(process.env.KEKA_CLAUDE_BIN || 'claude', ['-p', '--model', 'claude-haiku-4-5'], {
      input: instructions,
      encoding: 'utf8',
      timeout: 45000,
      shell: true,
      env: { ...process.env, KEKA_INNER: '1' },
    });
    if (r.status !== 0 || !r.stdout) {
      engine.log('session-end.haiku', 'claude -p failed: status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 300));
      return none;
    }
    const m = r.stdout.match(/\{[\s\S]*\}/);
    if (!m) return none;
    const parsed = JSON.parse(m[0]);
    return {
      summary: parsed.summary ? String(parsed.summary).slice(0, 200) : null,
      learnings: Array.isArray(parsed.learnings) ? parsed.learnings.slice(0, 3) : [],
    };
  } catch (err) {
    engine.log('session-end.haiku', err);
    return none;
  }
}
