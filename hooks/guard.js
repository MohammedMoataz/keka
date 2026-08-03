#!/usr/bin/env node
'use strict';
// PreToolUse secrets guard: block real credentials anywhere, ask on secret-ish outbound
// payloads and credential-file reads. Fail-open by design — a guard bug must never brick
// every tool call — but always logged. Opt-out: plugin setting `guard` / KEKA_GUARD=off.
if (process.env.KEKA_INNER) process.exit(0);

// high-precision credential shapes: blocked in every matched tool, including file writes
const BLOCK = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,            // AWS access key / STS
  /\bsk-[A-Za-z0-9_-]{32,}\b/,                // OpenAI-style
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,           // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,         // GitHub fine-grained PAT
  /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/,         // Slack tokens
  /hooks\.slack\.com\/services\/T[\w/]+/,     // Slack webhooks
  /AccountKey=[A-Za-z0-9+/=]{40,}/,           // Azure connection strings
];
// secret-ish heuristics: ask, and only where the payload leaves the machine or enters
// context (Bash, WebFetch) — code being edited legitimately mentions tokens constantly
const ASK = [
  /\b(?:api[_-]?key|secret|token|password|passwd)\b["'\s:=\\]*["']?[A-Za-z0-9_\-.]{20,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, // JWT header.payload
];
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env(?:\.[\w.-]+)?|credentials(?:\.\w+)?|id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|pfx|p12)|secrets?\.(?:json|ya?ml|toml))$/i;
const EXEMPT = /\.(?:example|sample|template|dist)$/i; // .env.example is documentation, not a secret
const OUTBOUND = new Set(['Bash', 'WebFetch']);

// scan raw string values, not JSON.stringify(tool_input) — serialization escapes let
// payloads slip past the patterns, and JSON syntax causes false hits
function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], out);
  return out;
}
const sensitivePath = (p) => SENSITIVE_PATH.test(p) && !EXEMPT.test(p);
function ask(reason) {
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason,
  } }));
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const engine = require('./engine.js');
    if (!engine.optOn('guard', 'on')) process.exit(0);
    const data = JSON.parse(raw || '{}');
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    const text = strings(input, []).join('\n');
    for (const re of BLOCK) {
      if (re.test(text)) {
        console.error('keka-guard: blocked — payload contains a credential matching ' + re.source.slice(0, 40));
        process.exit(2);
      }
    }
    if (tool === 'Read') {
      if (sensitivePath(String(input.file_path || ''))) {
        ask('keka-guard: reading a credentials-type file — its content would enter the model context.');
      }
    } else if (OUTBOUND.has(tool)) {
      for (const re of ASK) {
        if (re.test(text)) ask('keka-guard: possible secret in outbound payload — confirm before running.');
      }
      for (const tok of String(input.command || '').split(/[\s"'`;|&()<>=,]+/)) {
        if (tok && sensitivePath(tok)) {
          ask('keka-guard: command touches a credentials-type file (' + tok + ') — confirm before running.');
        }
      }
    }
  } catch (err) {
    try { require('./engine.js').log('guard', err); } catch { /* fail-open, logged when possible */ }
  }
  process.exit(0);
});
