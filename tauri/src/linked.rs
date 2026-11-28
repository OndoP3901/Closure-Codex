use std::{
    collections::HashMap,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use crate::settings::{read_json, write_json, Settings};

pub const HOSTS: [&str; 4] = ["codex", "dsh", "workbuddy", "antigravity"];
const NAMES: [&str; HOSTS.len()] = ["Codex", "DSH", "WorkBuddy", "Antigravity"];
pub const ANTIGRAVITY: usize = 3;
const SIGNALS: [&str; 6] = [
    "/turnStartSeq",
    "/turnEnd/seq",
    "/tools/ok",
    "/tools/fail",
    "/errors/count",
    "/userInput/seq",
];

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn enabled(settings: Settings, host: usize) -> bool {
    [
        settings.codex_linked,
        settings.dsh_linked,
        settings.workbuddy_linked,
        settings.antigravity_linked,
    ][host]
}

#[derive(Default)]
pub struct Host {
    pub instance: String,
    pub connected: bool,
    pub conversations: Vec<Value>,
    pub account: Value,
}

#[derive(Default)]
pub struct Hub(Mutex<Tracker>);

#[derive(Default)]
struct Tracker {
    hosts: [Host; HOSTS.len()],
    previous: [HashMap<String, [u64; 6]>; HOSTS.len()],
    totals: [u64; 6],
    focus: Option<String>,
    revision: u64,
    details: [Value; 6],
}

impl Hub {
    pub fn set(&self, index: usize, host: Host) {
        let mut state = self.0.lock().unwrap();
        let prior = &state.hosts[index];
        if !host.connected || !prior.connected || host.instance != prior.instance {
            state.previous[index] = host
                .conversations
                .iter()
                .filter_map(|value| Some((value["id"].as_str()?.to_owned(), counters(value))))
                .collect();
        }
        state.hosts[index] = host;
    }

    pub fn status(&self, settings: Settings) -> Value {
        Value::Object(
            self.0
                .lock()
                .unwrap()
                .hosts
                .iter()
                .enumerate()
                .filter(|(index, _)| enabled(settings, *index))
                .map(|(index, host)| {
                    (
                        HOSTS[index].into(),
                        json!({"status": if host.connected { "connected" } else { "waiting" }}),
                    )
                })
                .collect(),
        )
    }

    pub fn snapshot(&self, settings: Settings) -> Value {
        let mut state = self.0.lock().unwrap();
        let mut candidates = Vec::new();
        let mut accounts = Vec::new();
        let time = now();
        for index in 0..HOSTS.len() {
            let host = &state.hosts[index];
            if !enabled(settings, index) || !host.connected {
                continue;
            }
            let mut account = object(&host.account);
            account.extend(object(
                &json!({"host":HOSTS[index], "name":NAMES[index], "connected":true}),
            ));
            accounts.push(Value::Object(account));
            let mut next = HashMap::new();
            for conversation in &host.conversations {
                let Some(id) = conversation["id"].as_str() else {
                    continue;
                };
                let counts = counters(conversation);
                let before = state.previous[index].get(id).copied().unwrap_or_default();
                let delta = std::array::from_fn::<_, 6, _>(|i| counts[i].saturating_sub(before[i]));
                next.insert(id.to_owned(), counts);
                let key = json!([HOSTS[index], host.instance, id]).to_string();
                let at = conversation["lastActivityAt"]
                    .as_u64()
                    .unwrap_or_default()
                    .min(time);
                let active = conversation["work"]["active"].as_bool().unwrap_or_default();
                candidates.push((
                    at,
                    state.focus.as_ref() == Some(&key),
                    active,
                    key,
                    index,
                    delta,
                    conversation.clone(),
                ));
            }
            state.previous[index] = next;
        }
        candidates.sort_by(|a, b| {
            (b.0, b.1, b.2)
                .cmp(&(a.0, a.1, a.2))
                .then_with(|| a.3.cmp(&b.3))
        });
        let selected = candidates.first();
        let focus = selected.map(|candidate| candidate.3.clone());
        if state.focus != focus {
            state.revision += 1;
            state.focus = focus;
        }
        let mut companion = Map::new();
        let mut work = json!({"active":false,"mode":"idle"});
        if let Some((_, _, _, _, index, delta, value)) = selected {
            companion = object(&state.hosts[*index].account);
            companion.extend(object(&value["closureCompanion"]));
            work = value["work"].clone();
            for (position, amount) in delta.iter().enumerate() {
                state.totals[position] = state.totals[position].saturating_add(*amount);
                if *amount != 0 {
                    state.details[position] = match position {
                        1 => value["turnEnd"].clone(),
                        3 => {
                            json!({"lastFailName": value["tools"]["lastFailName"], "lastFailReason": value["tools"]["lastFailReason"]})
                        }
                        4 => json!({"message": value["errors"]["message"]}),
                        5 => json!({"scene": value["userInput"]["scene"]}),
                        _ => Value::Null,
                    };
                    if let Some(details) = state.details[position].as_object_mut() {
                        details.insert("host".into(), json!(HOSTS[*index]));
                    }
                }
            }
        }
        companion.entry("quota").or_insert(json!([]));
        companion.extend(object(&json!({
            "focusKey":state.focus,"focusRevision":state.revision,"following":!accounts.is_empty(),"accounts":accounts,
        })));
        let mut end = object(&state.details[1]);
        end.entry("kind").or_insert(json!("completed"));
        end.insert("seq".into(), json!(state.totals[1]));
        if end["kind"] == "error" {
            end.insert("errorSeq".into(), json!(state.totals[4]));
        }
        json!({
            "closureCompanion":companion,"work":work,"turnStartSeq":state.totals[0],"turnEnd":end,
            "tools":with(&state.details[3], json!({"ok":state.totals[2],"fail":state.totals[3]})),
            "errors":with(&state.details[4], json!({"count":state.totals[4]})),
            "userInput":with(&state.details[5], json!({"seq":state.totals[5]})),
        })
    }
}

fn counters(value: &Value) -> [u64; 6] {
    SIGNALS.map(|path| {
        value
            .pointer(path)
            .and_then(Value::as_u64)
            .unwrap_or_default()
    })
}

fn object(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn with(base: &Value, fields: Value) -> Value {
    let mut result = object(base);
    result.extend(object(&fields));
    Value::Object(result)
}

pub fn dsh(directory: &Path, enabled: bool) -> Host {
    let directory = directory.join("ClosureCompanion/bridges");
    let timestamp = now();
    if write_json(
        &directory.join("dsh-request.json"),
        &json!({"enabled":enabled,"updatedAt":timestamp}),
    )
    .is_err()
        || !enabled
    {
        return Host::default();
    }
    read_dsh(&directory, timestamp)
}

pub fn read_dsh(directory: &Path, timestamp: u64) -> Host {
    let Ok(value) = read_json::<Value>(&directory.join("dsh.json"), 1024 * 1024) else {
        return Host::default();
    };
    let at = value["updatedAt"].as_u64().unwrap_or_default();
    let Some(instance) = value["instance"].as_str() else {
        return Host::default();
    };
    let state = &value["state"];
    if value["version"] != 1
        || value["host"] != "dsh"
        || at > timestamp + 5000
        || timestamp.saturating_sub(at) > 15000
        || !state["tools"].is_object()
        || !state["turnEnd"].is_object()
    {
        return Host::default();
    }
    let conversations = state["conversations"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| {
            vec![with(
                state,
                json!({"id":"dsh","lastActivityAt":state["lastEventAt"]}),
            )]
        });
    let balance = &value["balance"];
    let wallets = |key: &str| {
        balance[key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let currency = item["currency"].as_str()?;
                let amount = item["balance"].as_str()?;
                (balance["status"] == "ready"
                    && matches!(currency, "CNY" | "USD")
                    && amount.parse::<f64>().is_ok_and(f64::is_finite))
                .then(|| json!({"currency":currency,"balance":amount}))
            })
            .collect::<Vec<_>>()
    };
    Host {
        instance: instance.into(),
        connected: true,
        conversations,
        account: with(
            &state["closureCompanion"],
            json!({"host":"dsh","source":"official","quota":[],
            "accountStatus":balance["status"].as_str().unwrap_or("unavailable"),"wallets":wallets("wallets"),"bonusWallets":wallets("bonusWallets")}),
        ),
    }
}

#[derive(Default)]
pub struct Conversation {
    pub at: u64,
    pub active: bool,
    pub talk_until: u64,
    pub total: Option<u64>,
    pub turn_tokens: Option<u64>,
    start: u64,
    complete: u64,
    tool_ok: u64,
    tool_fail: u64,
    errors: u64,
    input: u64,
    end_kind: String,
    error: String,
    end_reason: String,
    tool_name: String,
    tool_reason: String,
    scene: String,
}

impl Conversation {
    pub fn begin(&mut self, notify: bool) {
        self.active = true;
        self.talk_until = 0;
        self.turn_tokens = None;
        self.start += u64::from(notify);
    }

    pub fn end(&mut self, kind: &str, reason: &str, notify: bool) {
        self.active = false;
        if notify {
            self.complete += 1;
            self.end_kind = kind.into();
            self.end_reason = reason.into();
        }
    }

    pub fn failed(&mut self, reason: &str) {
        self.errors += 1;
        self.error = reason.into();
    }

    pub fn tool(&mut self, failed: bool, name: &str, reason: &str) {
        if failed {
            self.tool_fail += 1;
            if name.len() <= 64
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b" _.:/-".contains(&b))
            {
                self.tool_name = name.into();
            } else {
                self.tool_name.clear();
            }
            self.tool_reason = reason.into();
        } else {
            self.tool_ok += 1;
        }
    }

    pub fn input(&mut self, kind: &str) {
        self.input += 1;
        self.scene = kind.into();
    }

    pub fn snapshot(&self, id: &str, timestamp: u64) -> Value {
        let active = self.active && timestamp.saturating_sub(self.at) < 20 * 60_000;
        let mode = if !active {
            "idle"
        } else if self.talk_until > timestamp {
            "outputting"
        } else {
            "thinking"
        };
        let usage = self
            .total
            .map(|total| json!({"total":total,"turn":self.turn_tokens}));
        json!({
            "id":id,"lastActivityAt":self.at,"work":{"active":active,"mode":mode},
            "turnStartSeq":self.start,"turnEnd":{"seq":self.complete,"kind":self.end_kind,"reason":self.end_reason},
            "tools":{"ok":self.tool_ok,"fail":self.tool_fail,"lastFailName":self.tool_name,"lastFailReason":self.tool_reason},
            "errors":{"count":self.errors,"message":self.error},"userInput":{"seq":self.input,"scene":self.scene},
            "closureCompanion":{"tokenUsage":usage}
        })
    }
}

