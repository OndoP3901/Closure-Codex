use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

fn copy_file(source: &Path, target: &Path) -> io::Result<()> {
    println!("cargo:rerun-if-changed={}", source.display());
    fs::create_dir_all(target.parent().expect("destination has a parent"))?;
    fs::copy(source, target)?;
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    println!("cargo:rerun-if-changed={}", source.display());
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else {
            copy_file(&entry.path(), &destination)?;
        }
    }
    Ok(())
}

fn stage_frontend() -> io::Result<()> {
    let source = Path::new("../shared/companion");
    let staging_root = Path::new(".generated");
    fs::create_dir_all(staging_root)?;
    let root = fs::canonicalize(".")?;
    if fs::canonicalize(staging_root)? != root.join(staging_root) {
        return Err(io::Error::other(
            "staging parent resolved outside its expected path",
        ));
    }
    let target = staging_root.join("frontend");
    if target.exists() {
        if fs::canonicalize(&target)? != root.join(&target) {
            return Err(io::Error::other(
                "staging directory resolved outside its expected path",
            ));
        }
        fs::remove_dir_all(&target)?;
    }
    copy_tree(Path::new("frontend"), &target)?;
    copy_file(&source.join("bridge.js"), &target.join("bridge.js"))?;
    copy_tree(
        &source.join("upstream/assets"),
        &target.join("dsh-closure/assets"),
    )?;
    fs::write(target.join("dsh-closure/config"), "{}")?;
    Ok(())
}

fn main() {
    stage_frontend().expect("stage existing Closure frontend");
    let mut attributes = tauri_build::Attributes::new();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let source = "../shared/companion/upstream/icon.png";
        println!("cargo:rerun-if-changed={source}");
        let icon_path = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("closure.ico");
        let image =
            ico::IconImage::read_png(io::BufReader::new(fs::File::open(source).unwrap())).unwrap();
        let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
        icon.add_entry(ico::IconDirEntry::encode(&image).unwrap());
        icon.write(fs::File::create(&icon_path).unwrap()).unwrap();
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(icon_path));
    }
    tauri_build::try_build(attributes).expect("prepare Tauri host");
}
