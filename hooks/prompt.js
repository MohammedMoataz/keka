#!/usr/bin/env node
'use strict';
// UserPromptSubmit: ensure the session row exists (resumed sessions get no SessionStart,
// so this is what makes them visible) + record the first prompt. No output ever.
if (process.env.KEKA_INNER) process.exit(0);

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const engine = require('./engine.js');
    engine.sessionStart(data.session_id, data.cwd); // INSERT OR IGNORE — no-op when the row exists
    engine.firstPrompt(data.session_id, String(data.prompt || '').trim());
  } catch (err) {
    try { require('./engine.js').log('prompt', err); } catch { /* silent */ }
  }
  process.exit(0);
});
