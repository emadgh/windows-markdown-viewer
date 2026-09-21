import test from "node:test";
import assert from "node:assert/strict";
import { directionForText } from "../src/direction.js";

test("uses the first strong Arabic or Hebrew character for RTL paragraphs", () => {
  assert.equal(directionForText("  123 سلام world"), "rtl");
  assert.equal(directionForText("- שלום world"), "rtl");
});

test("uses the first strong Latin character for LTR paragraphs", () => {
  assert.equal(directionForText("  123 Markdown سلام"), "ltr");
  assert.equal(directionForText("---"), "ltr");
});
