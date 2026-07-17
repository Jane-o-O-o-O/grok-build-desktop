const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const required = [
  "main.cjs", "preload.cjs", "package.json", "renderer/index.html",
  "provider-config.cjs", "native-config.cjs", "account-info.cjs", "git-workspace.cjs", "scripts/test-providers.cjs", "scripts/test-native-config.cjs", "scripts/test-account-info.cjs", "scripts/test-git-workspace.cjs",
  "renderer/tokens.css", "renderer/app.css", "renderer/app.js",
  "renderer/assets/GrokSans-Regular.woff2", "renderer/assets/GrokSans-Medium.woff2",
  "renderer/assets/grok-mark.png", "build/icon.png"
];
for (const file of required) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) throw new Error(`Missing asset: ${file}`);
}

for (const file of ["main.cjs", "preload.cjs", "native-config.cjs", "account-info.cjs", "git-workspace.cjs", "renderer/app.js", "scripts/serve.cjs"]) {
  new vm.Script(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}

const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "renderer/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer/app.css"), "utf8") + fs.readFileSync(path.join(root, "renderer/tokens.css"), "utf8");
const backend = fs.readFileSync(path.join(root, "main.cjs"), "utf8") + fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
for (const ref of [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js|woff2))"/g)].map((match) => match[1])) {
  if (!fs.existsSync(path.join(root, "renderer", ref))) throw new Error(`Broken HTML asset: ${ref}`);
}
for (const id of ["messages", "promptInput", "sendButton", "threadList", "activityTimeline", "branchButton", "branchPopover", "branchList", "settingsBackdrop", "settingsSearch", "rawConfigEditor", "accountPopover", "authMenuButton", "providerUrl", "discoverModelsButton", "dockTabs", "dockTabAdd", "terminalForm", "browserView", "workspaceFileList"]) {
  if (!html.includes(`id="${id}"`) || !js.includes(`#${id}`)) throw new Error(`UI wiring missing: ${id}`);
}
for (const selector of [".app-shell", ".sidebar", ".conversation", ".composer", ".inspector", ".message", ".tool-card"]) {
  if (!css.includes(selector)) throw new Error(`Component style missing: ${selector}`);
}
for (const token of ["--accent", "--surface", "--text", "--line", "--shadow-composer"]) {
  if (!css.includes(token)) throw new Error(`Design token missing: ${token}`);
}
for (const feature of ["scheduleStreamingRender", "requestAnimationFrame", "openPicker", "picker-popover", "dock-status--workspace", "dock-status--local", "grokLogoShimmer", "assets/grok-mark.png", "discoverProviderModels", "nativeSettingGroups", "config:save-raw", "auth:login", "onAuthEvent", "git:info", "switchGitBranch", "branch-popover", "dock-tabbar", "terminal:run", "workspace:files", "providers:discover"]) {
  if (!`${html}\n${js}\n${css}\n${backend}`.includes(feature)) throw new Error(`Desktop interaction missing: ${feature}`);
}
const iconGenerator = fs.readFileSync(path.join(root, "scripts/generate-icon.py"), "utf8");
if (!iconGenerator.includes("logo07.txt") || !iconGenerator.includes("logo24.txt") || !iconGenerator.includes("BRAILLE_DOTS")) {
  throw new Error("Desktop icon is no longer derived from the canonical TUI braille logo");
}
for (const removed of ['id="composerHint"', "profile-row", "Local workspace"]) {
  if (`${html}\n${js}`.includes(removed)) throw new Error(`Removed desktop element returned: ${removed}`);
}

console.log(`Verified ${required.length} desktop assets, renderer wiring, Grok design tokens, and JavaScript syntax.`);
