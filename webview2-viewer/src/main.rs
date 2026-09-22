#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use open::that as open_external;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::{
    borrow::Cow,
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    thread,
    time::Duration,
};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
    window::{Window, WindowBuilder, WindowId},
};
use update_via_github::{UpdateConfig, UpdateManager, UpdateStatus};
use wry::{
    http::{header::CONTENT_TYPE, Request, Response},
    DragDropEvent, WebView, WebViewBuilder,
};

const HTML: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist/index.html"));
const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024;
const INSTANCE_PORT: u16 = 45831;
const INSTANCE_MAGIC: &[u8] = b"MARKDOWN_VIEWER_1\n";
const UPDATE_REPOSITORY: &str = "emadgh/windows-markdown-viewer";
const UPDATE_ASSET: &str = "markdown-viewer-webview2.exe";
const UPDATE_CHECKSUM: &str = "markdown-viewer-webview2.exe.sha256";

include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));

#[derive(Debug, Clone, Serialize)]
struct DocumentPayload {
    path: String,
    name: String,
    contents: String,
}

#[derive(Debug)]
enum UserEvent {
    Open(Vec<PathBuf>),
    Drop(WindowId, DropState),
    Ipc(WindowId, String),
    Update(UpdateStatus),
}
#[derive(Debug)]
enum DropState {
    Enter,
    Leave,
    Drop(Vec<PathBuf>),
}

fn validate_markdown(value: &Path, cwd: &Path) -> Result<PathBuf, String> {
    let joined = if value.is_absolute() {
        value.to_path_buf()
    } else {
        cwd.join(value)
    };
    let path = joined
        .canonicalize()
        .map_err(|_| format!("File not found: {}", joined.display()))?;
    if !path.is_file()
        || !path
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| x.eq_ignore_ascii_case("md"))
    {
        return Err("Only .md files are supported.".into());
    }
    Ok(path)
}
fn read_document(path: &Path) -> Result<DocumentPayload, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_DOCUMENT_BYTES {
        return Err("Markdown file is larger than 16 MB.".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("Could not read document: {e}"))?;
    let contents = String::from_utf8_lossy(&bytes)
        .trim_start_matches('\u{feff}')
        .to_owned();
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Markdown document")
        .to_owned();
    Ok(DocumentPayload {
        path: path.to_string_lossy().into_owned(),
        name,
        contents,
    })
}
fn bootstrap_html(payload: Option<&DocumentPayload>) -> String {
    let json = serde_json::to_string(&payload)
        .unwrap_or_else(|_| "null".into())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    HTML.replace("__INITIAL_STATE__", &json)
}
fn app_response(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = if request.uri().path() == "/" {
        "/index.html"
    } else {
        request.uri().path()
    };
    let Some((bytes, mime)) = embedded_asset(path) else {
        return Response::builder()
            .status(404)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Cow::Owned(b"asset not found".to_vec()))
            .unwrap();
    };
    if path == "/index.html" {
        let html = String::from_utf8_lossy(bytes).replace("__INITIAL_STATE__", "null");
        Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(Cow::Owned(html.into_bytes()))
            .unwrap()
    } else {
        Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(Cow::Borrowed(bytes))
            .unwrap()
    }
}
fn image_response(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let query = request.uri().query().unwrap_or_default();
    let mut doc = None;
    let mut src = None;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next().unwrap_or_default();
        let val = percent_decode_str(it.next().unwrap_or_default())
            .decode_utf8_lossy()
            .into_owned();
        if key == "doc" {
            doc = Some(val);
        } else if key == "src" {
            src = Some(val);
        }
    }
    let result = (|| -> Result<(Vec<u8>, &'static str), String> {
        let doc = PathBuf::from(doc.ok_or("missing document")?);
        let src = src.ok_or("missing source")?;
        if src.contains("://") || src.starts_with('/') || src.starts_with('\\') {
            return Err("external image".into());
        }
        let path = doc
            .parent()
            .ok_or("document parent missing")?
            .join(src.replace('/', "\\"))
            .canonicalize()
            .map_err(|_| "image not found")?;
        let meta = fs::metadata(&path).map_err(|_| "image not found")?;
        if meta.len() > MAX_IMAGE_BYTES {
            return Err("image too large".into());
        }
        let mime = match path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            _ => return Err("unsupported image".into()),
        };
        Ok((fs::read(path).map_err(|_| "image read failed")?, mime))
    })();
    match result {
        Ok((body, mime)) => Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(Cow::Owned(body))
            .unwrap(),
        Err(msg) => Response::builder()
            .status(404)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Cow::Owned(msg.as_bytes().to_vec()))
            .unwrap(),
    }
}

