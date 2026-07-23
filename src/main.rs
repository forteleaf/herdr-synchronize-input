//! sync-input — a herdr plugin that mirrors what you type in the focused pane
//! to every other pane in the same tab, by watching the focused pane's output
//! (an output-watching reimagining of tmux `synchronize-panes`).
//!
//! Subcommands:
//!   * `toggle` — action entrypoint; starts or stops the background watcher for
//!     the focused tab.
//!   * `watch`  — the watcher daemon, spawned detached by `toggle`. Takes
//!     `--source <pane_id> --tab <tab_id>`.
//!   * `ensure-keybinding` — startup-hook entrypoint; idempotently adds the
//!     toggle shortcut to the user's herdr config.toml.

mod config;
mod herdr;
mod keybinding;
mod line;
mod state;
mod toggle;
mod watch;

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or_default();

    let result = match cmd {
        "toggle" => toggle::run(),
        "watch" => toggle::run_watch(&args[1..]),
        "ensure-keybinding" => keybinding::ensure(),
        other => {
            eprintln!(
                "sync-input: unknown subcommand {other:?} (expected `toggle`, `watch`, or `ensure-keybinding`)"
            );
            return ExitCode::from(2);
        }
    };

    if let Err(e) = result {
        eprintln!("sync-input: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
