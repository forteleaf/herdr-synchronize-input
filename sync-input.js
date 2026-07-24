#!/usr/bin/env node
'use strict';

/**
 * sync-input — a herdr plugin that mirrors what you type in the focused pane
 * to every other pane in the same tab, by watching the focused pane's output
 * (an output-watching reimagining of tmux `synchronize-panes`).
 *
 * Subcommands:
 *   - toggle — action entrypoint; starts or stops the background watcher for
 *     the focused tab.
 *   - watch  — the watcher daemon, spawned detached by `toggle`. Takes
 *     `--source <pane_id> --tab <tab_id>`.
 *   - send <key> — broadcast a control key (e.g. `ctrl+l`) to the focused tab
 *     when sync is on, else to the focused pane. Bound to keys via `send-*`
 *     actions.
 *
 * Pure Node.js, stdlib only (net/fs/child_process/os/path) — no npm
 * dependencies, no build step.
 */

const toggle = require('./toggle');

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || '';

  if (cmd === 'toggle') {
    await toggle.run();
  } else if (cmd === 'watch') {
    await toggle.runWatch(args.slice(1));
  } else if (cmd === 'send') {
    await require('./send').run(args[1]);
  } else {
    process.stderr.write(`sync-input: unknown subcommand ${JSON.stringify(cmd)} (expected \`toggle\`, \`watch\`, or \`send\`)\n`);
    process.exitCode = 2;
    return;
  }
}

main().catch((e) => {
  process.stderr.write(`sync-input: ${e.message}\n`);
  process.exitCode = 1;
});
