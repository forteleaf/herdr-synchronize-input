# herdr-synchronize-input — synchronized input plugin for herdr

*English · [한국어](README.ko.md)*

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

## License

(project license information)
