# herdr-synchronize-input — synchronized input plugin for herdr

*English · [한국어](README.ko.md)*

> **⚠️ Status: ABANDONED.** This plugin does not work reliably and is no longer
> maintained. It cannot reach "works correctly" because of a hard limitation in
> herdr's plugin API (see the failure log below). Kept only as a record.

## Failure log (post-mortem)

**Goal:** replicate tmux `synchronize-panes` — type in one pane and have it
mirror live to the other panes in the tab.

**Why it can't work:** herdr's plugin/socket API (0.7.4) exposes **no key-input
hook** and **no output-changed event**. tmux duplicates keystrokes at the
source; herdr cannot. All a plugin can do is **poll and diff the visible screen
text** and re-send it — a heuristic, not real input capture.

**What that heuristic can't handle (tried and confirmed broken):**

- **Control keys** (Ctrl+C/L/D, arrows, Esc, Tab): leave no trace on the input
  line, so they can't be detected. The workaround was one explicit key binding
  per key — clunky, and hijacking hot keys spawns a Node process per press.
- **Shell autosuggestions** (fish/zsh grey hints): once ANSI colour is stripped
  they look identical to typed text, so they get mirrored as real input — wrong
  commands land in the other panes.
- **No-echo input** (passwords), **multi-line commands**, completion menus, and
  interactive apps (vim/less/REPLs) do not mirror.
- **Prompt detection** is a guess; unusual prompts need a hand-written regex.
- **Nested tmux over SSH:** the `ctrl+b` prefix can be broadcast, but the tmux
  command key pressed *after* it is consumed by tmux and never echoed, so it
  cannot be mirrored.

**herdr operational quirks also got in the way:**

- Startup hooks do not fire on install/link/reload — only on session restore.
- Locally-linked *and* installed plugins vanished from the registry after a live
  handoff.
- There is no way to auto-register a keybinding; the user must edit
  `config.toml` by hand.

**Conclusion:** output-watching is a dead end for correct input synchronization.
Reliable multi-pane input would require a real key-input hook / broadcast
feature in herdr itself (upstream), or using tmux. **Project abandoned.**

The documentation below describes the (partially working) implementation as it
stood, for reference only.

---

## Overview

`herdr-synchronize-input` is a plugin for the herdr terminal multiplexer that provides functionality similar to tmux's `synchronize-panes`. When you type directly into the focused (active) pane, your input is mirrored in real time to every other pane in the same tab.

**How it works**: the plugin watches the focused pane's screen output, detects changes on the input line, and sends the delta to the other panes with `herdr pane send-text`.

## Requirements

- herdr 0.7.4 or newer
- **Node.js on your PATH** — herdr does not install it for you. There is no build/compile step and no npm dependencies.

> The plugin **id** is `herdr-synchronize-input` (same as the GitHub repository name). This id is used by `herdr plugin config-dir`, the keybinding, and so on.

## Installation

### Option A — install from GitHub (recommended)

```bash
herdr plugin install forteleaf/herdr-synchronize-input
```

herdr clones the repository and registers the plugin directly — there is no build step. You just need Node.js on your PATH.

### Option B — link a local checkout (for development)

```bash
herdr plugin link "$(pwd)"     # run from the plugin directory (where herdr-plugin.toml lives)
```

### Create the config file (both options)

Copy `config.toml` into the plugin's config directory:

```bash
cp config.example.toml "$(herdr plugin config-dir herdr-synchronize-input)/config.toml"
```

You can find the config directory with:

```bash
herdr plugin config-dir herdr-synchronize-input
```

## Keybinding (manual setup required)

herdr has no way to register a keybinding from a manifest, so you need to add
one yourself. Add the following block to your herdr config
(`~/.config/herdr/config.toml`):

```toml
[[keys.command]]
key = "prefix+shift+y"
type = "plugin_action"
command = "herdr-synchronize-input.toggle"
description = "synchronize input to all panes"
```

