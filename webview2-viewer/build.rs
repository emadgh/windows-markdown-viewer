use std::{env, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../index.html");
    println!("cargo:rerun-if-changed=../src");
    println!("cargo:rerun-if-changed=../scripts/inline-dist.mjs");
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
}
