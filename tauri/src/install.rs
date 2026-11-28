use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY},
    RegKey,
};

use crate::{
    settings::{read_json, write_json},
    windows, workbuddy,
};

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub enum Product {
    Dsh,
    WorkBuddy,
}

impl Product {
    fn name(self) -> &'static str {
        match self {
            Self::Dsh => "DeepSeek Harness",
            Self::WorkBuddy => "WorkBuddy",
        }
    }

    fn launcher(self) -> &'static str {
        match self {
            Self::Dsh => "DeepSeek Harness.exe",
            Self::WorkBuddy => "WorkBuddy.exe",
        }
    }

    fn accepts(self, path: &Path) -> bool {
        path.is_absolute()
            && path
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case(self.launcher()))
            && path.is_file()
            && (self == Self::Dsh || workbuddy::runtime_executable(path).is_some())
    }

    fn saved_path(self, local: &Path) -> PathBuf {
        local.join("ClosureCompanionTauri").join(match self {
            Self::Dsh => "dsh-install.json",
            Self::WorkBuddy => "workbuddy-install.json",
        })
    }

    fn matches_display_name(self, display: &str) -> bool {
        let mut parts = display.trim().rsplitn(2, ' ');
        let suffix = parts.next().unwrap_or_default();
        display.trim().eq_ignore_ascii_case(self.name())
            || (suffix.starts_with(|c: char| c.is_ascii_digit())
                && parts
                    .next()
                    .is_some_and(|name| name.eq_ignore_ascii_case(self.name())))
    }

    fn registered(self, root: &RegKey, view: u32) -> Option<PathBuf> {
        let app_path = format!(
            r"Software\Microsoft\Windows\CurrentVersion\App Paths\{}",
            self.launcher()
        );
        if let Some(path) = root
            .open_subkey_with_flags(app_path, KEY_READ | view)
            .ok()
            .and_then(|key| key.get_value::<String, _>("").ok())
            .map(|s| PathBuf::from(s.trim().trim_matches('"')))
            .filter(|path| self.accepts(path))
        {
            return Some(path);
        }
        let uninstall = root
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                KEY_READ | view,
            )
            .ok()?;
        for name in uninstall.enum_keys().flatten() {
            let Ok(key) = uninstall.open_subkey_with_flags(name, KEY_READ | view) else {
                continue;
            };
            if !key
                .get_value::<String, _>("DisplayName")
                .is_ok_and(|s| self.matches_display_name(&s))
            {
                continue;
            }
            let location: String = key.get_value("InstallLocation").unwrap_or_default();
            let icon: String = key.get_value("DisplayIcon").unwrap_or_default();
            if let Some(path) = self.from_registration(&location, &icon) {
                return Some(path);
            }
        }
        None
    }

    fn from_registration(self, location: &str, icon: &str) -> Option<PathBuf> {
        let icon = icon.trim();
        let icon = icon
            .rsplit_once(',')
            .filter(|(_, index)| index.trim().parse::<i32>().is_ok())
            .map_or(icon, |(path, _)| path)
            .trim()
            .trim_matches('"');
        [
            Path::new(location.trim().trim_matches('"')).join(self.launcher()),
            PathBuf::from(icon),
        ]
        .into_iter()
        .find(|path| self.accepts(path))
    }

    fn locate(self, local: &Path) -> Option<PathBuf> {
        let variable = match self {
            Self::Dsh => "CLOSURE_DSH_EXE",
            Self::WorkBuddy => "CLOSURE_WORKBUDDY_EXE",
        };
        if let Some(path) = std::env::var_os(variable)
            .map(PathBuf::from)
            .filter(|p| self.accepts(p))
        {
            return Some(path);
        }
        if let Ok(path) = read_json::<PathBuf>(&self.saved_path(local), 128 * 1024) {
            if self.accepts(&path) {
                return Some(path);
            }
        }
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                if let Some(path) = self.registered(&RegKey::predef(hive), view) {
                    return Some(path);
                }
            }
        }
        let default = local
            .join("Programs")
            .join(self.name())
            .join(self.launcher());
        if self.accepts(&default) {
            return Some(default);
        }
        let names: &[&str] = match self {
            Self::Dsh => &["DeepSeek Harness.exe"],
            Self::WorkBuddy => &["WorkBuddy.exe", "WorkBuddy-app.exe"],
        };
        windows::paths(names).into_iter().find_map(|path| {
            if self.accepts(&path) {
                return Some(path);
            }
            // Newer WorkBuddy runs versions/<version>/WorkBuddy-app.exe.
            if self != Self::WorkBuddy {
                return None;
            }
            let launcher = path.ancestors().nth(3)?.join(self.launcher());
            (self.accepts(&launcher)
                && workbuddy::runtime_executable(&launcher)
                    .is_some_and(|runtime| windows::same_path(&runtime, &path)))
            .then_some(launcher)
        })
    }
}

