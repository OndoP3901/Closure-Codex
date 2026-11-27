use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tungstenite::{client, Message, WebSocket};
use url::Url;

use crate::{
    linked::{failure, now, Conversation, Host},
    settings::read_json,
    windows,
};

const OBSERVER: &str = include_str!("../../shared/companion/workbuddy-renderer.js");
const TIMEOUT: Duration = Duration::from_secs(3);

pub fn executable(local: &Path) -> PathBuf {
    std::env::var_os("CLOSURE_WORKBUDDY_EXE")
        .map(PathBuf::from)
        .unwrap_or_else(|| local.join("Programs/WorkBuddy/WorkBuddy.exe"))
}

pub fn runtime_executable(launcher: &Path) -> Option<PathBuf> {
    let install = launcher.parent()?;
    if install.join("resources/app.asar").is_file() {
        return Some(launcher.to_path_buf());
    }
    let mut activation = String::new();
    File::open(install.join("activation.record"))
        .ok()?
        .take(4096)
        .read_to_string(&mut activation)
        .ok()?;
    let mut lines = activation.lines();
    if lines.next()? != "WB-ACTIVATION-1" {
        return None;
    }
    let version = lines.nth(2)?;
    if version.split('.').count() != 3
        || !version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let runtime = install.join("versions").join(version);
    let executable = runtime.join("WorkBuddy-app.exe");
    (executable.is_file() && runtime.join("resources/app.asar").is_file()).then_some(executable)
}

pub(crate) fn api(port: u16, path: &str) -> Option<Value> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .timeout_global(Some(TIMEOUT))
        .build()
        .into();
    agent
        .get(format!("http://127.0.0.1:{port}/json/{path}"))
        .call()
        .ok()?
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_json()
        .ok()
}

pub(crate) fn socket_url(value: &Value, port: u16, prefix: &str) -> Option<Url> {
    let url = Url::parse(value.as_str()?).ok()?;
    let id = url.path().strip_prefix(prefix)?;
    (url.scheme() == "ws"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(port)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && !id.is_empty()
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    .then_some(url)
}

fn recorded_ports<'a>(
    local: &'a Path,
    launcher: &'a Path,
    runtime: &'a Path,
) -> impl Iterator<Item = u16> + 'a {
    [
        "ClosureCompanion/workbuddy-session.json",
        "ClosureWorkBuddyTheme/session.json",
    ]
    .into_iter()
    .filter_map(|file| {
        let record = read_json::<Value>(&local.join(file), 64 * 1024).ok()?;
        let path = record["executable"].as_str()?;
        let port = record["port"]
            .as_u64()
            .and_then(|port| u16::try_from(port).ok())
            .filter(|port| *port >= 1024)?;
        ((windows::same_path(Path::new(path), runtime)
            || windows::same_path(Path::new(path), launcher))
            && windows::owns_listener(port, runtime))
        .then_some(port)
    })
}

fn discover(local: &Path, launcher: &Path, executable: &Path) -> Option<(u16, Url)> {
    let renderer = executable
        .parent()?
        .join("resources/app.asar/renderer/index.html");
    recorded_ports(local, launcher, executable).find_map(|port| {
        let list = api(port, "list")?;
        let target = list.as_array()?.iter().find_map(|target| {
            let page = Url::parse(target["url"].as_str()?).ok()?;
            (target["type"] == "page"
                && !page.query_pairs().any(|(k, _)| k == "windowAppId")
                && page
                    .to_file_path()
                    .is_ok_and(|path| windows::same_path(&path, &renderer)))
            .then(|| socket_url(&target["webSocketDebuggerUrl"], port, "/devtools/page/"))
            .flatten()
        })?;
        Some((port, target))
    })
}

pub(crate) struct Debugger {
    socket: WebSocket<TcpStream>,
    id: u32,
    port: u16,
}

impl Debugger {
    pub(crate) fn connect(port: u16, url: &Url, executable: &Path) -> Option<Self> {
        if !windows::owns_listener(port, executable) {
            return None;
        }
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let stream = TcpStream::connect_timeout(&addr, TIMEOUT).ok()?;
        stream.set_read_timeout(Some(TIMEOUT)).ok()?;
        stream.set_write_timeout(Some(TIMEOUT)).ok()?;
        let (socket, _) = client(url.as_str(), stream).ok()?;
        Some(Self {
            socket,
            id: 0,
            port,
        })
    }

    pub(crate) fn evaluate(&mut self, expression: &str) -> Option<Value> {
        self.id += 1;
        let msg = json!({"id":self.id,"method":"Runtime.evaluate",
            "params":{"expression":expression,"returnByValue":true,"awaitPromise":true}});
        self.socket
            .send(Message::Text(msg.to_string().into()))
            .ok()?;
        let until = Instant::now() + TIMEOUT;
        while Instant::now() < until {
            let message = self.socket.read().ok()?;
            if let Message::Text(text) = message {
                if text.len() > 2 * 1024 * 1024 {
                    return None;
                }
                let Ok(message) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if message["id"] == self.id {
                    return message.pointer("/result/result/value").cloned();
                }
            }
        }
        None
    }
}

