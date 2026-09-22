use std::{
    env, fs,
    fmt::Write as FmtWrite,
    io,
    path::{Path, PathBuf},
    process::Command,
};

fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn collect_assets(
    root: &Path,
    directory: &Path,
    assets: &mut Vec<(String, PathBuf)>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_assets(root, &path, assets)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .expect("asset must be inside dist")
                .to_string_lossy()
                .replace('\\', "/");
            assets.push((format!("/{relative}"), path));
        }
    }
    Ok(())
}

fn generate_asset_manifest(root: &Path) {
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    let mut assets = Vec::new();
    collect_assets(root, root, &mut assets).expect("could not enumerate frontend assets");
    assets.sort_by(|left, right| left.0.cmp(&right.0));

    let manifest = out_dir.join("embedded_assets.rs");
    let mut source = String::from(
        "pub fn embedded_asset(path: &str) -> Option<(&'static [u8], &'static str)> {\n    match path {\n",
    );
    for (url, path) in assets {
        writeln!(
            source,
            "        {url:?} => Some((include_bytes!(r#\"{}\"#), {:?})),",
            path.display(),
            mime_type(&path),
        )
        .expect("could not write asset manifest");
    }
    source.push_str("        _ => None,\n    }\n}\n");
    fs::write(manifest, source).expect("could not write embedded asset manifest");
}

fn main() {
    println!("cargo:rerun-if-changed=../index.html");
    println!("cargo:rerun-if-changed=../src");
    println!("cargo:rerun-if-changed=../scripts/inline-dist.mjs");
    println!("cargo:rerun-if-changed=../vite.config.js");
    println!("cargo:rerun-if-changed=../dist");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let status = Command::new(npm)
        .args(["run", "build:webview"])
        .current_dir(root)
        .status()
        .expect("npm is required to bundle the vanilla frontend");
    assert!(status.success(), "frontend bundle failed");
    generate_asset_manifest(&root.join("dist"));
}
