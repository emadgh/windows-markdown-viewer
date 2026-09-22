const brand = document.querySelector(".brand");
const titleElement = document.querySelector("title");

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function currentDisplayTitle() {
  const title = document.title.trim();
  const withoutAppSuffix = title.replace(/\s+—\s+Markdown Viewer v.*$/, "").trim();
  if (withoutAppSuffix && !/^Markdown Viewer(?:\s+v.*)?$/.test(withoutAppSuffix)) {
    return withoutAppSuffix;
  }
  return "Markdown Viewer";
}

function syncBrandToDocumentTitle() {
  if (brand) brand.textContent = currentDisplayTitle();
}

if (titleElement) {
  new MutationObserver(syncBrandToDocumentTitle).observe(titleElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
syncBrandToDocumentTitle();

document.addEventListener("paste", (event) => {
  if (event.defaultPrevented || isEditableTarget(event.target)) return;

  const markdown = event.clipboardData?.getData("text/plain") ?? "";
  if (!markdown.trim()) return;

  if (typeof window.__hostLoad !== "function") return;

  event.preventDefault();
  window.__hostLoad({
    path: "",
    name: "Clipboard.md",
    contents: markdown,
  });
  syncBrandToDocumentTitle();
  window.__hostNotice?.("Rendered Markdown from the clipboard.");
});