fn try_forward_to_existing(paths: &[PathBuf]) -> bool {
    let payload = match serde_json::to_vec(
        &paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
    ) {
        Ok(value) => value,
        Err(_) => return false,
    };
    for _ in 0..40 {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", INSTANCE_PORT)) {
            if stream.write_all(INSTANCE_MAGIC).is_ok() && stream.write_all(&payload).is_ok() {
                return true;
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

fn bind_instance_listener() -> std::io::Result<TcpListener> {
    TcpListener::bind(("127.0.0.1", INSTANCE_PORT))
}

fn start_instance_listener(listener: TcpListener, proxy: EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            let mut bytes = Vec::new();
            if stream.read_to_end(&mut bytes).is_err() || !bytes.starts_with(INSTANCE_MAGIC) {
                continue;
            }
            let Ok(names) = serde_json::from_slice::<Vec<String>>(&bytes[INSTANCE_MAGIC.len()..])
            else {
                continue;
            };
            let paths = names.into_iter().map(PathBuf::from).collect();
            let _ = proxy.send_event(UserEvent::Open(paths));
        }
    });
}

fn notice_script(message: &str, is_error: bool) -> String {
    format!(
        "window.__hostNotice({}, {})",
        serde_json::to_string(message).unwrap_or_else(|_| "\"Operation failed\"".into()),
        is_error
    )
}

fn resolve_internal_link_mode(
    source: &Path,
    href: &str,
    cwd: &Path,
    obsidian: bool,
) -> Result<(PathBuf, Option<String>), String> {
    let decoded = percent_decode_str(href.trim())
        .decode_utf8_lossy()
        .into_owned();
    let (target, fragment) = decoded.split_once('#').unwrap_or((decoded.as_str(), ""));
    let target = target
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(target);
    if target.is_empty() {
        if !obsidian {
            return Err("This link points to the current document.".into());
        }
        let path = validate_markdown(source, cwd)?;
        let fragment = (!fragment.is_empty()).then(|| fragment.to_owned());
        return Ok((path, fragment));
    }
    let is_file_url = target
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file://"));
    if !is_file_url && (target.contains("://") || target.starts_with("//")) {
        return Err("Only local Markdown links can be opened in this window.".into());
    }
    let candidate = if is_file_url {
        let mut path = target[7..].to_owned();
        if path.starts_with('/') && path.chars().nth(2) == Some(':') {
            path.remove(0);
        }
        PathBuf::from(path.replace('/', "\\"))
    } else {
        PathBuf::from(target.replace('/', "\\"))
    };
    let path = if obsidian {
        resolve_obsidian_path(source, &candidate, target, cwd)?
    } else {
        let joined = if candidate.is_absolute() {
            candidate
        } else {
            source.parent().unwrap_or(cwd).join(candidate)
        };
        validate_markdown(&joined, cwd)?
    };
    let fragment = (!fragment.is_empty()).then(|| fragment.to_owned());
    Ok((path, fragment))
}

