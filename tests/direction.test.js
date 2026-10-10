import test from "node:test";
import assert from "node:assert/strict";
import { applyDocumentDirection, directionForText } from "../src/direction.js";

function element(textContent = "") {
  const attributes = new Map();
  return {
    textContent, dataset: {}, style: {},
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name),
  };
}

test("manual directions override English-first paragraphs and restore Auto", () => {
  const englishFirst = element("Markdown متن فارسی\nEnglish سطر دوم");
  const persianFirst = element("متن فارسی English");
  const container = element();
  container.querySelectorAll = () => [englishFirst, persianFirst];

  applyDocumentDirection(container);
  assert.equal(englishFirst.getAttribute("dir"), "ltr");
  assert.equal(persianFirst.getAttribute("dir"), "rtl");
  assert.equal(englishFirst.style.unicodeBidi, "plaintext");

  applyDocumentDirection(container, "rtl");
  assert.equal(container.getAttribute("dir"), "rtl");
  assert.equal(englishFirst.getAttribute("dir"), "rtl");
  assert.equal(englishFirst.style.unicodeBidi, "isolate");
  assert.equal(englishFirst.style.textAlign, "start");

  applyDocumentDirection(container, "ltr");
  assert.equal(persianFirst.getAttribute("dir"), "ltr");
  assert.equal(persianFirst.style.unicodeBidi, "isolate");

  applyDocumentDirection(container);
  assert.equal(container.getAttribute("dir"), undefined);
  assert.equal(container.dataset.manualDirection, undefined);
  assert.equal(englishFirst.getAttribute("dir"), "ltr");
  assert.equal(persianFirst.getAttribute("dir"), "rtl");
  assert.equal(englishFirst.style.unicodeBidi, "plaintext");
});

test("uses the first strong Arabic or Hebrew character for RTL paragraphs", () => {
  assert.equal(directionForText("  123 سلام world"), "rtl");
  assert.equal(directionForText("- שלום world"), "rtl");
});

test("uses the first strong Latin character for LTR paragraphs", () => {
  assert.equal(directionForText("  123 Markdown سلام"), "ltr");
  assert.equal(directionForText("---"), "ltr");
});
