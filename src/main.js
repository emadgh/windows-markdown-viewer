import "github-markdown-css/github-markdown.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/700.css";
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
const settingsAssociationButton = document.querySelector("#settings-association-button");
const updateButton = document.querySelector("#update-button");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsClose = document.querySelector("#settings-close");
const settingsUpdateButton = document.querySelector("#settings-update-button");
const appVersionElement = document.querySelector("#app-version");
const githubLink = document.querySelector("#github-link");
const fontSelect = document.querySelector("#font-select");
const fontSizeInput = document.querySelector("#font-size-input");
const fontSizeValue = document.querySelector("#font-size-value");
const backButton = document.querySelector("#back-button");
const forwardButton = document.querySelector("#forward-button");
const printButton = document.querySelector("#print-button");
const editButton = document.querySelector("#edit-button");
const overlay = document.querySelector("#drop-overlay");
const notice = document.querySelector("#notice");
const lightbox = document.querySelector("#image-lightbox");
const lightboxImage = document.querySelector("#lightbox-image");
const lightboxCaption = document.querySelector("#lightbox-caption");
const lightboxCount = document.querySelector("#lightbox-count");
const lightboxClose = document.querySelector("#lightbox-close");
const lightboxPrevious = document.querySelector("#lightbox-previous");
const lightboxNext = document.querySelector("#lightbox-next");
let manualDirection = null;
let mermaidRenderGeneration = 0;
let updateAction = "check";
let currentPayload = null;
let galleryImages = [];
let lightboxIndex = 0;
let lightboxPreviousFocus = null;
const backStack = [];
const forwardStack = [];
const bootstrap = window.__BOOTSTRAP__ || null;
const APP_VERSION = typeof window.__APP_VERSION__ === "string" && window.__APP_VERSION__ !== "__APP_VERSION__"
  ? window.__APP_VERSION__
  : "dev";
const GITHUB_URL = "https://github.com/emadgh/windows-markdown-viewer";
const directionBlocks = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption";
const FONT_PRESETS = {
  system: '"Vazirmatn", "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif',
  vazir: '"Vazirmatn", "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif',
  segoe: '"Segoe UI", "Vazirmatn", sans-serif',
  noto: '"Noto Sans Arabic", "Vazirmatn", "Segoe UI", Tahoma, sans-serif',
  tahoma: 'Tahoma, "Vazirmatn", "Noto Sans Arabic", sans-serif',
  consolas: 'Consolas, "Cascadia Mono", "Vazirmatn", monospace',
};