#[derive(Default)]
pub struct WorkBuddy {
    debugger: Option<Debugger>,
    runtime: Option<String>,
    sessions: HashMap<String, Conversation>,
    instance: String,
    sequence: u64,
    account_revision: Value,
    last_balance: u64,
    balance: Value,
}

impl WorkBuddy {
    pub fn stop(&mut self, executable: &Path) {
        if let Some(mut debugger) = self.debugger.take() {
            if runtime_executable(executable)
                .is_some_and(|runtime| windows::owns_listener(debugger.port, &runtime))
            {
                debugger.evaluate("window.__closureCompanionBridge?.dispose()");
            }
        }
        *self = Self::default();
    }

    pub fn tick(&mut self, local: &Path, executable: &Path) -> Host {
        self.read(local, executable).unwrap_or_else(|| {
            self.debugger = None;
            Host::default()
        })
    }

    fn read(&mut self, local: &Path, launcher: &Path) -> Option<Host> {
        let runtime = runtime_executable(launcher)?;
        let executable = runtime.as_path();
        if self.debugger.is_none() {
            let (port, url) = discover(local, launcher, executable)?;
            self.debugger = Debugger::connect(port, &url, executable);
            self.runtime = runtime_asset(executable);
            self.instance.clear();
            self.last_balance = 0;
        }
        let debugger = self.debugger.as_mut()?;
        if !windows::owns_listener(debugger.port, executable)
            || debugger.evaluate(OBSERVER)? != true
        {
            return None;
        }
        let snapshot = debugger.evaluate("window.__closureCompanionBridge.snapshot()")?;
        let instance = snapshot["instance"].as_str()?;
        let sequence = snapshot["sequence"].as_u64()?;
        let timestamp = now();
        if self.instance != instance || sequence < self.sequence {
            self.instance = instance.into();
            self.sessions.clear();
            for session in snapshot["sessions"].as_array()?.iter().take(250) {
                if let Some(id) = session["id"].as_str() {
                    let mut state = Conversation::default();
                    state.active = matches!(
                        session["state"].as_str(),
                        Some("planning" | "working" | "pending")
                    );
                    state.at = session["lastActivityAt"]
                        .as_u64()
                        .unwrap_or(0)
                        .min(timestamp);
                    self.sessions.insert(id.into(), state);
                }
            }
        } else {
            for event in snapshot["events"].as_array()? {
                if event["seq"].as_u64().unwrap_or(0) <= self.sequence {
                    continue;
                }
                let Some(id) = event["id"].as_str() else {
                    continue;
                };
                if self.sessions.len() >= 250 && !self.sessions.contains_key(id) {
                    if let Some(key) = self
                        .sessions
                        .iter()
                        .filter(|(_, value)| !value.active)
                        .min_by_key(|(_, value)| value.at)
                        .map(|(key, _)| key.clone())
                    {
                        self.sessions.remove(&key);
                    } else {
                        continue;
                    }
                }
                let state = self.sessions.entry(id.into()).or_default();
                state.at = state
                    .at
                    .max(event["at"].as_u64().unwrap_or(timestamp).min(timestamp));
                let data = &event["data"];
                let reason = failure(&data["error"], "任务执行失败，请查看软件内提示。");
                match event["kind"].as_str() {
                    Some("start") if !state.active => {
                        state.begin(true);
                        state.turn_tokens = Some(0);
                    }
                    Some("end") => {
                        let terminal = match data["kind"].as_str() {
                            Some("completed") => "completed",
                            Some("error") => "error",
                            _ => "interrupted",
                        };
                        if terminal == "error" {
                            state.failed(reason);
                        }
                        state.end(
                            terminal,
                            if terminal == "error" { reason } else { "" },
                            true,
                        );
                        self.last_balance = 0;
                    }
                    Some("mode") => {
                        state.active = true;
                        state.talk_until = if data["mode"] == "outputting" {
                            timestamp + 1800
                        } else {
                            0
                        };
                    }
                    Some("tool") => state.tool(
                        data["failed"] == true,
                        data["name"].as_str().unwrap_or(""),
                        failure(&data["error"], "工具执行失败，请查看软件内提示。"),
                    ),
                    Some("question") => state.input("question"),
                    Some("answer") => state.input("answer"),
                    Some("usage") => {
                        if let Some(total) = data["total"].as_u64() {
                            state.total = Some(state.total.unwrap_or(0).saturating_add(total));
                            state.turn_tokens =
                                Some(state.turn_tokens.unwrap_or(0).saturating_add(total));
                        }
                    }
                    _ => {}
                }
            }
        }
        self.sequence = sequence;
        if self.account_revision != snapshot["accountRevision"] {
            self.account_revision = snapshot["accountRevision"].clone();
            self.last_balance = 0;
        }
        if timestamp.saturating_sub(self.last_balance) >= 60_000 {
            self.last_balance = timestamp;
            let result = self.runtime.as_ref().and_then(|module| {
                let module = json!(format!("./assets/{module}"));
                debugger.evaluate(&format!("(async()=>{{const m=await import({module});const v=await m.n().authGetAccountUsage({{locale:'zh'}});return v?{{usageLeft:v.usageLeft}}:null}})()"))
            });
            self.balance = credits(result);
        }
        Some(Host {
            instance: self.instance.clone(),
            connected: true,
            account: self.balance.clone(),
            conversations: self
                .sessions
                .iter()
                .map(|(id, state)| state.snapshot(id, timestamp))
                .collect(),
        })
    }
}