fn http_failure(code: i64) -> Option<&'static str> {
    Some(match code {
        400 => "请求参数无效",
        401 => "身份验证失败",
        403 => "权限不足或访问被拒绝",
        404 => "资源或接口不存在",
        408 | 504 => "请求超时",
        429 => "请求频率或额度受限",
        500 => "服务端内部错误",
        502 => "上游服务响应异常",
        503 => "服务暂不可用",
        500..=599 => "服务端错误",
        _ => return None,
    })
}

fn structured_failure(error: &Value) -> Option<&'static str> {
    let info = error
        .get("codex_error_info")
        .or_else(|| error.get("codexErrorInfo"));
    let variant = info
        .and_then(Value::as_object)
        .and_then(|map| map.iter().next());
    let number = |v: &Value| v.as_i64().or_else(|| v.as_str()?.parse().ok());
    for reason in variant
        .map(|(_, details)| details)
        .into_iter()
        .chain([error])
    {
        if let Some(message) = [
            "http_status_code",
            "httpStatusCode",
            "statusCode",
            "status_code",
        ]
        .iter()
        .find_map(|field| reason.get(*field).and_then(number).and_then(http_failure))
        {
            return Some(message);
        }
    }
    match error.get("code").and_then(number) {
        Some(-32700) => return Some("服务无法解析请求"),
        Some(-32600) => return Some("请求格式无效"),
        Some(-32601) => return Some("服务未提供此工具"),
        Some(-32602) => return Some("工具参数无效"),
        Some(-32603) => return Some("服务端内部错误"),
        _ => {}
    }
    let kind = info
        .and_then(Value::as_str)
        .or_else(|| variant.map(|(key, _)| key.as_str()))
        .or_else(|| error.get("code")?.as_str())?;
    Some(match kind.replace('_', "").to_ascii_lowercase().as_str() {
        "contextwindowexceeded" => "超出模型上下文长度",
        "sessionbudgetexceeded" => "已达到会话预算上限",
        "usagelimitexceeded" | "insufficientquota" => "已达到使用额度上限",
        "ratelimitexceeded" => "请求频率受限",
        "unauthorized" => "身份验证失败",
        "serveroverloaded" | "flexunavailable" => "服务暂不可用",
        "internalservererror" => "服务端内部错误",
        "modelnotfound" => "找不到所选模型",
        "sandboxerror" => "沙箱限制或执行错误",
        "badrequest" => "请求参数无效",
        "httpconnectionfailed" | "responsestreamconnectionfailed" => "连接失败",
        "responsestreamdisconnected" => "服务连接中断",
        _ => return None,
    })
}

