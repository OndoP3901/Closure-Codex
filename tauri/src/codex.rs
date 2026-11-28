use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

use crate::{
    linked::{failure, now, Conversation, Host},
    windows,
};

const TAIL: u64 = 256 * 1024;
const RECENT: u64 = 30 * 60_000;

#[derive(Default)]
pub struct Codex {
    files: HashMap<PathBuf, Rollout>,
    rate: (u64, Vec<Value>),
    watcher: Option<(RecommendedWatcher, Receiver<notify::Result<notify::Event>>)>,
    next_scan: Option<Instant>,
    started_at: Option<u64>,
}

#[derive(Default)]
struct Rollout {
    offset: u64,
    subagent: bool,
    turn: Option<String>,
    turn_error: Option<&'static str>,
    token_base: Option<u64>,
    calls: HashMap<String, bool>,
    pending_answers: u32,
    state: Conversation,
}

impl Codex {
    fn refresh_rollouts(&mut self, sessions: &Path, timestamp: u64) {
        let initial = self.started_at.is_none();
        let started_at = *self.started_at.get_or_insert(timestamp);
        let mut changed = HashSet::new();
        let mut scan = self.next_scan.is_none_or(|next| Instant::now() >= next);
        if let Some((_, events)) = &self.watcher {
            for event in events.try_iter() {
                match event {
                    Ok(event) if !event.need_rescan() => changed.extend(event.paths),
                    _ => scan = true,
                }
            }
        }
        let mut paths: HashSet<PathBuf> = self.files.keys().chain(&changed).cloned().collect();
        if scan {
            if self.watcher.is_none() {
                let (tx, rx) = mpsc::channel();
                if let Ok(mut watcher) = notify::recommended_watcher(tx) {
                    if watcher.watch(sessions, RecursiveMode::Recursive).is_ok() {
                        self.watcher = Some((watcher, rx));
                    }
                }
            }
            // A resumed chat keeps the directory in which it was originally created.
            paths.extend(
                walkdir::WalkDir::new(sessions)
                    .min_depth(4)
                    .max_depth(4)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_file())
                    .map(|e| e.into_path()),
            );
            let seconds = if self.watcher.is_some() { 300 } else { 5 };
            self.next_scan = Some(Instant::now() + Duration::from_secs(seconds));
        }
        for path in paths {
            if !path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with("rollout-") && s.ends_with(".jsonl"))
            {
                continue;
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(meta) if meta.is_file() => meta,
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => continue,
                _ => {
                    self.files.remove(&path);
                    continue;
                }
            };
            // Windows can defer the modification timestamp while the writer holds the log open.
            let known = self.files.get(&path);
            if !changed.contains(&path)
                && !known.is_some_and(|r| timestamp.saturating_sub(r.state.at) < RECENT)
                && metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_millis(RECENT))
            {
                self.files.remove(&path);
                continue;
            }
            let since = if known.is_some() {
                0
            } else {
                started_at.max(timestamp.saturating_sub(RECENT))
            };
            let rollout = self.files.entry(path.clone()).or_default();
            if let Err(error) = rollout.read(
                &path,
                metadata.len(),
                (!initial).then_some(since),
                &mut self.rate,
            ) {
                eprintln!("Codex rollout read failed: {}", error.kind());
            }
        }
    }

    pub fn tick(&mut self, home: &Path, account: &Value) -> Host {
        let timestamp = now();
        self.refresh_rollouts(&home.join("sessions"), timestamp);
        let mut account = account.as_object().cloned().unwrap_or_default();
        if account
            .get("quota")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
            && timestamp.saturating_sub(self.rate.0) < RECENT
        {
            account.insert(
                "quota".into(),
                json!(self
                    .rate
                    .1
                    .iter()
                    .filter(|window| window["resetsAt"].as_u64().unwrap_or(0) > timestamp)
                    .collect::<Vec<_>>()),
            );
        }
        Host {
            connected: gui_path().is_some(),
            instance: "codex".into(),
            conversations: self
                .files
                .iter()
                .filter(|(_, rollout)| !rollout.subagent)
                .filter_map(|(path, rollout)| {
                    Some(
                        rollout
                            .state
                            .snapshot(path.file_name()?.to_str()?, timestamp),
                    )
                })
                .collect(),
            account: Value::Object(account),
        }
    }
}