fn resolve_obsidian_path(
    source: &Path,
    candidate: &Path,
    display_target: &str,
    cwd: &Path,
) -> Result<PathBuf, String> {
    if candidate.is_absolute() {
        return validate_markdown(candidate, cwd)
            .map_err(|_| format!("Obsidian note not found: {display_target}"));
    }
    let needs_md_extension = candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .map_or(true, |extension| extension.is_empty());
    let mut base = source.parent().unwrap_or(cwd).to_path_buf();
    loop {
        let direct = base.join(candidate);
        if let Ok(path) = validate_markdown(&direct, cwd) {
            return Ok(path);
        }
        if needs_md_extension {
            let mut with_extension = direct.clone();
            with_extension.set_extension("md");
            if let Ok(path) = validate_markdown(&with_extension, cwd) {
                return Ok(path);
            }
        }
        let Some(parent) = base.parent() else { break };
        if parent == base {
            break;
        }
        base = parent.to_path_buf();
    }
    Err(format!("Obsidian note not found: {display_target}"))
}
fn navigate_script(payload: &DocumentPayload, fragment: Option<&str>) -> String {
    let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "null".into());
    let fragment_json = serde_json::to_string(&fragment).unwrap_or_else(|_| "null".into());
    format!("window.__hostNavigate({payload_json}, {fragment_json})")
}
fn updater_config() -> UpdateConfig {
    UpdateConfig::new(UPDATE_REPOSITORY, UPDATE_ASSET, env!("CARGO_PKG_VERSION"))
        .with_app_name("MarkdownViewer")
        .with_checksum_asset(UPDATE_CHECKSUM)
        .with_required_checksum(true)
        .with_max_download_size(100 * 1024 * 1024)
        .with_min_executable_size(100_000)
}

fn update_key(status: &UpdateStatus) -> String {
    match status {
        UpdateStatus::Idle => "idle".into(),
        UpdateStatus::Checking => "checking".into(),
        UpdateStatus::UpToDate => "up-to-date".into(),
        UpdateStatus::Available(info) => format!("available:{}", info.version),
        UpdateStatus::Downloading {
            info,
            downloaded,
            total,
        } => format!("downloading:{}:{downloaded}:{total:?}", info.version),
        UpdateStatus::Ready(info, _) => format!("ready:{}", info.version),
        UpdateStatus::Failed(message) => format!("failed:{message}"),
    }
}

fn update_script(status: &UpdateStatus) -> String {
    let data = match status {
        UpdateStatus::Idle => serde_json::json!({"state":"idle"}),
        UpdateStatus::Checking => serde_json::json!({"state":"checking"}),
        UpdateStatus::UpToDate => serde_json::json!({"state":"up-to-date"}),
        UpdateStatus::Available(info) => {
            serde_json::json!({"state":"available","version":info.version})
        }
        UpdateStatus::Downloading {
            info,
            downloaded,
            total,
        } => {
            serde_json::json!({"state":"downloading","version":info.version,"downloaded":downloaded,"total":total})
        }
        UpdateStatus::Ready(info, _) => serde_json::json!({"state":"ready","version":info.version}),
        UpdateStatus::Failed(message) => serde_json::json!({"state":"failed","message":message}),
    };
    format!(
        "window.__hostUpdate({})",
        serde_json::to_string(&data).unwrap_or_else(|_| "{\"state\":\"failed\"}".into())
    )
}

fn watch_update(manager: UpdateManager, proxy: EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        let mut last = String::new();
        loop {
            thread::sleep(Duration::from_millis(250));
            let status = manager.status();
            let key = update_key(&status);
            if key != last {
                let _ = proxy.send_event(UserEvent::Update(status.clone()));
                last = key;
            }
            if matches!(
                status,
                UpdateStatus::UpToDate | UpdateStatus::Ready(_, _) | UpdateStatus::Failed(_)
            ) {
                break;
            }
        }
    });
}

