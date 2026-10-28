import "github-markdown-css/github-markdown.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/700.css";
import "highlight.js/styles/github-dark.css";
import DOMPurify from "dompurify";
import { marked } from "marked";
import mermaid from "mermaid";
import { toBlob } from "html-to-image";
import hljs from "highlight.js";
import { applyDocumentDirection } from "./direction.js";
import { parseObsidianHref, rewriteObsidianLinks } from "./obsidian.js";
import "./style.css";

const documentRoot = document.querySelector("#document");
const toolbar = document.querySelector(".toolbar");
const fileNameLabel = document.querySelector(".file-name");
const instanceModeSelect = document.querySelector("#instance-mode-select");
const directionButton = document.querySelector("#direction-button");
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
const imageButton = document.querySelector("#image-button");
const imageButtonLabel = document.querySelector("#image-button-label");
const imageExportDialog = document.querySelector("#image-export-dialog");
const imageExportStatus = document.querySelector("#image-export-status");
const imageExportClose = document.querySelector("#image-export-close");
const saveImageButton = document.querySelector("#save-image-button");
const copyImageButton = document.querySelector("#copy-image-button");
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
let mermaidRenderGeneration = 0;
let mermaidRenderPromise = Promise.resolve();
let updateAction = "check";
let currentPayload = null;
let readyImageBlob = null;
let readyImageName = null;
let imageExportInProgress = false;
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
const FONT_PRESETS = {
  system: '"Vazirmatn", "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif',
  vazir: '"Vazirmatn", "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif',
  segoe: '"Segoe UI", "Vazirmatn", sans-serif',
  noto: '"Noto Sans Arabic", "Vazirmatn", "Segoe UI", Tahoma, sans-serif',
  tahoma: 'Tahoma, "Vazirmatn", "Noto Sans Arabic", sans-serif',
  consolas: 'Consolas, "Cascadia Mono", "Vazirmatn", monospace',
};

