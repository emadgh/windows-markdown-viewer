const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LTR = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;

const directionBlocks = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption";

/** Apply a document override, or restore each block's automatic direction. */
export function applyDocumentDirection(container, direction = null) {
  if (direction) {
    container.setAttribute("dir", direction);
    container.dataset.manualDirection = "true";
  } else {
    container.removeAttribute("dir");
    delete container.dataset.manualDirection;
  }
  container.querySelectorAll(directionBlocks).forEach((block) => {
    const automatic = block.dataset.autoDirection || directionForText(block.textContent);
    block.dataset.autoDirection = automatic;
    block.setAttribute("dir", direction || automatic);
    // plaintext ignores dir and chooses a base direction separately for each line.
    block.style.unicodeBidi = direction ? "isolate" : "plaintext";
    block.style.textAlign = direction ? "start" : "";
  });
}

/** Returns the direction of the first strong character, defaulting to LTR. */
export function directionForText(text) {
  for (const character of text) {
    if (RTL.test(character)) return "rtl";
    if (LTR.test(character)) return "ltr";
  }
  return "ltr";
}
