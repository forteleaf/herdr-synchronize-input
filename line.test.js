'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { lastNonblank, extractInput, reconcile, wasSubmitted } = require('./line');

// Ported 1:1 from src/line.rs's `#[cfg(test)] mod tests`.

test('last_nonblank_skips_trailing_blanks', () => {
  assert.equal(lastNonblank('a\nb\n\n  \n'), 'b');
  assert.equal(lastNonblank(''), '');
});

test('extract_with_fish_prompt_glyph', () => {
  assert.equal(extractInput('╰─❮ echo hello', null), 'echo hello');
});

test('extract_empty_input_bare_glyph', () => {
  assert.equal(extractInput('╰─❮', null), '');
});

test('extract_dollar_prompt', () => {
  assert.equal(extractInput('user@host:~$ ls -la', null), 'ls -la');
});

test('extract_uses_last_terminator', () => {
  // A `$` inside the typed text must not fool us: the prompt terminator is
  // the last one, so input after it wins.
  assert.equal(extractInput('~ ❯ echo $HOME', null), 'echo $HOME');
});

test('extract_with_regex_override', () => {
  const p = /^\[.*\]\$ /;
  assert.equal(extractInput('[me@box ~]$ whoami', p), 'whoami');
});

test('extract_regex_no_match_returns_line', () => {
  const p = /^ZZZ/;
  assert.equal(extractInput('nope', p), 'nope');
});

test('reconcile_pure_append', () => {
  assert.deepEqual(reconcile('ls', 'ls -la'), [0, ' -la']);
});

test('reconcile_pure_backspace', () => {
  assert.deepEqual(reconcile('ls -la', 'ls'), [4, '']);
});

test('reconcile_midline_edit', () => {
  // "cat a" -> "cat b": one backspace, retype "b".
  assert.deepEqual(reconcile('cat a', 'cat b'), [1, 'b']);
});

test('reconcile_multibyte', () => {
  // Counts codepoints, not UTF-16 units or bytes.
  assert.deepEqual(reconcile('café', 'café latte'), [0, ' latte']);
  assert.deepEqual(reconcile('café', 'caf'), [1, '']);
});

test('reconcile_multibyte_korean', () => {
  assert.deepEqual(reconcile('안녕', '안녕하세요'), [0, '하세요']);
  assert.deepEqual(reconcile('안녕하세요', '안녕'), [3, '']);
});

test('submitted_detected_when_command_above', () => {
  const visible = '╰─❮ true xyz\n╭─ prompt\n╰─❮';
  assert.ok(wasSubmitted(visible, '╰─❮ true xyz'));
});

test('submitted_false_when_cleared_in_place', () => {
  const visible = 'some earlier output\n╭─ prompt\n╰─❮';
  assert.ok(!wasSubmitted(visible, '╰─❮ true xyz'));
});
