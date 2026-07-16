const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const required = [
  "main.cjs", "preload.cjs", "package.json", "renderer/index.html",
  "renderer/tokens.css", "renderer/app.css", "renderer/app.js",
  "renderer/assets/GrokSans-Regular.woff2", "renderer/assets/GrokSans-Medium.woff2",
  "build/icon.png"
];
for (const file of required) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) throw new Error(`Missing asset: ${file}`);
}

for (const file of ["main.cjs", "preload.cjs", "renderer/app.js", "scripts/serve.cjs"]) {
  new vm.Script(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}

const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "renderer/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer/app.css"), "utf8") + fs.readFileSync(path.join(root, "renderer/tokens.css"), "utf8");
for (const ref of [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js|woff2))"/g)].map((match) => match[1])) {
  if (!fs.existsSync(path.join(root, "renderer", ref))) throw new Error(`Broken HTML asset: ${ref}`);
}
for (const id of ["messages", "promptInput", "sendButton", "threadList", "activityTimeline", "settingsBackdrop"]) {
  if (!html.includes(`id="${id}"`) || !js.includes(`#${id}`)) throw new Error(`UI wiring missing: ${id}`);
}
for (const selector of [".app-shell", ".sidebar", ".conversation", ".composer", ".inspector", ".message", ".tool-card"]) {
  if (!css.includes(selector)) throw new Error(`Component style missing: ${selector}`);
}
for (const token of ["--accent", "--surface", "--text", "--line", "--shadow-composer"]) {
  if (!css.includes(token)) throw new Error(`Design token missing: ${token}`);
}

console.log(`Verified ${required.length} desktop assets, renderer wiring, Grok design tokens, and JavaScript syntax.`);
