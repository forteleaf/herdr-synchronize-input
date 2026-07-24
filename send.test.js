'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { selectTargets } = require('./send');

const panes = [
  { paneId: 'w1:p1', tabId: 'w1:t1', focused: true },
  { paneId: 'w1:p2', tabId: 'w1:t1', focused: false },
  { paneId: 'w1:p3', tabId: 'w1:t2', focused: false }, // different tab
];
const source = panes[0];

test('sync off targets only the focused pane', () => {
  assert.deepStrictEqual(selectTargets(panes, source, false, []), ['w1:p1']);
});

test('sync on targets every pane in the focused tab, source included', () => {
  assert.deepStrictEqual(selectTargets(panes, source, true, []), ['w1:p1', 'w1:p2']);
});

test('sync on excludes ignored panes', () => {
  assert.deepStrictEqual(selectTargets(panes, source, true, ['w1:p2']), ['w1:p1']);
});

test('sync on never targets panes in other tabs', () => {
  assert.ok(!selectTargets(panes, source, true, []).includes('w1:p3'));
});
