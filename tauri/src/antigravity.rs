use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

use crate::{
    linked::{now, Conversation, Host, Hub, ANTIGRAVITY},
    settings::{read_json, write_json},
    windows, workbuddy,
};

const LEASE_MS: u64 = 5_000;
const EVENT_MS: u64 = 60_000;
const MAX_CONVERSATIONS: usize = 128;
const QUOTA: &str = include_str!("../../shared/companion/antigravity-quota.js");

fn directory(local: &Path) -> PathBuf {
    local.join("ClosureCompanion/bridges/antigravity")
}

pub fn is_app(executable: &Path, local: &Path) -> bool {
    windows::same_path(executable, &self::executable(local))
}

pub fn executable(local: &Path) -> PathBuf {
    std::env::var_os("CLOSURE_ANTIGRAVITY_EXE")
        .map(PathBuf::from)
        .unwrap_or_else(|| local.join("Programs/Antigravity/Antigravity.exe"))
}

pub fn debug_port(roaming: &Path, executable: &Path) -> Option<u16> {
    let mut address = String::new();
    File::open(roaming.join("Antigravity/DevToolsActivePort"))
        .ok()?
        .take(4096)
        .read_to_string(&mut address)
        .ok()?;
    let port = address.lines().next()?.trim().parse::<u16>().ok()?;
    (port >= 1024 && windows::owns_listener(port, executable)).then_some(port)
}

