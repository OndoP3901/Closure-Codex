use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub codex_linked: bool,
    pub dsh_linked: bool,
    pub workbuddy_linked: bool,
    #[serde(default = "yes")]
    pub show_outside_codex: bool,
    pub start_at_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            codex_linked: false,
            dsh_linked: false,
            workbuddy_linked: false,
            show_outside_codex: true,
            start_at_login: false,
        }
    }
}

impl Settings {
    pub fn linked(self) -> bool {
        self.codex_linked || self.dsh_linked || self.workbuddy_linked
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Profile {
    settings: Settings,
}

pub struct Runtime {
    profile: Mutex<Profile>,
    pathname: PathBuf,
    pub startup_error: Mutex<String>,
    pub test: bool,
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> io::Result<T> {
    let mut bytes = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::other("JSON exceeds limit"));
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let folder = path
        .parent()
        .ok_or_else(|| io::Error::other("missing parent"))?;
    fs::create_dir_all(folder)?;
    let mut temporary = tempfile::NamedTempFile::new_in(folder)?;
    serde_json::to_writer(&mut temporary, value)?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}

impl Runtime {
    pub fn load(directory: &Path, test: bool) -> io::Result<Self> {
        let pathname = directory.join("profile.json");
        let profile = match read_json::<Profile>(&pathname, 1024 * 1024) {
            Ok(profile) => profile,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let profile = Profile::default();
                write_json(&pathname, &profile)?;
                profile
            }
            Err(error) => return Err(error),
        };
        let mut startup_error = String::new();
        if !test && super::windows::set_startup(profile.settings.start_at_login).is_err() {
            startup_error = "开机自启设置未生效，请在菜单中重试。".into();
        }
        Ok(Self {
            profile: Mutex::new(profile),
            pathname,
            startup_error: Mutex::new(startup_error),
            test,
        })
    }

    pub fn get(&self) -> Settings {
        self.profile.lock().unwrap().settings
    }

    pub fn set(&self, key: &str, enabled: bool) -> io::Result<Settings> {
        let mut profile = self.profile.lock().unwrap();
        let old = profile.settings;
        let mut next = old;
        match key {
            "codexLinked" => next.codex_linked = enabled,
            "dshLinked" => next.dsh_linked = enabled,
            "workbuddyLinked" => next.workbuddy_linked = enabled,
            "showOutsideCodex" => next.show_outside_codex = enabled,
            "startAtLogin" => next.start_at_login = enabled,
            _ => return Err(io::Error::other("未知桌宠设置。")),
        }
        let change_startup = !self.test && key == "startAtLogin";
        if change_startup {
            super::windows::set_startup(enabled)?;
        }
        profile.settings = next;
        if let Err(error) = write_json(&self.pathname, &*profile) {
            profile.settings = old;
            if change_startup && super::windows::set_startup(old.start_at_login).is_err() {
                *self.startup_error.lock().unwrap() = "开机自启状态恢复失败。".into();
            }
            return Err(error);
        }
        if change_startup {
            self.startup_error.lock().unwrap().clear();
        }
        Ok(next)
    }
}
