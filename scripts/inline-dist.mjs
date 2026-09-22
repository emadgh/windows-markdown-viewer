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
fs.writeFileSync(path.join(dist, "index.html"), html);
