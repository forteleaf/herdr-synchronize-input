'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('./config');

// Ported 1:1 from src/config.rs's `#[cfg(test)] mod tests`.

test('empty_prompt_regex_becomes_none', () => {
  assert.equal(config.parse('prompt_regex = ""').promptRegex, null);
});

test('whitespace_prompt_regex_becomes_none', () => {
  assert.equal(config.parse('prompt_regex = "  \\t "').promptRegex, null);
});

test('real_prompt_regex_is_kept', () => {
  assert.equal(config.parse('prompt_regex = "^\\\\$ "').promptRegex, '^\\$ ');
});

test('missing_prompt_regex_is_none', () => {
  assert.equal(config.parse('notify = false').promptRegex, null);
});

test('empty_prompt_regex_falls_through_to_heuristic_stripping', () => {
  // The bug this guards: `prompt_regex = ""` must NOT be compiled into an
  // empty RegExp (which matches at offset 0 and strips nothing). It
  // normalizes to null, and extractInput then uses the heuristic, which
  // correctly strips the prompt instead of mirroring the whole line.
  const cfg = config.parse('prompt_regex = ""');
  assert.equal(cfg.promptRegex, null);

  const line = require('./line');
  assert.equal(line.extractInput('╰─❮ echo hello', null), 'echo hello');
});

test('defaults_when_no_recognized_fields', () => {
  const cfg = config.parse('# just a comment\n');
  assert.deepEqual(cfg, config.defaultConfig());
});

test('ignore_panes_string_array', () => {
  const cfg = config.parse('ignore_panes = ["w0:p1", "w0:p2"]');
  assert.deepEqual(cfg.ignorePanes, ['w0:p1', 'w0:p2']);
});

test('poll_interval_ms_integer', () => {
  const cfg = config.parse('poll_interval_ms = 250');
  assert.equal(cfg.pollIntervalMs, 250);
});

test('notify_boolean', () => {
  assert.equal(config.parse('notify = false').notify, false);
  assert.equal(config.parse('notify = true').notify, true);
});

test('comment_after_value_is_stripped', () => {
  const cfg = config.parse('poll_interval_ms = 100 # comment\nnotify = false');
  assert.equal(cfg.pollIntervalMs, 100);
  assert.equal(cfg.notify, false);
});

test('hash_inside_string_is_not_a_comment', () => {
  const cfg = config.parse('prompt_regex = "^# "');
  assert.equal(cfg.promptRegex, '^# ');
});

test('malformed_toml_falls_back_to_defaults', () => {
  const cfg = config.parse('this is not valid toml [[[');
  // Malformed lines are simply skipped by this dedicated parser (no `=`
  // found on that line, or unparsable value), so defaults survive.
  assert.deepEqual(cfg, config.defaultConfig());
});
