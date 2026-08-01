#!/usr/bin/env node
'use strict';
// PostToolUse / PostToolUseFailure (Edit|Write|Bash): deterministic one-line observation row.
// No LLM, no output.
if (process.env.KEKA_INNER) process.exit(0);

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    // failures are the richest learning signal — mark them so session-end distillation sees them
    const failed = data.hook_event_name === 'PostToolUseFailure' ? 'FAIL ' : '';
    let target = '', digest = '';
    if (tool === 'Bash') {
      digest = failed + String(input.command || '').replace(/\s+/g, ' ').slice(0, 160);
    } else {
      target = String(input.file_path || '');
      digest = failed + tool.toLowerCase() + ' ' + target.split(/[\\/]/).slice(-3).join('/');
    }
    if (digest) require('./engine.js').observe(data.session_id, tool, target, digest);
  } catch (err) {
    try { require('./engine.js').log('observe', err); } catch { /* silent */ }
  }
  process.exit(0);
});
