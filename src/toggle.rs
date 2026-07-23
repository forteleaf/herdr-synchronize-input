//! The `toggle` action entrypoint. Starts a background output watcher for the
//! focused tab if none is running, otherwise stops the existing one.

use std::io;
use std::process::{Command, Stdio};

use crate::config::Config;
use crate::state::{self, State};
use crate::{herdr, watch};

pub fn run() -> io::Result<()> {
    // The source pane is whichever pane is focused right now; its tab is the
    // tab we synchronize. Deriving both from the live pane list avoids relying
    // on which context env vars an action invocation happens to carry.
    let panes = herdr::pane_list()?;
    let source = panes
        .iter()
        .find(|p| p.focused)
        .ok_or_else(|| io::Error::other("no focused pane to synchronize from"))?;
    let tab_id = source.tab_id.clone();
    let source_pane = source.pane_id.clone();

    let config = Config::load();

    // Toggle OFF: deleting the state file makes the running watcher exit on its
    // next poll (see state.rs / watch.rs).
    if state::exists(&tab_id) {
        state::clear(&tab_id);
        if config.notify {
            herdr::notify("Sync input off", "Stopped mirroring your keystrokes.");
        }
        return Ok(());
    }

    // Toggle ON: record state first (so the freshly spawned watcher sees its
    // liveness token immediately), then spawn the detached daemon and patch in
    // its real pid.
    state::write(&State {
        pid: 0,
        source_pane: source_pane.clone(),
        tab_id: tab_id.clone(),
    });

    let child = spawn_watcher(&source_pane, &tab_id).inspect_err(|_| {
        // Roll back the token if the daemon never launched.
        state::clear(&tab_id);
    })?;

    state::write(&State {
        pid: child,
        source_pane,
        tab_id: tab_id.clone(),
    });

    if config.notify {
        let others = panes.iter().filter(|p| p.tab_id == tab_id).count().saturating_sub(1);
        herdr::notify(
            "Sync input on",
            &format!("Mirroring your keystrokes to {others} pane(s) in this tab."),
        );
    }
    Ok(())
}

/// Spawn `sync-input watch` as a detached background process and return its
/// pid. Stdio is detached to /dev/null so the daemon outlives this short-lived
/// action process.
fn spawn_watcher(source_pane: &str, tab_id: &str) -> io::Result<u32> {
    let exe = std::env::current_exe()?;
    let child = Command::new(exe)
        .arg("watch")
        .arg("--source")
        .arg(source_pane)
        .arg("--tab")
        .arg(tab_id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(child.id())
}

/// Parse `watch` arguments: `--source <pane> --tab <tab>`.
pub fn parse_watch_args(args: &[String]) -> io::Result<(String, String)> {
    let mut source = None;
    let mut tab = None;
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--source" => source = it.next().cloned(),
            "--tab" => tab = it.next().cloned(),
            other => return Err(io::Error::other(format!("watch: unexpected argument {other:?}"))),
        }
    }
    match (source, tab) {
        (Some(s), Some(t)) => Ok((s, t)),
        _ => Err(io::Error::other("watch: --source and --tab are required")),
    }
}

/// Run the watcher from parsed CLI args.
pub fn run_watch(args: &[String]) -> io::Result<()> {
    let (source, tab) = parse_watch_args(args)?;
    watch::run(source, tab, Config::load())
}
