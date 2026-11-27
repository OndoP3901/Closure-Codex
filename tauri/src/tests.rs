use std::{net::TcpListener, path::Path, time::Duration};

use serde_json::{json, Value};

use crate::{
    codex,
    linked::{self, now, Host, Hub},
    settings::{self, Settings},
    windows,
};

fn host(instance: &str, id: &str, at: u64, turns: u64) -> Host {
    Host {
        instance: instance.into(),
        connected: true,
        conversations: vec![json!({
            "id": id, "lastActivityAt": at, "turnStartSeq": turns,
            "work": {"active": true, "mode": "thinking"}
        })],
        account: json!({"source":"official"}),
    }
}

#[test]
fn newest_conversation_wins_without_replaying_other_events() {
    let settings = Settings {
        codex_linked: true,
        dsh_linked: true,
        ..Default::default()
    };
    let hub = Hub::default();
    let time = now() - 100;
    hub.set(0, host("codex", "first", time, 14));
    hub.set(1, host("dsh", "other", time - 1, 24));
    assert_eq!(hub.snapshot(settings)["turnStartSeq"], 0);
    hub.set(1, host("dsh", "other", time + 2, 25));
    hub.set(0, host("codex", "first", time + 1, 15));
    let value = hub.snapshot(settings);
    assert_eq!(value["turnStartSeq"], 1);
    assert!(value["closureCompanion"]["focusKey"]
        .as_str()
        .unwrap()
        .contains("dsh"));
    hub.set(0, host("codex", "first", time + 3, 15));
    let value = hub.snapshot(settings);
    assert_eq!(value["turnStartSeq"], 1);
    assert!(value["closureCompanion"]["focusKey"]
        .as_str()
        .unwrap()
        .contains("codex"));
    hub.set(1, host("reconnected", "other", time + 4, 80));
    assert_eq!(hub.snapshot(settings)["turnStartSeq"], 1);
}

#[test]
fn dsh_lease_rejects_stale_snapshots_and_reads_wallets() {
    let temp = tempfile::tempdir().unwrap();
    let bridge = temp.path().join("ClosureCompanion/bridges");
    let mut value = json!({"version":1,"host":"dsh","instance":"fixture","updatedAt":now(),
        "state":{"tools":{"ok":0,"fail":0},"turnEnd":{"seq":0},"conversations":[]},
        "balance":{"status":"ready","wallets":[{"currency":"CNY","balance":"0.00"},{"currency":"USD","balance":"NaN"}],
            "bonusWallets":[{"currency":"USD","balance":"3.00"}]}});
    settings::write_json(&bridge.join("dsh.json"), &value).unwrap();
    let host = linked::dsh(temp.path(), true);
    assert!(host.connected);
    assert_eq!(
        host.account["wallets"],
        json!([{"currency":"CNY","balance":"0.00"}])
    );
    assert_eq!(host.account["bonusWallets"][0]["balance"], "3.00");
    value["updatedAt"] = json!(now() - 16_000);
    settings::write_json(&bridge.join("dsh.json"), &value).unwrap();
    assert!(!linked::dsh(temp.path(), true).connected);
    linked::dsh(temp.path(), false);
    let request: Value = settings::read_json(&bridge.join("dsh-request.json"), 1024).unwrap();
    assert_eq!(request["enabled"], false);
}

#[test]
fn windows_accepts_only_the_verified_loopback_listener() {
    let local = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = local.local_addr().unwrap().port();
    let exe = std::env::current_exe().unwrap();
    assert!(windows::owns_listener(port, &exe));
    assert!(!windows::owns_listener(port, Path::new("C:/unrelated.exe")));
    let wildcard = TcpListener::bind(("0.0.0.0", 0)).unwrap();
    assert!(!windows::owns_listener(
        wildcard.local_addr().unwrap().port(),
        &exe
    ));
}

#[test]
#[ignore = "requires a running Store Codex with an active account"]
fn codex_reads_live_account_without_logging_balances() {
    let home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::home_dir().unwrap().join(".codex"));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime
        .block_on(codex::account(&home))
        .expect("Codex app-server did not return account state");
    let account = codex::Codex::default().tick(&home, &result);
    assert!(account.connected);
    assert!(result["quota"].as_array().is_some());
    assert!(matches!(
        result["source"].as_str(),
        Some("official" | "thirdParty" | "unsupported")
    ));
}

#[test]
#[ignore = "requires the running DSH bridge and WorkBuddy companion connection"]
fn dsh_and_workbuddy_read_live_accounts_without_logging_balances() {
    let local = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
    let dsh = linked::read_dsh(&local.join("ClosureCompanion/bridges"), now());
    assert!(
        dsh.connected,
        "DSH did not produce a current bridge snapshot"
    );
    assert!(
        matches!(
            dsh.account["accountStatus"].as_str(),
            Some("ready" | "signed-out")
        ),
        "DSH account service did not finish"
    );

    let executable = crate::workbuddy::executable(&local);
    let mut adapter = crate::workbuddy::WorkBuddy::default();
    let deadline = std::time::Instant::now() + Duration::from_secs(12);
    loop {
        let host = adapter.tick(&local, &executable);
        if host.connected {
            assert!(
                matches!(
                    host.account["accountStatus"].as_str(),
                    Some("ready" | "signed-out")
                ),
                "WorkBuddy account service did not finish"
            );
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "WorkBuddy bridge did not connect"
        );
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[test]
fn supervisor_distinguishes_quit_from_abnormal_exit() {
    use std::{cell::Cell, os::windows::process::ExitStatusExt, process::ExitStatus};
    let runs = Cell::new(0);
    let code = windows::supervise_with(
        || {
            let prior = runs.get();
            runs.set(prior + 1);
            Ok(ExitStatus::from_raw(u32::from(prior == 0)))
        },
        Duration::ZERO,
    )
    .unwrap();
    assert_eq!((code, runs.get()), (0, 2));
    let runs = Cell::new(0);
    let code = windows::supervise_with(
        || {
            runs.set(runs.get() + 1);
            Ok(ExitStatus::from_raw(1))
        },
        Duration::ZERO,
    )
    .unwrap();
    assert_eq!((code, runs.get()), (1, 4));
}