fn start_update_check(manager: &UpdateManager, proxy: &EventLoopProxy<UserEvent>) -> bool {
    if !manager.start_check(true) {
        return false;
    }
    watch_update(manager.clone(), proxy.clone());
    true
}
fn create_window(
    target: &EventLoopWindowTarget<UserEvent>,
    proxy: EventLoopProxy<UserEvent>,
    payload: Option<&DocumentPayload>,
) -> wry::Result<(Window, WebView)> {
    let title = payload
        .map(|p| format!("{} — Markdown Viewer", p.name))
        .unwrap_or_else(|| "Markdown Viewer".into());
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(tao::dpi::LogicalSize::new(1100.0, 800.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(640.0, 460.0))
        .build(target)
        .unwrap();
    let id = window.id();
    let ipc_proxy = proxy.clone();
    let drop_proxy = proxy.clone();
    let builder = WebViewBuilder::new()
        .with_url("mv-app://localhost/index.html")
        .with_custom_protocol("mv-app".into(), |_id, request| app_response(&request))
        .with_custom_protocol("mv-image".into(), |_id, request| image_response(&request))
        .with_ipc_handler(move |request: Request<String>| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(id, request.body().clone()));
        })
        .with_drag_drop_handler(move |event| {
            let state = match event {
                DragDropEvent::Enter { .. } => DropState::Enter,
                DragDropEvent::Over { .. } => return true,
                DragDropEvent::Leave => DropState::Leave,
                DragDropEvent::Drop { paths, .. } => DropState::Drop(paths),
                _ => return true,
            };
            let _ = drop_proxy.send_event(UserEvent::Drop(id, state));
            true
        });
    let webview = builder.build(&window)?;
    Ok((window, webview))
}
fn register_association() -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu
            .create_subkey("Software\\Classes")
            .map_err(|e| e.to_string())?
            .0;
        let extension = classes.create_subkey(".md").map_err(|e| e.to_string())?.0;
        extension
            .set_value("", &"MarkdownViewer.md")
            .map_err(|e| e.to_string())?;
        extension
            .create_subkey("OpenWithProgids")
            .map_err(|e| e.to_string())?
            .0
            .set_value("MarkdownViewer.md", &"")
            .map_err(|e| e.to_string())?;
        let prog = classes
            .create_subkey("MarkdownViewer.md")
            .map_err(|e| e.to_string())?
            .0;
        prog.set_value("", &"Markdown Viewer Markdown File")
            .map_err(|e| e.to_string())?;
        prog.create_subkey("DefaultIcon")
            .map_err(|e| e.to_string())?
            .0
            .set_value("", &format!("\"{}\",0", exe.display()))
            .map_err(|e| e.to_string())?;
        prog.create_subkey("shell\\open\\command")
            .map_err(|e| e.to_string())?
            .0
            .set_value("", &format!("\"{}\" \"%1\"", exe.display()))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("File association is only available on Windows.".into())
    }
}
fn notify(webviews: &mut HashMap<WindowId, (Window, WebView)>, id: WindowId, script: &str) {
    if let Some((_, view)) = webviews.get(&id) {
        let _ = view.evaluate_script(script);
    }
}

