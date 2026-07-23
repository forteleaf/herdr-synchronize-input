//! Per-tab watcher state, stored as a small JSON file under
//! `HERDR_PLUGIN_STATE_DIR`.
//!
//! The state file doubles as the watcher's liveness token: its presence means
//! "a watcher is active for this tab", and `toggle` stops the watcher simply by
//! deleting it. The watcher polls for its own file every loop and exits when it
//! disappears (see `watch.rs`). This keeps shutdown signal-free and dependency
//! free — no `kill(2)`, no `libc`. The recorded `pid` is kept only for
//! diagnostics.

use std::env;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    /// PID of the detached `watch` daemon (diagnostics only).
    pub pid: u32,
    /// The pane being watched (the pane focused at toggle time).
    pub source_pane: String,
    /// The tab this watcher belongs to.
    pub tab_id: String,
}

/// Path to the state file for a given tab, if the state dir is known.
fn path(tab_id: &str) -> Option<PathBuf> {
    let dir = env::var("HERDR_PLUGIN_STATE_DIR").ok()?;
    let safe: String = tab_id
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    Some(PathBuf::from(dir).join(format!("watch-{safe}.json")))
}

/// Record (or overwrite) the watcher state for a tab.
pub fn write(state: &State) {
    if let Some(path) = path(&state.tab_id)
        && let Ok(json) = serde_json::to_string(state)
    {
        let _ = std::fs::write(path, json);
    }
}

/// Whether a watcher is currently recorded as active for a tab.
pub fn exists(tab_id: &str) -> bool {
    path(tab_id).map(|p| p.exists()).unwrap_or(false)
}

/// Remove the state file for a tab (stops the watcher on its next poll).
pub fn clear(tab_id: &str) {
    if let Some(path) = path(tab_id) {
        let _ = std::fs::remove_file(path);
    }
}
