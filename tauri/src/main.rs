#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod codex;
mod cursor;
mod linked;
mod settings;
#[cfg(test)]
mod tests;
mod windows;
mod workbuddy;

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use cursor::{Cursor, Sample};
use linked::{Host, Hub};
use serde_json::{json, Value};
use settings::Runtime;
use tauri::{
    ipc::Channel, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

struct Options {
    smoke: bool,
    canvas: bool,
    profile: PathBuf,
}

#[derive(Default)]
struct Ready(AtomicBool);

#[tauri::command]
fn frontend_ready(
    window: WebviewWindow,
    ready: State<'_, Ready>,
    runtime: State<'_, Runtime>,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    ready.0.store(true, Ordering::Release);
    if runtime.test || runtime.get().show_outside_codex {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_cursor(window: WebviewWindow, cursor: State<'_, Cursor>, channel: Channel<Sample>) {
    cursor.start(window, channel);
}

fn settings_value(runtime: &Runtime, hub: &Hub) -> Value {
    let settings = runtime.get();
    let mut value = json!(settings);
    value["startupError"] = json!(*runtime.startup_error.lock().unwrap());
    value["integrations"] = hub.status(settings);
    value
}

#[tauri::command]
fn runtime_settings(runtime: State<'_, Runtime>, hub: State<'_, Hub>) -> Value {
    settings_value(&runtime, &hub)
}

#[tauri::command]
fn set_runtime_setting(
    runtime: State<'_, Runtime>,
    hub: State<'_, Hub>,
    key: String,
    enabled: bool,
) -> Value {
    match runtime.set(&key, enabled) {
        Ok(_) => {
            let mut value = settings_value(&runtime, &hub);
            value["ok"] = json!(true);
            value
        }
        Err(error) => {
            eprintln!("Closure runtime setting: {error}");
            json!({"ok":false,"error":"设置未保存，请重试。"})
        }
    }
}

#[tauri::command]
fn linked_state(runtime: State<'_, Runtime>, hub: State<'_, Hub>) -> Value {
    hub.snapshot(runtime.get())
}

#[cfg(windows)]
#[tauri::command]
fn smoke_cursor_passthrough(
    window: WebviewWindow,
    options: State<'_, Options>,
) -> Result<bool, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };

    if !options.smoke {
        return Err("Window inspection requires smoke mode.".into());
    }
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    // The HWND belongs to the live Tauri window supplied by this command.
    let style = unsafe { GetWindowLongPtrW(handle.0, GWL_EXSTYLE) };
    Ok(style & WS_EX_TRANSPARENT as isize != 0)
}

#[tauri::command]
fn frontend_failed(app: AppHandle, message: String) {
    eprintln!("桌宠前端启动失败：{message}");
    app.exit(1);
}

#[tauri::command]
fn smoke_result(app: AppHandle, options: State<'_, Options>, message: Option<String>) {
    if options.smoke {
        if let Some(message) = message {
            eprintln!("{message}");
            app.exit(1);
        } else {
            println!("Tauri companion smoke passed");
            app.exit(0);
        }
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn create_window(app: &AppHandle, options: &Options) -> tauri::Result<()> {
    let runtime = app.state::<Runtime>();
    let mut page = format!("index.html?codexLinked={}", runtime.get().linked());
    if options.smoke {
        page.push_str("&smoke=1");
    }
    if options.canvas {
        page.push_str("&canvas=1");
    }
    let window = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App(PathBuf::from(page)))
        .title("可露希尔 · 桌宠")
        .visible(false)
        .focused(false)
        .focusable(false)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .use_https_scheme(true)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_navigation(|url| url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
        .data_directory(options.profile.join("webview"))
        .build()?;
    if !options.smoke {
        let recover = window.clone();
        window.with_webview(move |view| {
            use webview2_com::ProcessFailedEventHandler;
            let result = unsafe { view.controller().CoreWebView2() }.and_then(|webview| {
                let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        COREWEBVIEW2_PROCESS_FAILED_KIND,
                        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
                        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
                        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
                    };
                    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                    if args.is_some_and(|args| unsafe { args.ProcessFailedKind(&mut kind) }.is_ok())
                        && matches!(
                            kind,
                            COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                                | COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                                | COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                        )
                    {
                        let _ = recover.set_ignore_cursor_events(true);
                        recover.app_handle().exit(1);
                    }
                    Ok(())
                }));
                let mut token = 0;
                unsafe { webview.add_ProcessFailed(&handler, &mut token) }
            });
            if let Err(error) = result {
                eprintln!("WebView2 ProcessFailed registration: {error}");
            }
        })?;
    }
    if options.smoke {
        window.set_position(PhysicalPosition::new(-30_000, -30_000))?;
        window.set_size(PhysicalSize::new(900, 620))?;
    } else if let Some(monitor) = window
        .cursor_position()
        .ok()
        .and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
        .or(window.primary_monitor()?)
    {
        let area = monitor.work_area();
        window.set_position(area.position)?;
        window.set_size(area.size)?;
    }
    let watchdog = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(25));
        let testing = watchdog.app_handle().state::<Options>().smoke;
        if testing
            || !watchdog
                .app_handle()
                .state::<Ready>()
                .0
                .load(Ordering::Acquire)
        {
            eprintln!("桌宠启动或冒烟测试超时。");
            watchdog.app_handle().exit(1);
        }
    });
    Ok(())
}