`prefix` is `Ctrl-b` by default (whatever you set as your herdr prefix), so
`prefix Shift-y` toggles synchronization. Change `key` to bind a different
shortcut.

**Re-attach herdr** after adding the block for it to take effect.

## Broadcasting control keys (Ctrl+L, Ctrl+C, …)

Text sync mirrors typed characters, but it cannot mirror control keys (Ctrl+L,
Ctrl+C, arrows, …): they leave no trace on the input line and herdr has no
key-input hook. For those the plugin ships explicit **broadcast actions** you
bind to keys:

| Action | Sends |
|---|---|
| `herdr-synchronize-input.send-ctrl-l` | Ctrl+L (clear screen) |
| `herdr-synchronize-input.send-ctrl-c` | Ctrl+C (interrupt) |
| `herdr-synchronize-input.send-ctrl-d` | Ctrl+D (EOF) |
| `herdr-synchronize-input.send-ctrl-w` | Ctrl+W (delete word) |
| `herdr-synchronize-input.send-ctrl-b` | Ctrl+B (e.g. tmux prefix) |

Each action is **sync-aware**: when sync is ON it broadcasts the key to every
pane in the focused tab (ignored panes excluded); when sync is OFF it sends only
to the focused pane — so binding directly over the real key stays safe.

Bind the ones you want in `~/.config/herdr/config.toml`. Two styles:

```toml
# Dedicated shortcut (recommended) — leaves the real Ctrl+L alone:
[[keys.command]]
key = "prefix+ctrl+l"
type = "plugin_action"
command = "herdr-synchronize-input.send-ctrl-l"
description = "clear all panes"

# Or bind directly over the real key (matches habit; when sync is off it just
# passes through to the focused pane):
[[keys.command]]
key = "ctrl+l"
type = "plugin_action"
command = "herdr-synchronize-input.send-ctrl-l"
description = "clear all panes when synced"
```

To broadcast a different key, copy an action in `herdr-plugin.toml` with any
herdr key name (e.g. `ctrl+a`, `up`). Note each bound key spawns a short-lived
Node process per press, so avoid binding keys you hammer constantly.

### Controlling nested tmux (partial)

If your panes are SSH'd into servers running tmux, binding `ctrl+b` to
`send-ctrl-b` broadcasts the tmux prefix to every pane, so all sessions enter
prefix mode at once. **But the key you press _after_ the prefix** (the tmux
command — `c`, `n`, an arrow, …) is consumed by tmux and never echoed to the
shell, so the text watcher cannot see or broadcast it. Fully driving remote
tmux would require binding each of those keys as its own broadcast action. So
this covers the prefix and individual control keys — not arbitrary
prefix-then-key sequences.

## Usage

### Enable / disable synchronization

Press `prefix+shift+y` (e.g. `Ctrl-b Shift-y`) to toggle synchronization.

- **First press**: synchronization on — typing in the focused pane of the focused tab is mirrored to the other panes.
- **Second press**: synchronization off.

### What gets mirrored

While synchronization is on:

1. Type text in the focused pane.
2. Each character is sent to the other panes in the same tab in real time.
3. Pressing `Enter` sends a newline to the other panes too, so the command runs in every pane at once.
4. Characters deleted with `Backspace` are mirrored as well (computed after stripping the prompt).

## Configuration

Fields in the config file (`$(herdr plugin config-dir herdr-synchronize-input)/config.toml`):

### `ignore_panes`

A list of pane IDs to exclude from synchronization, e.g. `["w0:p1", "w1:p3"]`.

Find pane IDs with `herdr pane list`:

```bash
herdr pane list
```

**Default**: `[]` (all panes included)

**Example**:
```toml
ignore_panes = ["w0:p1"]  # exclude workspace 0, pane 1
```

### `notify`

Whether to show a herdr notification when synchronization is toggled. `true` or `false`.

**Default**: `true`

```toml
notify = true
```

### `poll_interval_ms`