marked.setOptions({ gfm: true, breaks: false });
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
document.title = `Markdown Viewer v${APP_VERSION}`;
document.querySelector(".brand").textContent = `Markdown Viewer v${APP_VERSION}`;
appVersionElement.textContent = `v${APP_VERSION}`;
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
  closeLightbox();
  const rawHtml = marked.parse(rewriteObsidianLinks(payload.contents));
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
  documentRoot.innerHTML = safeHtml;
  documentRoot.removeAttribute("dir");
  delete documentRoot.dataset.manualDirection;
  applyAutomaticDirection(documentRoot);
  setDirection(null);
  document.title = `${payload.name} — Markdown Viewer v${APP_VERSION}`;
  resolveRelativeImages(payload.path);
  refreshImageGallery();
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
    image.src = `mv-app://localhost/__image?doc=${encodeURIComponent(documentPath)}&src=${encodeURIComponent(source)}`;
    image.addEventListener("error", () => showNotice(`Could not load local image: ${source}`, true), { once: true });
  }
}
function refreshImageGallery() {
  galleryImages = [...documentRoot.querySelectorAll("img")];
  galleryImages.forEach((image, index) => {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    const label = image.alt?.trim() || ("Image " + (index + 1));
    image.setAttribute("aria-label", "Open " + label);
  });
}
function renderLightboxImage() {
  const image = galleryImages[lightboxIndex];
  if (!image) return;
  lightboxImage.src = image.currentSrc || image.src;
  lightboxImage.alt = image.alt || "";
  lightboxCaption.textContent = image.alt?.trim() || "";
  lightboxCount.textContent = galleryImages.length > 1
    ? (lightboxIndex + 1) + " / " + galleryImages.length
    : "";
  lightboxPrevious.disabled = galleryImages.length < 2;
  lightboxNext.disabled = galleryImages.length < 2;
}
function openLightbox(index) {
  if (!galleryImages.length) return;
  lightboxIndex = ((index % galleryImages.length) + galleryImages.length) % galleryImages.length;
  lightboxPreviousFocus = document.activeElement;
  renderLightboxImage();
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  lightboxClose.focus();
}
function closeLightbox() {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  document.body.classList.remove("lightbox-open");
  lightboxImage.removeAttribute("src");
  if (lightboxPreviousFocus && typeof lightboxPreviousFocus.focus === "function") {
    lightboxPreviousFocus.focus();
  }
  lightboxPreviousFocus = null;
}
function stepLightbox(delta) {
  if (galleryImages.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + galleryImages.length) % galleryImages.length;
  renderLightboxImage();
}
function updateEditButton() {
  editButton.disabled = !currentPayload?.path;
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
  updateEditButton();
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
function showFirstRunAssociationPrompt() {
  try {
    if (localStorage.getItem("markdown-viewer.association-prompt-shown")) return;
    localStorage.setItem("markdown-viewer.association-prompt-shown", "true");
  } catch { /* Continue with the prompt if storage is unavailable. */ }
  window.setTimeout(() => showNotice("Set as default .md file viewer. Open Settings to register it."), 450);
}
function closeSettings() {
  if (settingsDialog.open) settingsDialog.close();
}
function setUpdateControls(state) {
  if (!state || !state.state) return;
  updateButton.hidden = !["available", "downloading", "ready"].includes(state.state);
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
settingsAssociationButton.addEventListener("click", () => hostMessage({ type: "register" }));
updateButton.addEventListener("click", () => hostMessage({ type: `update_${updateAction}` }));
settingsUpdateButton.addEventListener("click", () => updateButton.click());
backButton.addEventListener("click", goBack);
forwardButton.addEventListener("click", goForward);
printButton.addEventListener("click", () => window.print());
editButton.addEventListener("click", () => { if (currentPayload?.path) hostMessage({ type: "edit", path: currentPayload.path }); });
settingsButton.addEventListener("click", () => settingsDialog.showModal());
settingsClose.addEventListener("click", closeSettings);
githubLink.addEventListener("click", (event) => { event.preventDefault(); hostMessage({ type: "external", url: GITHUB_URL }); });
settingsDialog.addEventListener("click", (event) => { if (event.target === settingsDialog) closeSettings(); });
fontSelect.addEventListener("change", () => { applyViewerSettings(fontSelect.value, fontSizeInput.value); saveViewerSettings(); });
fontSizeInput.addEventListener("input", () => { applyViewerSettings(fontSelect.value, fontSizeInput.value); saveViewerSettings(); });
documentRoot.addEventListener("click", (event) => {
  const image = event.target?.closest?.("img");
  if (image && documentRoot.contains(image)) {
    event.preventDefault();
    const index = galleryImages.indexOf(image);
    if (index >= 0) openLightbox(index);
    return;
  }
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
lightboxClose.addEventListener("click", closeLightbox);
lightboxPrevious.addEventListener("click", () => stepLightbox(-1));
lightboxNext.addEventListener("click", () => stepLightbox(1));
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target.matches?.("[data-lightbox-close]")) closeLightbox();
});
lightboxImage.addEventListener("error", () => showNotice("Could not load image preview.", true));
documentRoot.addEventListener("keydown", (event) => {
  const image = event.target?.closest?.("img");
  if (!image || !documentRoot.contains(image)) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const index = galleryImages.indexOf(image);
    if (index >= 0) openLightbox(index);
  }
});
window.addEventListener("keydown", (event) => {
  if (lightbox.hidden) return;
  if (event.key === "Escape") closeLightbox();
  else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepLightbox(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    stepLightbox(1);
  }
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
showFirstRunAssociationPrompt();
if (bootstrap) window.__hostLoad(bootstrap);
hostMessage({ type: "ready" });