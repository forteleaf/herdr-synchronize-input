//! JSON-RPC client for the running herdr server, spoken directly over the Unix
//! socket at `HERDR_SOCKET_PATH`.
//!
//! Protocol, established by a spike against herdr 0.7.4:
//!   * Framing is newline-delimited JSON. Each request is one line, each
//!     response is one line.
//!   * A request MUST carry `id`, `method`, and `params` (a missing `id` is
//!     rejected with `invalid_request`).
//!   * The server answers one request per connection and then closes it, so we
//!     open a fresh connection per call.
//!   * A successful reply is `{"id":..,"result":{..}}`; a failure is
//!     `{"id":..,"error":{"code":..,"message":..}}`.
//!
//! Why the socket instead of shelling out to the `herdr` CLI: the watcher polls
//! `pane.read` on a tight (~60ms) interval, and spawning a process per poll is
//! far too heavy. The socket call is a cheap connect + one line each way.
//!
//! Watching note: herdr 0.7.4 has NO streaming "output changed" event. The
//! spike confirmed `events.subscribe` only offers `pane.output_matched`
//! (regex), `pane.agent_status_changed`, and `pane.scroll_changed`, and
//! `events.wait` rejects output matches with `unsupported_event_wait_match`.
//! So the only way to watch arbitrary output is to poll `pane.read`, which is
//! what `watch.rs` does.

use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

/// Bound on any single socket round-trip.
const CALL_TIMEOUT: Duration = Duration::from_secs(5);

/// A single pane, as reported by `pane.list`.
#[derive(Debug, Clone, Deserialize)]
pub struct Pane {
    pub pane_id: String,
    pub tab_id: String,
    #[serde(default)]
    pub focused: bool,
}

/// Resolve the herdr socket path from the environment.
fn socket_path() -> io::Result<String> {
    env::var("HERDR_SOCKET_PATH").map_err(|_| {
        io::Error::other("HERDR_SOCKET_PATH not set (run as a herdr plugin process)")
    })
}

/// Perform one JSON-RPC call and return its `result` value.
fn call(method: &str, params: Value) -> io::Result<Value> {
    let stream = UnixStream::connect(socket_path()?)?;
    stream.set_read_timeout(Some(CALL_TIMEOUT))?;
    stream.set_write_timeout(Some(CALL_TIMEOUT))?;

    let request = json!({ "id": "sync-input", "method": method, "params": params });
    let mut line = serde_json::to_string(&request)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    line.push('\n');
    (&stream).write_all(line.as_bytes())?;
    (&stream).flush()?;

    let mut reader = BufReader::new(&stream);
    let mut response = String::new();
    reader.read_line(&mut response)?;
    let value: Value = serde_json::from_str(&response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    if let Some(err) = value.get("error") {
        return Err(io::Error::other(format!("herdr {method} error: {err}")));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| io::Error::other(format!("herdr {method}: response had no result")))
}

/// List every pane known to the server.
pub fn pane_list() -> io::Result<Vec<Pane>> {
    let result = call("pane.list", json!({}))?;
    let panes = result
        .get("panes")
        .cloned()
        .ok_or_else(|| io::Error::other("pane.list: no panes field"))?;
    serde_json::from_value(panes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Read the currently visible screen text of a pane (ANSI stripped, the
/// server's default). This is the only source that returns live content:
/// `recent`/`recent_unwrapped` came back empty in the spike, and the read
/// `revision` is always 0, so change detection must diff the text itself.
pub fn pane_read_visible(pane_id: &str) -> io::Result<String> {
    let result = call("pane.read", json!({ "pane_id": pane_id, "source": "visible" }))?;
    result
        .get("read")
        .and_then(|r| r.get("text"))
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .ok_or_else(|| io::Error::other("pane.read: no text in response"))
}

/// Send literal UTF-8 text to a pane's PTY (as if typed/pasted).
pub fn send_text(pane_id: &str, text: &str) -> io::Result<()> {
    call("pane.send_text", json!({ "pane_id": pane_id, "text": text })).map(|_| ())
}

/// Send one or more named keys to a pane (herdr grammar, e.g. `enter`,
/// `backspace`).
pub fn send_keys(pane_id: &str, keys: &[&str]) -> io::Result<()> {
    call("pane.send_keys", json!({ "pane_id": pane_id, "keys": keys })).map(|_| ())
}

/// Return true if a pane with the given id currently exists.
pub fn pane_exists(pane_id: &str) -> bool {
    match pane_list() {
        Ok(panes) => panes.iter().any(|p| p.pane_id == pane_id),
        Err(_) => false,
    }
}

/// Show a herdr notification (best-effort; errors are swallowed).
pub fn notify(title: &str, body: &str) {
    let _ = call(
        "notification.show",
        json!({ "title": title, "body": body, "position": "bottom-right" }),
    );
}