How often (in milliseconds) the plugin re-reads the focused pane's screen output. Lower values feel more responsive but use more CPU.

**Default**: `60` (0.06s)

**Range**: 50–500ms recommended

```toml
poll_interval_ms = 60
```

### `prompt_regex`

An optional regular expression that matches the shell prompt on the input line. The matched portion (e.g. `user@host:~$`) is treated as prompt, not as typed input.

Set this if prompt stripping does not work correctly with your prompt.

**Default**: unset (no regex; the built-in heuristic is used)

**Examples**:
```toml
# bash-style prompt: "user@host:~$ "
prompt_regex = "^[^@]+@[^ ]+:[^$]*\\$ $"

# zsh-style prompt: "user@host ~$ "
prompt_regex = "^[^@]+@[^ ]+.*\\$ $"

# simple $ prompt
prompt_regex = "^\\$ $"
```

## Limitations

**Important**: because of constraints in herdr's plugin API, this plugin has the following limitations.

### Why

herdr's plugin API **does not provide a key-input event hook**. tmux can duplicate keystrokes at the source, but herdr cannot. So this plugin **watches the focused pane's screen output**, detects changes on the input line, and imitates them on the other panes.

### What works

- ✅ Ordinary text input (Latin, CJK, symbols)
- ✅ Deletion with `Backspace`
- ✅ Running a command with `Enter`

### What does not work

- ❌ **Special/control keys**: `Ctrl-C`, `Ctrl-D`, `Ctrl-Z`, arrow keys (`←`, `→`, `↑`, `↓`), `Esc`, `Tab`, etc. are not sent to the other panes.
- ❌ **Password input**: passwords are usually not echoed, so they cannot be watched.
- ⚠️ **Shell autosuggestions & syntax highlighting**: `zsh` syntax highlighting is not synchronized. `bash`/`fish` autosuggestions may be mirrored incorrectly.
- ❌ **Multi-line commands**: multi-line input (e.g. heredocs) may become misaligned.
- ❌ **Complex shell interactions**: interactive programs (`vim`, `less`, the `python` REPL, etc.) are not supported.

### When to use it

- Running the same command across several servers
- Entering the same file path in multiple panes
- Running simple scripts or command-line tasks in several panes at once

### When not to use it

- Tasks that require exact input synchronization (e.g. passwords, sensitive settings)
- Controlling interactive programs
- When you rely on complex shell autocompletion or syntax highlighting

## Troubleshooting

### Synchronization does not work

**Symptom**: you type, but nothing appears in the other panes.

**Fixes**:

1. Confirm synchronization is on. Pressing `prefix+shift+y` shows a herdr notification (when `notify = true`).

2. Confirm the keybinding is registered. The [keybinding block](#keybinding-manual-setup-required) should be present in `~/.config/herdr/config.toml`, and you must re-attach the herdr server after it is added.

3. Confirm the correct pane is focused. The pane with the highlighted border is focused.

4. Confirm the other panes are in the same tab. Synchronization only applies within the same tab.

5. Confirm the prompt is recognized correctly:
   - With only the prompt showing (no input), type a single character in the focused pane.
   - If it does not appear in the other panes, prompt detection may be failing.
   - In that case, set `prompt_regex` in `config.toml` to define the prompt explicitly.

### Exclude specific panes

Set `ignore_panes` in `config.toml`:

```toml
ignore_panes = ["w0:p2", "w0:p3"]
```

Find pane IDs with `herdr pane list`.

### High CPU usage

Increase the poll interval. Raise `poll_interval_ms` in `config.toml`:

```toml
poll_interval_ms = 200  # increase from the default 60 to 200
```

Tune it against the responsiveness / CPU trade-off.

## Reference

- `herdr pane list`: list all panes in the workspace
- `herdr tab list`: list tabs in the current workspace
- `herdr pane read <id>`: read the screen content of a pane
- `herdr notification show <title>`: show a herdr notification
