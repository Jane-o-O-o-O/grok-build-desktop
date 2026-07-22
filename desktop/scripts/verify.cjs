const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const required = [
  "main.cjs", "preload.cjs", "package.json", "renderer/index.html",
  "provider-config.cjs", "provider-bridge.cjs", "native-config.cjs", "account-info.cjs", "git-workspace.cjs", "cli-runtime.cjs", "attachment-store.cjs", "scripts/test-providers.cjs", "scripts/test-provider-bridge.cjs", "scripts/test-native-config.cjs", "scripts/test-account-info.cjs", "scripts/test-git-workspace.cjs", "scripts/test-cli-runtime.cjs", "scripts/test-attachments.cjs",
  "renderer/tokens.css", "renderer/app.css", "renderer/i18n.js", "renderer/locales-native.js", "renderer/app.js",
  "renderer/assets/GrokSans-Regular.woff2", "renderer/assets/GrokSans-Medium.woff2",
  "renderer/assets/grok-mark.png", "build/icon.png"
];
for (const file of required) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) throw new Error(`Missing asset: ${file}`);
}

for (const file of ["main.cjs", "preload.cjs", "provider-config.cjs", "provider-bridge.cjs", "native-config.cjs", "account-info.cjs", "git-workspace.cjs", "cli-runtime.cjs", "attachment-store.cjs", "renderer/i18n.js", "renderer/locales-native.js", "renderer/app.js", "scripts/serve.cjs"]) {
  new vm.Script(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}

const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "renderer/app.js"), "utf8");
const i18n = fs.readFileSync(path.join(root, "renderer/i18n.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer/app.css"), "utf8") + fs.readFileSync(path.join(root, "renderer/tokens.css"), "utf8");
const backend = fs.readFileSync(path.join(root, "main.cjs"), "utf8") + fs.readFileSync(path.join(root, "preload.cjs"), "utf8") + fs.readFileSync(path.join(root, "cli-runtime.cjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (!packageJson.build?.files?.includes("attachment-store.cjs") || packageJson.scripts?.["test:attachments"] !== "node scripts/test-attachments.cjs") {
  throw new Error("Clipboard attachment storage is missing from the packaged desktop build or test scripts");
}
for (const ref of [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js|woff2))"/g)].map((match) => match[1])) {
  if (!fs.existsSync(path.join(root, "renderer", ref))) throw new Error(`Broken HTML asset: ${ref}`);
}
for (const id of ["messages", "promptInput", "sendButton", "fileDropOverlay", "threadList", "branchButton", "branchPopover", "branchList", "settingsBackdrop", "settingsSearch", "settingsDoneButton", "settingsPendingStatus", "rawConfigEditor", "accountPopover", "authMenuButton", "providerUrl", "discoverModelsButton", "dockTabs", "dockTabAdd", "dockTabPrev", "dockTabNext", "dockDynamicPanes", "fileTree", "fileFilterInput", "fileCodeView", "fileMetaLang", "fileMetaLines", "fileSaveButton", "sidebarResizer", "inspectorResizer", "agentModeButton", "agentModeLabel", "localeSelect", "runtimeDockStatus", "runtimeDockLabel", "runtimeSetupBackdrop", "macosTipBackdrop", "pickRuntimeBinary", "clearRuntimeBinary", "openRuntimeSetup"]) {
  if (!html.includes(`id="${id}"`) || !js.includes(`#${id}`)) throw new Error(`UI wiring missing: ${id}`);
}
for (const selector of [".app-shell", ".sidebar", ".conversation", ".composer", ".inspector", ".message", ".tool-card"]) {
  if (!css.includes(selector)) throw new Error(`Component style missing: ${selector}`);
}
for (const token of ["--accent", "--surface", "--text", "--line", "--shadow-composer"]) {
  if (!css.includes(token)) throw new Error(`Design token missing: ${token}`);
}
for (const feature of ["scheduleStreamingRender", "scheduleSideStreamingRender", "requestAnimationFrame", "openPicker", "picker-popover", "dock-status--workspace", "dock-status--local", "grokLogoShimmer", "assets/grok-mark.png", "discoverProviderModels", "nativeSettingGroups", "config:save-raw", "auth:login", "onAuthEvent", "git:info", "switchGitBranch", "branch-popover", "dock-tabbar", "terminal:create", "onTerminalEvent", "side-task-composer", "data-browser-view", "normalizeBrowserUrl", "refreshActiveBrowserPane", "syncBrowserNavButtons", "updateBrowserTabLabel", "dock-pane--browser", "browser.placeholder", "browser.loadFailed", "workspace:list", "attachments:save-clipboard-image", "attachments:validate-paths", "saveClipboardImage", "pathForFile", "handlePromptPaste", "bindAttachmentDropZone", "is-file-dragging", "providers:discover", "providers:probe-all", "providers:refresh", "providers:set-enabled", "setProviderModelsEnabled", "data-toggle-provider", "data-provider-model-toggle", "data-provider-card", "data-provider-enabled-status", "providerModelDrafts", "changedProviderDrafts", "updateProviderDraftUI", "applySettingsChanges", "settings-open", "animation-play-state:paused", "backdrop-filter:none", "onProviderEvent", "startSessionUpdateBridge", "tool_call_update", "toolMessageMarkup", "thinking-block", "permission_requested", "runtime:models", "hydrateRuntimeModels", "settings-search-hit", "settingsSearchCatalog", "integration-detail-modal", "openIntegrationDetail", "slash-popover", "slashCommands", "file-explorer", "file-tree", "pane-resizer", "bindPaneResizer", "applyPaneWidths", "tool-steps", "toolGroupMarkup", "ensureActiveAssistant", "updateTurnProgress", "stream-caret", "agent-mode-picker", "openAgentModePicker", "permissionMode", "buildCliArgs", "streaming-json", "platform-darwin", "GrokI18n", "applyLocale", "localeSelect", "locales-native.js", "nativeSettingTitle", "runtime:pick-binary", "runtime:clear-binary", "pickRuntimeBinary", "clearRuntimeBinary", "openRuntimeSetup", "maybeShowMacosGatekeeperTip", "RUNTIME_NOT_FOUND", "customBinary", "guide-modal", "macosTipBackdrop", "detectFileLanguage", "fileMetaLang", "file-code__empty-icon", "workspace:write", "writeWorkspaceFile", "saveWorkspaceFile", "fileCodeEditor", "bindFileTreeOnce"]) {
  if (!`${html}\n${js}\n${css}\n${backend}\n${i18n}`.includes(feature)) throw new Error(`Desktop interaction missing: ${feature}`);
}
for (const removed of ["AcpAgentRun", "agent stdio", "grok:permission-respond", "respondPermission", "handleToolPermission"]) {
  if (`${backend}\n${js}`.includes(removed)) throw new Error(`Removed ACP interaction returned: ${removed}`);
}
for (const feature of ["t(definition.titleKey)", "t(item.titleKey)", "t(item.descKey)"]) {
  if (!js.includes(feature)) throw new Error(`Localized workbench label wiring missing: ${feature}`);
}
for (const feature of ['value="zh" data-i18n-option="lang.zh"', 'value="en" data-i18n-option="lang.en"']) {
  if (!html.includes(feature)) throw new Error(`Locale option wiring missing: ${feature}`);
}
if ((i18n.match(/"lang\.zh": "中文"/g) || []).length !== 2 || (i18n.match(/"lang\.en": "English"/g) || []).length !== 2) {
  throw new Error("Locale option labels must stay distinct in both interface languages");
}
if (html.includes('data-i18n-option="lang.name"') || i18n.includes('"lang.name"')) {
  throw new Error("Ambiguous locale option label returned");
}
const i18nWindow = {};
const i18nDocument = { documentElement: {}, querySelectorAll: () => [], querySelector: () => null };
const i18nContext = vm.createContext({ window: i18nWindow, document: i18nDocument });
new vm.Script(i18n, { filename: "renderer/i18n.js" }).runInContext(i18nContext);
const localeOptions = [
  { dataset: { i18nOption: "lang.zh" }, textContent: "" },
  { dataset: { i18nOption: "lang.en" }, textContent: "" }
];
const localeRoot = {
  querySelectorAll: () => [],
  querySelector: (selector) => selector === "#localeSelect" ? { options: localeOptions } : null
};
for (const locale of ["zh", "en"]) {
  i18nWindow.GrokI18n.setLocale(locale);
  i18nWindow.GrokI18n.applyDom(localeRoot);
  if (localeOptions.map((option) => option.textContent).join("|") !== "中文|English") {
    throw new Error(`Locale options collapsed after switching to ${locale}`);
  }
}
const iconGenerator = fs.readFileSync(path.join(root, "scripts/generate-icon.py"), "utf8");
if (!iconGenerator.includes("logo07.txt") || !iconGenerator.includes("logo24.txt") || !iconGenerator.includes("BRAILLE_DOTS")) {
  throw new Error("Desktop icon is no longer derived from the canonical TUI braille logo");
}
for (const removed of ['id="composerHint"', "profile-row", "Local workspace"]) {
  if (`${html}\n${js}`.includes(removed)) throw new Error(`Removed desktop element returned: ${removed}`);
}
if (/[A-Z]:\\\\[^"'\n]+/.test(js) || /[A-Z]:\\[^<\n]+/.test(html)) {
  throw new Error("Platform-specific workspace path is hard-coded in the renderer");
}
for (const feature of ["workspace:resolve", "resolveWorkspace", "resolveWorkspaceState"]) {
  if (!`${backend}\n${js}`.includes(feature)) throw new Error(`Workspace fallback wiring missing: ${feature}`);
}

console.log(`Verified ${required.length} desktop assets, renderer wiring, Grok design tokens, and JavaScript syntax.`);
