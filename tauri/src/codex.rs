use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use chrono::{Local, TimeDelta};
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
    pub fn tick(&mut self, home: &Path, account: &Value) -> Host {
        let timestamp = now();
        for days in [0, 1] {
            let date = Local::now() - TimeDelta::days(days);
            let folder = home
                .join("sessions")
                .join(date.format("%Y/%m/%d").to_string());
            let Ok(entries) = fs::read_dir(folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
                    continue;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                let Some(age) = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.elapsed().ok())
                else {
                    continue;
                };
                if age.as_millis() > RECENT as u128 || !metadata.is_file() {
                    continue;
                }
                let file = entry.path();
                let known = self.files.contains_key(&file);
                let rollout = self.files.entry(file.clone()).or_default();
                if let Err(error) = rollout.read(
                    &file,
                    metadata.len(),
                    known || age.as_secs() <= 2,
                    &mut self.rate,
                ) {
                    eprintln!("Codex rollout read failed: {}", error.kind());
                }
            }
        }
        self.files.retain(|_, rollout| {
            timestamp.saturating_sub(rollout.state.at) < RECENT || rollout.state.at == 0
        });
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
        notify: bool,
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
            self.record(&header, false, rate);
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
                self.record(line, notify && !truncated, rate);
            }
        }
        self.offset = start + last as u64 + 1;
        Ok(())
    }

    fn record(&mut self, line: &str, notify: bool, rate: &mut (u64, Vec<Value>)) {
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
                if !windows.is_empty() {
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
                    let failed = item["type"] == "McpToolCall"
                        && (item["status"] == "failed"
                            || item["result"]["isError"] == true
                            || item["result"]["is_error"] == true);
                    if failed
                        || (item["status"] == "completed"
                            && item["exit_code"].as_i64().unwrap_or(0) == 0)
                    {
                        let name = item["tool"]
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
                            .unwrap_or("");
                        self.state.tool(
                            failed,
                            name,
                            failure(item, "工具执行失败，请查看软件内提示。"),
                        );
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
    let result = tokio::time::timeout(std::time::Duration::from_secs(12), async {
        rpc.call(
            "initialize",
            json!({"clientInfo":{"name":"closure_companion","version":env!("CARGO_PKG_VERSION")}}),
        )
        .await?;
        rpc.input
            .write_all(b"{\"method\":\"initialized\"}\n")
            .await
            .ok()?;
        let config = rpc
            .call("config/read", json!({"includeLayers":false}))
            .await?;
        let config = &config["config"];
        let name = config["model_provider"].as_str().unwrap_or("openai");
        let provider = &config["model_providers"][name];
        let base = provider["base_url"]
            .as_str()
            .or(config["openai_base_url"].as_str())
            .map(str::to_owned)
            .or_else(|| std::env::var("OPENAI_BASE_URL").ok());
        if base
            .as_deref()
            .and_then(|url| url::Url::parse(url).ok())
            .is_some_and(|url| {
                url.scheme() == "https"
                    && matches!(url.host_str(), Some("hejuapi.com" | "www.hejuapi.com"))
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.port().is_none()
            })
        {
            let key = provider["env_key"]
                .as_str()
                .and_then(|key| std::env::var(key).ok())
                .or_else(|| {
                    provider["experimental_bearer_token"]
                        .as_str()
                        .map(str::to_owned)
                });
            let balance = tokio::task::spawn_blocking(move || key.as_deref().and_then(third_party))
                .await
                .ok()
                .flatten();
            return Some(json!({"source":"thirdParty", "quota":[], "balance":balance}));
        }
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
        if name != "openai"
            || !official(base.as_deref(), "https://api.openai.com")
            || !official(chat.as_deref(), "https://chatgpt.com")
        {
            return Some(json!({"source":"unsupported", "quota":[]}));
        }
        let account = rpc
            .call("account/read", json!({"refreshToken":false}))
            .await?;
        if account["account"]["type"] != "chatgpt" {
            return Some(json!({"source":"unsupported", "quota":[]}));
        }
        let result = rpc
            .call(
                "account/rateLimits/read",
                json!({"excludeResetCreditDetails":true}),
            )
            .await?;
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
        Some(json!({"source":"official","quota":quota,"credits":credits}))
    })
    .await
    .ok()
    .flatten();
    let _ = child.kill().await;
    result
}

fn third_party(key: &str) -> Option<Value> {
    let key = key.trim();
    if !key.starts_with("sk-") || key.chars().any(char::is_whitespace) {
        return None;
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(8)))
        .max_redirects(0)
        .build()
        .into();
    let value: Value = agent
        .get("https://www.hejuapi.com/api/usage/account")
        .header("Authorization", format!("Bearer {key}"))
        .call()
        .ok()?
        .body_mut()
        .with_config()
        .limit(64 * 1024)
        .read_json()
        .ok()?;
    if value["success"] != true {
        return None;
    }
    let remaining = value["data"]["remaining"].as_f64()?;
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
    Some(json!({"remaining":remaining,"unit":unit}))
}

struct Rpc {
    input: tokio::process::ChildStdin,
    output: tokio::io::BufReader<tokio::process::ChildStdout>,
    id: u32,
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