pub fn account(local: &Path, roaming: &Path) -> Option<Value> {
    let executable = executable(local);
    let port = debug_port(roaming, &executable)?;
    let server = executable
        .parent()?
        .join("resources/bin/language_server.exe");
    let pages = workbuddy::api(port, "list")?;
    let mut fallback = None;
    for target in pages
        .as_array()?
        .iter()
        .filter(|target| target["type"] == "page")
    {
        let Some(page) = target["url"]
            .as_str()
            .and_then(|value| Url::parse(value).ok())
        else {
            continue;
        };
        let Some(page_port) = page.port() else {
            continue;
        };
        if !matches!(page.scheme(), "https" | "http")
            || page.host_str() != Some("127.0.0.1")
            || !page.username().is_empty()
            || page.password().is_some()
            || !(windows::owns_listener(page_port, &server)
                || windows::owns_listener(page_port, &executable))
        {
            continue;
        }
        let Some(socket) =
            workbuddy::socket_url(&target["webSocketDebuggerUrl"], port, "/devtools/page/")
        else {
            continue;
        };
        let Some(mut debugger) = workbuddy::Debugger::connect(port, &socket, &executable) else {
            continue;
        };
        let active = debugger.evaluate(
            "window === window.top && document.querySelector('.agy-shell') ? document.hasFocus() : null",
        );
        match active.as_ref().and_then(Value::as_bool) {
            Some(true) => {
                fallback = Some(debugger);
                break;
            }
            Some(false) if fallback.is_none() => fallback = Some(debugger),
            _ => {}
        }
    }
    let mut debugger = fallback?;
    Some(
        debugger
            .evaluate(QUOTA)
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({"quota":[],"accountStatus":"unavailable"})),
    )
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Lease {
    instance: String,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    conversation_id: String,
    transcript_path: String,
    #[serde(default)]
    fully_idle: bool,
    #[serde(default)]
    termination_reason: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Signal {
    Start,
    Completed,
    Interrupted,
    Error,
    Background,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    instance: String,
    id: String,
    at: u64,
    signal: Signal,
}

fn app_transcript(path: &str) -> bool {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    path.contains("/.gemini/antigravity/brain/") || path.starts_with(".gemini/antigravity/brain/")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

fn recent(at: u64, time: u64, max_age: u64) -> bool {
    at > 0 && at <= time && time - at <= max_age
}

fn record(root: &Path, name: &str, mut input: impl Read, at: u64) -> io::Result<()> {
    let lease: Lease = read_json(&root.join("lease.json"), 4096)?;
    if !recent(lease.updated_at, at.saturating_add(250), LEASE_MS) {
        return Ok(());
    }
    let mut bytes = Vec::new();
    input.by_ref().take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Ok(());
    }
    let payload: Payload = serde_json::from_slice(&bytes)?;
    if !valid_id(&payload.conversation_id) || !app_transcript(&payload.transcript_path) {
        return Ok(());
    }
    let signal = match (
        name,
        payload.termination_reason.as_str(),
        payload.fully_idle,
    ) {
        ("start", _, _) => Signal::Start,
        ("stop", "error" | "max_steps_exceeded", _) => Signal::Error,
        ("stop", "model_stop", true) => Signal::Completed,
        ("stop", "model_stop", false) => Signal::Background,
        ("stop", _, _) => Signal::Interrupted,
        _ => return Ok(()),
    };
    let event = Event {
        instance: lease.instance,
        id: payload.conversation_id,
        at,
        signal,
    };
    let mut file = tempfile::Builder::new()
        .prefix(".hook-")
        .tempfile_in(root)?;
    serde_json::to_writer(&mut file, &event)?;
    file.flush()?;
    let name = file.path().file_name().unwrap().to_string_lossy();
    let target = root.join(format!(
        "{at:013}-{}.json",
        name.trim_start_matches(".hook-")
    ));
    file.persist_noclobber(target)?;
    Ok(())
}

pub fn hook(local: &Path, name: &str) {
    let _ = record(&directory(local), name, io::stdin().lock(), now());
    // Command hooks must return JSON even when the companion is absent.
    let _ = writeln!(io::stdout().lock(), "{{}}");
}

pub struct Bridge {
    local: PathBuf,
    root: PathBuf,
    instance: String,
    connected: bool,
    last_process_check: u64,
    conversations: HashMap<String, Conversation>,
}

impl Bridge {
    pub fn new(local: &Path) -> Self {
        Self {
            local: local.to_path_buf(),
            root: directory(local),
            instance: String::new(),
            connected: false,
            last_process_check: 0,
            conversations: HashMap::new(),
        }
    }

    pub fn tick(&mut self, enabled: bool, hub: &Hub, account: &Value) {
        let at = now();
        if !enabled {
            if !self.instance.is_empty() {
                let _ = fs::remove_file(self.root.join("lease.json"));
                self.events(at);
                self.instance.clear();
                self.connected = false;
                self.conversations.clear();
                hub.set(ANTIGRAVITY, Host::default());
            }
            return;
        }
        if self.instance.is_empty() {
            self.instance = format!("{}-{at}", std::process::id());
        }
        if self.connected && at.saturating_sub(self.last_process_check) >= 2_000 {
            self.last_process_check = at;
            if !windows::paths(&["Antigravity.exe"])
                .iter()
                .any(|path| is_app(path, &self.local))
            {
                self.connected = false;
                self.conversations.clear();
                self.instance = format!("{}-{at}", std::process::id());
                hub.set(ANTIGRAVITY, Host::default());
            }
        }
        if write_json(
            &self.root.join("lease.json"),
            &Lease {
                instance: self.instance.clone(),
                updated_at: at,
            },
        )
        .is_err()
        {
            return;
        }
        let events = self.events(at);
        if !self.connected && !events.is_empty() {
            self.connected = true;
            self.last_process_check = at;
            // Seed the host before publishing its first live event.
            hub.set(ANTIGRAVITY, self.host(at, account));
        }
        for event in events {
            self.apply(event);
        }
        hub.set(ANTIGRAVITY, self.host(at, account));
    }

    fn events(&self, at: u64) -> Vec<Event> {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut files: Vec<_> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    return false;
                };
                name.ends_with(".json") && name.as_bytes().first().is_some_and(u8::is_ascii_digit)
            })
            .collect();
        files.sort_unstable();
        files
            .into_iter()
            .take(512)
            .filter_map(|path| {
                let event = read_json::<Event>(&path, 4096);
                fs::remove_file(path).ok()?;
                let event = event.ok()?;
                (event.instance == self.instance
                    && recent(event.at, at.saturating_add(500), EVENT_MS)
                    && valid_id(&event.id))
                .then_some(event)
            })
            .collect()
    }

    fn apply(&mut self, event: Event) {
        if !self.conversations.contains_key(&event.id)
            && self.conversations.len() >= MAX_CONVERSATIONS
        {
            let oldest = self
                .conversations
                .iter()
                .min_by_key(|(_, conversation)| (conversation.active, conversation.at))
                .map(|(id, _)| id.clone())
                .unwrap();
            self.conversations.remove(&oldest);
        }
        let conversation = self.conversations.entry(event.id).or_default();
        if event.at < conversation.at {
            return;
        }
        let expired = event.at.saturating_sub(conversation.at) >= 20 * 60_000;
        match event.signal {
            Signal::Start => {
                if !conversation.active || expired {
                    conversation.begin(true);
                } else {
                    return;
                }
            }
            Signal::Background if conversation.active => {}
            Signal::Completed if conversation.active => conversation.end("completed", "", true),
            Signal::Interrupted if conversation.active => conversation.end("interrupted", "", true),
            Signal::Error if conversation.active => {
                let reason = "Antigravity 任务失败";
                conversation.failed(reason);
                conversation.end("error", reason, true);
            }
            _ => return,
        }
        conversation.at = event.at;
    }

    fn host(&self, at: u64, account: &Value) -> Host {
        Host {
            instance: self.instance.clone(),
            connected: self.connected || account.is_object(),
            conversations: self
                .conversations
                .iter()
                .map(|(id, conversation)| conversation.snapshot(id, at))
                .collect(),
            account: if account.is_object() {
                account.clone()
            } else {
                json!({"quota":[],"accountStatus":"disconnected"})
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_keeps_only_local_app_events_and_lifecycle_is_deduplicated() {
        let local = tempfile::tempdir().unwrap();
        let mut bridge = Bridge::new(local.path());
        bridge.instance = "test".into();
        let at = now();
        write_json(
            &bridge.root.join("lease.json"),
            &Lease {
                instance: bridge.instance.clone(),
                updated_at: at,
            },
        )
        .unwrap();
        let payload = |source: &str, reason: &str, idle: bool| {
            serde_json::to_vec(&json!({
                "conversationId":"conversation-42",
                "transcriptPath":format!("C:/User/.gemini/{source}/brain/conversation-42/logs/transcript.jsonl"),
                "terminationReason":reason, "fullyIdle":idle, "lastUserInput":"private",
            })).unwrap()
        };
        record(
            &bridge.root,
            "start",
            payload("antigravity-cli", "", false).as_slice(),
            at,
        )
        .unwrap();
        for (offset, name, reason, idle) in [
            (1, "start", "", false),
            (2, "start", "", false),
            (3, "stop", "model_stop", false),
            (4, "stop", "model_stop", true),
            (5, "stop", "model_stop", true),
            (6, "start", "", false),
            (7, "stop", "error", true),
        ] {
            record(
                &bridge.root,
                name,
                payload("antigravity", reason, idle).as_slice(),
                at + offset,
            )
            .unwrap();
        }
        let events = bridge.events(at + 8);
        assert_eq!(events.len(), 7);
        for (index, event) in events.into_iter().enumerate() {
            assert!(!serde_json::to_string(&event).unwrap().contains("private"));
            bridge.apply(event);
            if index == 2 {
                assert!(bridge.conversations["conversation-42"].active);
            }
        }
        let state = &bridge.host(at + 8, &Value::Null).conversations[0].clone();
        assert_eq!(state["turnStartSeq"], 2);
        assert_eq!(state["turnEnd"]["seq"], 2);
        assert_eq!(state["turnEnd"]["kind"], "error");
        assert!(bridge.events(at + 8).is_empty());
    }

    #[test]
    #[ignore = "requires the running Antigravity desktop app with a selected model that exposes quota"]
    fn reads_live_antigravity_account() {
        let local = std::env::var_os("LOCALAPPDATA").unwrap();
        let roaming = std::env::var_os("APPDATA").unwrap();
        let account =
            account(Path::new(&local), Path::new(&roaming)).expect("Antigravity renderer");
        assert_eq!(account["accountStatus"], "ready");
        let quota = account["quota"].as_array().expect("quota array");
        assert!(!quota.is_empty());
        assert!(quota.iter().all(|window| {
            matches!(window["minutes"].as_u64(), Some(300 | 10080))
                && window["remaining"]
                    .as_f64()
                    .is_some_and(|value| (0.0..=100.0).contains(&value))
        }));
    }
}
