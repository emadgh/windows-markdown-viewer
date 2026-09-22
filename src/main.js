import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github-dark.css";
import DOMPurify from "dompurify";
import { marked } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js";
import { directionForText } from "./direction.js";
import { parseObsidianHref, rewriteObsidianLinks } from "./obsidian.js";
import "./style.css";

const documentRoot = document.querySelector("#document");
const toolbar = document.querySelector(".toolbar");
const directionButton = document.querySelector("#direction-button");
const automaticButton = document.querySelector("#automatic-button");
const associationButton = document.querySelector("#association-button");
const updateButton = document.querySelector("#update-button");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsClose = document.querySelector("#settings-close");
const settingsUpdateButton = document.querySelector("#settings-update-button");
const fontSelect = document.querySelector("#font-select");
const fontSizeInput = document.querySelector("#font-size-input");
const fontSizeValue = document.querySelector("#font-size-value");
const backButton = document.querySelector("#back-button");
const forwardButton = document.querySelector("#forward-button");
const printButton = document.querySelector("#print-button");
const overlay = document.querySelector("#drop-overlay");
const notice = document.querySelector("#notice");
let manualDirection = null;
let mermaidRenderGeneration = 0;
let updateAction = "check";
let currentPayload = null;
const backStack = [];
const forwardStack = [];
const bootstrap = window.__BOOTSTRAP__ || null;
const directionBlocks = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption";
const FONT_PRESETS = {
  system: '"Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif',
  segoe: '"Segoe UI", sans-serif',
  noto: '"Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif',
  tahoma: 'Tahoma, "Noto Sans Arabic", sans-serif',
  consolas: 'Consolas, "Cascadia Mono", monospace',
};