fn start_runtime(app: &AppHandle, local: &Path) {
    let executable = workbuddy::executable(local);
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::home_dir().unwrap_or_default().join(".codex"));
    let account = std::sync::Arc::new(Mutex::new(Value::Null));
    let quota_app = app.clone();
    let quota_home = codex_home.clone();
    let quota = account.clone();
    tauri::async_runtime::spawn(async move {
        let mut next = std::time::Instant::now();
        loop {
            if !quota_app.state::<Runtime>().get().codex_linked {
                *quota.lock().unwrap() = Value::Null;
                next = std::time::Instant::now();
            } else if std::time::Instant::now() >= next {
                let result = codex::account(&quota_home).await;
                next = std::time::Instant::now()
                    + Duration::from_secs(if result.is_some() { 60 } else { 5 });
                *quota.lock().unwrap() = result.unwrap_or_default();
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    let codex_app = app.clone();
    thread::spawn(move || {
        let mut codex = codex::Codex::default();
        let mut enabled = false;
        loop {
            let needed = codex_app.state::<Runtime>().get().codex_linked;
            if needed {
                let account = account.lock().unwrap().clone();
                codex_app
                    .state::<Hub>()
                    .set(0, codex.tick(&codex_home, &account));
            } else if enabled {
                codex = codex::Codex::default();
                codex_app.state::<Hub>().set(0, Host::default());
            }
            enabled = needed;
            thread::sleep(Duration::from_secs(1));
        }
    });
    let dsh_app = app.clone();
    let dsh_local = local.to_path_buf();
    thread::spawn(move || {
        let mut enabled = false;
        loop {
            let needed = dsh_app.state::<Runtime>().get().dsh_linked;
            if needed || enabled {
                dsh_app
                    .state::<Hub>()
                    .set(1, linked::dsh(&dsh_local, needed));
            }
            enabled = needed;
            thread::sleep(Duration::from_secs(1));
        }
    });
    let work_app = app.clone();
    let work_local = local.to_path_buf();
    let work_executable = executable.clone();
    thread::spawn(move || {
        let mut worker = workbuddy::WorkBuddy::default();
        let mut enabled = false;
        loop {
            let needed = work_app.state::<Runtime>().get().workbuddy_linked;
            if needed {
                work_app
                    .state::<Hub>()
                    .set(2, worker.tick(&work_local, &work_executable));
            } else if enabled {
                worker.stop(&work_executable);
                work_app.state::<Hub>().set(2, Host::default());
            }
            enabled = needed;
            thread::sleep(Duration::from_secs(1));
        }
    });
    let window = app.get_webview_window("pet").unwrap();
    let local = local.to_path_buf();
    thread::spawn(move || {
        let mut last = None;
        while let Ok(visible) = window.is_visible() {
            let ready = window.state::<Ready>().0.load(Ordering::Acquire);
            let settings = window.state::<Runtime>().get();
            if ready {
                let target = if settings.show_outside_codex {
                    window.current_monitor().ok().flatten().map(|monitor| {
                        let area = monitor.work_area();
                        (
                            area.position.x,
                            area.position.y,
                            area.size.width,
                            area.size.height,
                        )
                    })
                } else {
                    windows::foreground_bounds(settings, &local, &executable)
                };
                if let Some((x, y, width, height)) = target {
                    if target != last {
                        let _ = window.set_position(PhysicalPosition::new(x, y));
                        let _ = window.set_size(PhysicalSize::new(width, height));
                    }
                    if !visible {
                        let _ = window.show();
                    }
                } else if visible {
                    let _ = window.hide();
                }
                last = target;
            }
            thread::sleep(Duration::from_millis(if settings.show_outside_codex {
                350
            } else {
                75
            }));
        }
    });
}

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let has = |flag: &str| args.iter().any(|arg| arg == flag);
    let argument = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| PathBuf::from(&pair[1]))
    };
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    if !has("--smoke") && !has("--worker") {
        let result = windows::supervise(&args);
        if matches!(result, Ok(1)) {
            windows::show_error(
                "桌宠多次异常退出。请确认系统已安装 Microsoft Edge WebView2 Runtime。",
            );
        }
        windows::finish(result);
    }
    let options = Options {
        smoke: has("--smoke"),
        canvas: has("--canvas"),
        profile: argument("--profile").unwrap_or_else(|| {
            if has("--smoke") {
                std::env::temp_dir().join(format!("closure-tauri-runtime-{}", std::process::id()))
            } else {
                local.join("ClosureCompanionTauri")
            }
        }),
    };
    let mut builder = tauri::Builder::default();
    if !options.smoke {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}));
    }
    let app = builder
        .manage(Cursor::default())
        .manage(Hub::default())
        .manage(Ready::default())
        .manage(options)
        .setup(move |app| {
            let options = app.state::<Options>();
            let runtime = Runtime::load(&options.profile, options.smoke);
            match runtime {
                Ok(runtime) => app.manage(runtime),
                Err(error) => {
                    if options.smoke {
                        eprintln!("Closure profile: {error}");
                    } else {
                        windows::show_error(&format!("桌宠配置读取失败：{error}"));
                    }
                    std::process::exit(2);
                }
            };
            app.manage(audio::Audio::start(app.handle().clone()));
            create_window(app.handle(), &options)?;
            if !options.smoke {
                start_runtime(app.handle(), &local);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            frontend_failed,
            start_cursor,
            cursor::cursor_result,
            runtime_settings,
            set_runtime_setting,
            linked_state,
            audio::play_voice,
            audio::stop_voice,
            audio::voice_volume,
            smoke_result,
            #[cfg(windows)]
            smoke_cursor_passthrough,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("launch the Closure companion with Microsoft Edge WebView2");
    std::process::exit(app.run_return(|_, _| {}));
}