fn runtime_asset(executable: &Path) -> Option<String> {
    let mut file = File::open(executable.parent()?.join("resources/app.asar")).ok()?;
    let mut prefix = [0_u8; 16];
    file.read_exact(&mut prefix).ok()?;
    let size = u32::from_le_bytes(prefix[12..16].try_into().ok()?) as usize;
    let offset = u64::from(u32::from_le_bytes(prefix[4..8].try_into().ok()?)) + 8;
    if size == 0 || size > 16 * 1024 * 1024 {
        return None;
    }
    let mut header = vec![0; size];
    file.read_exact(&mut header).ok()?;
    let header: Value = serde_json::from_slice(&header).ok()?;
    let assets = header
        .pointer("/files/renderer/files/assets/files")?
        .as_object()?;
    let mut matching = None;
    for (key, record) in assets {
        if !key
            .strip_prefix("runtime-")
            .and_then(|key| key.strip_suffix(".js"))
            .is_some_and(|key| {
                !key.is_empty()
                    && key
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            })
            || record["unpacked"] == true
        {
            continue;
        }
        let Some(length) = record["size"]
            .as_u64()
            .filter(|size| *size < 2 * 1024 * 1024)
        else {
            continue;
        };
        let position = offset.checked_add(record["offset"].as_str()?.parse().ok()?)?;
        file.seek(SeekFrom::Start(position)).ok()?;
        let mut source = vec![0; length as usize];
        file.read_exact(&mut source).ok()?;
        let source = String::from_utf8_lossy(&source);
        if source.contains("authGetAccountUsage") && source.contains("getDaemonClient") {
            if matching.is_some() {
                return None;
            }
            matching = Some(key.clone());
        }
    }
    matching
}

fn credits(value: Option<Value>) -> Value {
    let (status, credits) = match value {
        Some(Value::Null) => ("signed-out", Value::Null),
        Some(value) => {
            let amount = &value["usageLeft"];
            if matches!(amount.as_str(), Some("unlimited" | "Unlimited" | "不限量")) {
                ("ready", json!({"unlimited":true}))
            } else {
                let balance = amount
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| amount.as_f64().map(|v| v.to_string()));
                match balance.filter(|balance| {
                    balance.len() < 64 && balance.parse::<f64>().is_ok_and(f64::is_finite)
                }) {
                    Some(balance) => ("ready", json!({"balance":balance})),
                    None => ("unavailable", Value::Null),
                }
            }
        }
        None => ("unavailable", Value::Null),
    };
    json!({"source":"official","quota":[],"accountStatus":status,"credits":credits})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::launch::Agent;

    #[test]
    #[ignore = "requires the locally installed WorkBuddy desktop app"]
    fn menu_launch_applies_the_theme_setting_and_connects_workbuddy() {
        let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
        let launcher = executable(&local);
        let runtime = runtime_executable(&launcher).unwrap();
        let mut adapter = WorkBuddy::default();

        for theme_enabled in [true, false, true] {
            Agent::WorkBuddy.open(&local, theme_enabled).unwrap();
            let (port, url) = discover(&local, &launcher, &runtime).unwrap();
            let mut debugger = Debugger::connect(port, &url, &runtime).unwrap();
            assert_eq!(
                debugger.evaluate("document.documentElement.getAttribute('data-closure-workbuddy-theme') === 'on'"),
                Some(json!(theme_enabled))
            );
            let host = adapter.tick(&local, &launcher);
            assert!(host.connected, "WorkBuddy bridge did not connect");
            assert!(
                matches!(
                    host.account["accountStatus"].as_str(),
                    Some("ready" | "signed-out")
                ),
                "WorkBuddy account service did not finish"
            );
        }
    }
}
