'use strict';

const herdr = require('./herdr');
const state = require('./state');
const config = require('./config');

/**
 * Broadcast a named control key (herdr key grammar, e.g. "ctrl+l", "ctrl+c",
 * "ctrl+b") to panes. Invoked by the manifest `send-*` actions, which a user
 * binds to keys in their herdr config.
 *
 * Why this exists: control keys cannot be detected by the output watcher — they
 * leave no trace on the input line and herdr exposes no key-input hook — so
 * each broadcastable key is an explicit action instead.
 *
 * Sync-aware targeting:
 *   - Sync ON for the focused tab  -> send to every pane in that tab (the
 *     focused pane included, ignored panes excluded), so e.g. ctrl+l clears
 *     them all at once.
 *   - Sync OFF                     -> send only to the focused pane, so normal
 *     single-pane behavior is preserved even when the action is bound directly
 *     over the real key (e.g. ctrl+c).
 */

// Pure target selection, split out so it can be unit-tested without a server.
function selectTargets(panes, source, syncActive, ignorePanes) {
  if (!syncActive) {
    return [source.paneId];
  }
  const ignore = new Set(ignorePanes || []);
  return panes
    .filter((p) => p.tabId === source.tabId && !ignore.has(p.paneId))
    .map((p) => p.paneId);
}

async function run(key) {
  if (!key) {
    throw new Error('send: missing key (e.g. `send ctrl+l`)');
  }

  const panes = await herdr.paneList();
  const source = panes.find((p) => p.focused);
  if (!source) {
    throw new Error('no focused pane');
  }

  const syncActive = state.exists(source.tabId);
  const cfg = config.load();
  const targets = selectTargets(panes, source, syncActive, cfg.ignorePanes);

  // Best-effort per pane, matching the watcher: one unreachable pane must not
  // sink the whole broadcast.
  await Promise.all(targets.map((pane) => herdr.sendKeys(pane, [key]).catch(() => {})));
}

module.exports = { run, selectTargets };
