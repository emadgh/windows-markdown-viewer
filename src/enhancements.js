function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

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
  window.__hostNotice?.("Rendered Markdown from the clipboard.");
});