marked.setOptions({ gfm: true, breaks: true });
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
document.title = `Markdown Viewer v${APP_VERSION}`;
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
  applyDocumentDirection(documentRoot, direction);
  const mode = direction || "auto";
  const label = mode === "auto" ? "Auto" : mode.toUpperCase();
  const next = { auto: "RTL", rtl: "LTR", ltr: "Auto" }[mode];
  directionButton.dataset.direction = mode;
  directionButton.textContent = label;
  directionButton.title = `Text direction: ${label}. Click to switch to ${next}.`;
  directionButton.setAttribute("aria-label", directionButton.title);
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
  closeLightbox();
  const rawHtml = marked.parse(rewriteObsidianLinks(payload.contents));
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
  documentRoot.innerHTML = safeHtml;
  documentRoot.removeAttribute("dir");
  delete documentRoot.dataset.manualDirection;
  setDirection(null);
  document.title = `${payload.name} — Markdown Viewer v${APP_VERSION}`;
  fileNameLabel.textContent = payload.name || "Untitled.md";
  fileNameLabel.title = payload.path || payload.name || "Untitled.md";
  resolveRelativeImages(payload.path);
  refreshImageGallery();
  mermaidRenderPromise = renderMermaidDiagrams();
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
    // Wry maps custom protocols to HTTP origins on Windows; retain that origin.
    image.src = `/__image?doc=${encodeURIComponent(documentPath)}&src=${encodeURIComponent(source)}`;
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
  imageButton.disabled = !currentPayload;
}
function sanitizedPngName(documentName) {
  const stem = (documentName || "Markdown document").replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 120);
  return `${safe || "Markdown document"}.png`;
}
function waitForImage(image) {
  if (image.complete) return image.decode?.().catch(() => {}) ?? Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }).then(() => image.decode?.().catch(() => {}));
}
async function prepareDocumentImage() {
  if (!currentPayload || imageExportInProgress) return;
  imageExportInProgress = true;
  imageButton.disabled = true;
  imageButtonLabel.textContent = "Preparing…";
  const sourcePayload = currentPayload;
  let stage;
  try {
    await mermaidRenderPromise;
    await document.fonts?.ready;
    await Promise.all([...documentRoot.querySelectorAll("img")].map(waitForImage));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (currentPayload !== sourcePayload) throw new Error("The open document changed. Try exporting again.");

    const rootStyle = getComputedStyle(documentRoot);
    const contentWidth = Math.ceil(Math.max(documentRoot.getBoundingClientRect().width, documentRoot.scrollWidth));
    const clone = documentRoot.cloneNode(true);
    Object.assign(clone.style, { width: `${contentWidth}px`, maxWidth: "none", minHeight: "0", height: "auto", margin: "0" });
    clone.removeAttribute("aria-live");
    stage = document.createElement("div");
    stage.setAttribute("aria-hidden", "true");
    Object.assign(stage.style, {
      position: "fixed", left: "0", top: "100vh", zIndex: "-1", display: "block",
      boxSizing: "border-box", width: `${contentWidth + 80}px`, height: "auto",
      overflow: "visible",
    });
    const surface = document.createElement("div");
    Object.assign(surface.style, {
      display: "flow-root", boxSizing: "border-box", width: "100%", padding: "40px",
      backgroundColor: rootStyle.backgroundColor, color: rootStyle.color, fontFamily: rootStyle.fontFamily,
    });
    surface.append(clone);
    stage.append(surface);
    document.body.append(stage);

    const width = Math.ceil(surface.getBoundingClientRect().width);
    const height = Math.ceil(surface.getBoundingClientRect().height);
    if (width > 32000 || height > 32000 || width * height > 160_000_000) {
      throw new Error("This document is too large for a single image. Try a shorter document.");
    }
    const blob = await toBlob(surface, {
      backgroundColor: rootStyle.backgroundColor,
      pixelRatio: 1,
      cacheBust: true,
    });
    if (!blob) throw new Error("The image could not be created.");
    readyImageBlob = blob;
    readyImageName = sanitizedPngName(sourcePayload.name);
    imageExportStatus.classList.remove("error");
    imageExportStatus.textContent = `Image ready (${width} × ${height} px). Choose where to put it.`;
    saveImageButton.disabled = false;
    copyImageButton.disabled = false;
    imageExportDialog.showModal();
    saveImageButton.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNotice(`Could not create image: ${message}`, true);
  } finally {
    stage?.remove();
    imageExportInProgress = false;
    imageButtonLabel.textContent = "Image";
    imageButton.disabled = !currentPayload;
  }
}
function saveDocumentImage() {
  if (!readyImageBlob || !readyImageName) return;
  const url = URL.createObjectURL(readyImageBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = readyImageName;
  link.hidden = true;
  document.body.append(link);
  imageExportStatus.classList.remove("error");
  imageExportStatus.textContent = "Saving image to Downloads…";
  saveImageButton.disabled = true;
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
async function copyDocumentImage() {
  if (!readyImageBlob) return;
  copyImageButton.disabled = true;
  imageExportStatus.classList.remove("error");
  imageExportStatus.textContent = "Copying image…";
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard is unavailable in this WebView.");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": readyImageBlob })]);
    imageExportStatus.textContent = "Image copied to the clipboard.";
    showNotice("Image copied to the clipboard.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    imageExportStatus.classList.add("error");
    imageExportStatus.textContent = `Could not copy image: ${message}`;
    copyImageButton.disabled = false;
  }
}
function finishImageDownload(success, path) {
  if (success) {
    imageExportStatus.classList.remove("error");
    imageExportStatus.textContent = "Image saved to Downloads.";
    showNotice("Image saved to Downloads.");
    return;
  }
  saveImageButton.disabled = false;
  imageExportStatus.classList.add("error");
  imageExportStatus.textContent = "Could not save the image to Downloads. Check that the folder is available.";
  showNotice("Could not save the image to Downloads.", true);
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

directionButton.addEventListener("click", () => {
  const next = { auto: "rtl", rtl: "ltr", ltr: null }[directionButton.dataset.direction];
  setDirection(next);
});
settingsAssociationButton.addEventListener("click", () => hostMessage({ type: "register" }));
updateButton.addEventListener("click", () => hostMessage({ type: `update_${updateAction}` }));
settingsUpdateButton.addEventListener("click", () => updateButton.click());
backButton.addEventListener("click", goBack);
forwardButton.addEventListener("click", goForward);
printButton.addEventListener("click", () => window.print());
imageButton.addEventListener("click", prepareDocumentImage);
saveImageButton.addEventListener("click", saveDocumentImage);
copyImageButton.addEventListener("click", copyDocumentImage);
imageExportClose.addEventListener("click", () => imageExportDialog.close());
imageExportDialog.addEventListener("click", (event) => { if (event.target === imageExportDialog) imageExportDialog.close(); });
imageExportDialog.addEventListener("close", () => {
  readyImageBlob = null;
  readyImageName = null;
  saveImageButton.disabled = false;
  copyImageButton.disabled = false;
  imageExportStatus.textContent = "";
  imageExportStatus.classList.remove("error");
});
editButton.addEventListener("click", () => { if (currentPayload?.path) hostMessage({ type: "edit", path: currentPayload.path }); });
settingsButton.addEventListener("click", () => settingsDialog.showModal());
settingsClose.addEventListener("click", closeSettings);
instanceModeSelect.addEventListener("change", () => {
  instanceModeSelect.disabled = true;
  hostMessage({ type: "instance_mode", mode: instanceModeSelect.value });
});
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
window.__hostSettings = (settings) => {
  if (!["single", "multiple"].includes(settings?.instanceMode)) return;
  instanceModeSelect.value = settings.instanceMode;
  instanceModeSelect.disabled = false;
};
window.__hostLoad = (payload) => {
  if (!payload) return;
  backStack.length = 0;
  forwardStack.length = 0;
  showPayload(payload, { record: false });
};
window.__hostNavigate = (payload, fragment = null) => { if (payload) showPayload(payload, { fragment, record: true }); };
window.__hostUpdate = setUpdateControls;
window.__hostImageDownloadComplete = finishImageDownload;
loadViewerSettings();
updateHistoryButtons();
showFirstRunAssociationPrompt();
if (bootstrap) window.__hostLoad(bootstrap);
hostMessage({ type: "ready" });
