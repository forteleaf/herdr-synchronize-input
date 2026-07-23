//! `ensure-keybinding` subcommand, run by the plugin's `[[startup]]` hook.
//!
//! herdr 0.7.4 has no way to register a keybinding from a manifest and no CLI
//! to add one, so on session restore we make sure the toggle shortcut exists in
//! the user's herdr `config.toml`. This is idempotent: if an *active* binding
//! for our action is already present we do nothing, and we never touch a config
//! we cannot parse. The original file is backed up before it is modified.

use std::io;
use std::path::PathBuf;

/// The plugin action a binding must invoke to count as "already installed".
const ACTION: &str = "herdr-synchronize-input.toggle";
/// Default shortcut. `prefix` is whatever the user set as their herdr prefix.
const DEFAULT_KEY: &str = "prefix+shift+y";

/// The block we append. The marker comment makes it easy to find and remove.
const BLOCK: &str = "\n# Added by herdr-synchronize-input. Remove this block to unbind the shortcut.\n\
[[keys.command]]\n\
key = \"prefix+shift+y\"\n\
type = \"plugin_action\"\n\
command = \"herdr-synchronize-input.toggle\"\n\
description = \"synchronize input to all panes\"\n";

/// Locate the herdr config file: `$XDG_CONFIG_HOME/herdr/config.toml` if
/// `XDG_CONFIG_HOME` is set, otherwise `$HOME/.config/herdr/config.toml`.
fn config_path() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME")
        && !xdg.is_empty()
    {
        return Some(PathBuf::from(xdg).join("herdr").join("config.toml"));
    }
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".config").join("herdr").join("config.toml"))
}

/// Whether an *active* (non-commented) `[[keys.command]]` entry already binds
/// our action. Parsing as TOML ignores comments, so a commented-out block does
/// not count — we still want to add a live one.
fn has_active_binding(text: &str) -> bool {
    let Ok(table) = text.parse::<toml::Table>() else {
        return false;
    };
    table
        .get("keys")
        .and_then(|keys| keys.get("command"))
        .and_then(|cmd| cmd.as_array())
        .is_some_and(|entries| {
            entries
                .iter()
                .any(|e| e.get("command").and_then(toml::Value::as_str) == Some(ACTION))
        })
}

/// Marker recording that we have already done our one-time keybinding install,
/// stored in `HERDR_PLUGIN_STATE_DIR`. Once present we never touch the config
/// again, so a user who later removes or changes the binding keeps their choice
/// instead of having it re-added on every session restore.
fn marker_path() -> Option<PathBuf> {
    std::env::var("HERDR_PLUGIN_STATE_DIR")
        .ok()
        .map(|dir| PathBuf::from(dir).join("keybinding-installed"))
}

/// Ensure the toggle keybinding exists in the user's herdr config, exactly
/// once. The marker is written only after a successful install (or when a
/// binding was already present), so transient failures (missing HOME,
/// unparseable config) are retried on the next startup.
pub fn ensure() -> io::Result<()> {
    let marker = marker_path();
    if marker.as_ref().is_some_and(|m| m.exists()) {
        return Ok(()); // one-time install already done; respect the user's config
    }

    let installed = install()?;
    if installed
        && let Some(m) = marker
        && let Some(parent) = m.parent()
    {
        std::fs::create_dir_all(parent)?;
        let _ = std::fs::write(&m, b"1");
    }
    Ok(())
}

/// Perform the one-time install. Returns `true` when the binding is now in
/// place (added by us or already present), `false` when we deliberately did
/// nothing and want to retry later (no HOME, unparseable config).
fn install() -> io::Result<bool> {
    let Some(path) = config_path() else {
        eprintln!(
            "herdr-synchronize-input: cannot locate herdr config.toml (no HOME); skipping keybinding install"
        );
        return Ok(false);
    };

    match std::fs::read_to_string(&path) {
        Ok(text) => {
            // Never risk corrupting a config we cannot understand.
            if text.parse::<toml::Table>().is_err() {
                eprintln!(
                    "herdr-synchronize-input: {} is not valid TOML; leaving it untouched",
                    path.display()
                );
                return Ok(false);
            }
            if has_active_binding(&text) {
                return Ok(true); // already installed — nothing to do
            }
            let backup = path.with_extension("toml.bak");
            std::fs::copy(&path, &backup)?;
            let mut updated = text;
            if !updated.ends_with('\n') {
                updated.push('\n');
            }
            updated.push_str(BLOCK);
            std::fs::write(&path, updated)?;
            eprintln!(
                "herdr-synchronize-input: added `{DEFAULT_KEY}` -> {ACTION} to {} (backup: {}). Re-attach herdr to apply.",
                path.display(),
                backup.display()
            );
            Ok(true)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, BLOCK.trim_start_matches('\n'))?;
            eprintln!(
                "herdr-synchronize-input: created {} with the keybinding. Re-attach herdr to apply.",
                path.display()
            );
            Ok(true)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_binding_is_detected() {
        let text = r#"
[[keys.command]]
key = "prefix+shift+y"
type = "plugin_action"
command = "herdr-synchronize-input.toggle"
description = "synchronize input to all panes"
"#;
        assert!(has_active_binding(text));
    }

    #[test]
    fn commented_binding_does_not_count() {
        // A commented-out block must NOT be treated as installed, so the hook
        // still adds a live binding.
        let text = "# [[keys.command]]\n\
# key = \"prefix+shift+y\"\n\
# command = \"herdr-synchronize-input.toggle\"\n";
        assert!(!has_active_binding(text));
    }

    #[test]
    fn absent_binding_is_false() {
        let text = r#"
prefix = "ctrl+q"

[[keys.command]]
key = "prefix+g"
type = "popup"
command = "lazygit"
"#;
        assert!(!has_active_binding(text));
    }

    #[test]
    fn our_action_among_other_bindings_is_detected() {
        let text = r#"
[[keys.command]]
key = "prefix+g"
type = "popup"
command = "lazygit"

[[keys.command]]
key = "prefix+shift+y"
type = "plugin_action"
command = "herdr-synchronize-input.toggle"
"#;
        assert!(has_active_binding(text));
    }
}
