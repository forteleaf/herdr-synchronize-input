'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Plugin configuration, loaded from `config.toml` inside
 * `HERDR_PLUGIN_CONFIG_DIR`.
 *
 * Node has no built-in TOML parser and we take on zero npm dependencies, so
 * this is a small dedicated parser for exactly the four fields the plugin
 * uses: `ignore_panes` (string array), `notify` (bool), `poll_interval_ms`
 * (integer), `prompt_regex` (string, normalized to null when empty/blank).
 * Anything else in the file is ignored. Any parse error or missing file
 * falls back to defaults, mirroring src/config.rs.
 */

// Default poll cadence for the output watcher. herdr 0.7.4 exposes no
// streaming "output changed" event (see herdr.js), so the watcher polls
// `pane.read` on this interval. ~60ms keeps typing feeling live without
// hammering the socket.
const DEFAULT_POLL_INTERVAL_MS = 60;

function defaultConfig() {
  return {
    ignorePanes: [],
    notify: true,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    promptRegex: null,
  };
}

function configPath() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) return null;
  return path.join(dir, 'config.toml');
}

// Load configuration, returning defaults on any error or missing file.
function load() {
  const p = configPath();
  if (!p) return defaultConfig();
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    return defaultConfig();
  }
  return parse(text);
}

// Strip a trailing `# comment`, respecting single- and double-quoted strings
// (so a `#` inside a prompt_regex string is not treated as a comment start).
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inDouble) {
      if (c === '\\') {
        i++; // skip the escaped character
        continue;
      }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// Unescape a TOML basic (double-quoted) string body.
function unescapeDouble(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      switch (n) {
        case 'n':
          out += '\n';
          i++;
          break;
        case 't':
          out += '\t';
          i++;
          break;
        case 'r':
          out += '\r';
          i++;
          break;
        case 'b':
          out += '\b';
          i++;
          break;
        case 'f':
          out += '\f';
          i++;
          break;
        case '"':
          out += '"';
          i++;
          break;
        case '\\':
          out += '\\';
          i++;
          break;
        case 'u': {
          const hex = s.slice(i + 2, i + 6);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          break;
        }
        default:
          out += n;
          i++;
      }
    } else {
      out += c;
    }
  }
  return out;
}

// Parse a single TOML string literal (basic `"..."` or literal `'...'`).
function parseTomlString(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return unescapeDouble(s.slice(1, -1));
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}

// Parse the inside of a `[ ... ]` string array, splitting on top-level commas
// (i.e. not commas inside a quoted string).
function parseStringArray(inner) {
  const parts = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inDouble) {
      cur += c;
      if (c === '\\' && i + 1 < inner.length) {
        cur += inner[++i];
        continue;
      }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      cur += c;
      if (c === "'") inSingle = false;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      cur += c;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      cur += c;
      continue;
    }
    if (c === ',') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);

  return parts.map((p) => parseTomlString(p)).filter((_, idx) => parts[idx].trim() !== '');
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (v.startsWith('[') && v.endsWith(']')) {
    return parseStringArray(v.slice(1, -1));
  }
  return parseTomlString(v);
}

function applyField(cfg, key, value) {
  switch (key) {
    case 'ignore_panes':
      if (Array.isArray(value)) cfg.ignorePanes = value.map(String);
      break;
    case 'notify':
      if (typeof value === 'boolean') cfg.notify = value;
      break;
    case 'poll_interval_ms':
      if (typeof value === 'number' && Number.isFinite(value)) cfg.pollIntervalMs = value;
      break;
    case 'prompt_regex':
      if (typeof value === 'string') cfg.promptRegex = value;
      break;
    default:
      // Unknown fields are ignored, matching serde's permissive default.
      break;
  }
}

// Fix up values that are valid TOML but not meaningful. An empty or
// whitespace-only `prompt_regex` becomes `null`: an empty regex matches at
// offset 0 and would strip nothing, silently disabling the prompt heuristic —
// treat it as "unset" so the heuristic runs instead.
function normalize(cfg) {
  if (cfg.promptRegex !== null && cfg.promptRegex.trim() === '') {
    cfg.promptRegex = null;
  }
}

// Parse config text, falling back to defaults on error, and normalize.
function parse(text) {
  const cfg = defaultConfig();
  try {
    const rawLines = text.split(/\r\n|\r|\n/);
    let i = 0;
    while (i < rawLines.length) {
      const line = stripComment(rawLines[i]).trim();
      i++;
      if (!line) continue;

      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      let valuePart = line.slice(eq + 1);

      // Accumulate lines until brackets balance, for multi-line arrays.
      if (valuePart.trim().startsWith('[')) {
        while (countChar(valuePart, '[') > countChar(valuePart, ']') && i < rawLines.length) {
          valuePart += '\n' + stripComment(rawLines[i]);
          i++;
        }
      }

      let value;
      try {
        value = parseValue(valuePart);
      } catch {
        continue;
      }
      applyField(cfg, key, value);
    }
  } catch {
    return defaultConfig();
  }

  normalize(cfg);
  return cfg;
}

module.exports = { load, parse, defaultConfig };
