//! Plugin configuration, loaded from `config.toml` inside
//! `HERDR_PLUGIN_CONFIG_DIR`.

use std::env;
use std::path::PathBuf;

use serde::Deserialize;

/// Default poll cadence for the output watcher. herdr 0.7.4 exposes no
/// streaming "output changed" event (see `herdr.rs`), so the watcher polls
/// `pane read` on this interval. ~60ms keeps typing feeling live without
/// hammering the socket.
const DEFAULT_POLL_INTERVAL_MS: u64 = 60;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Pane ids that must never receive synchronized input.
    pub ignore_panes: Vec<String>,
    /// Whether to show herdr notifications on start/stop.
    pub notify: bool,
    /// How often (milliseconds) the watcher re-reads the source pane.
    pub poll_interval_ms: u64,
    /// Optional regex matching the shell prompt on the input line. Everything
    /// up to and including the match is treated as prompt and stripped; the
    /// remainder is the typed input we mirror. When unset, a built-in
    /// heuristic (`line::extract_input`) is used instead.
    pub prompt_regex: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            ignore_panes: Vec::new(),
            notify: true,
            poll_interval_ms: DEFAULT_POLL_INTERVAL_MS,
            prompt_regex: None,
        }
    }
}

impl Config {
    /// Path to the config file, if the config dir is known.
    fn path() -> Option<PathBuf> {
        env::var("HERDR_PLUGIN_CONFIG_DIR")
            .ok()
            .map(|dir| PathBuf::from(dir).join("config.toml"))
    }

    /// Load configuration, returning defaults on any error or missing file.
    pub fn load() -> Config {
        let Some(path) = Self::path() else {
            return Config::default();
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Config::default();
        };
        Self::parse(&text)
    }

    /// Parse config text, falling back to defaults on error, and normalize.
    fn parse(text: &str) -> Config {
        let mut cfg: Config = toml::from_str(text).unwrap_or_default();
        cfg.normalize();
        cfg
    }

    /// Fix up values that are valid TOML but not meaningful. An empty or
    /// whitespace-only `prompt_regex` becomes `None`: `Regex::new("")` matches
    /// at offset 0 and would strip nothing, silently disabling the prompt
    /// heuristic — treat it as "unset" so the heuristic runs instead.
    fn normalize(&mut self) {
        if let Some(re) = &self.prompt_regex {
            if re.trim().is_empty() {
                self.prompt_regex = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_prompt_regex_becomes_none() {
        assert_eq!(Config::parse(r#"prompt_regex = """#).prompt_regex, None);
    }

    #[test]
    fn whitespace_prompt_regex_becomes_none() {
        assert_eq!(Config::parse("prompt_regex = \"  \\t \"").prompt_regex, None);
    }

    #[test]
    fn real_prompt_regex_is_kept() {
        assert_eq!(
            Config::parse(r#"prompt_regex = "^\\$ ""#).prompt_regex.as_deref(),
            Some(r"^\$ ")
        );
    }

    #[test]
    fn missing_prompt_regex_is_none() {
        assert_eq!(Config::parse("notify = false").prompt_regex, None);
    }

    #[test]
    fn empty_prompt_regex_falls_through_to_heuristic_stripping() {
        // The bug this guards: `prompt_regex = ""` must NOT be compiled into a
        // `Regex::new("")` (which matches at offset 0 and strips nothing). It
        // normalizes to None, and `extract_input` then uses the heuristic,
        // which correctly strips the prompt instead of mirroring the whole line.
        let cfg = Config::parse(r#"prompt_regex = """#);
        let prompt = cfg
            .prompt_regex
            .as_deref()
            .and_then(|p| regex::Regex::new(p).ok());
        assert!(prompt.is_none());
        assert_eq!(
            crate::line::extract_input("╰─❮ echo hello", prompt.as_ref()),
            "echo hello"
        );
    }
}
