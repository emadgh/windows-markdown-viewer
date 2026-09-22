import test from "node:test";
import assert from "node:assert/strict";
import { obsidianLinkHref, parseObsidianHref, rewriteObsidianLinks } from "../src/obsidian.js";

const tick = String.fromCharCode(96);

test("rewrites Obsidian wiki links and aliases", () => {
  const output = rewriteObsidianLinks("[[Folder/Note]] and [[Other Note|نمایش]]");
  assert.match(output, /\[Note\]\(#obsidian:Folder%2FNote\)/);
  assert.match(output, /\[نمایش\]\(#obsidian:Other%20Note\)/);
});

test("preserves wiki-looking text in inline and fenced code", () => {
  const markdown = `${tick}[[inline]]${tick}\n\n${tick.repeat(3)}\n[[fenced]]\n${tick.repeat(3)}`;
  assert.equal(rewriteObsidianLinks(markdown), markdown);
});

test("round-trips encoded Obsidian targets", () => {
  const target = "Folder/یادداشت من#بخش اول";
  assert.equal(parseObsidianHref(obsidianLinkHref(target)), target);
});