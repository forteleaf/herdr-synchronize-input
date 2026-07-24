'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Per-tab watcher state, stored as a small JSON file under
 * `HERDR_PLUGIN_STATE_DIR`.
 *
 * The state file doubles as the watcher's liveness token: its presence means
 * "a watcher is active for this tab", and `toggle` stops the watcher simply
 * by deleting it. The watcher polls for its own file every loop and exits
 * when it disappears (see watch.js). This keeps shutdown signal-free and
 * dependency-free — no signals, no process management libs. The recorded
 * `pid` is kept only for diagnostics.
 */

// Path to the state file for a given tab, if the state dir is known.
function statePath(tabId) {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) return null;
  // Unicode-aware, like Rust's `char::is_alphanumeric`.
  const safe = Array.from(tabId)
    .map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '_'))
    .join('');
  return path.join(dir, `watch-${safe}.json`);
}

// Record (or overwrite) the watcher state for a tab.
function write(state) {
  const p = statePath(state.tabId);
  if (!p) return;
  try {
    fs.writeFileSync(
      p,
      JSON.stringify({ pid: state.pid, source_pane: state.sourcePane, tab_id: state.tabId })
    );
  } catch {
    // Best-effort, matches Rust's `let _ =`.
  }
}

// Whether a watcher is currently recorded as active for a tab.
function exists(tabId) {
  const p = statePath(tabId);
  if (!p) return false;
  return fs.existsSync(p);
}

// Remove the state file for a tab (stops the watcher on its next poll).
function clear(tabId) {
  const p = statePath(tabId);
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    // Already gone, or never existed — fine either way.
  }
}

module.exports = { write, exists, clear };
