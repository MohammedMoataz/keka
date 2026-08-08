#!/usr/bin/env node
'use strict';
// Keeps a project's team seed current at the moments memory actually changes shape:
// PreCompact (/compact) and PostToolUse after a successful `git commit`. /clear and exit
// are covered by session-end.js, which calls the same engine function.
// Never creates the seed — running /handoff once is the opt-in — and never touches git.
if (process.env.KEKA_INNER) process.exit(0);

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let engine = null;
  try {
    const data = JSON.parse(raw || '{}');
    // PostToolUse only fires on success (failures go to PostToolUseFailure), so a match
    // here means the commit landed.
    if (data.hook_event_name === 'PostToolUse') {
      const cmd = String((data.tool_input || {}).command || '');
      if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) process.exit(0);
    }
    engine = require('./engine.js');
    engine.useProject(data.cwd);
    const r = engine.autoSeed(data.cwd);
    if (r) {
      console.log(JSON.stringify({
        systemMessage: `keka: refreshed .keka/${r.file} — ${r.memories} memories, ${r.sessions} sessions`
          + `${r.encrypted ? ' (encrypted)' : ''}. Commit it to pass the knowledge on.`,
      }));
    }
  } catch (err) {
    try { (engine || require('./engine.js')).log('seed-refresh', err); } catch { /* never block */ }
  }
  process.exit(0);
});
