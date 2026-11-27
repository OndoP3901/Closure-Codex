use std::{
    io,
    mem::{size_of, zeroed},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{self, Command},
    thread,
    time::{Duration, Instant},
};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, INVALID_HANDLE_VALUE, POINT, RECT},
    Graphics::Gdi::ClientToScreen,
    NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    },
    Networking::WinSock::AF_INET,
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::WindowsAndMessaging::{
        GetClassNameW, GetClientRect, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
        WS_EX_TOOLWINDOW,
    },
};

use crate::settings::Settings;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STARTUP_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const STARTUP_NAME: &str = "ClosureCompanionTauri";

pub fn set_startup(enabled: bool) -> io::Result<()> {
    let root = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let (key, _) = root.create_subkey(STARTUP_KEY)?;
    if enabled {
        let command = format!("\"{}\"", std::env::current_exe()?.display());
        key.set_value(STARTUP_NAME, &command)
    } else {
        match key.delete_value(STARTUP_NAME) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
}

pub fn command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn supervise(args: &[std::ffi::OsString]) -> io::Result<i32> {
    let exe = std::env::current_exe()?;
    supervise_with(
        || command(&exe).arg("--worker").args(args).status(),
        Duration::from_millis(500),
    )
}

pub(crate) fn supervise_with(
    mut run: impl FnMut() -> io::Result<process::ExitStatus>,
    backoff: Duration,
) -> io::Result<i32> {
    let mut failures = 0;
    loop {
        let started = Instant::now();
        let status = run()?;
        match status.code() {
            Some(0) => return Ok(0),
            Some(2) => return Ok(2),
            _ => {}
        }
        if started.elapsed() >= Duration::from_secs(60) {
            failures = 0;
        }
        failures += 1;
        if failures >= 4 {
            return Ok(1);
        }
        thread::sleep(backoff * failures);
    }
}

pub fn executable(pid: u32) -> Option<PathBuf> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0_u16; 32768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        let result = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
        CloseHandle(process);
        result
    };
    (result != 0).then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize])))
}

pub fn paths(names: &[&str]) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return paths;
        }
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut next = Process32FirstW(snapshot, &mut entry);
        while next != 0 {
            let name = wide_string(&entry.szExeFile);
            if names
                .iter()
                .any(|expected| name.eq_ignore_ascii_case(expected))
            {
                paths.extend(executable(entry.th32ProcessID));
            }
            next = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    paths
}

fn wide_string(buffer: &[u16]) -> String {
    String::from_utf16_lossy(
        &buffer[..buffer
            .iter()
            .position(|&value| value == 0)
            .unwrap_or(buffer.len())],
    )
}

pub fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .replace('/', "\\")
        .eq_ignore_ascii_case(&right.to_string_lossy().replace('/', "\\"))
}

pub fn codex_window(path: &Path) -> bool {
    let path = path.to_string_lossy().to_ascii_lowercase();
    path.contains("\\windowsapps\\openai.codex_")
        && (path.ends_with("\\app\\codex.exe") || path.ends_with("\\app\\chatgpt.exe"))
}

pub fn foreground_bounds(
    settings: Settings,
    local: &Path,
    workbuddy: &Path,
) -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null()
            || IsWindowVisible(window) == 0
            || IsIconic(window) != 0
            || !GetWindow(window, GW_OWNER).is_null()
            || GetWindowLongPtrW(window, GWL_EXSTYLE) & WS_EX_TOOLWINDOW as isize != 0
        {
            return None;
        }
        let mut class = [0; 48];
        GetClassNameW(window, class.as_mut_ptr(), class.len() as i32);
        if wide_string(&class) != "Chrome_WidgetWin_1" {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        let exe = executable(pid)?;
        let allowed = (settings.codex_linked || !settings.linked()) && codex_window(&exe)
            || settings.dsh_linked
                && same_path(
                    &exe,
                    &local.join("Programs/DeepSeek Harness/DeepSeek Harness.exe"),
                )
            || settings.workbuddy_linked && same_path(&exe, workbuddy);
        if !allowed {
            return None;
        }
        client_rect(window)
    }
}

unsafe fn client_rect(window: HWND) -> Option<(i32, i32, u32, u32)> {
    let mut rect = RECT::default();
    let mut origin = POINT::default();
    if GetClientRect(window, &mut rect) == 0
        || ClientToScreen(window, &mut origin) == 0
        || rect.right < 360
        || rect.bottom < 260
    {
        return None;
    }
    Some((origin.x, origin.y, rect.right as u32, rect.bottom as u32))
}

pub fn owns_listener(port: u16, application: &Path) -> bool {
    let mut size = 0;
    unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        for _ in 0..3 {
            let mut data = vec![0_u32; (size as usize).div_ceil(4)];
            if data.is_empty() {
                return false;
            }
            match GetExtendedTcpTable(
                data.as_mut_ptr().cast(),
                &mut size,
                0,
                AF_INET as u32,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            ) {
                0 => {
                    let count = data[0] as usize;
                    if count > (data.len() - 1) * 4 / size_of::<MIB_TCPROW_OWNER_PID>() {
                        return false;
                    }
                    let rows = std::slice::from_raw_parts(
                        data.as_ptr().add(1).cast::<MIB_TCPROW_OWNER_PID>(),
                        count,
                    );
                    let mut found = false;
                    for row in rows
                        .iter()
                        .filter(|row| u16::from_be(row.dwLocalPort as u16) == port)
                    {
                        if row.dwLocalAddr.to_ne_bytes() != [127, 0, 0, 1]
                            || !executable(row.dwOwningPid)
                                .is_some_and(|exe| same_path(&exe, application))
                        {
                            return false;
                        }
                        found = true;
                    }
                    return found;
                }
                122 => continue,
                _ => return false,
            }
        }
    }
    false
}

pub fn show_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let message = wide(message);
    let title = wide("可露希尔 · 桌宠");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        )
    };
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn finish(result: io::Result<i32>) -> ! {
    let code = match result {
        Ok(code) => code,
        Err(error) => {
            show_error(&error.to_string());
            2
        }
    };
    process::exit(code)
}