fn main() -> wry::Result<()> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let requested: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let instance_listener = match bind_instance_listener() {
        Ok(listener) => Some(listener),
        Err(_) if try_forward_to_existing(&requested) => return Ok(()),
        Err(_) => None,
    };
    let mut rejected = Vec::new();
    let paths: Vec<PathBuf> = requested
        .into_iter()
        .filter_map(|p| match validate_markdown(&p, &cwd) {
            Ok(value) => Some(value),
            Err(error) => {
                rejected.push(error);
                None
            }
        })
        .collect();
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let updater = UpdateManager::new(updater_config());
    let _ = start_update_check(&updater, &proxy);
    let mut current_update: Option<UpdateStatus> = None;
    let mut webviews = HashMap::new();
    let mut pending = HashMap::new();
    let mut current_documents: HashMap<WindowId, PathBuf> = HashMap::new();
    let mut pending_notices: HashMap<WindowId, Vec<String>> = HashMap::new();
    #[cfg(windows)]
    let association_error = register_association().err();
    #[cfg(not(windows))]
    let association_error: Option<String> = None;
    if let Some(listener) = instance_listener {
        start_instance_listener(listener, proxy.clone());
    }
    let (initial, initial_error) = match paths.first() {
        Some(path) => match read_document(path) {
            Ok(document) => (Some(document), None),
            Err(error) => (None, Some(error)),
        },
        None => (None, None),
    };
    let (window, webview) = create_window(&event_loop, proxy.clone(), initial.as_ref())?;
    let first_id = window.id();
    webviews.insert(first_id, (window, webview));
    pending.insert(first_id, initial);
    if let Some(document) = pending.get(&first_id).and_then(|value| value.as_ref()) {
        current_documents.insert(first_id, PathBuf::from(&document.path));
    }
    if let Some(error) = initial_error
        .as_ref()
        .or_else(|| rejected.first())
        .or(association_error.as_ref())
    {
        pending_notices
            .entry(first_id)
            .or_default()
            .push(notice_script(error, true));
    }
    for path in paths.iter().skip(1) {
        let _ = proxy.send_event(UserEvent::Open(vec![path.clone()]));
    }
    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, window_id, .. } => {
                webviews.remove(&window_id);
                pending.remove(&window_id);
                current_documents.remove(&window_id);
                pending_notices.remove(&window_id);
                if webviews.is_empty() { *control_flow = ControlFlow::Exit; }
            }
            Event::UserEvent(UserEvent::Open(paths)) => {
                for requested in paths {
                    match validate_markdown(&requested, &cwd).and_then(|path| read_document(&path)) {
                        Ok(doc) => {
                            let document_path = PathBuf::from(&doc.path);
                            if let Ok((window, view)) = create_window(target, proxy.clone(), Some(&doc)) {
                                let id = window.id();
                                webviews.insert(id, (window, view));
                                current_documents.insert(id, document_path);
                                pending.insert(id, Some(doc));
                            }
                        }
                        Err(error) => {
                            if let Some(id) = webviews.keys().next().copied() { notify(&mut webviews, id, &notice_script(&error, true)); }
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::Drop(id, DropState::Enter)) => notify(&mut webviews, id, "window.__hostDrop('enter')"),
            Event::UserEvent(UserEvent::Drop(id, DropState::Leave)) => notify(&mut webviews, id, "window.__hostDrop('leave')"),
            Event::UserEvent(UserEvent::Drop(id, DropState::Drop(paths))) => {
                notify(&mut webviews, id, "window.__hostDrop('leave')");
                let valid: Vec<_> = paths.into_iter().filter_map(|p| validate_markdown(&p, &cwd).ok()).collect();
                if valid.is_empty() { notify(&mut webviews, id, "window.__hostDrop('reject', 'Only .md files are supported.')"); }
                else { let _ = proxy.send_event(UserEvent::Open(valid)); }
            }
            Event::UserEvent(UserEvent::Ipc(id, message)) => {
                let parsed: serde_json::Value = serde_json::from_str(&message).unwrap_or_default();
                match parsed.get("type").and_then(|v| v.as_str()) {
                    Some("ready") => {
                        if let Some(payload) = pending.remove(&id).flatten() {
                            if let Ok(json) = serde_json::to_string(&payload) { notify(&mut webviews, id, &format!("window.__hostLoad({json})")); }
                        }
                        if let Some(notices) = pending_notices.remove(&id) { for script in notices { notify(&mut webviews, id, &script); } }
                        if let Some(status) = current_update.as_ref() { notify(&mut webviews, id, &update_script(status)); }
                    }
                    Some("external") => { if let Some(url) = parsed.get("url").and_then(|v| v.as_str()) { let _ = open_external(url); } }
                    Some("internal") => {
                        let result = (|| -> Result<(DocumentPayload, Option<String>), String> {
                            let href = parsed.get("href").and_then(|v| v.as_str()).ok_or("Missing local link target.")?;
                            let source = current_documents.get(&id).cloned().or_else(|| parsed.get("path").and_then(|v| v.as_str()).map(PathBuf::from)).ok_or("The current document path is unavailable.")?;
                            let obsidian = parsed.get("obsidian").and_then(|value| value.as_bool()).unwrap_or(false);
                            let (path, fragment) = resolve_internal_link_mode(&source, href, &cwd, obsidian)?;
                            Ok((read_document(&path)?, fragment))
                        })();
                        match result {
                            Ok((document, fragment)) => {
                                current_documents.insert(id, PathBuf::from(&document.path));
                                notify(&mut webviews, id, &navigate_script(&document, fragment.as_deref()));
                            }
                            Err(error) => notify(&mut webviews, id, &notice_script(&error, true)),
                        }
                    }
                    Some("history") => {
                        if let Some(path) = parsed.get("path").and_then(|v| v.as_str()) {
                            match validate_markdown(Path::new(path), &cwd) {
                                Ok(path) => { current_documents.insert(id, path); }
                                Err(error) => notify(&mut webviews, id, &notice_script(&error, true)),
                            }
                        }
                    }
                    Some("register") => {
                        match register_association() {
                            Ok(()) => notify(&mut webviews, id, "window.__hostNotice('Registered. If double-click still uses another app, choose Markdown Viewer in Windows Default Apps for .md.')"),
                            Err(error) => {
                                let message = format!("Could not register .md association ({error}). Choose this exe via Windows Settings > Apps > Default apps > .md.");
                                notify(&mut webviews, id, &notice_script(&message, true));
                            }
                        }
                    }
                    Some("update_check") => {
                        if !start_update_check(&updater, &proxy) { notify(&mut webviews, id, "window.__hostNotice('An update check is already running.')"); }
                    }
                    Some("update_download") => {
                        if updater.start_download() { watch_update(updater.clone(), proxy.clone()); }
                        else { notify(&mut webviews, id, "window.__hostNotice('No update is available to download.')"); }
                    }
                    Some("update_apply") => {
                        match updater.apply_ready() {
                            Ok(true) => *control_flow = ControlFlow::Exit,
                            Ok(false) => notify(&mut webviews, id, "window.__hostNotice('The update is not ready yet.')"),
                            Err(error) => notify(&mut webviews, id, &notice_script(&format!("Could not apply update: {error}"), true)),
                        }
                    }
                    _ => {}
                }
            }
            Event::UserEvent(UserEvent::Update(status)) => {
                current_update = Some(status.clone());
                let script = update_script(&status);
                let ids: Vec<_> = webviews.keys().copied().collect();
                for id in ids { notify(&mut webviews, id, &script); }
            }
            _ => {}
        }
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_markdown_extension_and_file_type() {
        let root =
            std::env::temp_dir().join(format!("markdown-viewer-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let markdown = root.join("sample.MD");
        let text = root.join("sample.txt");
        fs::write(&markdown, "# سلام").unwrap();
        fs::write(&text, "not markdown").unwrap();

        assert_eq!(
            validate_markdown(&markdown, &root).unwrap(),
            markdown.canonicalize().unwrap()
        );
        assert!(validate_markdown(&text, &root).is_err());
        assert!(validate_markdown(&root, &root).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_relative_internal_links() {
        let root =
            std::env::temp_dir().join(format!("markdown-viewer-links-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let source = root.join("index.md");
        let target = root.join("next.md");
        fs::write(&source, "# index").unwrap();
        fs::write(&target, "# next").unwrap();

        let (resolved, fragment) =
            resolve_internal_link_mode(&source, "./next.md#section", &root, false).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
        assert_eq!(fragment.as_deref(), Some("section"));
        assert!(
            resolve_internal_link_mode(&source, "https://example.com/next.md", &root, false)
                .is_err()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_obsidian_wiki_links_across_vault_directories() {
        let root =
            std::env::temp_dir().join(format!("markdown-viewer-obsidian-{}", std::process::id()));
        let notes = root.join("notes");
        fs::create_dir_all(&notes).unwrap();
        let source = notes.join("current.md");
        let target = root.join("target note.md");
        fs::write(&source, "# current").unwrap();
        fs::write(&target, "# target").unwrap();

        let (resolved, fragment) =
            resolve_internal_link_mode(&source, "target%20note#Heading", &root, true).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
        assert_eq!(fragment.as_deref(), Some("Heading"));

        let (same_document, same_fragment) =
            resolve_internal_link_mode(&source, "#Current", &root, true).unwrap();
        assert_eq!(same_document, source.canonicalize().unwrap());
        assert_eq!(same_fragment.as_deref(), Some("Current"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_obsidian_non_markdown_targets() {
        let root = std::env::temp_dir().join(format!(
            "markdown-viewer-obsidian-type-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("current.md");
        let image = root.join("image.png");
        fs::write(&source, "# current").unwrap();
        fs::write(&image, b"not markdown").unwrap();
        assert!(resolve_internal_link_mode(&source, "image.png", &root, true).is_err());
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn reads_utf8_markdown_and_strips_bom() {
        let path =
            std::env::temp_dir().join(format!("markdown-viewer-bom-{}.md", std::process::id()));
        fs::write(&path, b"\xEF\xBB\xBF\xD8\xB3\xD9\x84\xD8\xA7\xD9\x85").unwrap();
        let document = read_document(&path).unwrap();
        assert_eq!(document.contents, "سلام");
        assert_eq!(document.name, path.file_name().unwrap().to_string_lossy());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn escapes_bootstrap_html_terminators() {
        let payload = DocumentPayload {
            path: "C:\\docs\\sample.md".into(),
            name: "sample.md".into(),
            contents: "</script><script>alert(1)</script>".into(),
        };
        let html = bootstrap_html(Some(&payload));
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(!html.contains("</script><script>alert(1)"));
    }
}