pub struct Installs {
    pub local: PathBuf,
    cache: Mutex<HashMap<Product, (Instant, Option<PathBuf>)>>,
}

impl Installs {
    pub fn new(local: &Path) -> Self {
        Self {
            local: local.to_owned(),
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, product: Product) -> Option<PathBuf> {
        if let Some((at, path)) = self.cache.lock().unwrap().get(&product) {
            if at.elapsed() < Duration::from_secs(30) {
                return path.clone();
            }
        }
        self.refresh(product)
    }

    fn refresh(&self, product: Product) -> Option<PathBuf> {
        let path = product.locate(&self.local);
        self.cache
            .lock()
            .unwrap()
            .insert(product, (Instant::now(), path.clone()));
        path
    }

    pub fn for_launch(&self, product: Product, owner: isize) -> Result<PathBuf, String> {
        if let Some(path) = self.refresh(product) {
            return Ok(path);
        }
        let selected = windows::choose_launcher(owner, product.launcher())?;
        self.remember(product, &selected)?;
        Ok(selected)
    }

    fn remember(&self, product: Product, path: &Path) -> Result<(), String> {
        if !product.accepts(path) {
            return Err(format!("请选择完整安装目录中的 {}。", product.launcher()));
        }
        write_json(&product.saved_path(&self.local), &path)
            .map_err(|error| format!("应用安装位置保存失败（{error}）。"))?;
        self.cache
            .lock()
            .unwrap()
            .insert(product, (Instant::now(), Some(path.to_owned())));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn custom_install_locations_and_icon_paths_resolve_the_same_launcher() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("自选 目录,Apps");
        fs::create_dir_all(&directory).unwrap();
        let dsh = directory.join("DeepSeek Harness.exe");
        fs::write(&dsh, []).unwrap();
        assert_eq!(
            Product::Dsh.from_registration(directory.to_str().unwrap(), ""),
            Some(dsh.clone())
        );
        assert_eq!(
            Product::Dsh.from_registration("", &format!(r#""{}",0"#, dsh.display())),
            Some(dsh)
        );

        let launcher = directory.join("WorkBuddy.exe");
        let icon = format!("{},0", launcher.display());
        fs::write(&launcher, []).unwrap();
        assert!(Product::WorkBuddy.from_registration("", &icon).is_none());
        let version = directory.join("versions/5.12.1");
        fs::create_dir_all(version.join("resources")).unwrap();
        fs::write(version.join("resources/app.asar"), []).unwrap();
        fs::write(version.join("WorkBuddy-app.exe"), []).unwrap();
        fs::write(
            directory.join("activation.record"),
            "WB-ACTIVATION-1\r\nx\r\ny\r\n5.12.1\r\n",
        )
        .unwrap();
        assert!(Product::WorkBuddy.matches_display_name("WorkBuddy 5.12.1"));
        assert!(!Product::WorkBuddy.matches_display_name("WorkBuddy Helper"));
        assert_eq!(
            Product::WorkBuddy.from_registration("X:/missing", &icon),
            Some(launcher.clone())
        );
        assert_eq!(
            workbuddy::runtime_executable(&launcher),
            Some(version.join("WorkBuddy-app.exe"))
        );
        let installs = Installs::new(root.path());
        assert!(installs.remember(Product::Dsh, &launcher).is_err());
        installs.remember(Product::WorkBuddy, &launcher).unwrap();
        assert_eq!(
            read_json::<PathBuf>(&Product::WorkBuddy.saved_path(root.path()), 128 * 1024).unwrap(),
            launcher
        );
    }
}