impl Rollout {
    fn read(
        &mut self,
        path: &Path,
        len: u64,
        notify_since: Option<u64>,
        rate: &mut (u64, Vec<Value>),
    ) -> std::io::Result<()> {
        let truncated = len < self.offset;
        if truncated {
            *self = Self::default();
        }
        if len == self.offset {
            return Ok(());
        }
        let mut file = File::open(path)?;
        let start = self.offset.max(len.saturating_sub(TAIL));
        if self.offset == 0 && start > 0 {
            use std::io::BufRead;
            let mut header = String::new();
            BufReader::new((&file).take(TAIL)).read_line(&mut header)?;
            self.record(&header, None, rate);
        }
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = Vec::new();
        file.take(TAIL).read_to_end(&mut bytes)?;
        let Some(last) = bytes.iter().rposition(|&byte| byte == b'\n') else {
            return Ok(());
        };
        let mut lines = bytes[..last].split(|&byte| byte == b'\n');
        if start != self.offset {
            lines.next();
        }
        for line in lines {
            if let Ok(line) = std::str::from_utf8(line) {
                self.record(line, if truncated { None } else { notify_since }, rate);
            }
        }
        self.offset = start + last as u64 + 1;
        Ok(())
    }

    fn record(&mut self, line: &str, notify_since: Option<u64>, rate: &mut (u64, Vec<Value>)) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event = &record["payload"];
        let kind = event["type"].as_str().unwrap_or_default();
        let at = record["timestamp"]
            .as_str()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .and_then(|date| u64::try_from(date.timestamp_millis()).ok())
            .unwrap_or_default();
        let notify = notify_since.is_some_and(|since| at >= since);
        match record["type"].as_str() {
            Some("session_meta") => self.subagent = !event["source"]["subagent"].is_null(),
            Some("response_item") if !self.subagent => {
                self.state.at = self.state.at.max(at);
                if kind == "message"
                    && event["role"] == "assistant"
                    && self.turn.is_some()
                    && notify
                {
                    self.state.talk_until = at + 2200;
                }
                let call_id = event["call_id"].as_str().unwrap_or_default();
                if kind == "function_call"
                    && matches!(
                        event["name"].as_str(),
                        Some("request_user_input" | "request_user_input_async")
                    )
                {
                    let async_call = event["name"] == "request_user_input_async";
                    if self.calls.insert(call_id.into(), async_call).is_none()
                        && notify
                        && !async_call
                    {
                        self.state.input("question");
                    }
                } else if kind == "function_call_output" {
                    if let Some(async_call) = self.calls.remove(call_id) {
                        let output: Value = event["output"]
                            .as_str()
                            .and_then(|text| serde_json::from_str(text).ok())
                            .unwrap_or_else(|| event["output"].clone());
                        if async_call && output["accepted"] == true {
                            self.pending_answers += 1;
                            if notify {
                                self.state.input("question");
                            }
                        } else if !async_call
                            && notify
                            && output["answers"].as_object().is_some_and(|answers| {
                                answers.values().any(|answer| {
                                    answer["answers"].as_array().is_some_and(|values| {
                                        values.iter().any(|value| {
                                            value
                                                .as_str()
                                                .is_some_and(|text| !text.trim().is_empty())
                                        })
                                    })
                                })
                            })
                        {
                            self.state.input("answer");
                        }
                    }
                } else if kind == "message"
                    && event["role"] == "user"
                    && self.pending_answers > 0
                    && event["content"].as_array().is_some_and(|items| {
                        items.iter().any(|item| {
                            item["text"].as_str().is_some_and(|text| {
                                text.starts_with("<send_user_message_question_reply>")
                                    && text
                                        .trim_end()
                                        .ends_with("</send_user_message_question_reply>")
                            })
                        })
                    })
                {
                    self.pending_answers -= 1;
                    if notify {
                        self.state.input("answer");
                    }
                }
            }
            Some("event_msg") if !self.subagent => self.event(event, kind, at, notify, rate),
            _ => {}
        }
    }

    fn event(
        &mut self,
        event: &Value,
        kind: &str,
        at: u64,
        notify: bool,
        rate: &mut (u64, Vec<Value>),
    ) {
        if kind == "token_count" {
            if let Some(total) = event
                .pointer("/info/total_token_usage/total_tokens")
                .and_then(Value::as_u64)
            {
                if self.state.total != Some(total) {
                    self.state.at = self.state.at.max(at);
                }
                if self.turn.is_some() {
                    if self.token_base.is_none_or(|base| base > total) {
                        self.token_base = event
                            .pointer("/info/last_token_usage/total_tokens")
                            .and_then(Value::as_u64)
                            .and_then(|last| total.checked_sub(last));
                    }
                    self.state.turn_tokens =
                        self.token_base.and_then(|base| total.checked_sub(base));
                }
                self.state.total = Some(total);
            }
            let limits = &event["rate_limits"];
            if at >= rate.0 && matches!(limits["limit_id"].as_str(), None | Some("codex")) {
                let windows =
                    collect_limits(limits, "used_percent", "window_minutes", "resets_at", at);
                if !windows.is_empty() && at >= rate.0 {
                    *rate = (at, windows);
                }
            }
            return;
        }
        let turn_id = event["turn_id"].as_str();
        if kind == "task_started" {
            if turn_id.is_some() && self.turn.as_deref() != turn_id {
                self.turn = turn_id.map(str::to_owned);
                self.turn_error = None;
                self.token_base = self.state.total;
                self.state.at = self.state.at.max(at);
                self.state.begin(notify);
            }
            return;
        }
        if self.turn.is_none() || (turn_id.is_some() && self.turn.as_deref() != turn_id) {
            return;
        }
        let item = &event["item"];
        match (kind, item["type"].as_str()) {
            ("agent_message", _) | ("item_started" | "item_completed", Some("AgentMessage")) => {
                self.state.at = self.state.at.max(at);
                if notify {
                    self.state.talk_until = at + 2200;
                }
            }
            (
                "item_started" | "item_completed",
                Some("CommandExecution" | "McpToolCall" | "FileChange"),
            ) => {
                self.state.at = self.state.at.max(at);
                self.state.talk_until = 0;
                if kind == "item_completed" && notify {
                    let status = item["status"].as_str();
                    if matches!(
                        status,
                        Some("declined" | "cancelled" | "canceled" | "interrupted")
                    ) {
                        return;
                    }
                    let exit_code = item["exit_code"]
                        .as_i64()
                        .or_else(|| item["exitCode"].as_i64());
                    let command_failed = item["type"] == "CommandExecution"
                        && exit_code.is_some_and(|code| code != 0);
                    let mcp_error = item["type"] == "McpToolCall"
                        && (item["result"]["isError"] == true
                            || item["result"]["is_error"] == true);
                    if status == Some("failed") || command_failed || mcp_error {
                        let name = match item["type"].as_str() {
                            Some("CommandExecution") => "exec_command",
                            Some("FileChange") => "apply_patch",
                            _ => item["tool"]
                                .as_str()
                                .filter(|name| {
                                    matches!(
                                        *name,
                                        "web.search"
                                            | "web_run"
                                            | "search_service.web_run"
                                            | "apply_patch"
                                            | "exec_command"
                                    )
                                })
                                .unwrap_or(""),
                        };
                        let fallback = match exit_code {
                            Some(code) if command_failed => format!("命令退出码为 {code}"),
                            _ => "工具执行失败，请查看软件内提示。".into(),
                        };
                        self.state.tool(true, name, failure(item, &fallback));
                    } else if status == Some("completed") {
                        self.state.tool(false, "", "");
                    }
                }
            }
            ("error", _) if event["will_retry"] != true && event["willRetry"] != true => {
                self.state.at = self.state.at.max(at);
                self.state.talk_until = 0;
                let reason = failure(event, "任务执行失败，请查看软件内提示。");
                self.turn_error = Some(reason);
                if notify {
                    self.state.failed(reason);
                }
            }
            ("task_complete" | "turn_aborted", _) => {
                self.state.at = self.state.at.max(at);
                let (terminal, reason) = if kind == "turn_aborted" {
                    ("interrupted", "本轮被中断")
                } else if let Some(reason) = self.turn_error {
                    ("error", reason)
                } else {
                    ("completed", "")
                };
                self.state.end(terminal, reason, notify);
                self.turn = None;
                self.calls.clear();
            }
            _ => {}
        }
    }
}

