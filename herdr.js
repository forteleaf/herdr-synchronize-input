'use strict';

const net = require('net');

/**
 * JSON-RPC client for the running herdr server, spoken directly over the Unix
 * socket at `HERDR_SOCKET_PATH`.
 *
 * Protocol, established by a spike against herdr 0.7.4 (ported from
 * src/herdr.rs, the verified reference):
 *   - Framing is newline-delimited JSON. Each request is one line, each
 *     response is one line.
 *   - A request MUST carry `id`, `method`, and `params` (a missing `id` is
 *     rejected with `invalid_request`).
 *   - The server answers one request per connection and then closes it, so we
 *     open a fresh connection per call.
 *   - A successful reply is `{"id":..,"result":{..}}`; a failure is
 *     `{"id":..,"error":{"code":..,"message":..}}`.
 *
 * Why the socket instead of shelling out to the `herdr` CLI: the watcher
 * polls `pane.read` on a tight (~60ms) interval, and spawning a process per
 * poll is far too heavy. The socket call is a cheap connect + one line each
 * way.
 *
 * Watching note: herdr 0.7.4 has NO streaming "output changed" event. The
 * spike confirmed `events.subscribe` only offers `pane.output_matched`
 * (regex), `pane.agent_status_changed`, and `pane.scroll_changed`, and
 * `events.wait` rejects output matches with `unsupported_event_wait_match`.
 * So the only way to watch arbitrary output is to poll `pane.read`, which is
 * what watch.js does.
 */

// Bound on any single socket round-trip.
const CALL_TIMEOUT_MS = 5000;

// Resolve the herdr socket path from the environment.
function socketPath() {
  const p = process.env.HERDR_SOCKET_PATH;
  if (!p) {
    throw new Error('HERDR_SOCKET_PATH not set (run as a herdr plugin process)');
  }
  return p;
}

// Perform one JSON-RPC call and return its `result` value.
function call(method, params) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let socket;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      fn(arg);
    };

    let path;
    try {
      path = socketPath();
    } catch (e) {
      reject(e);
      return;
    }

    socket = net.createConnection(path);
    socket.setEncoding('utf8');

    timer = setTimeout(() => {
      finish(reject, new Error(`herdr ${method}: timed out`));
    }, CALL_TIMEOUT_MS);

    let buffer = '';

    socket.on('connect', () => {
      const request = { id: 'sync-input', method, params };
      socket.write(JSON.stringify(request) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;

      const line = buffer.slice(0, nl);
      let value;
      try {
        value = JSON.parse(line);
      } catch (e) {
        finish(reject, new Error(`herdr ${method}: invalid response JSON: ${e.message}`));
        return;
      }

      if (value && value.error) {
        finish(reject, new Error(`herdr ${method} error: ${JSON.stringify(value.error)}`));
        return;
      }
      if (!value || !Object.prototype.hasOwnProperty.call(value, 'result')) {
        finish(reject, new Error(`herdr ${method}: response had no result`));
        return;
      }
      finish(resolve, value.result);
    });

    socket.on('error', (e) => {
      finish(reject, e);
    });

    socket.on('close', () => {
      finish(reject, new Error(`herdr ${method}: connection closed before response`));
    });
  });
}

// List every pane known to the server.
async function paneList() {
  const result = await call('pane.list', {});
  const panes = result && result.panes;
  if (!Array.isArray(panes)) {
    throw new Error('pane.list: no panes field');
  }
  return panes.map((p) => ({
    paneId: p.pane_id,
    tabId: p.tab_id,
    focused: !!p.focused,
  }));
}

// Read the currently visible screen text of a pane (ANSI stripped, the
// server's default). This is the only source that returns live content:
// `recent`/`recent_unwrapped` came back empty in the spike, and the read
// `revision` is always 0, so change detection must diff the text itself.
async function paneReadVisible(paneId) {
  const result = await call('pane.read', { pane_id: paneId, source: 'visible' });
  const text = result && result.read && result.read.text;
  if (typeof text !== 'string') {
    throw new Error('pane.read: no text in response');
  }
  return text;
}

// Send literal UTF-8 text to a pane's PTY (as if typed/pasted).
async function sendText(paneId, text) {
  await call('pane.send_text', { pane_id: paneId, text });
}

// Send one or more named keys to a pane (herdr grammar, e.g. `enter`,
// `backspace`).
async function sendKeys(paneId, keys) {
  await call('pane.send_keys', { pane_id: paneId, keys });
}

// Return true if a pane with the given id currently exists.
async function paneExists(paneId) {
  try {
    const panes = await paneList();
    return panes.some((p) => p.paneId === paneId);
  } catch {
    return false;
  }
}

// Show a herdr notification (best-effort; errors are swallowed).
async function notify(title, body) {
  try {
    await call('notification.show', { title, body, position: 'bottom-right' });
  } catch {
    // best-effort
  }
}

module.exports = { paneList, paneReadVisible, sendText, sendKeys, paneExists, notify };
