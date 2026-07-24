'use strict';

/**
 * Pure text helpers for turning a pane's visible screen into the user's
 * current input, and for computing how to make a target pane's input match.
 *
 * These are the fiddliest, most failure-prone parts of the plugin, so they
 * live here as pure functions with unit tests, isolated from all I/O.
 *
 * Ported 1:1 from src/line.rs (the verified Rust reference).
 */

// Prompt terminators tried, longest/most-specific first, when no
// `prompt_regex` is configured. Each is a common shell prompt glyph followed
// by the separating space; input is whatever follows the last occurrence.
const TERMINATORS = ['❯ ', '❮ ', '➜ ', '$ ', '# ', '% ', '> '];

// Bare prompt glyphs. When the input is empty the trailing space is often
// trimmed away (e.g. fish renders `╰─❮`), so a line ending in one of these
// means "prompt, no input yet".
const BARE_GLYPHS = ['❯', '❮', '➜', '$', '#', '%', '>'];

// Split like Rust's `str::lines()`: split on `\n`, stripping a trailing `\r`
// from each line, without adding a phantom trailing empty entry for a single
// trailing newline (a trailing empty entry from a *second* newline is kept,
// matching Rust's behavior).
function splitLines(text) {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

// The last non-blank line of the visible screen — where the shell draws the
// prompt and the line being edited.
function lastNonblank(text) {
  const lines = splitLines(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') return lines[i];
  }
  return '';
}

// Extract the typed input from the prompt line.
//
// With a `prompt` RegExp, everything up to and including the first match is
// stripped. Without one, the built-in heuristic strips through the last
// prompt terminator; failing that, a bare trailing prompt glyph means empty
// input; failing that, the whole line is returned (we could not find a
// prompt, so mirroring the raw line is the least-surprising fallback).
function extractInput(line, prompt) {
  if (prompt) {
    prompt.lastIndex = 0;
    const m = prompt.exec(line);
    if (m) {
      return line.slice(m.index + m[0].length);
    }
    return line;
  }

  let cut = null;
  for (const term of TERMINATORS) {
    const i = line.lastIndexOf(term);
    if (i !== -1) {
      const end = i + term.length;
      cut = cut === null ? end : Math.max(cut, end);
    }
  }
  if (cut !== null) {
    return line.slice(cut);
  }

  // Codepoint-safe: a multibyte (e.g. Korean) trailing char must not be
  // mistaken for a bare glyph, and must not be split mid-codepoint.
  const chars = Array.from(line);
  const last = chars[chars.length - 1];
  if (last !== undefined && BARE_GLYPHS.includes(last)) {
    return '';
  }
  return line;
}

// How to turn `prev` into `cur`: the number of backspaces to send, then the
// text to append. Works on codepoints (not UTF-16 code units or bytes) so
// multibyte input (Korean, emoji, ...) is counted correctly, and reconciles
// from the longest common prefix so mid-line edits collapse to a
// delete-tail + retype-tail.
function reconcile(prev, cur) {
  const prevChars = Array.from(prev);
  const curChars = Array.from(cur);

  let common = 0;
  while (common < prevChars.length && common < curChars.length && prevChars[common] === curChars[common]) {
    common++;
  }

  const backspaces = prevChars.length - common;
  const toAdd = curChars.slice(common).join('');
  return [backspaces, toAdd];
}

// Whether `line` (a full input line, e.g. `╰─❮ true xyz`) appears in the
// visible screen somewhere ABOVE the last line. After Enter, the shell leaves
// the just-submitted command on a line above the fresh prompt; that is how we
// tell a submit apart from an in-place clear (ctrl+u), which leaves no such
// trace.
function wasSubmitted(visible, prevRawLine) {
  if (prevRawLine.trim() === '') return false;

  const lines = splitLines(visible);
  let i = lines.length - 1;
  // Skip trailing blank lines.
  while (i >= 0 && lines[i].trim() === '') i--;
  // Skip the current last non-blank line itself (the fresh prompt).
  i--;
  for (; i >= 0; i--) {
    if (lines[i] === prevRawLine) return true;
  }
  return false;
}

module.exports = {
  TERMINATORS,
  BARE_GLYPHS,
  lastNonblank,
  extractInput,
  reconcile,
  wasSubmitted,
};
