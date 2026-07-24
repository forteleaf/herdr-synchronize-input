'use strict';

const path = require('path');
const { spawn } = require('child_process');

const herdr = require('./herdr');
const state = require('./state');
const config = require('./config');

/**
 * The `toggle` action entrypoint. Starts a background output watcher for the
 * focused tab if none is running, otherwise stops the existing one.
 */
async function run() {
  // The source pane is whichever pane is focused right now; its tab is the
  // tab we synchronize. Deriving both from the live pane list avoids relying
  // on which context env vars an action invocation happens to carry.
  const panes = await herdr.paneList();
  const source = panes.find((p) => p.focused);
  if (!source) {
    throw new Error('no focused pane to synchronize from');
  }
  const tabId = source.tabId;
  const sourcePane = source.paneId;

  const cfg = config.load();

  // Toggle OFF: deleting the state file makes the running watcher exit on
  // its next poll (see state.js / watch.js).
  if (state.exists(tabId)) {
    state.clear(tabId);
    if (cfg.notify) {
      await herdr.notify('Sync input off', 'Stopped mirroring your keystrokes.');
    }
    return;
  }

  // Toggle ON: record state first (so the freshly spawned watcher sees its
  // liveness token immediately), then spawn the detached daemon and patch in
  // its real pid.
  state.write({ pid: 0, sourcePane, tabId });

  let child;
  try {
    child = spawnWatcher(sourcePane, tabId);
  } catch (e) {
    // Roll back the token if the daemon never launched.
    state.clear(tabId);
    throw e;
  }
  child.on('error', () => {
    // Roll back the token if the daemon fails to launch asynchronously.
    state.clear(tabId);
  });

  state.write({ pid: child.pid, sourcePane, tabId });

  if (cfg.notify) {
    const others = Math.max(0, panes.filter((p) => p.tabId === tabId).length - 1);
    await herdr.notify('Sync input on', `Mirroring your keystrokes to ${others} pane(s) in this tab.`);
  }
}

// Spawn `sync-input.js watch` as a detached background process, re-executing
// this same script under the current Node binary. Stdio is detached to
// /dev/null (via 'ignore') so the daemon outlives this short-lived action
// process.
function spawnWatcher(sourcePane, tabId) {
  const script = path.join(__dirname, 'sync-input.js');
  const child = spawn(
    process.execPath,
    [script, 'watch', '--source', sourcePane, '--tab', tabId],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  return child;
}

// Parse `watch` arguments: `--source <pane> --tab <tab>`.
function parseWatchArgs(args) {
  let source = null;
  let tab = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--source') {
      source = args[++i];
    } else if (flag === '--tab') {
      tab = args[++i];
    } else {
      throw new Error(`watch: unexpected argument ${JSON.stringify(flag)}`);
    }
  }
  if (source == null || tab == null) {
    throw new Error('watch: --source and --tab are required');
  }
  return { source, tab };
}

// Run the watcher from parsed CLI args.
async function runWatch(args) {
  const { source, tab } = parseWatchArgs(args);
  const watch = require('./watch');
  await watch.run(source, tab, config.load());
}

module.exports = { run, runWatch, parseWatchArgs };
