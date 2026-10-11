import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node scripts/check-webview.mjs <viewer.exe> (close other viewer instances first)");
const root = fileURLToPath(new URL("../", import.meta.url));
const readme = resolve(root, "README.md");
const contents = await readFile(readme, "utf8");
const version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const reservation = createServer();
await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const instanceReservation = createServer();
await new Promise((done) => instanceReservation.listen(0, "127.0.0.1", done));
const instancePort = instanceReservation.address().port;
await new Promise((done) => instanceReservation.close(done));
const temporary = await mkdtemp(resolve(tmpdir(), "markdown-viewer-native-"));
const nativeSecond = resolve(temporary, "Second document.md");
await writeFile(nativeSecond, "# A second file\n\nEnglish متن فارسی\n");
const testEnvironment = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: resolve(temporary, "webview"),
  MARKDOWN_VIEWER_CONFIG_DIR: temporary,
  MARKDOWN_VIEWER_INSTANCE_PORT: String(instancePort),
  MARKDOWN_VIEWER_TEST_MODE: "1",
};
const child = spawn(resolve(executable), [readme], {
  cwd: root, windowsHide: true, stdio: "ignore",
  env: testEnvironment,
});
let socket;
let sequence = 0;
const pending = new Map();
async function call(method, params) {
  const id = ++sequence;
  const result = await new Promise((done, fail) => {
    const timeout = setTimeout(() => { pending.delete(id); fail(new Error("WebView evaluation timed out")); }, 10000);
    pending.set(id, { done, fail, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return result;
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function viewerTargets() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return targets.filter(item => item.type === "page" && item.url.includes("mv-app"));
}
async function forwardFile(path) {
  const forwarded = spawn(resolve(executable), path ? [path] : [], {
    cwd: root, windowsHide: true, stdio: "ignore", env: testEnvironment,
  });
  const result = await new Promise((done, fail) => {
    const timeout = setTimeout(() => { forwarded.kill(); fail(new Error("Forwarded launch failed to exit")); }, 10000);
    forwarded.once("exit", code => { clearTimeout(timeout); done(code); });
    forwarded.once("error", error => { clearTimeout(timeout); fail(error); });
  });
  assert.equal(result, 0);
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Viewer exited early: ${child.exitCode}; close existing instances first`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((item) => item.type === "page" && item.url.includes("mv-app"));
      if (target) break;
    } catch { /* WebView2 is still starting. */ }
    await delay(200);
  }
  assert.ok(target, "WebView2 debugging target must become available");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.fail(new Error(JSON.stringify(message.error)));
    else entry.done(message.result);
  });
  let imageLoaded = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    imageLoaded = await evaluate("Boolean(document.querySelector('#document img')?.naturalWidth)");
    if (imageLoaded) break;
    await delay(100);
  }
  const imageState = await evaluate("({ url: location.href, title: document.title, images: [...document.querySelectorAll('#document img')].map(i => ({ src: i.src, width: i.naturalWidth })), notice: document.querySelector('#notice').textContent })");
  assert.ok(imageLoaded, `README screenshot must load: ${JSON.stringify(imageState)}`);
  assert.ok(imageState.title.endsWith(`Markdown Viewer v${version}`), "Window title must use the current version");
  assert.equal(await evaluate("document.querySelector('#app-version').textContent"), `v${version}`);
  console.log(`PASS version ${version} in title and settings`);
  assert.equal(await evaluate("document.querySelector('.file-name').textContent"), "README.md");
  assert.equal(await evaluate("document.querySelector('#instance-mode-select').value"), "single");
  const toolbarLayout = await evaluate("({ direction: document.querySelector('#direction-button').getBoundingClientRect().left, width: innerWidth, inActions: document.querySelector('.toolbar-actions').contains(document.querySelector('#direction-button')), count: document.querySelectorAll('[data-direction]').length, label: Boolean(document.querySelector('#direction-label')), brand: Boolean(document.querySelector('.brand')) })");
  assert.ok(toolbarLayout.direction > toolbarLayout.width / 2);
  assert.equal(toolbarLayout.inActions, true);
  assert.equal(toolbarLayout.count, 1);
  assert.equal(toolbarLayout.label, false);
  assert.equal(toolbarLayout.brand, false);
  console.log("PASS one direction button on the right, no heading, and live filename");
  await call("Emulation.setDeviceMetricsOverride", { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
  const narrow = await evaluate("({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('.file-info, .toolbar-actions')].map(e => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right })) })");
  assert.ok(narrow.scroll <= narrow.width);
  assert.ok(narrow.controls.every(r => r.left >= 0 && r.right <= narrow.width));
  await call("Emulation.clearDeviceMetricsOverride", {});
  console.log("PASS toolbar fits a narrow window without hiding the filename");
  if (process.argv[3]) {
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(process.argv[3]), Buffer.from(screenshot.data, "base64"));
  }
  console.log("PASS README screenshot", imageState.images[0]);
  await evaluate("document.querySelector('#document img').click()");
  await delay(200);
  assert.equal(await evaluate("!document.querySelector('#image-lightbox').hidden && document.querySelector('#lightbox-image').naturalWidth > 0"), true);
  console.log("PASS screenshot lightbox");
  const fixture = { path: readme, name: "Direction test.md", contents: "English متن فارسی  \nSecond متن فارسی\n\nفارسی English\n\n| English فارسی | فارسی English |\n| --- | --- |\n| Hello سلام | سلام Hello |" };
  await evaluate(`window.__hostLoad(${JSON.stringify(fixture)})`);
  assert.equal(await evaluate("document.querySelector('.file-name').textContent"), fixture.name);
  for (const mode of ["rtl", "ltr", "auto"]) {
    await evaluate("document.querySelector('#direction-button').click()");
    const state = await evaluate(`(() => {
      const p = document.querySelector('#document p');
      const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 7);
      const lineStarts = [...p.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => {
        const start = n.textContent.search(/\\S/);
        const line = document.createRange(); line.setStart(n, start); line.setEnd(n, Math.min(start + 6, n.length));
        return line.getBoundingClientRect().left;
      });
      return { mode: document.querySelector('#direction-button').dataset.direction, label: document.querySelector('#direction-button').textContent, description: document.querySelector('#direction-button').getAttribute('aria-label'),
        blocks: [...document.querySelectorAll('#document p, #document td, #document th')].map(b => ({ dir: b.dir, bidi: getComputedStyle(b).unicodeBidi })),
        lineStarts, wordLeft: r.getBoundingClientRect().left, paragraphLeft: p.getBoundingClientRect().left, paragraphRight: p.getBoundingClientRect().right };
    })()`);
    assert.equal(state.mode, mode);
    assert.equal(state.label, mode === "auto" ? "Auto" : mode.toUpperCase());
    assert.ok(state.description.includes(`Text direction: ${state.label}.`));
    if (mode !== "auto") {
      assert.ok(state.blocks.every((block) => block.dir === mode && block.bidi === "isolate"));
      assert.equal(state.lineStarts.length, 2, "Check both English-first lines separated by a hard line break");
      if (mode === "rtl") assert.ok(state.lineStarts.every(left => left > (state.paragraphLeft + state.paragraphRight) / 2), "English-first RTL lines should start on the right");
      else assert.ok(state.lineStarts.every(left => left < state.paragraphLeft + 10), "LTR lines should start on the left");
    } else {
      assert.equal(state.blocks[0].dir, "ltr");
      assert.equal(state.blocks[1].dir, "rtl");
      assert.ok(state.blocks.every((block) => block.bidi === "plaintext"));
    }
    console.log(`PASS ${mode} direction and active button`);
  }
  await evaluate("document.querySelector('#direction-button').click()");
  await evaluate(`window.__hostLoad(${JSON.stringify({ path: readme, name: "README.md", contents })})`);
  assert.equal(await evaluate("document.querySelector('#direction-button').dataset.direction"), "auto");
  console.log("PASS new document resets to Auto");
  await forwardFile(nativeSecond);
  await waitFor("document.querySelector('.file-name').textContent === 'Second document.md'");
  assert.equal((await viewerTargets()).length, 1, "Single mode must reuse the existing window");
  await evaluate("document.querySelector('#back-button').click()");
  assert.equal(await evaluate("document.querySelector('.file-name').textContent"), "README.md");
  console.log("PASS single instance reuses window and preserves Back history");
  await forwardFile(null);
  assert.equal((await viewerTargets()).length, 1);
  assert.equal(await evaluate("document.querySelector('.file-name').textContent"), "README.md");
  console.log("PASS empty launch focuses the existing window in Single mode");
  await evaluate("const s = document.querySelector('#instance-mode-select'); s.value = 'multiple'; s.dispatchEvent(new Event('change'))");
  await waitFor("!document.querySelector('#instance-mode-select').disabled");
  assert.equal(JSON.parse(await readFile(resolve(temporary, "settings.json"), "utf8")).instanceMode, "multiple");
  await forwardFile(nativeSecond);
  let windows;
  for (let attempt = 0; attempt < 100; attempt++) {
    windows = await viewerTargets();
    if (windows.length === 2 && windows.some(w => w.title.includes("Second document.md"))) break;
    await delay(100);
  }
  assert.equal(windows.length, 2, "Multiple mode must open another document window");
  assert.ok(windows.some(w => w.title.includes("Second document.md")));
  assert.equal(await evaluate("document.querySelector('.file-name').textContent"), "README.md");
  console.log("PASS multiple instances open separate windows and mode is persisted");
  await forwardFile(null);
  for (let attempt = 0; attempt < 100; attempt++) {
    windows = await viewerTargets();
    if (windows.length === 3) break;
    await delay(100);
  }
  assert.equal(windows.length, 3, "Launching the EXE in Multiple mode opens an empty window");
  console.log("PASS empty launch opens a new window in Multiple mode");
} finally {
  socket?.close();
  if (child.exitCode === null) {
    const exited = new Promise(done => child.once("exit", done));
    child.kill();
    await exited;
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => console.warn(`Temporary test data cleanup: ${error.message}`));
}
