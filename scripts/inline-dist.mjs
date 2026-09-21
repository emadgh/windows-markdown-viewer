import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const cssFiles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
for (const href of cssFiles) {
  const file = path.join(dist, href.replace(/^\//, ""));
  const css = fs.readFileSync(file, "utf8");
  html = html.replace(new RegExp(`<link[^>]+href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`), () => `<style>${css}</style>`);
}
const scriptFiles = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)].map((m) => m[1]);
for (const src of scriptFiles) {
  const file = path.join(dist, src.replace(/^\//, ""));
  // A bundled dependency can contain the literal `</script>` sequence in a
  // string. Escape the slash before putting it inside an inline script so the
  // HTML parser does not terminate the script early and render the remainder
  // as visible page text.
  const js = fs.readFileSync(file, "utf8").replace(/<\/script/gi, "<\\/script");
  html = html.replace(new RegExp(`<script[^>]+src="${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*><\\/script>`), () => `<script type="module">${js}</script>`);
}
fs.writeFileSync(path.join(dist, "index.html"), html);
