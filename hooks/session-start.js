#!/usr/bin/env node
'use strict';
// SessionStart (startup|clear): create session row + inject <=4K memory brief.
// Never fails the session; failures go to ~/.keka/log.jsonl.
if (process.env.KEKA_INNER) process.exit(0); // spawned claude -p children: no recursion, no rows

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let engine = null;
  try {
    const data = JSON.parse(raw || '{}');
    engine = require('./engine.js');
    engine.sessionStart(data.session_id, data.cwd);
    const fs = require('node:fs');
    const out = [];
    const brief = engine.brief(Number(engine.opt('brief_chars', 4000)) || 4000, data.cwd);
    if (brief.trim()) out.push('## Keka memory brief\n' + brief);
    // teammate seed committed in this repo? point at it — deterministic, zero tokens
    try {
      const seed = require('node:path').join(String(data.cwd || process.cwd()), '.keka', 'team-seed.jsonl');
      if (fs.existsSync(seed)) {
        const n = fs.readFileSync(seed, 'utf8').split('\n').filter((l) => l.trim()).length;
        out.push(`Team seed present (.keka/team-seed.jsonl, ${n} entries) — run /handoff import to load teammate memories.`);
      }
    } catch { /* nudge is optional */ }
    // partners: auto mode is restated every session (consent to install must be in context);
    // ask mode nudges once, until the first /partners run writes the marker (engine partners-seen)
    try {
      const mode = String(engine.opt('partners', 'ask')).toLowerCase();
      if (mode === 'auto') {
        out.push('Keka partners mode: auto — if a task needs a missing partner tool, /partners may install it without asking; always report what was installed.');
      } else if (mode !== 'off' && !fs.existsSync(engine.PARTNERS_SEEN)) {
        out.push('Recommended partner tools available — run /partners to review them. (This note disappears after the first run.)');
      }
    } catch { /* nudge is optional */ }
    if (out.length) console.log(out.join('\n\n'));
  } catch (err) {
    try { (engine || require('./engine.js')).log('session-start', err); } catch { /* never block a session */ }
  }
  process.exit(0);
});
