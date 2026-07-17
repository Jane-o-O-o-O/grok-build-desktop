(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = window.grokDesktop || null;
  const STORAGE_KEY = "grok-desktop-state-v1";

  const defaultState = {
    cwd: "E:\\interesting\\grok-build-kunkun",
    theme: "dark",
    model: "auto",
    modelLabel: "自动模型",
    effort: "high",
    effortLabel: "高思考",
    alwaysApprove: false,
    activeThreadId: null,
    threads: [],
    attachments: [],
    inspectorOpen: true,
    sidebarHidden: false,
    dockTabs: [{ id: "tasks", type: "tasks", title: "侧边任务" }],
    activeDockTabId: "tasks"
  };

  let state = loadState();
  let activeRun = null;
  let activeAssistantMessage = null;
  let activeRunDiagnostics = [];
  let startedAt = 0;
  let durationTimer = null;
  let runtimeModels = [{ id: "auto", label: "自动模型" }];
  let streamRenderFrame = null;
  const sideStreamFrames = new Map();
  let pickerPopover = null;
  let providerDiscovery = null;
  let savedProviders = [];
  let nativeConfig = { values: {}, raw: "", path: "~/.grok/config.toml", integrations: {} };
  let authState = { signedIn: false, name: "登录 Grok" };
  let authPollTimer = null;
  let authPollBusy = false;
  let runtimeState = { connected: false, version: null, binary: null };
  let gitState = { ok: true, isRepo: false, branches: [], dirtyCount: 0 };
  let branchFilter = "";

  const nativeSettingGroups = [
    { target: "nativeGeneralSettings", title: "原生会话", items: [
      ["auto_update", "自动更新", "启动时检查并安装 Grok Runtime 更新", "bool"],
      ["show_tips", "启动提示", "启动原生 TUI 时显示使用提示", "bool"],
      ["auto_compact", "自动压缩阈值", "上下文达到该百分比后自动压缩", "number", { suffix: "%" }],
      ["load_envrc", "加载 .envrc", "创建会话时读取工作区环境变量", "bool"],
      ["remote_fetch", "远程目录", "允许在线获取模型目录等可选信息", "bool"]
    ]},
    { target: "nativeModelSettings", title: "模型路由", items: [
      ["default_model", "默认模型", "新会话使用的原生模型", "model"],
      ["web_search_model", "网页搜索模型", "Web Search 工具使用的模型", "model"]
    ]},
    { target: "nativeAppearanceSettings", title: "主题与布局", items: [
      ["theme", "TUI 主题", "原生终端界面的颜色主题", "select", { auto: "跟随系统", groknight: "Grok Night", grokday: "Grok Day", tokyonight: "Tokyo Night", "rosepine-moon": "Rose Pine Moon", "oscura-midnight": "Oscura Midnight" }],
      ["auto_dark_theme", "系统深色主题", "TUI 跟随系统时使用的深色主题", "select", { groknight: "Grok Night", grokday: "Grok Day", tokyonight: "Tokyo Night", "rosepine-moon": "Rose Pine Moon", "oscura-midnight": "Oscura Midnight" }],
      ["auto_light_theme", "系统浅色主题", "TUI 跟随系统时使用的浅色主题", "select", { groknight: "Grok Night", grokday: "Grok Day", tokyonight: "Tokyo Night", "rosepine-moon": "Rose Pine Moon", "oscura-midnight": "Oscura Midnight" }],
      ["compact_mode", "紧凑模式", "减少消息区域内外边距", "bool"],
      ["screen_mode", "屏幕模式", "原生 TUI 默认使用全屏或最小模式", "select", { fullscreen: "全屏", minimal: "最小" }],
      ["show_timestamps", "显示时间戳", "在用户与 Agent 消息旁显示时间", "bool"],
      ["show_thinking_blocks", "显示思考块", "流式展示 Agent 的思考和推理内容", "bool"],
      ["group_tool_verbs", "合并工具调用", "折叠连续读取、搜索、列表与子 Agent 行", "bool"],
      ["collapsed_edit_blocks", "折叠编辑块", "用单行 +N/-M 摘要展示文件修改", "bool"],
      ["max_thoughts_width", "思考块最大宽度", "思考面板的列宽预算，范围 40–500", "number"],
      ["render_mermaid", "Mermaid 图表", "控制 Mermaid 代码块的渲染入口", "select", { auto: "自动", on: "开启", off: "关闭" }],
      ["display_refresh_auto_cadence", "匹配显示器刷新率", "在高刷新率显示器上提高 TUI 流式和滚动帧率", "bool"]
    ]},
    { target: "nativeInputSettings", title: "编辑与输入", items: [
      ["simple_mode", "Readline 输入", "使用普通输入而不是实验性 Vim 提示编辑", "bool"],
      ["vim_mode", "Vim 滚动导航", "使用 h/j/k/l 等按键导航对话历史", "bool"],
      ["prompt_suggestions", "提示词建议", "每轮后预测下一条输入并以幽灵文字显示", "bool"],
      ["voice_capture_mode", "语音触发方式", "控制语音快捷键是按住说话还是切换录音", "select", { hold: "按住说话", toggle: "切换录音" }],
      ["voice_stt_language", "语音识别语言", "Grok STT 的格式化与识别语言", "select", { en: "English", auto: "跟随系统", ar: "العربية", cs: "Čeština", da: "Dansk", nl: "Nederlands", fil: "Filipino", fr: "Français", de: "Deutsch", hi: "हिन्दी", id: "Bahasa Indonesia", it: "Italiano", ja: "日本語", ko: "한국어", mk: "Македонски", ms: "Bahasa Melayu", fa: "فارسی", pl: "Polski", pt: "Português", ro: "Română", ru: "Русский", es: "Español", sv: "Svenska", th: "ไทย", tr: "Türkçe", vi: "Tiếng Việt" }],
      ["scroll_speed", "滚动速度", "鼠标滚轮和触控板速度，范围 1–100", "number"],
      ["scroll_mode", "滚动输入", "自动检测或固定为滚轮/触控板", "select", { auto: "自动检测", wheel: "鼠标滚轮", trackpad: "触控板" }],
      ["scroll_lines", "每次滚动行数", "每个滚动事件移动的行数，范围 1–10", "number"],
      ["invert_scroll", "反向滚动", "使用自然滚动方向", "bool"],
      ["keep_text_selection", "文本选择", "控制选择高亮和双击行为", "select", { flash: "短暂高亮", hold: "保持高亮", word_select: "双击选词" }],
      ["hint_undo", "撤销提示", "清空输入后提示 Ctrl+Z 恢复草稿", "bool"],
      ["hint_plan_mode", "计划模式提示", "规划类请求时提示使用 Shift+Tab", "bool"],
      ["hint_image_input", "图片输入提示", "剪贴板存在图片时提示粘贴", "bool"],
      ["hint_send_now", "立即发送提示", "排队跟进内容后提示立即发送方式", "bool"],
      ["hint_small_screen", "小屏幕提示", "终端空间较小时提示紧凑模式", "bool"],
      ["hint_word_select", "单词选择提示", "双击文本后提示终端式选词设置", "bool"]
    ]},
    { target: "nativeAgentSettings", title: "执行策略", items: [
      ["permission_mode", "权限模式", "设置工具操作的默认审批行为", "select", { default: "使用默认", ask: "每次询问", auto: "智能审批", "always-approve": "始终批准" }],
      ["remember_tool_approvals", "记住工具审批", "在权限提示中提供始终允许此命令选项", "bool"],
      ["default_selected_permission", "默认选中的权限", "首次权限提示默认聚焦的选项", "select", { always_allow_all_sessions: "所有会话始终允许", allow_command_always: "始终允许此命令", allow_once: "仅允许一次", reject: "拒绝" }],
      ["ask_question_timeout", "问题等待超时", "用户问题工具在等待过久后结束", "bool"],
      ["subagents_enabled", "启用子 Agent", "允许 Grok 创建并行或专用子任务", "bool"],
      ["two_pass_compaction", "两阶段压缩", "使用预取式的两阶段上下文压缩", "bool"],
      ["fork_secondary_model", "分叉辅助模型", "Fork 时第二个 Agent 使用的模型", "model"],
      ["cancel_subagents", "取消主任务时的子 Agent", "选择同时停止、继续运行或每次询问", "select", { ask: "每次询问", always_stop: "始终停止", always_continue: "始终继续" }]
    ]},
    { target: "nativeToolSettings", title: "本地工具", items: [
      ["respect_gitignore", "遵循 .gitignore", "文件工具跳过 Git 忽略的文件", "bool"],
      ["bash_timeout", "Shell 超时", "前台命令最长运行秒数", "number", { suffix: "秒" }],
      ["bash_output_limit", "Shell 输出上限", "单次命令保留的最大输出字节数", "number", { suffix: "bytes" }],
      ["lsp_tools", "LSP 工具", "向 Agent 暴露语言服务器工具", "bool"],
      ["codebase_indexing", "代码库索引", "启用代码图和代码库索引能力", "bool"]
    ]},
    { target: "nativeMemorySettings", title: "跨会话记忆", items: [
      ["memory_enabled", "启用记忆", "在不同任务之间检索并复用项目知识", "bool"],
      ["memory_save_on_end", "结束时保存", "会话结束时保存元数据摘要", "bool"],
      ["memory_watcher", "监听记忆文件", "外部修改记忆文件时自动重新加载", "bool"],
      ["memory_max_results", "最大检索数量", "每次记忆搜索返回的结果数量", "number"],
      ["memory_min_score", "最低相关度", "记忆搜索结果的最低分数，范围 0–1", "number", { step: 0.05 }],
      ["memory_initial_injection", "首次注入记忆", "第一轮自动检索并注入相关记忆", "bool"]
    ]},
    { target: "nativeGitSettings", title: "工作区策略", items: [
      ["new_worktree_mode", "新会话 Worktree", "新建会话时是否询问或自动创建 Worktree", "select", { ask: "每次询问", always: "始终创建", never: "从不创建" }],
      ["fork_worktree_mode", "分叉 Worktree", "Fork 会话时是否创建独立 Worktree", "select", { ask: "每次询问", always: "始终创建", never: "从不创建" }],
      ["hunk_tracker_mode", "变更块跟踪", "选择 Agent 需要跟踪的文件变更范围", "select", { agent_only: "仅 Agent 修改", all_dirty: "所有未提交修改", off: "关闭" }]
    ]},
    { target: "nativePrivacySettings", title: "本地与诊断数据", items: [
      ["telemetry", "匿名遥测", "向配置的遥测后端发送匿名使用数据", "bool"],
      ["feedback", "反馈功能", "启用原生 TUI 的反馈入口", "bool"]
    ]}
  ];

  const dockTypes = {
    review: { title: "审阅", icon: "i-review", description: "查看 Git 工作区改动" },
    terminal: { title: "终端", icon: "i-terminal", description: "运行本地 Shell 命令" },
    browser: { title: "浏览器", icon: "i-browser", description: "打开网页与本地服务" },
    files: { title: "文件", icon: "i-file", description: "浏览和预览工作区文件" },
    tasks: { title: "侧边任务", icon: "i-tasks", description: "追踪当前 Grok 活动" }
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const merged = { ...defaultState, ...saved, attachments: [] };
      if (!Array.isArray(merged.dockTabs) || !merged.dockTabs.length) merged.dockTabs = structuredClone(defaultState.dockTabs);
      merged.dockTabs = merged.dockTabs.map((tab) => ({
        ...tab,
        messages: tab.type === "tasks" && Array.isArray(tab.messages) ? tab.messages : (tab.type === "tasks" ? [] : undefined),
        sessionId: tab.type === "tasks" ? (tab.sessionId || null) : undefined,
        runId: null,
        terminalReady: false,
        browserReady: false,
        output: ""
      }));
      if (!merged.dockTabs.some((tab) => tab.id === merged.activeDockTabId)) merged.activeDockTabId = merged.dockTabs[0].id;
      return merged;
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    const persistent = {
      ...state,
      attachments: [],
      dockTabs: state.dockTabs.map(({ runId, terminalReady, browserReady, output, activeAssistantId, ...tab }) => tab)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistent));
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function activeThread() {
    return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
  }

  function createThread(title = "新会话") {
    const thread = {
      id: uid(),
      sessionId: null,
      title,
      cwd: state.cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    state.threads.unshift(thread);
    state.activeThreadId = thread.id;
    saveState();
    renderAll();
    setTimeout(() => $("#promptInput").focus(), 0);
    return thread;
  }

  function removeThread(id) {
    const index = state.threads.findIndex((thread) => thread.id === id);
    if (index < 0) return;
    state.threads.splice(index, 1);
    if (state.activeThreadId === id) state.activeThreadId = state.threads[0]?.id || null;
    saveState();
    renderAll();
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function inlineMarkdown(value) {
    return value
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  }

  function markdown(source = "") {
    const escaped = escapeHtml(source).replace(/\r\n/g, "\n");
    const blocks = [];
    let text = escaped.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, code) => {
      const id = blocks.length;
      blocks.push(`<div class="code-block"><div class="code-block__head"><span>${language || "text"}</span><button class="icon-button copy-code" title="复制"><svg><use href="#i-copy"/></svg></button></div><pre>${code.replace(/\n$/, "")}</pre></div>`);
      return `\n@@BLOCK${id}@@\n`;
    });
    const lines = text.split("\n");
    const output = [];
    let list = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const placeholder = line.match(/^@@BLOCK(\d+)@@$/);
      if (placeholder) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(blocks[Number(placeholder[1])]);
      } else if (/^###\s+/.test(line)) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
      } else if (/^##\s+/.test(line)) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<h2>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`);
      } else if (/^[-*]\s+/.test(line)) {
        if (list !== "ul") { if (list) output.push(`</${list}>`); output.push("<ul>"); list = "ul"; }
        output.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      } else if (/^\d+\.\s+/.test(line)) {
        if (list !== "ol") { if (list) output.push(`</${list}>`); output.push("<ol>"); list = "ol"; }
        output.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
      } else if (!line.trim()) {
        if (list) { output.push(`</${list}>`); list = null; }
      } else {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<p>${inlineMarkdown(line)}</p>`);
      }
    }
    if (list) output.push(`</${list}>`);
    return output.join("");
  }

  function welcomeMarkup() {
    return `<div class="welcome">
      <div class="welcome-mark" aria-hidden="true"></div>
      <h1>构建下一件重要的事。</h1>
      <p>Grok Build 已连接到你的本地工作区。描述目标，它会理解代码、执行工具并验证结果。</p>
      <div class="quick-actions">
        <button class="quick-action" data-prompt="分析这个代码库的架构，并指出最值得优先改进的三个地方"><b>理解代码库</b><small>绘制架构与依赖关系</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="检查当前 Git 改动，找出潜在 bug 并直接修复"><b>审查当前改动</b><small>检查风险并运行验证</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="运行项目测试，定位失败原因并修复"><b>修复测试</b><small>执行、诊断、迭代</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="为这个项目补充一份清晰的开发者文档"><b>整理项目文档</b><small>生成可维护的说明</small><svg><use href="#i-arrow-up"/></svg></button>
      </div>
    </div>`;
  }

  function toolStatus(status, exitCode = null) {
    const normalized = String(status || "pending").toLowerCase().replace(/[^a-z_]/g, "_");
    if (exitCode != null && Number(exitCode) !== 0) return "failed";
    if (["completed", "complete", "success", "succeeded", "done"].includes(normalized)) return "completed";
    if (["failed", "error", "rejected", "denied", "cancelled", "canceled"].includes(normalized)) return "failed";
    if (["waiting_permission", "permission_prompt", "waiting_for_permission"].includes(normalized)) return "waiting_permission";
    if (["in_progress", "running", "started", "active"].includes(normalized)) return "in_progress";
    return "pending";
  }

  function toolStatusLabel(message) {
    const status = toolStatus(message.status, message.exitCode);
    if (status === "completed") return "已完成";
    if (status === "failed") return message.status === "cancelled" ? "已停止" : "执行异常";
    if (status === "waiting_permission") return "等待确认";
    if (status === "in_progress") return "执行中";
    return "准备中";
  }

  function toolIcon(message) {
    const value = `${message.toolName || ""} ${message.kindName || message.kind || ""} ${message.title || ""}`.toLowerCase();
    if (/browser|web|url|fetch/.test(value)) return "i-browser";
    if (/read|file|glob|grep|search|list/.test(value)) return "i-file";
    if (/edit|write|patch|replace/.test(value)) return "i-review";
    if (/task|agent|todo/.test(value)) return "i-tasks";
    if (/terminal|shell|bash|command|execute|run_/.test(value)) return "i-terminal";
    return "i-command";
  }

  function nestedToolValue(value, keys) {
    if (!value || typeof value !== "object") return null;
    for (const key of keys) if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") { const found = nestedToolValue(child, keys); if (found) return found; }
    }
    return null;
  }

  function toolInputSummary(message) {
    return nestedToolValue(message.input, ["command", "path", "file_path", "query", "url", "pattern", "description"])
      || message.description || message.toolName || message.kindName || "Runtime 工具";
  }

  function prettyToolValue(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function thinkingMarkup(message, running = false, side = false) {
    if (!message.thought || nativeConfig.values.show_thinking_blocks === false) return "";
    const active = Boolean(running);
    return `<details class="thinking-block ${side ? "thinking-block--side" : ""} ${active ? "is-active" : ""}" ${active ? "open" : ""}>
      <summary><span class="thinking-block__signal">${active ? '<i></i><i></i><i></i>' : '<svg><use href="#i-check"/></svg>'}</span><b>${active ? "正在思考" : "思考过程"}</b><span class="thinking-block__chevron"><svg><use href="#i-chevron"/></svg></span></summary>
      <div class="thinking-block__content">${escapeHtml(message.thought)}</div>
    </details>`;
  }

  function toolMessageMarkup(message, side = false) {
    const status = toolStatus(message.status, message.exitCode);
    const running = status === "pending" || status === "in_progress" || status === "waiting_permission";
    const input = prettyToolValue(message.input);
    const output = prettyToolValue(message.output || (message.exitCode != null ? `退出代码 ${message.exitCode}` : ""));
    const duration = message.durationMs != null ? `${Math.max(0, Number(message.durationMs))} ms` : "";
    const meta = [message.currentDir ? `目录  ${message.currentDir}` : "", message.exitCode != null ? `退出  ${message.exitCode}` : "", duration].filter(Boolean);
    return `<details class="tool-card tool-card--${status} ${side ? "tool-card--side" : ""}" data-message-id="${escapeHtml(message.id)}" data-tool-call-id="${escapeHtml(message.toolCallId || "")}" ${running || status === "failed" ? "open" : ""}>
      <summary class="tool-card__head">
        <span class="tool-card__icon"><svg><use href="#${toolIcon(message)}"/></svg></span>
        <span class="tool-card__copy"><b>${escapeHtml(message.title || message.toolName || "Runtime 工具")}</b><small>${escapeHtml(toolInputSummary(message))}</small></span>
        <span class="tool-card__status"><i></i>${toolStatusLabel(message)}</span>
        <span class="tool-card__chevron"><svg><use href="#i-chevron"/></svg></span>
      </summary>
      <div class="tool-card__body">
        ${message.description ? `<p class="tool-card__description">${escapeHtml(message.description)}</p>` : ""}
        ${input ? `<section><header>输入</header><pre>${escapeHtml(input)}</pre></section>` : ""}
        ${output ? `<section><header>输出</header><pre>${escapeHtml(output)}</pre></section>` : (running ? '<div class="tool-card__waiting"><i></i>正在等待 Runtime 返回结果…</div>' : "")}
        ${meta.length ? `<footer>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</footer>` : ""}
      </div>
    </details>`;
  }

  function messageMarkup(message) {
    if (message.kind === "tool") return toolMessageMarkup(message);
    const assistant = message.role === "assistant";
    const identity = assistant ? '<span class="grok-mark" aria-hidden="true"></span>' : "YOU";
    return `<article class="message message--${assistant ? "assistant" : "user"}" data-message-id="${message.id}">
      <div class="message__meta"><span class="message__identity">${identity}</span><b>${assistant ? "Grok" : "你"}</b><span>${formatTime(message.createdAt)}</span></div>
      ${assistant ? `<div class="message__thinking-slot">${thinkingMarkup(message, activeAssistantMessage?.id === message.id)}</div>` : ""}
      <div class="message__body">${assistant ? markdown(message.text) : escapeHtml(message.text)}</div>
      ${assistant ? '<div class="message-actions"><button class="icon-button copy-message" title="复制"><svg><use href="#i-copy"/></svg></button></div>' : ""}
    </article>`;
  }

  function renderMessages() {
    const thread = activeThread();
    const target = $("#messages");
    if (!thread || !thread.messages.length) target.innerHTML = welcomeMarkup();
    else target.innerHTML = thread.messages.map(messageMarkup).join("");
    bindDynamicActions();
    updateWindowTrail();
  }

  // Streaming chunks can arrive only a few characters apart. Rebuilding the whole
  // conversation for every chunk resets layout, selection and hover state, which
  // presents as a full-page flash. Keep the message nodes stable and update only
  // the active answer, at most once per animation frame.
  function scheduleStreamingRender() {
    if (streamRenderFrame) return;
    const conversation = $("#conversation");
    const followOutput = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 140;
    streamRenderFrame = requestAnimationFrame(() => {
      streamRenderFrame = null;
      if (!activeAssistantMessage) return;
      const article = $(`[data-message-id="${activeAssistantMessage.id}"]`);
      const body = article?.querySelector(".message__body");
      if (!body) return;
      const thoughtSlot = article.querySelector(".message__thinking-slot");
      if (thoughtSlot && activeAssistantMessage.thought && nativeConfig.values.show_thinking_blocks !== false) {
        let block = thoughtSlot.querySelector(".thinking-block");
        if (!block) { thoughtSlot.innerHTML = thinkingMarkup(activeAssistantMessage, true); block = thoughtSlot.querySelector(".thinking-block"); }
        const content = block?.querySelector(".thinking-block__content");
        if (content) content.textContent = activeAssistantMessage.thought;
      }
      body.innerHTML = markdown(activeAssistantMessage.text);
      bindMessageBody(body);
      if (followOutput) conversation.scrollTop = conversation.scrollHeight;
    });
  }

  function renderThreads() {
    const target = $("#threadList");
    if (!state.threads.length) {
      target.innerHTML = '<div class="context-empty" style="margin:8px"><span>还没有任务<br>从上方新建一个</span></div>';
      return;
    }
    const groups = groupThreads(state.threads);
    target.innerHTML = Object.entries(groups).map(([label, threads]) => `<div class="thread-group-label">${label}</div>${threads.map((thread) => `
      <button class="thread-item ${thread.id === state.activeThreadId ? "is-active" : ""}" data-thread-id="${thread.id}">${escapeHtml(thread.title)}<span class="icon-button thread-item__menu" data-remove-thread="${thread.id}"><svg><use href="#i-more"/></svg></span></button>`).join("")}`).join("");
    $$('[data-thread-id]').forEach((button) => button.addEventListener("click", (event) => {
      if (event.target.closest("[data-remove-thread]")) return;
      state.activeThreadId = button.dataset.threadId;
      saveState(); renderAll();
    }));
    $$('[data-remove-thread]').forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); removeThread(button.dataset.removeThread);
    }));
  }

  function groupThreads(threads) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = today.getTime() - 86400000;
    return threads.reduce((groups, thread) => {
      const label = thread.updatedAt >= today.getTime() ? "今天" : thread.updatedAt >= yesterday ? "昨天" : "更早";
      (groups[label] ||= []).push(thread); return groups;
    }, {});
  }

  function formatTime(time) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function basename(filePath) {
    return String(filePath).split(/[\\/]/).filter(Boolean).pop() || filePath;
  }

  function updateBranchPill() {
    const button = $("#branchButton");
    button.classList.toggle("is-no-repo", !gitState.isRepo);
    button.classList.toggle("is-dirty", Boolean(gitState.isRepo && gitState.dirtyCount));
    $("#branchName").textContent = gitState.isRepo ? gitState.current : "非 Git 工作区";
    $("#branchDirtyDot").title = gitState.isRepo ? (gitState.dirtyCount ? `${gitState.dirtyCount} 个未提交修改` : "工作区干净") : "未检测到 Git 仓库";
  }

  function renderBranchPopover() {
    const title = $("#branchPopoverTitle"); const summary = $("#branchSummary"); const list = $("#branchList");
    if (!gitState.isRepo) {
      title.textContent = "未检测到 Git 仓库";
      summary.className = "branch-summary"; summary.innerHTML = "选择一个 Git 工作区后可查看和切换分支";
      $("#branchSearch").closest(".branch-search").hidden = true; $("#branchCreateForm").hidden = true; $("#branchOpenReview").hidden = true;
      list.innerHTML = '<div class="context-empty">当前目录不在 Git 工作树中</div>'; $("#branchRootLabel").textContent = basename(state.cwd); return;
    }
    $("#branchSearch").closest(".branch-search").hidden = false; $("#branchCreateForm").hidden = false; $("#branchOpenReview").hidden = false;
    title.textContent = gitState.detached ? `Detached · ${gitState.current}` : gitState.current;
    summary.className = `branch-summary ${gitState.dirtyCount ? "is-dirty" : ""}`;
    const divergence = [gitState.ahead ? `↑${gitState.ahead}` : "", gitState.behind ? `↓${gitState.behind}` : ""].filter(Boolean).join(" ");
    summary.innerHTML = `<span class="branch-summary-dot"></span><b>${gitState.dirtyCount ? `${gitState.dirtyCount} 个未提交修改` : "工作区干净"}</b>${gitState.stagedCount ? `<span>· ${gitState.stagedCount} 个已暂存</span>` : ""}${gitState.upstream ? `<span>· ${escapeHtml(gitState.upstream)} ${divergence}</span>` : '<span>· 无上游分支</span>'}`;
    const branches = (gitState.branches || []).filter((branch) => branch.name.toLowerCase().includes(branchFilter.toLowerCase()));
    list.innerHTML = branches.map((branch) => `<button class="branch-item ${branch.current ? "is-current" : ""}" data-git-branch="${escapeHtml(branch.name)}" ${branch.current ? "disabled" : ""}><svg><use href="#i-git"/></svg><span><b>${escapeHtml(branch.name)}</b><small>${escapeHtml([branch.upstream, branch.updated].filter(Boolean).join(" · ") || "本地分支")}</small></span>${branch.current ? "<em>当前</em>" : ""}</button>`).join("") || '<div class="context-empty">没有匹配的本地分支</div>';
    $("#branchRootLabel").textContent = basename(gitState.root || state.cwd);
    $$('[data-git-branch]', list).forEach((button) => button.addEventListener("click", () => switchBranch(button.dataset.gitBranch, button)));
  }

  async function refreshGitInfo() {
    $("#branchName").textContent = "检查分支…";
    gitState = api ? await api.gitInfo(state.cwd) : { ok: true, isRepo: true, root: state.cwd, current: "main", dirtyCount: 0, stagedCount: 0, branches: [{ name: "main", current: true, updated: "刚刚" }, { name: "feature/ui", current: false, updated: "2 小时前" }] };
    if (!gitState.ok) gitState = { ok: true, isRepo: false, branches: [], dirtyCount: 0, error: gitState.error };
    updateBranchPill(); renderBranchPopover();
  }

  async function switchBranch(branch, button) {
    if (activeRun) { toast("任务正在运行", "完成或停止当前任务后再切换分支"); return; }
    button.disabled = true;
    const result = api ? await api.switchGitBranch(state.cwd, branch) : { ok: true, info: { ...gitState, current: branch, branches: gitState.branches.map((item) => ({ ...item, current: item.name === branch })) } };
    button.disabled = false;
    if (!result.ok) { toast("分支切换失败", result.error); return; }
    gitState = result.info; updateBranchPill(); renderBranchPopover(); $("#branchPopover").hidden = true; $("#branchButton").setAttribute("aria-expanded", "false");
    refreshActiveDockPane(); toast("已切换 Git 分支", branch);
  }

  async function createBranch(event) {
    event.preventDefault();
    const input = $("#branchCreateInput"); const branch = input.value.trim(); if (!branch) return;
    if (activeRun) { toast("任务正在运行", "完成或停止当前任务后再创建分支"); return; }
    const submit = $("#branchCreateForm button"); submit.disabled = true;
    const result = api ? await api.createGitBranch(state.cwd, branch) : { ok: true, info: { ...gitState, current: branch, branches: [{ name: branch, current: true }, ...gitState.branches.map((item) => ({ ...item, current: false }))] } };
    submit.disabled = false;
    if (!result.ok) { toast("创建分支失败", result.error); return; }
    input.value = ""; gitState = result.info; updateBranchPill(); renderBranchPopover(); toast("已创建并切换分支", branch);
  }

  async function toggleBranchPopover(event) {
    event.stopPropagation(); const popover = $("#branchPopover"); const opening = popover.hidden;
    popover.hidden = !opening; $("#branchButton").setAttribute("aria-expanded", String(opening));
    if (opening) { branchFilter = ""; $("#branchSearch").value = ""; await refreshGitInfo(); }
  }

  function renderAttachments() {
    $("#attachmentList").innerHTML = state.attachments.map((file, index) => `<div class="attachment-chip"><svg><use href="#i-paperclip"/></svg><span>${escapeHtml(basename(file))}</span><button data-remove-attachment="${index}"><svg><use href="#i-x"/></svg></button></div>`).join("");
    $$('[data-remove-attachment]').forEach((button) => button.addEventListener("click", () => { state.attachments.splice(Number(button.dataset.removeAttachment), 1); renderAttachments(); }));
    renderContextFiles();
  }

  function renderContextFiles() {
    const target = $("#contextFiles");
    if (!target) return;
    $("#fileCount").textContent = `${state.attachments.length} FILES`;
    if (!state.attachments.length) {
      target.className = "context-empty";
      target.innerHTML = '<svg><use href="#i-folder"/></svg><span>附件和修改过的文件会显示在这里</span>';
    } else {
      target.className = "context-files";
      target.innerHTML = state.attachments.map((file) => `<button class="context-file" data-file="${escapeHtml(file)}"><svg><use href="#i-paperclip"/></svg><span>${escapeHtml(basename(file))}</span></button>`).join("");
    }
  }

  function renderAll() {
    renderThreads(); renderMessages(); renderAttachments(); renderDockTabs(); updateLayout(); updateWorkspace();
  }

  function renderDockTabs() {
    const target = $("#dockTabs");
    target.innerHTML = state.dockTabs.map((tab) => {
      const definition = dockTypes[tab.type] || dockTypes.tasks;
      return `<button class="dock-tab ${tab.id === state.activeDockTabId ? "is-active" : ""}" data-dock-tab="${tab.id}"><svg><use href="#${definition.icon}"/></svg><span>${escapeHtml(tab.title || definition.title)}</span>${state.dockTabs.length > 1 ? `<i class="dock-tab__close" data-close-dock="${tab.id}"><svg><use href="#i-x"/></svg></i>` : ""}</button>`;
    }).join("");
    ensureDynamicDockPanes();
    const active = state.dockTabs.find((tab) => tab.id === state.activeDockTabId) || state.dockTabs[0];
    $$("[data-dock-pane]").forEach((pane) => pane.classList.toggle("is-active", pane.dataset.dockPane === active?.type));
    $$("[data-dock-id]").forEach((pane) => pane.classList.toggle("is-active", pane.dataset.dockId === active?.id));
    $$('[data-dock-tab]').forEach((button) => button.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-dock]")) return;
      state.activeDockTabId = button.dataset.dockTab;
      saveState(); renderDockTabs(); refreshActiveDockPane();
    }));
    $$('[data-close-dock]').forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); closeDockTab(button.dataset.closeDock);
    }));
    requestAnimationFrame(() => {
      target.querySelector(".dock-tab.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      updateDockScrollButtons();
    });
  }

  function openDockType(type) {
    const definition = dockTypes[type];
    if (!definition) return;
    const multiInstance = ["tasks", "terminal", "browser"].includes(type);
    let tab = multiInstance ? null : state.dockTabs.find((item) => item.type === type);
    if (!tab) {
      const number = state.dockTabs.filter((item) => item.type === type).length + 1;
      tab = {
        id: `${type}-${uid()}`,
        type,
        title: `${definition.title}${number > 1 ? ` ${number}` : ""}`,
        ...(type === "tasks" ? { messages: [], sessionId: null, runId: null } : {}),
        ...(type === "terminal" ? { cwd: state.cwd, output: "", terminalReady: false, history: [] } : {}),
        ...(type === "browser" ? { url: "about:blank" } : {})
      };
      state.dockTabs.push(tab);
    }
    state.activeDockTabId = tab.id;
    state.inspectorOpen = true;
    $("#dockTabPicker").hidden = true;
    saveState(); renderDockTabs(); updateLayout(); refreshActiveDockPane();
  }

  function closeDockTab(tabId) {
    if (state.dockTabs.length <= 1) return;
    const index = state.dockTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    const tab = state.dockTabs[index];
    if (tab.type === "terminal") api?.closeTerminal(tab.id);
    if (tab.type === "tasks" && tab.runId) api?.cancelPrompt(tab.runId);
    const wasActive = state.activeDockTabId === tabId;
    state.dockTabs.splice(index, 1);
    if (wasActive) state.activeDockTabId = state.dockTabs[Math.max(0, index - 1)].id;
    saveState(); renderDockTabs(); refreshActiveDockPane();
  }

  function renderDockTabPicker() {
    $("#dockTabPicker").innerHTML = Object.entries(dockTypes).map(([type, item]) => `<button class="dock-tab-choice" data-open-dock="${type}"><svg><use href="#${item.icon}"/></svg><span><b>${item.title}</b><small>${item.description}</small></span></button>`).join("");
    $$('[data-open-dock]').forEach((button) => button.addEventListener("click", () => openDockType(button.dataset.openDock)));
  }

  function activeDockType() {
    return state.dockTabs.find((tab) => tab.id === state.activeDockTabId)?.type || "tasks";
  }

  function dynamicDockTab(tab) {
    return ["tasks", "terminal", "browser"].includes(tab.type);
  }

  function ensureDynamicDockPanes() {
    const host = $("#dockDynamicPanes");
    if (!host) return;
    const ids = new Set(state.dockTabs.filter(dynamicDockTab).map((tab) => tab.id));
    $$('[data-dock-id]', host).forEach((pane) => { if (!ids.has(pane.dataset.dockId)) pane.remove(); });
    state.dockTabs.filter(dynamicDockTab).forEach((tab) => {
      let pane = [...$$('[data-dock-id]', host)].find((item) => item.dataset.dockId === tab.id);
      if (pane) return;
      pane = document.createElement("section");
      pane.className = `dock-pane dock-pane--${tab.type}`;
      pane.dataset.dockId = tab.id;
      pane.dataset.dockKind = tab.type;
      if (tab.type === "tasks") initializeSideTaskPane(tab, pane);
      if (tab.type === "terminal") initializeTerminalPane(tab, pane);
      if (tab.type === "browser") initializeBrowserPane(tab, pane);
      host.appendChild(pane);
    });
  }

  function initializeSideTaskPane(tab, pane) {
    tab.messages ||= [];
    pane.innerHTML = `<div class="dock-pane__title side-task-head"><div><small>SHARED PROJECT MEMORY</small><h2>${escapeHtml(tab.title)}</h2></div><span><i></i>同步主对话</span></div>
      <div class="side-task-context"><svg><use href="#i-memory"/></svg><span>共享 <b>${escapeHtml(basename(state.cwd))}</b> 记忆，并在每次发送时读取主对话的最新上下文</span></div>
      <div class="side-task-messages" data-side-messages></div>
      <form class="side-task-composer" data-side-form><textarea rows="1" data-side-input placeholder="在这个并行对话中继续任务…"></textarea><button type="submit" data-side-send title="发送"><svg><use href="#i-send"/></svg></button></form>`;
    const form = $("[data-side-form]", pane); const input = $("[data-side-input]", pane);
    form.addEventListener("submit", (event) => { event.preventDefault(); sendSideTask(tab.id); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendSideTask(tab.id); }
    });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 112)}px`; });
    renderSideTaskPane(tab, pane);
  }

  function sideTaskMessageMarkup(message, tab = null) {
    if (message.kind === "tool") return toolMessageMarkup(message, true);
    const assistant = message.role === "assistant";
    return `<article class="side-message side-message--${assistant ? "assistant" : "user"}" data-side-message-id="${message.id}">
      <header>${assistant ? '<span class="grok-mark" aria-hidden="true"></span><b>Grok</b>' : "<b>你</b>"}<time>${formatTime(message.createdAt)}</time></header>
      ${assistant ? thinkingMarkup(message, Boolean(tab?.runId && message.id === tab.activeAssistantId), true) : ""}
      <div class="side-message__body">${assistant ? markdown(message.text || "") : escapeHtml(message.text || "")}</div>
    </article>`;
  }

  function createToolMessage(event) {
    return {
      id: uid(), kind: "tool", toolCallId: event.toolCallId || `tool-${uid()}`,
      toolName: event.toolName || null, kindName: event.kind || null,
      title: event.title || event.toolName || "Runtime 工具", status: toolStatus(event.status),
      input: event.input ?? null, output: event.output || "", exitCode: event.exitCode ?? null,
      currentDir: event.currentDir || null, description: event.description || null,
      locations: event.locations || null, createdAt: event.timestamp || Date.now(), startedAt: Date.now()
    };
  }

  function mergeToolMessage(message, event) {
    if (event.title) message.title = event.title;
    if (event.toolName) message.toolName = event.toolName;
    if (event.kind) message.kindName = event.kind;
    if (event.status) message.status = toolStatus(event.status, event.exitCode);
    if (event.input != null) message.input = event.input;
    if (event.output != null && event.output !== "") message.output = event.output;
    if (event.exitCode != null) message.exitCode = event.exitCode;
    if (event.currentDir) message.currentDir = event.currentDir;
    if (event.description) message.description = event.description;
    if (event.locations) message.locations = event.locations;
    if (toolStatus(message.status, message.exitCode) === "completed" || toolStatus(message.status, message.exitCode) === "failed") message.finishedAt ||= Date.now();
    return message;
  }

  function sideToolEvent(tab, event) {
    tab.messages ||= [];
    let tool = tab.messages.find((message) => message.kind === "tool" && message.toolCallId === event.toolCallId);
    if (!tool) {
      const active = tab.messages.find((message) => message.id === tab.activeAssistantId);
      if (active && !active.text && !active.thought) tab.messages.splice(tab.messages.indexOf(active), 1);
      tool = createToolMessage(event); tab.messages.push(tool);
      const assistant = { id: uid(), role: "assistant", text: "", thought: "", createdAt: Date.now() };
      tab.messages.push(assistant); tab.activeAssistantId = assistant.id;
    }
    mergeToolMessage(tool, event);
    return tool;
  }

  function lifecycleTool(tab, lifecycle) {
    if (!["permission_requested", "permission_resolved", "tool_started", "tool_completed"].includes(lifecycle.type)) return null;
    const tools = [...(tab.messages || [])].reverse().filter((message) => message.kind === "tool");
    const tool = tools.find((message) => !lifecycle.tool_name || message.toolName === lifecycle.tool_name) || tools[0];
    if (!tool) return null;
    if (lifecycle.type === "permission_requested") tool.status = "waiting_permission";
    if (lifecycle.type === "permission_resolved") tool.status = lifecycle.decision === "allow" ? "in_progress" : "failed";
    if (lifecycle.type === "tool_started") tool.status = "in_progress";
    if (lifecycle.type === "tool_completed") {
      tool.status = lifecycle.outcome === "success" ? "completed" : "failed";
      tool.durationMs = lifecycle.duration_ms;
      tool.finishedAt = Date.now();
    }
    return tool;
  }

  function renderSideTaskPane(tab, pane = null) {
    pane ||= [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
    if (!pane) return;
    const target = $("[data-side-messages]", pane);
    target.innerHTML = tab.messages?.length
      ? tab.messages.map((message) => sideTaskMessageMarkup(message, tab)).join("")
      : `<div class="side-task-empty"><span class="grok-mark" aria-hidden="true"></span><h3>并行处理一个新任务</h3><p>这里和主对话使用同一工作区记忆，同时保留独立的会话与回答。</p></div>`;
    const button = $("[data-side-send]", pane);
    button.classList.toggle("is-stop", Boolean(tab.runId));
    button.innerHTML = `<svg><use href="#${tab.runId ? "i-stop" : "i-send"}"/></svg>`;
    requestAnimationFrame(() => { target.scrollTop = target.scrollHeight; });
  }

  function scheduleSideStreamingRender(tab) {
    if (sideStreamFrames.has(tab.id)) return;
    sideStreamFrames.set(tab.id, requestAnimationFrame(() => {
      sideStreamFrames.delete(tab.id);
      const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
      const target = pane && $("[data-side-messages]", pane);
      const assistant = tab.messages?.find((message) => message.id === tab.activeAssistantId);
      const article = target?.querySelector(`[data-side-message-id="${tab.activeAssistantId}"]`);
      if (!assistant || !article) return;
      const followOutput = target.scrollHeight - target.scrollTop - target.clientHeight < 90;
      const body = $(".side-message__body", article); if (body) body.innerHTML = markdown(assistant.text || "");
      if (assistant.thought && nativeConfig.values.show_thinking_blocks !== false) {
        let block = $(".thinking-block", article);
        if (!block) { article.querySelector("header").insertAdjacentHTML("afterend", thinkingMarkup(assistant, true, true)); block = $(".thinking-block", article); }
        const content = block && $(".thinking-block__content", block); if (content) content.textContent = assistant.thought;
      }
      if (followOutput) target.scrollTop = target.scrollHeight;
    }));
  }

  function mainConversationContext() {
    const thread = activeThread();
    if (!thread?.messages?.length) return "主对话目前还没有消息。";
    return thread.messages.filter((message) => ["user", "assistant"].includes(message.role)).slice(-10)
      .map((message) => `${message.role === "user" ? "用户" : "Grok"}: ${String(message.text || "").slice(0, 1800)}`).join("\n\n");
  }

  async function sendSideTask(tabId) {
    const tab = state.dockTabs.find((item) => item.id === tabId && item.type === "tasks");
    const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tabId);
    if (!tab || !pane) return;
    if (tab.runId) { if (api) await api.cancelPrompt(tab.runId); finishSideTask(tab, "已停止"); return; }
    const input = $("[data-side-input]", pane); const prompt = input.value.trim();
    if (!prompt) return;
    tab.messages ||= [];
    tab.messages.push({ id: uid(), role: "user", text: prompt, createdAt: Date.now() });
    const assistant = { id: uid(), role: "assistant", text: "", createdAt: Date.now() };
    tab.messages.push(assistant); tab.activeAssistantId = assistant.id;
    input.value = ""; input.style.height = "auto";
    renderSideTaskPane(tab, pane); saveState();
    if (!api) {
      tab.runId = `demo-${uid()}`;
      assistant.text = `侧边任务已收到：**${prompt}**\n\n此对话已连接主对话上下文与同一项目记忆。`;
      setTimeout(() => finishSideTask(tab, "预览完成"), 350);
      renderSideTaskPane(tab, pane); return;
    }
    const sharedPrompt = `你正在 Grok Build 的侧边对话中并行处理任务。使用同一项目记忆，并参考下面主对话的最新上下文；直接完成侧边任务。\n\n<主对话最新上下文>\n${mainConversationContext()}\n</主对话最新上下文>\n\n<侧边任务>\n${prompt}\n</侧边任务>`;
    const result = await api.sendPrompt({ clientId: tab.id, prompt: sharedPrompt, cwd: tab.cwd || state.cwd, sessionId: tab.sessionId, model: state.model, effort: state.effort, alwaysApprove: state.alwaysApprove, attachments: [] });
    if (!result.ok) { assistant.text = `启动 Grok 时出现问题：${result.error}`; finishSideTask(tab, "启动失败"); return; }
    tab.runId = result.runId; renderSideTaskPane(tab, pane); saveState();
  }

  function handleSideTaskEvent(tab, event) {
    if (event.runId && !tab.runId) tab.runId = event.runId;
    let assistant = tab.messages?.find((message) => message.id === tab.activeAssistantId) || [...(tab.messages || [])].reverse().find((message) => message.role === "assistant");
    if (event.type === "session_bound") tab.sessionId = event.sessionId || tab.sessionId;
    else if (event.type === "tool_call" || event.type === "tool_update") { sideToolEvent(tab, event); assistant = tab.messages.find((message) => message.id === tab.activeAssistantId); }
    else if (event.type === "lifecycle") { if (!lifecycleTool(tab, event.event || {})) return; }
    else if (event.type === "text" && assistant) { assistant.text += event.data || ""; scheduleSideStreamingRender(tab); return; }
    else if (event.type === "thought" && assistant) { assistant.thought = (assistant.thought || "") + (event.data || ""); scheduleSideStreamingRender(tab); return; }
    else if (event.type === "error" && assistant) assistant.text += `\n\n**错误：** ${event.message}`;
    else if (event.type === "end") { tab.sessionId = event.sessionId || tab.sessionId; finishSideTask(tab, event.stopReason || "完成"); return; }
    else if (event.type === "process_exit" && event.code !== 0) { finishSideTask(tab, `进程退出 ${event.code ?? event.signal}`); return; }
    const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
    renderSideTaskPane(tab, pane);
  }

  function finishSideTask(tab, reason) {
    const assistant = tab.messages?.find((message) => message.id === tab.activeAssistantId);
    if (assistant && !assistant.text && !assistant.thought) tab.messages.splice(tab.messages.indexOf(assistant), 1);
    for (const tool of (tab.messages || []).filter((message) => message.kind === "tool")) {
      if (["pending", "in_progress", "waiting_permission"].includes(toolStatus(tool.status))) {
        tool.status = /停止|失败|退出|error|cancel/i.test(String(reason)) ? "cancelled" : "completed";
      }
    }
    tab.runId = null; tab.activeAssistantId = null;
    saveState(); renderSideTaskPane(tab);
  }

  function initializeTerminalPane(tab, pane) {
    tab.cwd ||= state.cwd; tab.output ||= ""; tab.history ||= [];
    pane.innerHTML = `<div class="dock-pane__title"><div><small>NATIVE SHELL SESSION</small><h2>${escapeHtml(tab.title)}</h2></div><span class="terminal-cwd" title="${escapeHtml(tab.cwd)}">${escapeHtml(basename(tab.cwd))}</span></div>
      <div class="terminal-toolbar"><span data-terminal-state><i></i>正在启动</span><button type="button" data-terminal-clear>清屏</button><button type="button" data-terminal-restart><svg><use href="#i-refresh"/></svg>重启</button></div>
      <pre class="terminal-screen" data-terminal-output></pre>
      <form class="terminal-composer" data-terminal-form><span>›</span><input data-terminal-input autocomplete="off" spellcheck="false" placeholder="输入 PowerShell / Shell 命令…"/><button type="submit"><svg><use href="#i-play"/></svg></button></form>`;
    $("[data-terminal-output]", pane).textContent = tab.output || "Grok Build native terminal ready.\n";
    $("[data-terminal-form]", pane).addEventListener("submit", (event) => { event.preventDefault(); submitTerminalCommand(tab.id); });
    const input = $("[data-terminal-input]", pane); let historyIndex = tab.history.length;
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" && tab.history.length) { event.preventDefault(); historyIndex = Math.max(0, historyIndex - 1); input.value = tab.history[historyIndex] || ""; }
      if (event.key === "ArrowDown" && tab.history.length) { event.preventDefault(); historyIndex = Math.min(tab.history.length, historyIndex + 1); input.value = tab.history[historyIndex] || ""; }
      if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); clearTerminal(tab); }
    });
    $("[data-terminal-clear]", pane).addEventListener("click", () => clearTerminal(tab));
    $("[data-terminal-restart]", pane).addEventListener("click", async () => { await api?.closeTerminal(tab.id); tab.terminalReady = false; tab.output = ""; await ensureTerminalSession(tab, pane); });
  }

  function stripAnsi(value) {
    return String(value || "").replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "").replace(/\r(?!\n)/g, "");
  }

  function appendTerminalOutput(tab, value) {
    tab.output = `${tab.output || ""}${stripAnsi(value)}`.slice(-200_000);
    const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
    const output = pane && $("[data-terminal-output]", pane);
    if (output) { output.textContent = tab.output; output.scrollTop = output.scrollHeight; }
  }

  async function ensureTerminalSession(tab, pane = null) {
    pane ||= [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
    if (!pane || tab.terminalReady) return;
    const status = $("[data-terminal-state]", pane);
    if (!api) { status.innerHTML = "<i></i>桌面预览"; return; }
    status.innerHTML = "<i></i>正在启动";
    const result = await api.createTerminal(tab.id, tab.cwd || state.cwd);
    if (!result.ok) { status.classList.add("is-error"); status.textContent = result.error; appendTerminalOutput(tab, `${result.error}\n`); return; }
    tab.terminalReady = true; tab.shell = result.shell;
    status.classList.remove("is-error"); status.innerHTML = `<i></i>${escapeHtml(result.shell)} 在线`;
    appendTerminalOutput(tab, tab.output ? "" : `${result.shell} · ${result.cwd}\n`);
  }

  async function submitTerminalCommand(tabId) {
    const tab = state.dockTabs.find((item) => item.id === tabId && item.type === "terminal");
    const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tabId);
    if (!tab || !pane) return;
    await ensureTerminalSession(tab, pane);
    const input = $("[data-terminal-input]", pane); const command = input.value;
    if (!command.trim()) return;
    tab.history ||= []; tab.history.push(command); tab.history = tab.history.slice(-100);
    appendTerminalOutput(tab, `\n› ${command}\n`); input.value = "";
    const result = api ? await api.writeTerminal(tab.id, `${command}\n`) : { ok: true };
    if (!result.ok) appendTerminalOutput(tab, `${result.error}\n`);
  }

  function clearTerminal(tab) {
    tab.output = "";
    const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
    const output = pane && $("[data-terminal-output]", pane); if (output) output.textContent = "";
  }

  function normalizeBrowserUrl(value) {
    const raw = String(value || "").trim(); if (!raw) return "about:blank";
    if (/^(about:|file:)/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(raw) ? `http://${raw}` : `https://${raw}`;
  }

  function initializeBrowserPane(tab, pane) {
    tab.url ||= "about:blank";
    pane.innerHTML = `<form class="browser-bar" data-browser-form>
      <button type="button" class="icon-button browser-nav browser-nav--back" data-browser-action="back" title="后退"><svg><use href="#i-chevron"/></svg></button>
      <button type="button" class="icon-button browser-nav" data-browser-action="forward" title="前进"><svg><use href="#i-chevron"/></svg></button>
      <button type="button" class="icon-button browser-nav" data-browser-action="reload" title="刷新"><svg><use href="#i-refresh"/></svg></button>
      <input data-browser-url value="${escapeHtml(tab.url === "about:blank" ? "" : tab.url)}" placeholder="输入网址或 localhost 地址" spellcheck="false"/>
      <button type="submit">前往</button><button type="button" class="icon-button" data-browser-action="external" title="在系统浏览器打开"><svg><use href="#i-external"/></svg></button></form>
      <div class="browser-status" data-browser-status><i></i><span>输入地址后开始浏览</span></div>
      <div class="browser-stage"><webview data-browser-view src="${escapeHtml(tab.url)}" partition="persist:grok-browser" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"></webview></div>`;
    const view = $("[data-browser-view]", pane); const input = $("[data-browser-url]", pane); const status = $("[data-browser-status]", pane);
    const updateLocation = (url) => { tab.url = url; input.value = url === "about:blank" ? "" : url; saveState(); };
    view.addEventListener("dom-ready", () => { tab.browserReady = true; status.className = "browser-status is-ready"; status.innerHTML = "<i></i><span>页面已就绪</span>"; });
    view.addEventListener("did-start-loading", () => { status.className = "browser-status is-loading"; status.innerHTML = "<i></i><span>正在载入…</span>"; });
    view.addEventListener("did-stop-loading", () => { status.className = "browser-status is-ready"; status.innerHTML = "<i></i><span>载入完成</span>"; try { updateLocation(view.getURL()); } catch {} });
    view.addEventListener("did-navigate", (event) => updateLocation(event.url));
    view.addEventListener("did-navigate-in-page", (event) => updateLocation(event.url));
    view.addEventListener("did-fail-load", (event) => { if (event.errorCode === -3) return; status.className = "browser-status is-error"; status.innerHTML = `<i></i><span>${escapeHtml(event.errorDescription || "页面载入失败")}</span>`; });
    $("[data-browser-form]", pane).addEventListener("submit", (event) => { event.preventDefault(); navigateBrowser(tab, pane, input.value); });
    $$('[data-browser-action]', pane).forEach((button) => button.addEventListener("click", () => {
      try {
        if (button.dataset.browserAction === "back" && view.canGoBack()) view.goBack();
        if (button.dataset.browserAction === "forward" && view.canGoForward()) view.goForward();
        if (button.dataset.browserAction === "reload") view.reload();
        if (button.dataset.browserAction === "external") api?.openExternal(view.getURL() || normalizeBrowserUrl(input.value));
      } catch (error) { status.className = "browser-status is-error"; status.textContent = error.message; }
    }));
  }

  function navigateBrowser(tab, pane, value) {
    const url = normalizeBrowserUrl(value); const view = $("[data-browser-view]", pane); const input = $("[data-browser-url]", pane);
    tab.url = url; input.value = url; saveState();
    try {
      if (typeof view.loadURL === "function" && tab.browserReady) view.loadURL(url).catch(() => view.setAttribute("src", url));
      else view.setAttribute("src", url);
    } catch { view.setAttribute("src", url); }
  }

  function updateDockScrollButtons() {
    const tabs = $("#dockTabs"); if (!tabs) return;
    const overflow = tabs.scrollWidth > tabs.clientWidth + 2;
    $("#dockTabPrev").disabled = !overflow || tabs.scrollLeft <= 1;
    $("#dockTabNext").disabled = !overflow || tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1;
  }

  function refreshActiveDockPane() {
    const type = activeDockType();
    if (type === "review") refreshReview();
    if (type === "files") refreshWorkspaceFiles();
    const tab = state.dockTabs.find((item) => item.id === state.activeDockTabId);
    if (tab && ["tasks", "terminal", "browser"].includes(type)) {
      ensureDynamicDockPanes();
      const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
      if (type === "tasks") renderSideTaskPane(tab, pane);
      if (type === "terminal") ensureTerminalSession(tab, pane);
    }
  }

  async function refreshReview() {
    const summary = $("#reviewSummary");
    summary.className = "review-summary";
    summary.textContent = "正在读取 Git 工作区…";
    if (!api) { summary.textContent = "桌面模式下读取 Git 审阅信息"; return; }
    const result = await api.reviewWorkspace(state.cwd);
    if (!result.ok) { summary.textContent = result.error; return; }
    summary.classList.toggle("is-clean", result.clean);
    summary.textContent = result.clean ? "工作区干净，没有待审阅改动。" : (result.stat || `${result.files.length} 个文件发生变化`);
    $("#reviewFiles").innerHTML = result.files.map((file) => `<button class="review-file" data-review-file="${escapeHtml(file.path)}"><i>${escapeHtml(file.status)}</i><span>${escapeHtml(file.path)}</span></button>`).join("");
    $$('[data-review-file]').forEach((button) => button.addEventListener("click", () => { openDockType("files"); openWorkspaceFile(button.dataset.reviewFile); }));
  }

  async function refreshWorkspaceFiles() {
    const list = $("#workspaceFileList");
    list.innerHTML = '<div class="context-empty"><span>正在建立文件索引…</span></div>';
    if (!api) { list.innerHTML = '<div class="context-empty"><span>桌面模式下浏览工作区文件</span></div>'; return; }
    const result = await api.listWorkspaceFiles(state.cwd);
    if (!result.ok) { list.innerHTML = `<div class="context-empty"><span>${escapeHtml(result.error)}</span></div>`; return; }
    list.innerHTML = result.files.map((file) => `<button class="workspace-file" data-workspace-file="${escapeHtml(file.path)}"><svg><use href="#i-file"/></svg><span>${escapeHtml(file.path)}</span><small>${formatBytes(file.size)}</small></button>`).join("");
    $$('[data-workspace-file]').forEach((button) => button.addEventListener("click", () => openWorkspaceFile(button.dataset.workspaceFile)));
  }

  function formatBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} K`;
    return `${(size / 1024 / 1024).toFixed(1)} M`;
  }

  async function openWorkspaceFile(file) {
    $("#filePreviewTitle").textContent = file;
    $("#filePreviewContent").textContent = "正在读取…";
    $$('[data-workspace-file]').forEach((button) => button.classList.toggle("is-active", button.dataset.workspaceFile === file));
    if (!api) return;
    const result = await api.readWorkspaceFile(state.cwd, file);
    $("#filePreviewContent").textContent = result.ok ? result.content : result.error;
  }

  function updateLayout() {
    $("#appShell").classList.toggle("is-sidebar-hidden", state.sidebarHidden);
    $("#appShell").classList.toggle("is-inspector-open", state.inspectorOpen);
    // A focused control inside a collapsing grid column can make Chromium keep a
    // hidden horizontal document offset. Reset it so the left navigation never
    // gets pushed outside the viewport after closing the right workbench.
    if (document.scrollingElement?.scrollLeft) document.scrollingElement.scrollLeft = 0;
    document.documentElement.dataset.theme = resolvedTheme();
    updateSwitches();
  }

  function resolvedTheme() {
    if (state.theme !== "system") return state.theme;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function updateWorkspace() {
    const name = basename(state.cwd);
    $("#workspaceName").textContent = name;
    $("#workspacePath").textContent = state.cwd;
    $("#cwdLabel").textContent = name;
    $("#modelLabel").textContent = state.modelLabel;
    $("#effortLabel").textContent = state.effortLabel;
  }

  function updateWindowTrail() {
    // The title bar intentionally stays fixed as "GROK BUILD".
  }

  function updateSwitches() {
    [$("#approvalSwitch"), $("#settingsApproval")].forEach((el) => el?.setAttribute("aria-checked", String(state.alwaysApprove)));
    $("#permissionLabel").textContent = state.alwaysApprove ? "自动批准" : "每次询问";
    $("#themeSelect").value = state.theme;
  }

  function bindDynamicActions() {
    $$(".quick-action").forEach((button) => button.addEventListener("click", () => { $("#promptInput").value = button.dataset.prompt; autoSizeInput(); $("#promptInput").focus(); }));
    $$(".copy-message").forEach((button) => button.addEventListener("click", async () => {
      const id = button.closest(".message").dataset.messageId;
      const message = activeThread()?.messages.find((item) => item.id === id);
      if (message) { await navigator.clipboard.writeText(message.text); toast("已复制", "回复已复制到剪贴板"); }
    }));
    $$(".message__body").forEach(bindMessageBody);
  }

  function bindMessageBody(body) {
    $$(".copy-code", body).forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(button.closest(".code-block").querySelector("pre").textContent); toast("已复制", "代码块已复制"); }));
    $$("a", body).forEach((link) => link.addEventListener("click", (event) => { if (api) { event.preventDefault(); api.openExternal(link.href); } }));
  }

  function setRunning(running) {
    const button = $("#sendButton");
    $("#sessionState").classList.toggle("is-running", running);
    setSessionStateText(running ? "Grok 正在工作" : "准备就绪");
    button.classList.toggle("is-stop", running);
    button.innerHTML = `<svg><use href="#${running ? "i-stop" : "i-send"}"/></svg>`;
    if (running) {
      startedAt = Date.now();
      clearInterval(durationTimer);
      durationTimer = setInterval(() => { const label = $("#turnDuration"); if (label) label.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)} S`; }, 100);
    } else clearInterval(durationTimer);
  }

  function setSessionStateText(label) {
    const target = $("#sessionState");
    if (!target) return;
    const textNode = [...target.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = label;
    else target.append(document.createTextNode(label));
  }

  function phaseLabel(phase) {
    return ({
      waiting_for_model: "等待模型响应", streaming_reasoning: "Grok 正在思考",
      streaming_text: "Grok 正在回答", tool_execution: "正在执行工具",
      permission_prompt: "等待工具确认", compacting: "正在整理上下文"
    })[phase] || "Grok 正在工作";
  }

  function mainToolEvent(event) {
    const thread = activeThread();
    if (!thread) return null;
    let tool = thread.messages.find((message) => message.kind === "tool" && message.toolCallId === event.toolCallId);
    if (!tool) {
      if (activeAssistantMessage && !activeAssistantMessage.text && !activeAssistantMessage.thought) {
        const index = thread.messages.indexOf(activeAssistantMessage); if (index >= 0) thread.messages.splice(index, 1);
      }
      tool = createToolMessage(event); thread.messages.push(tool);
      activeAssistantMessage = { id: uid(), role: "assistant", text: "", thought: "", createdAt: Date.now() };
      thread.messages.push(activeAssistantMessage);
      renderMessages(); scrollToBottom();
    } else {
      mergeToolMessage(tool, event);
      refreshToolMessage(tool);
    }
    mergeToolMessage(tool, event);
    saveState();
    return tool;
  }

  function refreshToolMessage(message) {
    const existing = $(`[data-message-id="${message.id}"]`);
    if (!existing) { renderMessages(); return; }
    const wasOpen = existing.open;
    const template = document.createElement("template"); template.innerHTML = toolMessageMarkup(message).trim();
    const replacement = template.content.firstElementChild;
    replacement.open = wasOpen || ["pending", "in_progress", "waiting_permission", "failed"].includes(toolStatus(message.status, message.exitCode));
    existing.replaceWith(replacement);
  }

  function handleMainLifecycle(lifecycle) {
    if (!lifecycle) return;
    if (lifecycle.type === "phase_changed") setSessionStateText(phaseLabel(lifecycle.phase));
    const thread = activeThread(); if (!thread) return;
    const tool = lifecycleTool({ messages: thread.messages }, lifecycle);
    if (tool) { refreshToolMessage(tool); saveState(); }
  }

  function addTimeline(title, detail, status = "done") {
    const list = $("#activityTimeline");
    if (!list) return;
    if (list.children.length > 6) list.removeChild(list.children[1]);
    list.insertAdjacentHTML("beforeend", `<li class="is-${status}"><i>${status === "done" ? '<svg><use href="#i-check"/></svg>' : ""}</i><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span></li>`);
  }

  async function sendPrompt() {
    if (activeRun) { if (api) await api.cancelPrompt(activeRun); finishRun("已停止"); return; }
    const input = $("#promptInput");
    const prompt = input.value.trim();
    if (!prompt) return;
    const thread = activeThread() || createThread(prompt.slice(0, 34));
    if (!thread.messages.length) thread.title = prompt.replace(/\s+/g, " ").slice(0, 34);
    thread.messages.push({ id: uid(), role: "user", text: prompt, createdAt: Date.now() });
    activeAssistantMessage = { id: uid(), role: "assistant", text: "", thought: "", createdAt: Date.now() };
    activeRunDiagnostics = [];
    thread.messages.push(activeAssistantMessage);
    thread.updatedAt = Date.now();
    input.value = ""; input.style.height = "auto";
    saveState(); renderAll(); scrollToBottom(); setRunning(true);
    addTimeline("提交任务", prompt.slice(0, 42), "done");
    addTimeline("Grok 推理", "等待首个响应片段", "active");

    if (!api) {
      activeRun = `demo-${uid()}`;
      simulatePrompt(prompt);
      return;
    }
    const result = await api.sendPrompt({ clientId: "main", prompt, cwd: thread.cwd || state.cwd, sessionId: thread.sessionId, model: state.model, effort: state.effort, alwaysApprove: state.alwaysApprove, attachments: state.attachments });
    if (!result.ok) { activeAssistantMessage.text = `启动 Grok 时出现问题：${result.error}`; toast("Runtime 错误", result.error); finishRun("启动失败"); renderMessages(); return; }
    activeRun = result.runId;
    state.attachments = [];
    renderAttachments();
  }

  function simulatePrompt(prompt) {
    const response = `我已收到任务：**${prompt}**\n\n桌面预览模式已启用。安装依赖并通过 Electron 启动后，这里会实时呈现 Grok Build 的思考与回答流。\n\n- 会话 ID 自动续接\n- 工作区与附件会传给本地 runtime\n- 支持中止、主题和任务历史`;
    let index = 0;
    const timer = setInterval(() => {
      if (!activeRun) return clearInterval(timer);
      activeAssistantMessage.text += response.slice(index, index + 5); index += 5;
      scheduleStreamingRender();
      if (index >= response.length) { clearInterval(timer); finishRun("预览完成"); }
    }, 35);
  }

  function handleRunEvent(event) {
    const sideTab = state.dockTabs.find((tab) => tab.type === "tasks" && (tab.id === event.clientId || (tab.runId && tab.runId === event.runId)));
    if (sideTab) { handleSideTaskEvent(sideTab, event); return; }
    if (!activeRun && event.clientId === "main" && activeAssistantMessage) activeRun = event.runId;
    if (!activeRun || event.runId !== activeRun) return;
    if (event.type === "text") {
      activeAssistantMessage.text += event.data || "";
      scheduleStreamingRender();
    } else if (event.type === "thought") {
      activeAssistantMessage.thought = (activeAssistantMessage.thought || "") + (event.data || "");
      scheduleStreamingRender();
    } else if (event.type === "session_bound") {
      const thread = activeThread(); if (thread) thread.sessionId = event.sessionId || thread.sessionId;
    } else if (event.type === "tool_call" || event.type === "tool_update") {
      mainToolEvent(event);
    } else if (event.type === "lifecycle") {
      handleMainLifecycle(event.event);
    } else if (event.type === "diagnostic") {
      activeRunDiagnostics.push(String(event.data || ""));
      activeRunDiagnostics = activeRunDiagnostics.slice(-8);
      addTimeline("Runtime 活动", String(event.data).slice(0, 55), "done");
    } else if (event.type === "error") {
      activeAssistantMessage.text += `\n\n**错误：** ${event.message}`;
      toast("Grok 返回错误", event.message);
    } else if (event.type === "end") {
      const thread = activeThread();
      thread.sessionId = event.sessionId || thread.sessionId;
      finishRun(event.stopReason || "完成");
    } else if (event.type === "process_exit" && event.code !== 0) {
      if (activeAssistantMessage) {
        const detail = activeRunDiagnostics.slice(-3).join("\n").trim();
        activeAssistantMessage.text += `\n\n**Runtime 退出（${event.code ?? event.signal}）**${detail ? `\n\n\`\`\`text\n${detail}\n\`\`\`` : ""}`;
      }
      finishRun(`进程退出 ${event.code ?? event.signal}`);
    }
  }

  function finishRun(reason) {
    const thread = activeThread();
    if (thread && activeAssistantMessage && !activeAssistantMessage.text && !activeAssistantMessage.thought) {
      const index = thread.messages.indexOf(activeAssistantMessage); if (index >= 0) thread.messages.splice(index, 1);
    }
    if (thread) for (const tool of thread.messages.filter((message) => message.kind === "tool")) {
      if (["pending", "in_progress", "waiting_permission"].includes(toolStatus(tool.status))) {
        tool.status = /停止|失败|退出|error|cancel/i.test(String(reason)) ? "cancelled" : "completed";
      }
    }
    if (thread) thread.updatedAt = Date.now();
    activeRun = null; activeAssistantMessage = null; activeRunDiagnostics = [];
    setRunning(false); saveState(); renderThreads(); renderMessages();
    addTimeline("任务结束", reason, "done");
  }

  function scrollToBottom() { requestAnimationFrame(() => { const el = $("#conversation"); el.scrollTop = el.scrollHeight; }); }
  function autoSizeInput() { const el = $("#promptInput"); el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }

  async function chooseWorkspace() {
    if (!api) { toast("桌面预览", "Electron 中可选择本地工作区"); return; }
    const cwd = await api.pickWorkspace();
    if (cwd) { state.cwd = cwd; const thread = activeThread(); if (thread && !thread.messages.length) thread.cwd = cwd; saveState(); updateWorkspace(); updateWindowTrail(); await refreshGitInfo(); refreshActiveDockPane(); toast("已切换工作区", cwd); }
  }

  async function chooseFiles() {
    if (!api) { state.attachments = ["src/main.rs", "Cargo.toml"]; renderAttachments(); return; }
    const files = await api.pickFiles();
    state.attachments.push(...files.filter((file) => !state.attachments.includes(file))); renderAttachments();
  }

  async function toggleApproval() {
    state.alwaysApprove = !state.alwaysApprove; saveState(); updateSwitches();
    if (api) {
      const result = await api.setNativeSetting("permission_mode", state.alwaysApprove ? "always-approve" : "ask");
      if (!result.ok) { state.alwaysApprove = !state.alwaysApprove; saveState(); updateSwitches(); toast("权限设置保存失败", result.error); }
      else { nativeConfig.values.permission_mode = result.value; nativeConfig.raw = result.raw; $("#rawConfigEditor").value = result.raw || ""; }
    }
  }
  function openPalette() {
    const backdrop = $("#paletteBackdrop"); backdrop.hidden = false; $("#paletteInput").value = ""; renderPalette(""); setTimeout(() => $("#paletteInput").focus(), 0);
  }
  function closePalette() { $("#paletteBackdrop").hidden = true; }
  function renderPalette(query) {
    const actions = [
      { title: "新建任务", meta: "⌘ N", icon: "i-plus", run: () => createThread() },
      { title: "选择工作区", meta: basename(state.cwd), icon: "i-folder", run: chooseWorkspace },
      { title: "切换任务脉络", meta: "⌘ ⇧ I", icon: "i-command", run: () => { state.inspectorOpen = !state.inspectorOpen; saveState(); updateLayout(); } },
      { title: "桌面设置", meta: "⌘ ,", icon: "i-settings", run: openSettings }
    ];
    const matches = [...actions, ...state.threads.map((thread) => ({ title: thread.title, meta: "历史任务", icon: "i-terminal", run: () => { state.activeThreadId = thread.id; saveState(); renderAll(); } }))].filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    $("#paletteResults").innerHTML = `<div class="palette-group">快速操作</div>${matches.map((item, index) => `<button class="palette-item ${index === 0 ? "is-selected" : ""}" data-palette="${index}"><svg><use href="#${item.icon}"/></svg><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.meta)}</small></button>`).join("") || '<div class="context-empty">没有匹配项</div>'}`;
    $$('[data-palette]').forEach((button) => button.addEventListener("click", () => { matches[Number(button.dataset.palette)].run(); closePalette(); }));
  }
  const settingTargetPages = {
    nativeGeneralSettings: "general", nativeModelSettings: "models", nativeAppearanceSettings: "appearance",
    nativeInputSettings: "input", nativeAgentSettings: "agent", nativeToolSettings: "tools",
    nativeMemorySettings: "memory", nativeGitSettings: "git", nativePrivacySettings: "privacy"
  };

  function modelSettingOptions(current) {
    const values = [{ id: "", label: "使用 Runtime 默认值" }, ...runtimeModels.filter((item) => item.id !== "auto")];
    if (current && !values.some((item) => item.id === current)) values.push({ id: current, label: current });
    return values;
  }

  function settingControl(item) {
    const [id, , , type, choices = {}] = item;
    const value = nativeConfig.values?.[id];
    if (type === "bool") return `<div class="native-setting-control"><button class="switch" data-native-setting="${id}" role="switch" aria-checked="${Boolean(value)}"><i></i></button><svg class="setting-saved"><use href="#i-check"/></svg></div>`;
    if (type === "model") {
      return `<div class="native-setting-control"><select data-native-setting="${id}">${modelSettingOptions(value).map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select><svg class="setting-saved"><use href="#i-check"/></svg></div>`;
    }
    if (type === "select") return `<div class="native-setting-control"><select data-native-setting="${id}">${Object.entries(choices).map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select><svg class="setting-saved"><use href="#i-check"/></svg></div>`;
    const step = choices.step || 1;
    return `<div class="native-setting-control"><input type="number" step="${step}" value="${Number(value ?? 0)}" data-native-setting="${id}"/>${choices.suffix ? `<small>${escapeHtml(choices.suffix)}</small>` : ""}<svg class="setting-saved"><use href="#i-check"/></svg></div>`;
  }

  function renderNativeSettings() {
    for (const group of nativeSettingGroups) {
      const target = $(`#${group.target}`);
      if (!target) continue;
      target.innerHTML = `<div class="native-settings-group"><h4>${escapeHtml(group.title)}</h4><div class="settings-card">${group.items.map((item) => `<div class="settings-row" data-setting-row="${item[0]}" data-search-text="${escapeHtml(`${item[1]} ${item[2]} ${item[0]}`.toLowerCase())}"><span><b>${escapeHtml(item[1])}</b><small>${escapeHtml(item[2])}</small></span>${settingControl(item)}</div>`).join("")}</div></div>`;
    }
    $$('[data-native-setting]').forEach((control) => {
      if (control.matches("button")) control.addEventListener("click", () => applyNativeSetting(control.dataset.nativeSetting, control.getAttribute("aria-checked") !== "true", control));
      else control.addEventListener("change", () => applyNativeSetting(control.dataset.nativeSetting, control.type === "number" ? Number(control.value) : control.value, control));
    });
  }

  async function applyNativeSetting(id, value, control) {
    control.disabled = true;
    const result = api ? await api.setNativeSetting(id, value) : { ok: true, value };
    control.disabled = false;
    if (!result.ok) { toast("设置保存失败", result.error); return; }
    nativeConfig.values[id] = result.value;
    if (result.raw != null) { nativeConfig.raw = result.raw; $("#rawConfigEditor").value = result.raw; }
    if (control.matches("button")) control.setAttribute("aria-checked", String(Boolean(result.value)));
    control.closest(".native-setting-control")?.classList.add("is-saved");
    setTimeout(() => control.closest(".native-setting-control")?.classList.remove("is-saved"), 1200);
    if (id === "permission_mode") { state.alwaysApprove = result.value === "always-approve"; saveState(); updateSwitches(); }
    $("#settingsConfigStatus").textContent = `已写入 ${nativeConfig.path}`;
  }

  function renderIntegrationSummary() {
    const counts = nativeConfig.integrations || {};
    const items = [
      ["i-command", "MCP Servers", counts.mcp || 0], ["i-tasks", "Plugins", counts.plugins || 0],
      ["i-file", "Skills", counts.skills || 0], ["i-terminal", "Hooks", counts.hooks || 0],
      ["i-user", "Agents", counts.agents || 0], ["i-command", "Custom Models", counts.models || 0]
    ];
    $("#integrationGrid").innerHTML = items.map(([icon, label, count]) => `<article class="integration-card"><svg><use href="#${icon}"/></svg><b>${label}</b><small>${count} 个已发现项目</small></article>`).join("");
  }

  async function loadNativeConfig() {
    if (api) nativeConfig = await api.readNativeConfig();
    $("#nativeConfigPath").textContent = nativeConfig.path;
    $("#rawConfigEditor").value = nativeConfig.raw || "";
    $("#settingsConfigStatus").textContent = `直接读写 ${nativeConfig.path} · ${Object.keys(nativeConfig.values || {}).length} 项原生设置`;
    state.alwaysApprove = nativeConfig.values?.permission_mode === "always-approve";
    saveState(); updateSwitches(); renderNativeSettings(); renderIntegrationSummary();
  }

  function showSettingsPage(page = "general") {
    $$('[data-settings-page]').forEach((button) => button.classList.toggle("is-active", button.dataset.settingsPage === page));
    $$('[data-settings-panel]').forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== page; });
    $("#settingsContent").scrollTop = 0;
  }

  function renderSettingsSearch(query) {
    const value = query.trim().toLowerCase();
    let results = $("#settingsSearchResults");
    if (!value) { results?.remove(); showSettingsPage($('[data-settings-page].is-active')?.dataset.settingsPage || "general"); return; }
    const matches = nativeSettingGroups.flatMap((group) => group.items.map((item) => ({ group, item }))).filter(({ item }) => `${item[0]} ${item[1]} ${item[2]}`.toLowerCase().includes(value));
    if (!results) {
      results = document.createElement("section"); results.id = "settingsSearchResults"; results.className = "settings-panel"; $("#settingsContent").prepend(results);
    }
    $$('[data-settings-panel]').forEach((panel) => { panel.hidden = true; });
    $$('[data-settings-page]').forEach((button) => button.classList.remove("is-active"));
    results.hidden = false;
    results.innerHTML = `<div class="settings-panel__heading"><h3>搜索设置</h3><p>找到 ${matches.length} 个匹配项</p></div><div class="settings-card">${matches.map(({ group, item }) => `<button class="settings-row" data-search-result="${item[0]}" data-search-page="${settingTargetPages[group.target]}"><span><b>${escapeHtml(item[1])}</b><small>${escapeHtml(item[2])}</small></span><svg style="width:14px"><use href="#i-chevron"/></svg></button>`).join("") || '<div class="context-empty">没有匹配的原生设置</div>'}</div>`;
    $$('[data-search-result]', results).forEach((button) => button.addEventListener("click", () => {
      $("#settingsSearch").value = ""; results.remove(); showSettingsPage(button.dataset.searchPage);
      setTimeout(() => $(`[data-setting-row="${button.dataset.searchResult}"]`)?.scrollIntoView({ block: "center" }), 0);
    }));
  }

  function initials(name) {
    const value = String(name || "G").trim();
    return (/^[\u4e00-\u9fff]/.test(value) ? value.slice(0, 1) : value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "G").toUpperCase();
  }

  function updateAccountUI() {
    const name = authState.signedIn ? authState.name : "登录 Grok";
    const email = authState.email || (authState.signedIn ? `通过 ${authState.method || "Grok"} 登录` : "使用 Grok 账号继续");
    const avatarText = authState.signedIn ? initials(name) : "G";
    [$("#accountAvatar"), $("#accountPopoverAvatar"), $("#settingsAccountAvatar")].forEach((avatar) => { avatar.textContent = avatarText; });
    $("#accountAvatar").appendChild(document.createElement("i"));
    $("#accountAvatar").classList.toggle("is-online", runtimeState.connected);
    $("#runtimeTitle").textContent = name;
    $("#runtimeMeta").textContent = runtimeState.connected ? `Grok runtime 在线${runtimeState.version ? ` · ${runtimeState.version}` : ""}` : "Grok runtime 未连接";
    $("#accountPopoverName").textContent = name; $("#accountPopoverEmail").textContent = email;
    $("#accountRuntimeDot").classList.toggle("is-online", runtimeState.connected);
    $("#accountRuntimeLabel").textContent = runtimeState.connected ? "Grok Runtime 在线" : "Grok Runtime 离线";
    $("#accountVersionLabel").textContent = runtimeState.version || "等待 Runtime 连接";
    $("#authMenuLabel").textContent = authState.signedIn ? "退出登录" : "登录 Grok";
    $("#settingsAccountName").textContent = name; $("#settingsAccountEmail").textContent = email;
    $("#settingsAccountTeam").textContent = [authState.team, authState.role].filter(Boolean).join(" · ");
    $("#settingsAuthButton").textContent = authState.signedIn ? "退出登录" : "登录 Grok";
    $("#settingsRuntimeVersion").textContent = runtimeState.version || "—";
  }

  async function refreshAuthInfo() {
    authState = api ? await api.authInfo() : { signedIn: false, name: "登录 Grok" };
    updateAccountUI();
    return authState;
  }

  function stopAuthPolling() {
    clearInterval(authPollTimer); authPollTimer = null; authPollBusy = false;
  }

  function startAuthPolling() {
    stopAuthPolling(); let checks = 0;
    authPollTimer = setInterval(async () => {
      if (authPollBusy) return;
      authPollBusy = true; checks += 1;
      try {
        const info = await refreshAuthInfo();
        if (info.signedIn) {
          stopAuthPolling();
          $("#authProgress").hidden = true;
          await detectRuntime();
          toast("Grok 登录完成", info.email || info.name);
        } else if (checks >= 400) stopAuthPolling();
      } finally { authPollBusy = false; }
    }, 1500);
  }

  async function toggleAuth() {
    $("#accountPopover").hidden = true;
    if (!api) { toast("账号预览", "Electron 中连接 Grok 账号"); return; }
    if (authState.signedIn) {
      stopAuthPolling();
      const result = await api.logout();
      if (!result.ok) { toast("退出登录失败", result.error); return; }
      authState = result.info; updateAccountUI(); toast("已退出 Grok", "本地 Runtime 仍可使用第三方模型"); return;
    }
    $("#authProgress").hidden = false; $("#authProgressText").textContent = "正在连接 auth.x.ai 并生成 Runtime OAuth 授权地址…";
    const result = await api.login();
    if (!result.ok) { $("#authProgressText").textContent = result.error; toast("登录启动失败", result.error); }
    else { startAuthPolling(); toast("正在连接 Grok 账号", "Runtime OAuth 授权页即将打开"); }
  }

  async function openSettings(page = "general") {
    $("#accountPopover").hidden = true; $("#settingsBackdrop").hidden = false; showSettingsPage(page);
    await Promise.all([loadSavedProviders(), loadNativeConfig(), refreshAuthInfo()]);
  }
  function closeSettings() { $("#settingsBackdrop").hidden = true; $("#settingsSearch").value = ""; $("#settingsSearchResults")?.remove(); }

  function providerModelOptions() {
    return savedProviders.flatMap((provider) => (provider.models || []).map((model) => ({
      id: model.localId,
      label: model.name || model.id,
      provider: provider.name,
      protocol: provider.protocol
    })));
  }

  function mergeProviderModels() {
    const local = providerModelOptions();
    const ids = new Set(runtimeModels.map((item) => item.id));
    for (const model of local) if (!ids.has(model.id)) runtimeModels.push(model);
    if (!runtimeModels.some((item) => item.id === state.model)) {
      state.model = "auto";
      state.modelLabel = runtimeModels[0]?.label || "自动模型";
    }
    saveState(); updateWorkspace();
  }

  async function loadSavedProviders() {
    if (!api) { renderSavedProviders(); return; }
    savedProviders = await api.listProviders();
    renderSavedProviders(); mergeProviderModels();
  }

  function renderSavedProviders() {
    const target = $("#savedProviders");
    if (!savedProviders.length) {
      target.innerHTML = '<div class="context-empty"><span>还没有第三方模型服务</span></div>';
      return;
    }
    target.innerHTML = savedProviders.map((provider) => `<div class="saved-provider"><span class="saved-provider__protocol">${provider.protocol === "anthropic" ? "ANTH" : "OAI"}</span><span><b>${escapeHtml(provider.name)}</b><small>${escapeHtml(provider.baseUrl)} · ${provider.models.length} 个模型${provider.keyProtected ? " · 系统加密" : ""}</small></span><button class="icon-button" data-remove-provider="${provider.id}" title="移除"><svg><use href="#i-trash"/></svg></button></div>`).join("");
    $$('[data-remove-provider]').forEach((button) => button.addEventListener("click", async () => {
      savedProviders = api ? await api.removeProvider(button.dataset.removeProvider) : [];
      runtimeModels = runtimeModels.filter((item) => !String(item.id).startsWith(`desktop-${button.dataset.removeProvider.replace(/^provider-/, "provider")}`));
      renderSavedProviders(); mergeProviderModels(); await detectRuntime();
      toast("模型服务已移除", "Grok 配置已同步更新");
    }));
  }

  async function discoverProviderModels() {
    const url = $("#providerUrl").value.trim();
    const key = $("#providerKey").value.trim();
    const status = $("#providerDetectStatus");
    status.className = "provider-detect-status";
    status.textContent = "正在尝试 OpenAI 与 Anthropic 协议…";
    $("#discoverModelsButton").disabled = true;
    const result = api ? await api.discoverProviderModels({ baseUrl: url, apiKey: key }) : { ok: true, protocol: "openai", baseUrl: url, models: [{ id: "example-model", name: "Example Model" }] };
    $("#discoverModelsButton").disabled = false;
    if (!result.ok) {
      providerDiscovery = null;
      status.classList.add("is-error"); status.textContent = result.error;
      $("#discoveredModels").hidden = true; $("#providerSaveRow").hidden = true;
      return;
    }
    providerDiscovery = { ...result, apiKey: key, selected: new Set(result.models.map((model) => model.id)) };
    status.classList.add("is-success");
    status.textContent = `已识别 ${result.protocol === "anthropic" ? "Anthropic Messages" : "OpenAI Chat Completions"} 协议，共 ${result.models.length} 个模型`;
    renderDiscoveredModels();
  }

  function renderDiscoveredModels() {
    const target = $("#discoveredModels");
    if (!providerDiscovery) { target.hidden = true; return; }
    target.hidden = false;
    target.innerHTML = providerDiscovery.models.map((model) => `<label class="discovered-model"><input type="checkbox" data-discovered-model="${escapeHtml(model.id)}" ${providerDiscovery.selected.has(model.id) ? "checked" : ""}/><span><b>${escapeHtml(model.name || model.id)}</b><small>${escapeHtml(model.id)}${model.owner ? ` · ${escapeHtml(model.owner)}` : ""}</small></span></label>`).join("");
    $$('[data-discovered-model]').forEach((input) => input.addEventListener("change", () => {
      input.checked ? providerDiscovery.selected.add(input.dataset.discoveredModel) : providerDiscovery.selected.delete(input.dataset.discoveredModel);
      updateProviderSelection();
    }));
    $("#providerSaveRow").hidden = false; updateProviderSelection();
  }

  function updateProviderSelection() {
    const count = providerDiscovery?.selected.size || 0;
    $("#providerSelectionCount").textContent = `已选择 ${count} 个模型`;
    $("#saveProviderButton").disabled = count === 0;
  }

  async function saveDiscoveredProvider() {
    if (!providerDiscovery) return;
    const selected = providerDiscovery.models.filter((model) => providerDiscovery.selected.has(model.id));
    const result = api ? await api.saveProvider({
      baseUrl: providerDiscovery.baseUrl,
      apiKey: providerDiscovery.apiKey,
      protocol: providerDiscovery.protocol,
      models: selected
    }) : { ok: true, providers: [] };
    if (!result.ok) { toast("保存失败", result.error); return; }
    savedProviders = result.providers;
    providerDiscovery = null;
    $("#providerUrl").value = ""; $("#providerKey").value = "";
    $("#providerDetectStatus").className = "provider-detect-status";
    $("#providerDetectStatus").textContent = "填写连接信息后发现模型";
    $("#discoveredModels").hidden = true; $("#providerSaveRow").hidden = true;
    renderSavedProviders(); await detectRuntime(); mergeProviderModels();
    toast("第三方模型已保存", `${selected.length} 个模型已加入模型选择器`);
  }

  function closePicker() {
    pickerPopover?.remove();
    pickerPopover = null;
    $$(".is-picker-open").forEach((button) => button.classList.remove("is-picker-open"));
  }

  function openPicker(anchor, { items, selected, onSelect }) {
    closePicker();
    anchor.classList.add("is-picker-open");
    const popover = document.createElement("section");
    popover.className = "picker-popover";
    popover.setAttribute("role", "listbox");
    popover.innerHTML = `<div class="picker-popover__items">${items.map((item) => `<button class="picker-option ${item.id === selected ? "is-selected" : ""}" role="option" aria-selected="${item.id === selected}" data-picker-id="${escapeHtml(item.id)}"><span class="picker-option__radio"><i></i></span><span class="picker-option__copy"><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description || "")}</small></span>${item.badge ? `<em>${escapeHtml(item.badge)}</em>` : ""}</button>`).join("")}</div>`;
    document.body.appendChild(popover);
    pickerPopover = popover;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const left = Math.max(10, Math.min(anchorRect.left, innerWidth - popoverRect.width - 10));
    const top = Math.max(10, anchorRect.top - popoverRect.height - 9);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    const itemScroller = popover.querySelector(".picker-popover__items");
    itemScroller.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    requestAnimationFrame(() => popover.querySelector(".picker-option.is-selected")?.scrollIntoView({ block: "nearest" }));
    popover.querySelectorAll("[data-picker-id]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = items.find((candidate) => candidate.id === button.dataset.pickerId);
      if (item) onSelect(item);
      closePicker();
    }));
  }

  function toast(title, detail) {
    const node = document.createElement("div"); node.className = "toast";
    node.innerHTML = `<svg><use href="#i-check"/></svg><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>`;
    $("#toastStack").appendChild(node); setTimeout(() => node.remove(), 3600);
  }

  async function detectRuntime() {
    if (!api) { runtimeState = { connected: true, version: "界面预览", binary: null }; updateAccountUI(); return runtimeState; }
    const info = await api.runtimeInfo();
    runtimeState = info;
    runtimeModels = [
      { id: "auto", label: info.defaultModel ? `自动 · ${info.defaultModel}` : "自动模型" },
      ...(info.models || []).map((id) => ({ id, label: id }))
    ];
    mergeProviderModels();
    if (!runtimeModels.some((item) => item.id === state.model)) state.model = "auto";
    state.modelLabel = runtimeModels.find((item) => item.id === state.model)?.label || runtimeModels[0].label;
    saveState();
    updateWorkspace();
    $("#settingsRuntimePath").textContent = info.binary || "未检测到";
    $("#settingsRuntimeVersion").textContent = info.version || "—";
    updateAccountUI();
    if (!$("#settingsBackdrop").hidden && nativeConfig.values) renderNativeSettings();
    return info;
  }

  async function refreshRuntimeDetection() {
    const button = $("#refreshRuntime");
    button.disabled = true; button.classList.add("is-refreshing");
    const previousPath = $("#settingsRuntimePath").textContent;
    $("#settingsRuntimePath").textContent = "正在重新检测 Grok Runtime…";
    try {
      const info = await detectRuntime();
      toast(info?.connected ? "Grok Runtime 已连接" : "Runtime 检测完成", info?.version || info?.binary || previousPath || "检测已完成");
    } finally {
      button.disabled = false; button.classList.remove("is-refreshing");
    }
  }

  function bindStaticActions() {
    $("#newThreadButton").addEventListener("click", () => createThread());
    $("#searchButton").addEventListener("click", openPalette);
    $("#brandButton").addEventListener("click", () => { state.activeThreadId = null; saveState(); renderAll(); });
    $("#workspaceButton").addEventListener("click", chooseWorkspace); $("#cwdButton").addEventListener("click", chooseWorkspace);
    $("#branchButton").addEventListener("click", toggleBranchPopover);
    $("#branchRefresh").addEventListener("click", async (event) => { event.stopPropagation(); await refreshGitInfo(); });
    $("#branchSearch").addEventListener("input", (event) => { branchFilter = event.target.value; renderBranchPopover(); });
    $("#branchCreateForm").addEventListener("submit", createBranch);
    $("#branchOpenReview").addEventListener("click", () => { $("#branchPopover").hidden = true; $("#branchButton").setAttribute("aria-expanded", "false"); openDockType("review"); });
    $("#attachButton").addEventListener("click", chooseFiles);
    $("#sendButton").addEventListener("click", sendPrompt);
    $("#promptInput").addEventListener("input", autoSizeInput);
    $("#promptInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendPrompt(); } });
    $("#sidebarToggle").addEventListener("click", () => { state.sidebarHidden = !state.sidebarHidden; saveState(); updateLayout(); });
    $("#inspectorToggle").addEventListener("click", () => { state.inspectorOpen = !state.inspectorOpen; saveState(); updateLayout(); if (state.inspectorOpen) refreshActiveDockPane(); });
    $("#inspectorClose").addEventListener("click", () => { state.inspectorOpen = false; saveState(); updateLayout(); });
    $("#dockTabAdd").addEventListener("click", (event) => { event.stopPropagation(); $("#dockTabPicker").hidden = !$("#dockTabPicker").hidden; });
    $("#dockTabPrev").addEventListener("click", () => $("#dockTabs").scrollBy({ left: -220, behavior: "smooth" }));
    $("#dockTabNext").addEventListener("click", () => $("#dockTabs").scrollBy({ left: 220, behavior: "smooth" }));
    $("#dockTabs").addEventListener("scroll", updateDockScrollButtons);
    window.addEventListener("resize", updateDockScrollButtons);
    $("#reviewRefresh").addEventListener("click", refreshReview);
    $("#filesRefresh").addEventListener("click", refreshWorkspaceFiles);
    $("#approvalSwitch").addEventListener("click", toggleApproval);
    $("#settingsButton").addEventListener("click", () => openSettings("general")); $$('[data-close-modal]').forEach((button) => button.addEventListener("click", closeSettings));
    $("#settingsBackdrop").addEventListener("click", (event) => { if (event.target === $("#settingsBackdrop")) closeSettings(); });
    $("#paletteBackdrop").addEventListener("click", (event) => { if (event.target === $("#paletteBackdrop")) closePalette(); });
    $("#paletteInput").addEventListener("input", (event) => renderPalette(event.target.value));
    $("#themeButton").addEventListener("click", () => { state.theme = resolvedTheme() === "dark" ? "light" : "dark"; saveState(); updateLayout(); });
    $("#themeSelect").addEventListener("change", (event) => { state.theme = event.target.value; saveState(); updateLayout(); });
    $("#refreshRuntime").addEventListener("click", refreshRuntimeDetection);
    $("#runtimeCard").addEventListener("click", (event) => { event.stopPropagation(); $("#accountPopover").hidden = !$("#accountPopover").hidden; });
    $("#profileMenuButton").addEventListener("click", () => openSettings("account"));
    $("#settingsMenuButton").addEventListener("click", () => openSettings("general"));
    $("#authMenuButton").addEventListener("click", toggleAuth); $("#settingsAuthButton").addEventListener("click", toggleAuth);
    $$('[data-settings-page]').forEach((button) => button.addEventListener("click", () => { $("#settingsSearch").value = ""; $("#settingsSearchResults")?.remove(); showSettingsPage(button.dataset.settingsPage); }));
    $("#settingsSearch").addEventListener("input", (event) => renderSettingsSearch(event.target.value));
    $("#reloadRawConfig").addEventListener("click", loadNativeConfig);
    $("#revealRawConfig").addEventListener("click", () => api?.revealNativeConfig());
    $("#integrationOpenConfig").addEventListener("click", () => api?.openNativeConfig());
    $("#saveRawConfig").addEventListener("click", async () => {
      const result = api ? await api.saveRawConfig($("#rawConfigEditor").value) : { ok: true, raw: $("#rawConfigEditor").value, values: nativeConfig.values };
      if (!result.ok) { toast("配置保存失败", result.error); return; }
      nativeConfig = result; renderNativeSettings(); renderIntegrationSummary();
      $("#settingsConfigStatus").textContent = `已保存 ${nativeConfig.path}`; toast("原生配置已保存", "TUI 与桌面端将读取同一份 config.toml");
      await detectRuntime();
    });
    $("#discoverModelsButton").addEventListener("click", discoverProviderModels);
    $("#saveProviderButton").addEventListener("click", saveDiscoveredProvider);
    $("#modelButton").addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(event.currentTarget, {
        selected: state.model,
        items: runtimeModels.map((item, index) => ({ ...item, description: item.id === "auto" ? "跟随 Grok Runtime 的默认模型" : "固定使用这个模型处理后续任务", badge: index === 0 ? "推荐" : "" })),
        onSelect: (item) => { state.model = item.id; state.modelLabel = item.label; saveState(); updateWorkspace(); toast("模型已切换", item.label); }
      });
    });
    $("#effortButton").addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(event.currentTarget, {
        selected: state.effort,
        items: [
          { id: "low", label: "低思考", description: "快速回答，适合简单修改与查询" },
          { id: "medium", label: "中思考", description: "速度与分析深度之间的平衡", badge: "均衡" },
          { id: "high", label: "高思考", description: "更深入地规划、实现并验证复杂任务" }
        ],
        onSelect: (item) => { state.effort = item.id; state.effortLabel = item.label; saveState(); updateWorkspace(); toast("思考档位已切换", item.label); }
      });
    });
    $("#clearThreadsButton").addEventListener("click", () => toast("任务已整理", "历史记录保留在本机"));
    $("#conversation").addEventListener("scroll", () => { const el = $("#conversation"); $("#scrollBottom").classList.toggle("is-visible", el.scrollHeight - el.scrollTop - el.clientHeight > 160); });
    $("#scrollBottom").addEventListener("click", scrollToBottom);
    $$('[data-window]').forEach((button) => button.addEventListener("click", () => { if (!api) return; const action = button.dataset.window; if (action === "min") api.minimize(); else if (action === "max") api.maximize(); else api.close(); }));
    document.addEventListener("keydown", (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); }
      if (mod && event.key.toLowerCase() === "n") { event.preventDefault(); createThread(); }
      if (mod && event.key === ",") { event.preventDefault(); openSettings(); }
      if (mod && event.key.toLowerCase() === "f" && !$("#settingsBackdrop").hidden) { event.preventDefault(); $("#settingsSearch").focus(); }
      if (event.key === "Escape") { $("#accountPopover").hidden = true; $("#branchPopover").hidden = true; $("#branchButton").setAttribute("aria-expanded", "false"); closePicker(); closePalette(); closeSettings(); }
    });
    document.addEventListener("click", (event) => {
      if (pickerPopover && !pickerPopover.contains(event.target)) closePicker();
      if (!event.target.closest("#dockTabPicker") && !event.target.closest("#dockTabAdd")) $("#dockTabPicker").hidden = true;
      if (!event.target.closest("#accountPopover") && !event.target.closest("#runtimeCard")) $("#accountPopover").hidden = true;
      if (!event.target.closest("#branchPopover") && !event.target.closest("#branchButton")) { $("#branchPopover").hidden = true; $("#branchButton").setAttribute("aria-expanded", "false"); }
    });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (state.theme === "system") updateLayout(); });
  }

  bindStaticActions();
  if (api) api.onRunEvent(handleRunEvent);
  if (api) api.onTerminalEvent((event) => {
    const tab = state.dockTabs.find((item) => item.type === "terminal" && item.id === event.terminalId);
    if (!tab) return;
    if (event.type === "output") appendTerminalOutput(tab, event.data);
    if (event.type === "error") appendTerminalOutput(tab, `\n${event.message}\n`);
    if (event.type === "exit") {
      tab.terminalReady = false;
      if (!event.closing) appendTerminalOutput(tab, `\n[终端进程已退出：${event.code ?? event.signal ?? "unknown"}]\n`);
      const pane = [...$$('[data-dock-id]')].find((item) => item.dataset.dockId === tab.id);
      const status = pane && $("[data-terminal-state]", pane); if (status) { status.classList.add("is-error"); status.textContent = "会话已结束"; }
    }
  });
  if (api) api.onAuthEvent((event) => {
    const progress = $("#authProgress"); const text = $("#authProgressText"); progress.hidden = false;
    if (event.kind === "output") text.textContent = `${text.textContent}\n${event.text}`.trim().slice(-6000);
    else text.textContent = event.text;
    text.scrollTop = text.scrollHeight;
    if (event.kind === "browser") toast("Grok 登录页面已打开", "请在浏览器完成账号登录");
    if (event.kind === "oauth-browser") toast("Runtime OAuth 授权页已打开", "授权完成后账号会自动同步到应用");
    if (event.kind === "complete") setTimeout(async () => { stopAuthPolling(); await refreshAuthInfo(); await detectRuntime(); progress.hidden = true; toast("Grok 登录完成", authState.email || authState.name); }, 700);
    if (event.kind === "error") { stopAuthPolling(); toast("Grok 登录状态", event.text); }
  });
  renderDockTabPicker();
  renderAll();
  (async () => { await loadSavedProviders(); await loadNativeConfig(); await refreshAuthInfo(); await detectRuntime(); await refreshGitInfo(); refreshActiveDockPane(); })();
})();