marked.setOptions({ gfm: true, breaks: false });
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
marked.use({ renderer: { code({ text, lang }) {
  const normalizedLanguage = (lang || "").trim().toLowerCase();
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (normalizedLanguage === "mermaid") return `<div class="mermaid">${escaped}</div>\n`;
  const language = hljs.getLanguage(normalizedLanguage) ? normalizedLanguage : "plaintext";
  const highlighted = language === "plaintext"
    ? escaped
    : hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>\n`;
} } });

function syncToolbarOffset() {
  const height = Math.ceil(toolbar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--toolbar-height", `${height}px`);
}
if ("ResizeObserver" in window) new ResizeObserver(syncToolbarOffset).observe(toolbar);
window.addEventListener("resize", syncToolbarOffset, { passive: true });
syncToolbarOffset();
function hostMessage(message) {
  if (window.ipc?.postMessage) window.ipc.postMessage(JSON.stringify(message));
}
function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.classList.add("visible");
  window.setTimeout(() => notice.classList.remove("visible"), 5200);
}
function setDirection(direction) {
  manualDirection = direction;
  if (direction) {
    documentRoot.setAttribute("dir", direction);
    documentRoot.dataset.manualDirection = "true";
    documentRoot.querySelectorAll(directionBlocks).forEach((block) => block.setAttribute("dir", direction));
  } else {
    documentRoot.removeAttribute("dir");
    delete documentRoot.dataset.manualDirection;
    documentRoot.querySelectorAll(directionBlocks).forEach((block) => {
      const automatic = block.dataset.autoDirection;
      if (automatic) block.setAttribute("dir", automatic);
    });
  }
  directionButton.textContent = direction === "rtl" ? "LTR" : "RTL";
  directionButton.setAttribute("aria-label", direction === "rtl" ? "Use left-to-right direction" : "Use right-to-left direction");
  automaticButton.hidden = !direction;
}
function applyAutomaticDirection(container) {
  container.querySelectorAll(directionBlocks).forEach((block) => {
    const automatic = directionForText(block.textContent);
    block.dataset.autoDirection = automatic;
    block.setAttribute("dir", automatic);
    block.style.unicodeBidi = "plaintext";
  });
}
async function renderMermaidDiagrams() {
  const generation = ++mermaidRenderGeneration;
  const diagrams = [...documentRoot.querySelectorAll(".mermaid")];
  if (!diagrams.length) return;
  try {
    await mermaid.run({ nodes: diagrams });
  } catch (error) {
    if (generation !== mermaidRenderGeneration) return;
    const reason = error instanceof Error ? error.message : String(error);
    diagrams.forEach((diagram) => {
      if (!diagram.querySelector("svg")) {
        diagram.classList.add("mermaid-error");
        diagram.textContent = `Mermaid diagram error: ${reason}`;
      }
    });
    showNotice("Could not render one or more Mermaid diagrams.", true);
  }
}
function scrollToPosition(top) {
  window.scrollTo(0, top);
  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
}
function renderDocument(payload, { scrollTop = 0, fragment = null } = {}) {
  manualDirection = null;
  const rawHtml = marked.parse(rewriteObsidianLinks(payload.contents));
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
  documentRoot.innerHTML = safeHtml;
  documentRoot.removeAttribute("dir");
  delete documentRoot.dataset.manualDirection;
  applyAutomaticDirection(documentRoot);
  setDirection(null);
  document.title = `${payload.name} — Markdown Viewer`;
  resolveRelativeImages(payload.path);
  renderMermaidDiagrams();
  window.requestAnimationFrame(() => {
    if (fragment) {
      if (scrollToFragment(fragment)) return;
    }
    scrollToPosition(scrollTop);
  });
}
function scrollToFragment(fragment) {
  const decoded = decodeURIComponent(fragment.replace(/^#/, ""));
  const target = document.getElementById(decoded) || document.querySelector(`[name="${CSS.escape(decoded)}"]`);
  if (target) {
    target.scrollIntoView({ block: "start" });
    return true;
  }
  showNotice(`Could not find section: ${decoded}`, true);
  return false;
}
function resolveRelativeImages(documentPath) {
  for (const image of documentRoot.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src");
    if (!source || /^(https?:|data:|#|mv-image:)/i.test(source)) continue;
    image.src = `mv-image://localhost/?doc=${encodeURIComponent(documentPath)}&src=${encodeURIComponent(source)}`;
    image.addEventListener("error", () => showNotice(`Could not load local image: ${source}`, true), { once: true });
  }
}
function updateHistoryButtons() {
  backButton.disabled = backStack.length === 0;
  forwardButton.disabled = forwardStack.length === 0;
}
function snapshot() {
  return currentPayload ? { payload: currentPayload, scrollTop: window.scrollY || document.documentElement.scrollTop || 0 } : null;
}
function showPayload(payload, { record = true, fragment = null, scrollTop = 0 } = {}) {
  if (record && currentPayload) {
    backStack.push(snapshot());
    forwardStack.length = 0;
  }
  currentPayload = payload;
  renderDocument(payload, { fragment, scrollTop });
  updateHistoryButtons();
}
function goBack() {
  const previous = backStack.pop();
  if (!previous) return;
  const current = snapshot();
  if (current) forwardStack.push(current);
  currentPayload = previous.payload;
  renderDocument(previous.payload, { scrollTop: previous.scrollTop });
  updateHistoryButtons();
  hostMessage({ type: "history", path: previous.payload.path });
}
function goForward() {
  const next = forwardStack.pop();
  if (!next) return;
  const current = snapshot();
  if (current) backStack.push(current);
  currentPayload = next.payload;
  renderDocument(next.payload, { scrollTop: next.scrollTop });
  updateHistoryButtons();
  hostMessage({ type: "history", path: next.payload.path });
}
function applyViewerSettings(fontKey, fontSize) {
  const safeFontKey = FONT_PRESETS[fontKey] ? fontKey : "system";
  const safeSize = Math.min(32, Math.max(12, Number(fontSize) || 16));
  document.documentElement.style.setProperty("--viewer-font", FONT_PRESETS[safeFontKey]);
  document.documentElement.style.setProperty("--viewer-font-size", `${safeSize}px`);
  fontSelect.value = safeFontKey;
  fontSizeInput.value = String(safeSize);
  fontSizeValue.textContent = `${safeSize}px`;
}
function loadViewerSettings() {
  let fontKey = "system";
  let fontSize = 16;
  try {
    fontKey = localStorage.getItem("markdown-viewer.font") || fontKey;
    fontSize = localStorage.getItem("markdown-viewer.font-size") || fontSize;
  } catch { /* Storage may be disabled by the host. */ }
  applyViewerSettings(fontKey, fontSize);
}
function saveViewerSettings() {
  try {
    localStorage.setItem("markdown-viewer.font", fontSelect.value);
    localStorage.setItem("markdown-viewer.font-size", fontSizeInput.value);
  } catch { /* Keep the setting active for this window. */ }
}
function closeSettings() {
  if (settingsDialog.open) settingsDialog.close();
}
function setUpdateControls(state) {
  if (!state || !state.state) return;
  updateButton.disabled = false;
  settingsUpdateButton.disabled = false;
  updateAction = "check";
  let label = "Check for updates";
  if (state.state === "checking") {
    label = "Checking…";
    updateButton.disabled = true;
    settingsUpdateButton.disabled = true;
  } else if (state.state === "downloading") {
    const percent = state.total ? Math.round((state.downloaded / state.total) * 100) : 0;
    label = percent ? `Downloading ${percent}%…` : "Downloading…";
    updateButton.disabled = true;
    settingsUpdateButton.disabled = true;
  } else if (state.state === "ready") {
    label = `Restart for v${state.version}`;
    updateAction = "apply";
  } else if (state.state === "available") {
    label = `Download v${state.version}`;
    updateAction = "download";
  } else if (state.state === "failed") {
    label = "Retry update check";
    updateButton.title = state.message || "Update check failed";
  }
  updateButton.textContent = label;
  settingsUpdateButton.textContent = label;
}

directionButton.addEventListener("click", () => setDirection(manualDirection === "rtl" ? "ltr" : "rtl"));
automaticButton.addEventListener("click", () => setDirection(null));
associationButton.addEventListener("click", () => hostMessage({ type: "register" }));
updateButton.addEventListener("click", () => hostMessage({ type: `update_${updateAction}` }));
settingsUpdateButton.addEventListener("click", () => updateButton.click());
backButton.addEventListener("click", goBack);
forwardButton.addEventListener("click", goForward);
printButton.addEventListener("click", () => window.print());
settingsButton.addEventListener("click", () => settingsDialog.showModal());
settingsClose.addEventListener("click", closeSettings);
settingsDialog.addEventListener("click", (event) => { if (event.target === settingsDialog) closeSettings(); });
fontSelect.addEventListener("change", () => { applyViewerSettings(fontSelect.value, fontSizeInput.value); saveViewerSettings(); });
fontSizeInput.addEventListener("input", () => { applyViewerSettings(fontSelect.value, fontSizeInput.value); saveViewerSettings(); });
documentRoot.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  const obsidianTarget = parseObsidianHref(href);
  if (obsidianTarget !== null) {
    event.preventDefault();
    if (!currentPayload?.path) { showNotice("Open a Markdown file before following a local link.", true); return; }
    if (obsidianTarget.startsWith("#")) {
      scrollToFragment(obsidianTarget);
      return;
    }
    hostMessage({ type: "internal", path: currentPayload.path, href: obsidianTarget, obsidian: true });
    return;
  }
  if (/^(https?|mailto|tel):/i.test(href)) {
    event.preventDefault();
    hostMessage({ type: "external", url: link.href });
    return;
  }
  if (href.startsWith("#")) return;
  event.preventDefault();
  if (!currentPayload?.path) { showNotice("Open a Markdown file before following a local link.", true); return; }
  hostMessage({ type: "internal", path: currentPayload.path, href });
});
window.__hostDrop = (state, message) => {
  if (state === "enter") overlay.classList.add("active");
  else overlay.classList.remove("active");
  if (state === "reject") showNotice(message || "Only .md files are supported.", true);
};
window.__hostNotice = (message, isError = false) => showNotice(message, isError);
window.__hostLoad = (payload) => {
  if (!payload) return;
  backStack.length = 0;
  forwardStack.length = 0;
  showPayload(payload, { record: false });
};
window.__hostNavigate = (payload, fragment = null) => { if (payload) showPayload(payload, { fragment, record: true }); };
window.__hostUpdate = setUpdateControls;
loadViewerSettings();
updateHistoryButtons();
if (bootstrap) window.__hostLoad(bootstrap);
hostMessage({ type: "ready" });