fn message_failure(message: &str) -> Option<&'static str> {
    let text = message[..message.floor_char_boundary(4096)].to_ascii_lowercase();
    for prefix in [
        "http/1.1 ",
        "http/2 ",
        "http ",
        "status code",
        "http status",
        "response code",
    ] {
        if let Some((_, tail)) = text.split_once(prefix) {
            let code = tail
                .trim_start_matches([' ', ':', '='])
                .split(|ch: char| !ch.is_ascii_digit())
                .next()
                .and_then(|s| s.parse().ok());
            if let Some(reason) = code.and_then(http_failure) {
                return Some(reason);
            }
        }
    }
    [
        ("context length", "超出模型上下文长度"),
        ("context window", "超出模型上下文长度"),
        ("rate limit", "请求过于频繁"),
        ("too many requests", "请求过于频繁"),
        ("timeout", "请求超时"),
        ("timed out", "请求超时"),
        ("deadline exceeded", "请求超时"),
        ("enotfound", "域名解析失败"),
        ("dns", "域名解析失败"),
        ("tls", "TLS 连接或证书校验失败"),
        ("certificate", "TLS 连接或证书校验失败"),
        ("permission denied", "权限不足"),
        ("connection", "连接失败"),
        ("unauthorized", "登录或授权失败"),
        ("quota", "可用额度不足"),
    ]
    .into_iter()
    .find_map(|(needle, reason)| text.contains(needle).then_some(reason))
}

pub fn failure<'a>(value: &Value, default: &'a str) -> &'a str {
    let errors = [
        value.get("error"),
        value.pointer("/result/structuredContent/error"),
        value.pointer("/result/structured_content/error"),
        value.pointer("/result/error"),
        Some(value),
    ]
    .into_iter()
    .flatten();
    errors
        .clone()
        .find_map(structured_failure)
        .or_else(|| {
            errors
                .filter_map(|e| e.as_str().or_else(|| e["message"].as_str()))
                .find_map(message_failure)
        })
        .or_else(|| {
            if value["type"] != "McpToolCall" {
                return None;
            }
            value
                .pointer("/result/content")?
                .as_array()?
                .iter()
                .take(4)
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .find_map(message_failure)
        })
        .unwrap_or(default)
}
