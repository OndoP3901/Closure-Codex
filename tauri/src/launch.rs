use std::{fs, io::Write, path::Path, process::Command};

use serde::Deserialize;

use crate::windows;

macro_rules! theme_files {
    ($($path:literal),+ $(,)?) => {
        &[$(($path, include_bytes!(concat!("../../themes/", $path)).as_slice())),+]
    };
}

const THEME_FILES: &[(&str, &[u8])] = theme_files![
    "codex/attach.cjs",
    "codex/cdp.cjs",
    "codex/decoration.css",
    "codex/decoration.mjs",
    "codex/official-runtime.cjs",
    "codex/palette.cjs",
    "codex/palette/closure-dark.txt",
    "codex/palette/LICENSE",
    "codex/renderer-payload.cjs",
    "codex/theme-launcher.cjs",
    "workbuddy/lib/attach.cjs",
    "workbuddy/lib/cdp.cjs",
    "workbuddy/lib/launcher.cjs",
    "workbuddy/lib/renderer.js",
    "workbuddy/lib/windows.cjs",
    "workbuddy/LICENSE",
    "antigravity/theme.cjs",
    "antigravity/theme.css",
];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Codex,
    Dsh,
    WorkBuddy,
    Antigravity,
}

impl Agent {
    pub fn setting(self) -> &'static str {
        match self {
            Self::Codex => "codexLinked",
            Self::Dsh => "dshLinked",
            Self::WorkBuddy => "workbuddyLinked",
            Self::Antigravity => "antigravityLinked",
        }
    }

    pub fn open(self, local: &Path, theme_enabled: bool) -> Result<(), String> {
        if matches!(self, Self::Dsh) {
            let exe = windows::dsh_executable(local);
            if !exe.is_file() {
                return Err("未找到 DSH，请先安装桌面客户端。".into());
            }
            crate::settings::write_json(
                &local.join("ClosureCompanionTauri/dsh-theme.json"),
                &serde_json::json!({ "enabled": theme_enabled }),
            )
            .map_err(|error| format!("DSH 主题设置未保存（{error}）"))?;
            if !windows::show_application(&exe) {
                Command::new(exe)
                    .env_remove("ELECTRON_RUN_AS_NODE")
                    .env_remove("NODE_OPTIONS")
                    .spawn()
                    .map_err(|error| format!("DSH 启动失败（{error}）"))?;
            }
            return Ok(());
        }
        if matches!(self, Self::Codex) && !theme_enabled {
            let config = local.join("ClosureCodexTheme/config.json");
            if crate::settings::read_json::<serde_json::Value>(&config, 64 * 1024)
                .is_ok_and(|value| value["enabled"] == true)
            {
                self.theme(local, "disable")?;
            }
            let explorer = std::env::var_os("SystemRoot")
                .map(std::path::PathBuf::from)
                .ok_or("无法定位 Windows 资源管理器。")?
                .join("explorer.exe");
            windows::command(&explorer)
                .arg(r"shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App")
                .spawn()
                .map_err(|error| format!("Codex 启动失败（{error}）"))?;
            return Ok(());
        }
        self.theme(local, if theme_enabled { "enable" } else { "link" })
    }

    fn theme(self, local: &Path, mode: &str) -> Result<(), String> {
        let (name, script) = match self {
            Self::Codex => ("Codex", "codex/theme-launcher.cjs"),
            Self::WorkBuddy => ("WorkBuddy", "workbuddy/lib/launcher.cjs"),
            Self::Antigravity => ("Antigravity", "antigravity/theme.cjs"),
            Self::Dsh => return Err("请在 DSH 插件管理中停用可露希尔主题。".into()),
        };
        let directory = local.join("ClosureCompanionTauri/themes");
        install_theme_files(&directory)
            .map_err(|error| format!("桌宠内置主题写入失败（{error}）"))?;
        let mut command = windows::command(Path::new("node.exe"));
        command
            .env_remove("NODE_OPTIONS")
            .arg(directory.join(script));
        match self {
            Self::Codex => {
                command.args(["--mode", mode, "--from-menu"]);
            }
            Self::WorkBuddy => {
                command.args(["--mode", mode]);
            }
            Self::Antigravity => {
                command.arg(mode);
            }
            Self::Dsh => unreachable!(),
        }
        let output = command.output().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "请安装 Node.js 22 或更新版本，然后重启桌宠。".into()
            } else {
                format!("{name} 主题启动失败（{error}）")
            }
        })?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| {
                line.trim()
                    .strip_prefix("Error: ")
                    .unwrap_or(line.trim())
                    .to_owned()
            })
            .unwrap_or_else(|| format!("{name} 主题操作失败。")))
    }
}

fn install_theme_files(directory: &Path) -> std::io::Result<()> {
    for (relative, contents) in THEME_FILES {
        let file = directory.join(relative);
        if fs::read(&file).is_ok_and(|current| current == *contents) {
            continue;
        }
        let parent = file.parent().expect("theme file has a parent");
        fs::create_dir_all(parent)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(contents)?;
        temporary.persist(file)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "opens the locally installed Antigravity desktop app"]
    fn launches_antigravity_with_the_embedded_theme() {
        let local = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
        Agent::Antigravity.open(&local, true).unwrap();
        let directory = local.join("ClosureAntigravityTheme");
        let session: serde_json::Value =
            crate::settings::read_json(&directory.join("session.json"), 4096).unwrap();
        let id = session["id"].as_str().unwrap();
        assert!(directory.join(format!("{id}.ready")).is_file());
    }
}