fn collect_limits(
    limits: &Value,
    percent: &str,
    duration: &str,
    resets: &str,
    timestamp: u64,
) -> Vec<Value> {
    ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| {
            let item = &limits[key];
            let used = item[percent].as_f64()?;
            let minutes = item[duration].as_u64()?;
            let reset = item[resets].as_u64()?.checked_mul(1000)?;
            ((0.0..=100.0).contains(&used) && minutes > 0 && reset > timestamp)
                .then(|| json!({"minutes":minutes,"remaining":100.0-used,"resetsAt":reset}))
        })
        .collect()
}

fn gui_path() -> Option<PathBuf> {
    windows::paths(&["Codex.exe", "ChatGPT.exe"])
        .into_iter()
        .find(|path| windows::codex_window(path))
}

pub async fn account(home: &Path) -> Option<Value> {
    let path = gui_path()?.parent()?.join("resources/codex.exe");
    let mut app = tokio::process::Command::from(windows::command(&path));
    let mut child = app
        .args(["app-server", "--listen", "stdio://"])
        .env("CODEX_HOME", home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let input = child.stdin.take()?;
    let output = child.stdout.take()?;
    let mut rpc = Rpc {
        input,
        output: tokio::io::BufReader::new(output),
        id: 0,
    };
    let config = tokio::time::timeout(Duration::from_secs(12), async {
        rpc.call(
            "initialize",
            json!({"clientInfo":{"name":"closure_companion","version":env!("CARGO_PKG_VERSION")}}),
        )
        .await?;
        rpc.input
            .write_all(b"{\"method\":\"initialized\"}\n")
            .await
            .ok()?;
        rpc.call("config/read", json!({"includeLayers":false}))
            .await
    })
    .await
    .ok()??;
    let config = &config["config"];
    let name = config["model_provider"].as_str().unwrap_or("openai");
    let provider = &config["model_providers"][name];
    let base = provider["base_url"]
        .as_str()
        .or(config["openai_base_url"].as_str())
        .map(str::to_owned)
        .or_else(|| std::env::var("OPENAI_BASE_URL").ok());
    let balance_query = base.as_deref().filter(|base| heju_origin(base)).map(|_| {
        let key = heju_key(provider, name, home, configured_env);
        tokio::task::spawn_blocking(move || third_party(&key.ok_or("no-key")?))
    });
    let official = |value: Option<&str>, expected: &str| {
        value.is_none_or(|value| {
            url::Url::parse(value).is_ok_and(|url| {
                url.origin().ascii_serialization() == expected
                    && url.username().is_empty()
                    && url.password().is_none()
            })
        })
    };
    let chat = config["chatgpt_base_url"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| std::env::var("CHATGPT_BASE_URL").ok());
    // ChatGPT quota belongs to the account and can be available with a custom model provider.
    let official_account = async {
        if !official(chat.as_deref(), "https://chatgpt.com") {
            return None;
        }
        rpc.call(
            "account/rateLimits/read",
            json!({"excludeResetCreditDetails":true}),
        )
        .await
        .map(|result| parse_official_limits(&result))
    };
    let custom = name != "openai"
        || !official(base.as_deref(), "https://api.openai.com")
        || !official(chat.as_deref(), "https://chatgpt.com");
    let result = account_sources(
        official_account,
        balance_query,
        custom,
        Duration::from_secs(8),
    )
    .await;
    let _ = child.kill().await;
    result
}

type RelayBalance = Result<Value, &'static str>;

async fn account_sources(
    official: impl std::future::Future<Output = Option<Value>>,
    relay: Option<tokio::task::JoinHandle<RelayBalance>>,
    custom: bool,
    wait: Duration,
) -> Option<Value> {
    let official = tokio::time::timeout(wait, official).await.ok().flatten();
    let Some(relay) = relay else {
        return official.or_else(|| custom.then(|| json!({"source":"unsupported","quota":[]})));
    };
    let mut account = official.unwrap_or_else(|| json!({"quota":[]}));
    account["source"] = json!("thirdParty");
    match relay.await.unwrap_or(Err("unavailable")) {
        Ok(balance) => {
            account["balance"] = balance;
            account["balanceStatus"] = json!("ready");
        }
        Err(status) => account["balanceStatus"] = json!(status),
    }
    Some(account)
}

fn heju_origin(base: &str) -> bool {
    url::Url::parse(base).is_ok_and(|url| {
        url.scheme() == "https"
            && matches!(url.host_str(), Some("hejuapi.com" | "www.hejuapi.com"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
    })
}

fn configured_env(name: &str) -> Option<String> {
    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return None;
    }
    std::env::var(name).ok().or_else(|| {
        winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Environment")
            .ok()?
            .get_value(name)
            .ok()
    })
}

fn heju_key(
    provider: &Value,
    name: &str,
    home: &Path,
    lookup: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    let valid = |key: &str| {
        let key = key.trim();
        (key.starts_with("sk-")
            && key.len() > 3
            && key.len() <= 1024
            && key.bytes().all(|b| b.is_ascii_graphic()))
        .then(|| key.to_owned())
    };
    if let Some(key) = provider["env_key"]
        .as_str()
        .and_then(&lookup)
        .as_deref()
        .and_then(valid)
        .or_else(|| {
            provider["experimental_bearer_token"]
                .as_str()
                .and_then(valid)
        })
    {
        return Some(key);
    }
    let header = |field: &str| {
        provider[field]
            .as_object()?
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))?
            .1
            .as_str()
    };
    let header_key = header("env_http_headers")
        .and_then(&lookup)
        .or_else(|| header("http_headers").map(str::to_owned));
    if let Some(key) = header_key
        .as_deref()
        .and_then(|v| v.trim().split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("Bearer"))
        .and_then(|(_, key)| valid(key))
    {
        return Some(key);
    }
    if provider["env_key"].is_string()
        || header("env_http_headers").is_some()
        || header("http_headers").is_some()
    {
        return None;
    }
    // The standard API-key slot belongs to this request only when the active provider uses Codex authentication.
    if name != "openai" && provider["requires_openai_auth"] != true {
        return None;
    }
    #[derive(serde::Deserialize)]
    struct ApiKeyLogin {
        #[serde(rename = "OPENAI_API_KEY")]
        key: Option<String>,
        auth_mode: Option<String>,
        tokens: Option<serde::de::IgnoredAny>,
    }
    let login =
        match crate::settings::read_json::<ApiKeyLogin>(&home.join("auth.json"), 1024 * 1024) {
            Ok(login)
                if login.tokens.is_none()
                    && login
                        .auth_mode
                        .as_deref()
                        .is_none_or(|mode| mode.eq_ignore_ascii_case("apikey")) =>
            {
                Some(login)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            _ => return None,
        };
    lookup("OPENAI_API_KEY")
        .or_else(|| login.and_then(|login| login.key))
        .as_deref()
        .and_then(valid)
        .filter(|key| {
            !["sk-proj-", "sk-svcacct-", "sk-admin-"]
                .iter()
                .any(|prefix| key.starts_with(prefix))
        })
}

fn parse_official_limits(result: &Value) -> Value {
    let limits = result
        .pointer("/rateLimitsByLimitId/codex")
        .unwrap_or(&result["rateLimits"]);
    let quantity = limits["credits"]["balance"].as_str().filter(|balance| {
        balance.len() <= 25
            && balance.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            && balance.parse::<f64>().is_ok_and(f64::is_finite)
    });
    let credits = if limits["credits"]["unlimited"] == true {
        Some(json!({"unlimited":true}))
    } else {
        quantity.map(|balance| json!({"balance":balance}))
    };
    let quota = collect_limits(
        limits,
        "usedPercent",
        "windowDurationMins",
        "resetsAt",
        now(),
    );
    json!({"source":"official","quota":quota,"credits":credits})
}

fn third_party(key: &str) -> RelayBalance {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(8)))
        .max_redirects(0)
        .build()
        .into();
    let value: Value = agent
        .get("https://www.hejuapi.com/api/usage/account")
        .header("Authorization", format!("Bearer {key}"))
        .call()
        .map_err(|error| match error {
            ureq::Error::StatusCode(401 | 403) => "unauthorized",
            ureq::Error::StatusCode(429) => "rate-limited",
            ureq::Error::Timeout(_) => "timeout",
            ureq::Error::StatusCode(_) => "service-error",
            _ => "network",
        })?
        .body_mut()
        .with_config()
        .limit(64 * 1024)
        .read_json()
        .map_err(|_| "invalid-response")?;
    parse_heju_balance(&value)
}

