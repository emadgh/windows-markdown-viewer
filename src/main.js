import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github-dark.css";
import DOMPurify from "dompurify";
import { marked } from "marked";
import hljs from "highlight.js";
import { directionForText } from "./direction.js";
import "./style.css";

const documentRoot = document.querySelector("#document");
const directionButton = document.querySelector("#direction-button");
const automaticButton = document.querySelector("#automatic-button");
const associationButton = document.querySelector("#association-button");
const overlay = document.querySelector("#drop-overlay");
const notice = document.querySelector("#notice");
let manualDirection = null;
const bootstrap = window.__BOOTSTRAP__ || null;
const directionBlocks = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption";

marked.setOptions({ gfm: true, breaks: false });
marked.use({ renderer: { code({ text, lang }) {
  const language = hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = language === "plaintext"
    ? text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    : hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>\n`;
} } });

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
function renderDocument(payload) {
  manualDirection = null;
  const rawHtml = marked.parse(payload.contents);
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
  documentRoot.innerHTML = safeHtml;
  documentRoot.removeAttribute("dir");
  delete documentRoot.dataset.manualDirection;
  applyAutomaticDirection(documentRoot);
  setDirection(null);
  document.title = `${payload.name} — Markdown Viewer`;
  resolveRelativeImages(payload.path);
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}
function resolveRelativeImages(documentPath) {
  for (const image of documentRoot.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src");
    if (!source || /^(https?:|data:|#|mv-image:)/i.test(source)) continue;
    image.src = `mv-image://localhost/?doc=${encodeURIComponent(documentPath)}&src=${encodeURIComponent(source)}`;
    image.addEventListener("error", () => showNotice(`Could not load local image: ${source}`, true), { once: true });
  }
}
directionButton.addEventListener("click", () => setDirection(manualDirection === "rtl" ? "ltr" : "rtl"));
automaticButton.addEventListener("click", () => setDirection(null));
associationButton.addEventListener("click", () => hostMessage({ type: "register" }));
documentRoot.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  const href = link.href;
  if (/^https?:/i.test(href)) { event.preventDefault(); hostMessage({ type: "external", url: href }); }
});
window.__hostDrop = (state, message) => {
  if (state === "enter") overlay.classList.add("active");
  else overlay.classList.remove("active");
  if (state === "reject") showNotice(message || "Only .md files are supported.", true);
};
window.__hostNotice = (message, isError = false) => showNotice(message, isError);
window.__hostLoad = (payload) => { if (payload) renderDocument(payload); };
if (bootstrap) renderDocument(bootstrap);
hostMessage({ type: "ready" });
