# Markdown Viewer for Windows

A fast, portable, read-only Markdown viewer for Windows 10/11 x64.

The desktop shell is a small Rust application using [`wry`](https://github.com/tauri-apps/wry) and the system WebView2 runtime. The UI is a bundled vanilla JavaScript application; Tauri and React are not used.

## Features

- Open `.md` files from the command line, Windows **Open with**, or double-click.
- Forward launches to the existing process while opening each document in its own window.
- Drag and drop Markdown files anywhere in the window.
- Automatic paragraph direction using Unicode bidirectional classification.
- Manual RTL/LTR direction controls with an Auto reset button.
- Correct Persian/Arabic/Unicode rendering through WebView2 system fonts.
- GitHub-style Markdown, fenced-code highlighting, and sanitized HTML.
- Relative local images resolved beside the Markdown file.
- External HTTP(S) links opened in the system browser.
- Single portable executable; no installer is required.

## Requirements

- Windows 10 or Windows 11, x64.
- Microsoft Edge WebView2 Runtime. It is normally preinstalled on current Windows versions.
- Node.js/npm and the Rust MSVC toolchain for building from source.

## Build

```powershell
npm ci
npm run build:portable
```

The executable is written to:

```text
webview2-viewer\target\release\markdown-viewer-webview2.exe
```

The build script compiles the Vite frontend, inlines its JavaScript/CSS into the HTML shell, and embeds that HTML into the Rust executable. The `dist/` and Cargo `target/` directories are generated and intentionally ignored by Git.

## Run

Open an empty viewer:

```powershell
.\webview2-viewer\target\release\markdown-viewer-webview2.exe
```

Open a document directly:

```powershell
.\webview2-viewer\target\release\markdown-viewer-webview2.exe .\docs\README.md
```

You can also drop one or more `.md` files onto any viewer window. A second launch forwards its paths to the first process instead of creating a duplicate process.

## File association

The app registers a per-user `MarkdownViewer.md` ProgID when it starts and from the **File association** button. Windows may protect an existing default-app choice. If double-click still opens another application, use:

**Settings → Apps → Default apps → Choose defaults by file type → `.md`**

Then select `markdown-viewer-webview2.exe` once.

## Development and tests

Run the frontend development server:

```powershell
npm run dev
```

Run tests:

```powershell
npm test
cargo test --manifest-path webview2-viewer\Cargo.toml
```

The Rust host validates local Markdown paths, limits document/image sizes, serves relative images through a private protocol, sanitizes bootstrap data, and handles the Windows single-instance forwarding channel.

## Project layout

```text
src/                    Vanilla JS, CSS, and direction logic
scripts/                Frontend bundling/inlining script
tests/                  Frontend tests
webview2-viewer/        Rust + wry Windows host
index.html              Frontend shell
package.json            Vite build and test scripts
```

## License

No license has been selected yet. Add the project license you want before publishing a public package.
