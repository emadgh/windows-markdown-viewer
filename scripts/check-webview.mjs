import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
const child = spawn(resolve(executable), [readme], {
  cwd: root, windowsHide: true, stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
});
let socket;
let sequence = 0;
const pending = new Map();
async function evaluate(expression) {
  const id = ++sequence;
  const result = await new Promise((done, fail) => {
    const timeout = setTimeout(() => { pending.delete(id); fail(new Error("WebView evaluation timed out")); }, 10000);
    pending.set(id, { done, fail, timeout });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
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
  console.log("PASS README screenshot", imageState.images[0]);
  await evaluate("document.querySelector('#document img').click()");
  await delay(200);
  assert.equal(await evaluate("!document.querySelector('#image-lightbox').hidden && document.querySelector('#lightbox-image').naturalWidth > 0"), true);
  console.log("PASS screenshot lightbox");
  const fixture = { path: readme, name: "Direction test.md", contents: "English متن فارسی  \nSecond متن فارسی\n\nفارسی English\n\n| English فارسی | فارسی English |\n| --- | --- |\n| Hello سلام | سلام Hello |" };
  await evaluate(`window.__hostLoad(${JSON.stringify(fixture)})`);
  for (const mode of ["rtl", "ltr", "auto"]) {
    await evaluate(`document.querySelector('[data-direction="${mode}"]').click()`);
    const state = await evaluate(`(() => {
      const p = document.querySelector('#document p');
      const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 7);
      const lineStarts = [...p.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => {
        const start = n.textContent.search(/\\S/);
        const line = document.createRange(); line.setStart(n, start); line.setEnd(n, Math.min(start + 6, n.length));
        return line.getBoundingClientRect().left;
      });
      return { pressed: [...document.querySelectorAll('[data-direction][aria-pressed="true"]')].map(b => b.dataset.direction),
        blocks: [...document.querySelectorAll('#document p, #document td, #document th')].map(b => ({ dir: b.dir, bidi: getComputedStyle(b).unicodeBidi })),
        lineStarts, wordLeft: r.getBoundingClientRect().left, paragraphLeft: p.getBoundingClientRect().left, paragraphRight: p.getBoundingClientRect().right };
    })()`);
    assert.deepEqual(state.pressed, [mode]);
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
  await evaluate("document.querySelector('[data-direction=rtl]').click()");
  await evaluate(`window.__hostLoad(${JSON.stringify({ path: readme, name: "README.md", contents })})`);
  assert.equal(await evaluate("document.querySelector('[data-direction=auto]').getAttribute('aria-pressed')"), "true");
  console.log("PASS new document resets to Auto");
} finally {
  socket?.close();
  child.kill();
}
