'use strict';

const herdr = require('./herdr');
const state = require('./state');
const line = require('./line');

/**
 * The watcher daemon. Spawned detached by `toggle`, it polls the source
 * pane's visible output and mirrors changes to the input line onto every
 * other pane in the same tab.
 *
 * Why polling: herdr 0.7.4 offers no streaming output-changed event (see the
 * module docs in herdr.js), so this is the only path. The cadence is
 * `config.pollIntervalMs` (~60ms default).
 *
 * Known limits (inherent to watching stripped screen text):
 *   - Shell autosuggestions (e.g. fish's greyed history hint) look identical
 *     to typed text once ANSI colour is stripped, so they get mirrored too.
 *   - Passwords (no echo), multi-line editors, and completion menus will not
 *     mirror cleanly.
 *   - Only text, backspace, submit (Enter), and in-place clear are handled;
 *     cursor movement and control keys are not.
 */

// How often to re-scan the tab for target panes (panes may open/close while
// the watcher runs).
const TARGET_REFRESH_MS = 1000;

class Watcher {
  constructor(sourcePane, tabId, config) {
    this.sourcePane = sourcePane;
    this.tabId = tabId;
    this.config = config;

    // A bad prompt_regex should not kill the watcher: warn and fall back to
    // the heuristic. (stderr is /dev/null when detached, but honest.)
    this.prompt = null;
    if (config.promptRegex) {
      try {
        this.prompt = new RegExp(config.promptRegex);
      } catch (e) {
        process.stderr.write(
          `sync-input: invalid prompt_regex ${JSON.stringify(config.promptRegex)}: ${e.message}; using heuristic\n`
        );
        this.prompt = null;
      }
    }

    this.targets = [];
    this.lastTargetRefresh = 0;
    // Last known typed input on the source line.
    this.prevInput = '';
    // Last known full source line (prompt + input), for submit detection.
    this.prevRaw = '';
  }

  // Rebuild the target list: other panes in the same tab, minus the source
  // and any ignored panes.
  async refreshTargets() {
    try {
      const panes = await herdr.paneList();
      this.targets = panes
        .filter((p) => p.tabId === this.tabId)
        .filter((p) => p.paneId !== this.sourcePane)
        .filter((p) => !this.config.ignorePanes.includes(p.paneId))
        .map((p) => p.paneId);
    } catch {
      // Transient failure: keep the previous target list.
    }
    this.lastTargetRefresh = Date.now();
  }

  async backspaceTargets(n) {
    if (n === 0) return;
    const keys = Array(n).fill('backspace');
    await Promise.all(this.targets.map((pane) => herdr.sendKeys(pane, keys).catch(() => {})));
  }

  async textTargets(text) {
    if (text === '') return;
    await Promise.all(this.targets.map((pane) => herdr.sendText(pane, text).catch(() => {})));
  }

  async enterTargets() {
    await Promise.all(this.targets.map((pane) => herdr.sendKeys(pane, ['enter']).catch(() => {})));
  }

  // Process one screen sample: diff the input line and mirror the change.
  async apply(visible) {
    const raw = line.lastNonblank(visible);
    const cur = line.extractInput(raw, this.prompt);

    if (cur === this.prevInput) return;

    // Input emptied after having content: either a submit (Enter) or an
    // in-place clear. Tell them apart by whether the old line was committed
    // above; mirror the matching action.
    if (this.prevInput !== '' && cur === '') {
      if (line.wasSubmitted(visible, this.prevRaw)) {
        await this.enterTargets();
      } else {
        await this.backspaceTargets(Array.from(this.prevInput).length);
      }
    } else {
      const [backspaces, toAdd] = line.reconcile(this.prevInput, cur);
      await this.backspaceTargets(backspaces);
      await this.textTargets(toAdd);
    }

    this.prevInput = cur;
    this.prevRaw = raw;
  }

  // Run until the watcher is toggled off or the source pane goes away.
  async run() {
    const interval = Math.max(1, this.config.pollIntervalMs);
    await this.refreshTargets();

    // setTimeout-recursion instead of setInterval: each poll (including its
    // async socket round-trips) fully completes before the next is scheduled,
    // so slow polls never pile up.
    const tick = async () => {
      // The state file is our liveness token; if toggle removed it, stop
      // quietly (toggle owns the "off" notification).
      if (!state.exists(this.tabId)) {
        return;
      }

      try {
        const visible = await herdr.paneReadVisible(this.sourcePane);
        await this.apply(visible);
      } catch {
        // A read failure is only fatal if the pane is truly gone; otherwise
        // treat it as a transient blip and keep polling.
        const stillThere = await herdr.paneExists(this.sourcePane);
        if (!stillThere) {
          state.clear(this.tabId);
          if (this.config.notify) {
            await herdr.notify('Sync input stopped', 'The watched pane was closed.');
          }
          return;
        }
      }

      if (Date.now() - this.lastTargetRefresh >= TARGET_REFRESH_MS) {
        await this.refreshTargets();
      }

      setTimeout(() => {
        tick().catch((e) => {
          process.stderr.write(`sync-input: ${e.message}\n`);
        });
      }, interval);
    };

    await tick();
  }
}

// Entry point for `sync-input.js watch --source <pane> --tab <tab>`.
async function run(sourcePane, tabId, config) {
  await new Watcher(sourcePane, tabId, config).run();
}

module.exports = { run, Watcher };
