//! Pure text helpers for turning a pane's visible screen into the user's
//! current input, and for computing how to make a target pane's input match.
//!
//! These are the fiddliest, most failure-prone parts of the plugin, so they
//! live here as pure functions with unit tests, isolated from all I/O.

use regex::Regex;

/// Prompt terminators tried, longest/most-specific first, when no
/// `prompt_regex` is configured. Each is a common shell prompt glyph followed
/// by the separating space; input is whatever follows the last occurrence.
const TERMINATORS: &[&str] = &["❯ ", "❮ ", "➜ ", "$ ", "# ", "% ", "> "];

/// Bare prompt glyphs. When the input is empty the trailing space is often
/// trimmed away (e.g. fish renders `╰─❮`), so a line ending in one of these
/// means "prompt, no input yet".
const BARE_GLYPHS: &[char] = &['❯', '❮', '➜', '$', '#', '%', '>'];

/// The last non-blank line of the visible screen — where the shell draws the
/// prompt and the line being edited.
pub fn last_nonblank(text: &str) -> &str {
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
}

/// Extract the typed input from the prompt line.
///
/// With a `prompt` regex, everything up to and including the first match is
/// stripped. Without one, the built-in heuristic strips through the last
/// prompt terminator; failing that, a bare trailing prompt glyph means empty
/// input; failing that, the whole line is returned (we could not find a
/// prompt, so mirroring the raw line is the least-surprising fallback).
pub fn extract_input(line: &str, prompt: Option<&Regex>) -> String {
    if let Some(re) = prompt {
        return match re.find(line) {
            Some(m) => line[m.end()..].to_string(),
            None => line.to_string(),
        };
    }

    let mut cut: Option<usize> = None;
    for term in TERMINATORS {
        if let Some(i) = line.rfind(term) {
            let end = i + term.len();
            cut = Some(cut.map_or(end, |c| c.max(end)));
        }
    }
    if let Some(end) = cut {
        return line[end..].to_string();
    }

    if line.chars().next_back().is_some_and(|c| BARE_GLYPHS.contains(&c)) {
        return String::new();
    }
    line.to_string()
}

/// How to turn `prev` into `cur`: the number of backspaces to send, then the
/// text to append. Works on characters (not bytes) so multibyte input is
/// counted correctly, and reconciles from the longest common prefix so
/// mid-line edits collapse to a delete-tail + retype-tail.
pub fn reconcile(prev: &str, cur: &str) -> (usize, String) {
    let prev: Vec<char> = prev.chars().collect();
    let cur: Vec<char> = cur.chars().collect();

    let mut common = 0;
    while common < prev.len() && common < cur.len() && prev[common] == cur[common] {
        common += 1;
    }

    let backspaces = prev.len() - common;
    let to_add: String = cur[common..].iter().collect();
    (backspaces, to_add)
}

/// Whether `line` (a full input line, e.g. `╰─❮ true xyz`) appears in the
/// visible screen somewhere ABOVE the last line. After Enter, the shell leaves
/// the just-submitted command on a line above the fresh prompt; that is how we
/// tell a submit apart from an in-place clear (ctrl+u), which leaves no such
/// trace.
pub fn was_submitted(visible: &str, prev_raw_line: &str) -> bool {
    if prev_raw_line.trim().is_empty() {
        return false;
    }
    // Skip the current last non-blank line, look for the committed copy above.
    visible
        .lines()
        .rev()
        .skip_while(|l| l.trim().is_empty())
        .skip(1)
        .any(|l| l == prev_raw_line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn re(p: &str) -> Regex {
        Regex::new(p).unwrap()
    }

    #[test]
    fn last_nonblank_skips_trailing_blanks() {
        assert_eq!(last_nonblank("a\nb\n\n  \n"), "b");
        assert_eq!(last_nonblank(""), "");
    }

    #[test]
    fn extract_with_fish_prompt_glyph() {
        assert_eq!(extract_input("╰─❮ echo hello", None), "echo hello");
    }

    #[test]
    fn extract_empty_input_bare_glyph() {
        assert_eq!(extract_input("╰─❮", None), "");
    }

    #[test]
    fn extract_dollar_prompt() {
        assert_eq!(extract_input("user@host:~$ ls -la", None), "ls -la");
    }

    #[test]
    fn extract_uses_last_terminator() {
        // A `$` inside the typed text must not fool us: the prompt terminator
        // is the last one, so input after it wins.
        assert_eq!(extract_input("~ ❯ echo $HOME", None), "echo $HOME");
    }

    #[test]
    fn extract_with_regex_override() {
        let p = re(r"^\[.*\]\$ ");
        assert_eq!(extract_input("[me@box ~]$ whoami", Some(&p)), "whoami");
    }

    #[test]
    fn extract_regex_no_match_returns_line() {
        let p = re(r"^ZZZ");
        assert_eq!(extract_input("nope", Some(&p)), "nope");
    }

    #[test]
    fn reconcile_pure_append() {
        assert_eq!(reconcile("ls", "ls -la"), (0, " -la".to_string()));
    }

    #[test]
    fn reconcile_pure_backspace() {
        assert_eq!(reconcile("ls -la", "ls"), (4, String::new()));
    }

    #[test]
    fn reconcile_midline_edit() {
        // "cat a" -> "cat b": one backspace, retype "b".
        assert_eq!(reconcile("cat a", "cat b"), (1, "b".to_string()));
    }

    #[test]
    fn reconcile_multibyte() {
        // Counts characters, not bytes.
        assert_eq!(reconcile("café", "café latte"), (0, " latte".to_string()));
        assert_eq!(reconcile("café", "caf"), (1, String::new()));
    }

    #[test]
    fn submitted_detected_when_command_above() {
        let visible = "╰─❮ true xyz\n╭─ prompt\n╰─❮";
        assert!(was_submitted(visible, "╰─❮ true xyz"));
    }

    #[test]
    fn submitted_false_when_cleared_in_place() {
        let visible = "some earlier output\n╭─ prompt\n╰─❮";
        assert!(!was_submitted(visible, "╰─❮ true xyz"));
    }
}
