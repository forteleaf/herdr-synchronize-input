//! The watcher daemon. Spawned detached by `toggle`, it polls the source
//! pane's visible output and mirrors changes to the input line onto every
//! other pane in the same tab.
//!
//! Why polling: herdr 0.7.4 offers no streaming output-changed event (see the
//! module docs in `herdr.rs`), so this is the only path. The cadence is
//! `config.poll_interval_ms` (~60ms default).
//!
//! Known limits (inherent to watching stripped screen text):
//!   * Shell autosuggestions (e.g. fish's greyed history hint) look identical
//!     to typed text once ANSI colour is stripped, so they get mirrored too.
//!   * Passwords (no echo), multi-line editors, and completion menus will not
//!     mirror cleanly.
//!   * Only text, backspace, submit (Enter), and in-place clear are handled;
//!     cursor movement and control keys are not.

use std::io;
use std::thread::sleep;
use std::time::{Duration, Instant};

use regex::Regex;

use crate::config::Config;
use crate::line;
use crate::{herdr, state};

/// How often to re-scan the tab for target panes (panes may open/close while
/// the watcher runs).
const TARGET_REFRESH: Duration = Duration::from_secs(1);

struct Watcher {
    source_pane: String,
    tab_id: String,
    config: Config,
    prompt: Option<Regex>,
    targets: Vec<String>,
    last_target_refresh: Instant,
    /// Last known typed input on the source line.
    prev_input: String,
    /// Last known full source line (prompt + input), for submit detection.
    prev_raw: String,
}

impl Watcher {
    fn new(source_pane: String, tab_id: String, config: Config) -> Self {
        // A bad prompt_regex should not kill the watcher: warn and fall back to
        // the heuristic. (stderr is /dev/null when detached, but honest.)
        let prompt = config.prompt_regex.as_deref().and_then(|p| match Regex::new(p) {
            Ok(re) => Some(re),
            Err(e) => {
                eprintln!("sync-input: invalid prompt_regex {p:?}: {e}; using heuristic");
                None
            }
        });

        let mut w = Watcher {
            source_pane,
            tab_id,
            config,
            prompt,
            targets: Vec::new(),
            last_target_refresh: Instant::now(),
            prev_input: String::new(),
            prev_raw: String::new(),
        };
        w.refresh_targets();
        w
    }

    /// Rebuild the target list: other panes in the same tab, minus the source
    /// and any ignored panes.
    fn refresh_targets(&mut self) {
        if let Ok(panes) = herdr::pane_list() {
            self.targets = panes
                .into_iter()
                .filter(|p| p.tab_id == self.tab_id)
                .filter(|p| p.pane_id != self.source_pane)
                .filter(|p| !self.config.ignore_panes.contains(&p.pane_id))
                .map(|p| p.pane_id)
                .collect();
        }
        self.last_target_refresh = Instant::now();
    }

    fn backspace_targets(&self, n: usize) {
        if n == 0 {
            return;
        }
        let keys = vec!["backspace"; n];
        for pane in &self.targets {
            let _ = herdr::send_keys(pane, &keys);
        }
    }

    fn text_targets(&self, text: &str) {
        if text.is_empty() {
            return;
        }
        for pane in &self.targets {
            let _ = herdr::send_text(pane, text);
        }
    }

    fn enter_targets(&self) {
        for pane in &self.targets {
            let _ = herdr::send_keys(pane, &["enter"]);
        }
    }

    /// Process one screen sample: diff the input line and mirror the change.
    fn apply(&mut self, visible: &str) {
        let raw = line::last_nonblank(visible).to_string();
        let cur = line::extract_input(&raw, self.prompt.as_ref());

        if cur == self.prev_input {
            return;
        }

        // Input emptied after having content: either a submit (Enter) or an
        // in-place clear. Tell them apart by whether the old line was committed
        // above; mirror the matching action.
        if !self.prev_input.is_empty() && cur.is_empty() {
            if line::was_submitted(visible, &self.prev_raw) {
                self.enter_targets();
            } else {
                self.backspace_targets(self.prev_input.chars().count());
            }
        } else {
            let (backspaces, to_add) = line::reconcile(&self.prev_input, &cur);
            self.backspace_targets(backspaces);
            self.text_targets(&to_add);
        }

        self.prev_input = cur;
        self.prev_raw = raw;
    }

    /// Run until the watcher is toggled off or the source pane goes away.
    fn run(&mut self) -> io::Result<()> {
        let interval = Duration::from_millis(self.config.poll_interval_ms.max(1));

        loop {
            // The state file is our liveness token; if toggle removed it, stop
            // quietly (toggle owns the "off" notification).
            if !state::exists(&self.tab_id) {
                return Ok(());
            }

            match herdr::pane_read_visible(&self.source_pane) {
                Ok(visible) => self.apply(&visible),
                Err(_) => {
                    // A read failure is only fatal if the pane is truly gone;
                    // otherwise treat it as a transient blip and keep polling.
                    if !herdr::pane_exists(&self.source_pane) {
                        state::clear(&self.tab_id);
                        if self.config.notify {
                            herdr::notify("Sync input stopped", "The watched pane was closed.");
                        }
                        return Ok(());
                    }
                }
            }

            if self.last_target_refresh.elapsed() >= TARGET_REFRESH {
                self.refresh_targets();
            }

            sleep(interval);
        }
    }
}

/// Entry point for `sync-input watch --source <pane> --tab <tab>`.
pub fn run(source_pane: String, tab_id: String, config: Config) -> io::Result<()> {
    Watcher::new(source_pane, tab_id, config).run()
}