fn parse_heju_balance(value: &Value) -> RelayBalance {
    if value["success"] != true {
        return Err("service-error");
    }
    let amount = &value["data"]["remaining"];
    let remaining = amount
        .as_f64()
        .or_else(|| amount.as_str()?.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .ok_or("invalid-response")?;
    let unit = value["data"]["unit"]
        .as_str()
        .filter(|unit| {
            matches!(
                *unit,
                "CNY"
                    | "USD"
                    | "EUR"
                    | "JPY"
                    | "HKD"
                    | "GBP"
                    | "CAD"
                    | "AUD"
                    | "SGD"
                    | "TWD"
                    | "KRW"
            )
        })
        .unwrap_or("");
    Ok(json!({"remaining":remaining,"unit":unit}))
}

struct Rpc {
    input: tokio::process::ChildStdin,
    output: tokio::io::BufReader<tokio::process::ChildStdout>,
    id: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, thread, time::SystemTime};

    #[test]
    fn completed_tools_count_failures_without_classifying_commands_or_stdout_as_errors() {
        let mut rollout = Rollout::default();
        let mut rate = (0, vec![]);
        let mut record = |payload: Value, notify_since| {
            let line =
                json!({"timestamp":"2026-01-01T00:00:00Z","type":"event_msg","payload":payload});
            rollout.record(&line.to_string(), notify_since, &mut rate);
            rollout.state.snapshot("conversation", 0)["tools"].clone()
        };
        record(json!({"type":"task_started","turn_id":"one"}), Some(0));
        let mut completed = |item, since| {
            record(
                json!({"type":"item_completed","turn_id":"one","item":item}),
                since,
            )
        };
        let command = json!({"type":"CommandExecution","status":"completed","exit_code":7,
            "command":"echo 429","aggregated_output":"timeout"});
        assert_eq!(completed(command.clone(), None)["fail"], 0);
        let tools = completed(command, Some(0));
        assert_eq!(
            tools,
            json!({"ok":0,"fail":1,"lastFailName":"exec_command","lastFailReason":"命令退出码为 7"})
        );
        let tools = completed(
            json!({"type":"CommandExecution","status":"failed","exitCode":0}),
            Some(0),
        );
        assert_eq!(tools["fail"], 2);
        let tools = completed(
            json!({"type":"FileChange","status":"failed","changes":{"path":"timeout"},
            "error":{"message":"timed out","httpStatusCode":403}}),
            Some(0),
        );
        assert_eq!(tools["lastFailReason"], "权限不足或访问被拒绝");
        assert_eq!(tools["lastFailName"], "apply_patch");
        let tools = completed(
            json!({"type":"McpToolCall","status":"completed","tool":"web_run",
            "result":{"isError":true,"structuredContent":{"error":{"code":-32602}}}}),
            Some(0),
        );
        assert_eq!(tools["fail"], 4);
        assert_eq!(tools["lastFailReason"], "工具参数无效");
        let tools = completed(
            json!({"type":"CommandExecution","status":"declined","exit_code":1}),
            Some(0),
        );
        assert_eq!(tools["fail"], 4);
        assert_eq!(tools["ok"], 0);
        for kind in ["CommandExecution", "FileChange", "McpToolCall"] {
            completed(
                json!({"type":kind,"status":"completed","exit_code":0,"arguments":"HTTP 429"}),
                Some(0),
            );
        }
        let tools = completed(
            json!({"type":"CommandExecution","status":"in_progress"}),
            Some(0),
        );
        assert_eq!(tools["ok"], 3);
        assert_eq!(tools["fail"], 4);
    }

    #[test]
    fn error_summaries_prefer_explicit_error_fields() {
        assert_eq!(
            failure(
                &json!({"codex_error_info":{"httpConnectionFailed":{"http_status_code":429}},
            "message":"connection timed out"}),
                "fallback"
            ),
            "请求频率或额度受限"
        );
        assert_eq!(
            failure(
                &json!({"error":{"codexErrorInfo":"contextWindowExceeded"}}),
                "fallback"
            ),
            "超出模型上下文长度"
        );
        assert_eq!(
            failure(
                &json!({"type":"McpToolCall","result":{"content":[{"type":"text","text":"HTTP 502"}]}}),
                "fallback"
            ),
            "上游服务响应异常"
        );
        assert_eq!(
            failure(
                &json!({"message":"processed 429 files","arguments":"timeout","output":"HTTP 403"}),
                "fallback"
            ),
            "fallback"
        );
    }

    #[test]
    fn heju_uses_only_the_key_configured_for_the_selected_provider() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let lookup = |name: &str| (name == "RELAY_KEY").then(|| "sk-relay-fixture".to_owned());
        let key = |provider: Value| heju_key(&provider, "heju", home, lookup);
        let api_login = json!({"auth_mode":"apikey","OPENAI_API_KEY":"sk-file-fixture"});
        crate::settings::write_json(&home.join("auth.json"), &api_login).unwrap();
        assert_eq!(
            key(json!({"env_key":"RELAY_KEY"})).as_deref(),
            Some("sk-relay-fixture")
        );
        assert_eq!(
            key(json!({"experimental_bearer_token":"sk-inline-fixture"})).as_deref(),
            Some("sk-inline-fixture")
        );
        assert_eq!(
            key(json!({"http_headers":{"Authorization":"Bearer sk-header-fixture"}})).as_deref(),
            Some("sk-header-fixture")
        );
        assert_eq!(
            key(json!({"requires_openai_auth":true})).as_deref(),
            Some("sk-file-fixture")
        );
        assert!(key(json!({"requires_openai_auth":true,"env_key":"MISSING"})).is_none());
        assert!(key(json!({})).is_none());
        crate::settings::write_json(
            &home.join("auth.json"),
            &json!({"auth_mode":"chatgpt","OPENAI_API_KEY":"sk-unrelated","tokens":{}}),
        )
        .unwrap();
        assert!(key(json!({"requires_openai_auth":true})).is_none());
        assert!(heju_origin("https://www.hejuapi.com/v1"));
        for other in [
            "http://hejuapi.com",
            "https://hejuapi.com.example.org",
            "https://user@hejuapi.com",
            "https://hejuapi.com:8443",
        ] {
            assert!(!heju_origin(other));
        }
    }

    #[test]
    fn official_quota_and_relay_balance_can_fail_independently() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let ready = parse_heju_balance(
                &json!({"success":true,"data":{"remaining":"0.00","unit":"CNY"}}),
            )
            .unwrap();
            let account = account_sources(
                std::future::pending(),
                Some(tokio::spawn(async { Ok(ready) })),
                true,
                Duration::from_millis(2),
            )
            .await
            .unwrap();
            assert_eq!(account["balance"]["remaining"], 0.0);
            assert_eq!(account["balanceStatus"], "ready");
            let official = json!({"credits":{"balance":"8"}, "quota":[{"remaining":15}]});
            let account = account_sources(
                async { Some(official.clone()) },
                Some(tokio::spawn(async { Err("unauthorized") })),
                true,
                Duration::from_secs(1),
            )
            .await
            .unwrap();
            assert_eq!(account["credits"], official["credits"]);
            assert_eq!(account["quota"], official["quota"]);
            assert_eq!(account["balanceStatus"], "unauthorized");
        });
        for invalid in [Value::Null, json!(""), json!("NaN"), json!(true)] {
            assert_eq!(
                parse_heju_balance(&json!({"success":true,"data":{"remaining":invalid}})),
                Err("invalid-response")
            );
        }
    }

    fn event(at: u64, kind: &str, turn: &str) -> String {
        let timestamp = chrono::DateTime::from_timestamp_millis(at as i64)
            .unwrap()
            .to_rfc3339();
        format!(
            "{}\n",
            json!({"timestamp":timestamp,"type":"event_msg","payload":{"type":kind,"turn_id":turn}})
        )
    }

    #[test]
    fn resumed_old_rollout_emits_only_new_events_including_a_split_record() {
        let temp = tempfile::tempdir().unwrap();
        let sessions = temp.path().join("sessions");
        let start = now();
        let old = start - 3 * 86_400_000;
        let date = chrono::DateTime::from_timestamp_millis(old as i64)
            .unwrap()
            .format("%Y/%m/%d");
        let directory = sessions.join(date.to_string());
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("rollout-old.jsonl");
        fs::write(
            &path,
            event(old, "task_started", "a") + &event(old + 1, "task_complete", "a"),
        )
        .unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_millis(old))
            .unwrap();
        let mut codex = Codex::default();
        codex.refresh_rollouts(&sessions, start);
        assert!(!codex.files.contains_key(&path));
        let append = |bytes: &[u8]| {
            File::options()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(bytes)
                .unwrap();
        };
        let end = event(start + 2, "task_complete", "b");
        append((event(start + 1, "task_started", "b") + end.trim_end()).as_bytes());
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_millis(old))
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !codex.files.contains_key(&path) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            codex.refresh_rollouts(&sessions, now());
        }
        let snapshot = |c: &Codex| c.files[&path].state.snapshot("old", now());
        assert_eq!(snapshot(&codex)["turnStartSeq"], 1);
        assert_eq!(snapshot(&codex)["turnEnd"]["seq"], 0);
        append(b"\n");
        codex.refresh_rollouts(&sessions, now());
        codex.refresh_rollouts(&sessions, now());
        assert_eq!(snapshot(&codex)["turnStartSeq"], 1);
        assert_eq!(snapshot(&codex)["turnEnd"]["seq"], 1);
        let mut reopened = Codex::default();
        reopened.refresh_rollouts(&sessions, now());
        assert_eq!(snapshot(&reopened)["turnEnd"]["seq"], 0);
        assert!(!reopened.files[&path].state.active);
    }
}

impl Rpc {
    async fn call(&mut self, method: &str, params: Value) -> Option<Value> {
        self.id += 1;
        let request = json!({"id":self.id,"method":method,"params":params});
        self.input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .ok()?;
        let mut line = String::new();
        loop {
            line.clear();
            if self.output.read_line(&mut line).await.ok()? == 0 {
                return None;
            }
            if let Ok(response) = serde_json::from_str::<Value>(&line) {
                if response["id"] == self.id {
                    return response.get("result").cloned();
                }
            }
        }
    }
}
