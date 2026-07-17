const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

function kindLabel(kind) {
  const value = String(kind || "").toLowerCase();
  if (value.includes("allow_once") || value === "allowonce") return "allow_once";
  if (value.includes("allow_always") || value === "allowalways") return "allow_always";
  if (value.includes("reject_once") || value === "rejectonce") return "reject_once";
  if (value.includes("reject_always") || value === "rejectalways") return "reject_always";
  return value || "other";
}

function normalizeOptions(options = []) {
  return options.map((option) => ({
    optionId: option.optionId || option.option_id || option.id || "",
    name: option.name || option.label || option.optionId || "选项",
    kind: kindLabel(option.kind)
  })).filter((option) => option.optionId);
}

function textFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text") return content.text || "";
  if (content.text) return content.text;
  return "";
}

function toolContentText(content) {
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (item?.type === "content") return textFromContent(item.content);
    return textFromContent(item);
  }).filter(Boolean).join("\n");
}

/**
 * Drive the official `grok agent stdio` ACP protocol from Electron.
 * Permissions are reverse-requests that we forward to the renderer.
 */
class AcpAgentRun extends EventEmitter {
  constructor({ binary, cwd, env, alwaysApprove, model, effort, sessionId, prompt }) {
    super();
    this.binary = binary;
    this.cwd = cwd;
    this.env = env;
    this.alwaysApprove = Boolean(alwaysApprove);
    this.model = model;
    this.effort = effort;
    this.resumeSessionId = sessionId || null;
    this.prompt = prompt;
    this.nextId = 1;
    this.pending = new Map();
    this.permissionByTool = new Map();
    this.buffer = "";
    this.sessionId = null;
    this.child = null;
    this.closed = false;
  }

  start() {
    const args = ["agent"];
    if (this.alwaysApprove) args.push("--always-approve");
    if (this.model && this.model !== "auto") args.push("--model", this.model);
    if (this.effort && this.effort !== "auto") args.push("--reasoning-effort", this.effort);
    args.push("stdio");

    this.child = spawn(this.binary, args, {
      cwd: this.cwd,
      windowsHide: true,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (text) this.emit("event", { type: "diagnostic", data: text });
    });
    this.child.on("error", (error) => {
      this.emit("event", { type: "error", message: error.message });
      this.#failAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.emit("event", { type: "process_exit", code, signal });
      this.#failAll(new Error(`agent exited (${code ?? signal})`));
    });

    this.#run().catch((error) => {
      this.emit("event", { type: "error", message: error.message || String(error) });
      this.kill();
    });

    return this.child;
  }

  respondPermission({ toolCallId, optionId, cancelled = false }) {
    const pending = this.permissionByTool.get(toolCallId);
    if (!pending) return { ok: false, error: "没有等待中的权限请求" };
    this.permissionByTool.delete(toolCallId);
    if (cancelled || !optionId) {
      this.#respond(pending.id, { outcome: { outcome: "cancelled" } });
    } else {
      this.#respond(pending.id, { outcome: { outcome: "selected", optionId: String(optionId) } });
    }
    return { ok: true };
  }

  cancel() {
    for (const [toolCallId, pending] of this.permissionByTool) {
      this.#respond(pending.id, { outcome: { outcome: "cancelled" } });
      this.permissionByTool.delete(toolCallId);
    }
    if (this.sessionId) {
      try {
        this.#notify("session/cancel", { sessionId: this.sessionId });
      } catch {}
    }
    this.kill();
  }

  kill() {
    if (!this.child || this.child.killed) return;
    try { this.child.kill(); } catch {}
  }

  async #run() {
    await this.#request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: "grok-desktop", version: "0.1.0" },
      _meta: {
        clientIdentifier: "grok-desktop",
        clientType: "grok-desktop",
        clientVersion: "0.1.0",
        startupHints: {
          nonInteractive: true,
          skipGitStatus: true,
          skipProjectLayout: true
        }
      }
    });

    if (this.resumeSessionId) {
      try {
        const loaded = await this.#request("session/load", {
          sessionId: this.resumeSessionId,
          cwd: this.cwd,
          mcpServers: []
        });
        this.sessionId = loaded?.sessionId || this.resumeSessionId;
      } catch {
        const created = await this.#request("session/new", this.#newSessionParams());
        this.sessionId = created.sessionId;
      }
    } else {
      const created = await this.#request("session/new", this.#newSessionParams());
      this.sessionId = created.sessionId;
    }

    this.emit("event", { type: "session_bound", sessionId: this.sessionId });

    const promptParams = {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: this.prompt }]
    };
    if (this.model && this.model !== "auto") {
      promptParams._meta = { ...(promptParams._meta || {}), modelId: this.model };
    }
    if (this.effort && this.effort !== "auto") {
      promptParams._meta = { ...(promptParams._meta || {}), "x.ai/reasoning_effort": this.effort };
    }

    const result = await this.#request("session/prompt", promptParams);
    this.emit("event", {
      type: "end",
      sessionId: this.sessionId,
      stopReason: result?.stopReason || result?.stop_reason || "end_turn"
    });
    this.kill();
  }

  #newSessionParams() {
    const params = { cwd: this.cwd, mcpServers: [] };
    const meta = {};
    if (this.model && this.model !== "auto") meta.modelId = this.model;
    if (Object.keys(meta).length) params._meta = meta;
    return params;
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        this.emit("event", { type: "diagnostic", data: line });
        continue;
      }
      this.#onMessage(message);
    }
  }

  #onMessage(message) {
    if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }

    if (message.method === "session/update" || message.method === "session_update") {
      this.#handleSessionUpdate(message.params || {});
      if (message.id != null) this.#respond(message.id, {});
      return;
    }

    if (message.method === "session/request_permission" || message.method === "request_permission") {
      this.#handlePermissionRequest(message);
      return;
    }

    if (message.method && message.id != null) {
      // Unknown reverse-request: acknowledge empty to avoid blocking the agent.
      this.#respond(message.id, {});
    }
  }

  #handleSessionUpdate(params) {
    const update = params.update || params;
    const type = update.sessionUpdate || update.session_update || update.type;
    if (type === "agent_message_chunk" || type === "agent_message") {
      const text = textFromContent(update.content);
      if (text) this.emit("event", { type: "text", data: text });
      return;
    }
    if (type === "agent_thought_chunk" || type === "agent_thought") {
      const text = textFromContent(update.content);
      if (text) this.emit("event", { type: "thought", data: text });
      return;
    }
    if (type === "tool_call") {
      const toolMeta = update._meta?.["x.ai/tool"] || {};
      this.emit("event", {
        type: "tool_call",
        toolCallId: update.toolCallId || update.tool_call_id,
        title: update.title || toolMeta.label || toolMeta.name || "工具调用",
        toolName: toolMeta.name || update.title || "tool",
        kind: toolMeta.kind || update.kind || "other",
        readOnly: Boolean(toolMeta.read_only),
        input: update.rawInput || update.raw_input || null,
        timestamp: Date.now()
      });
      return;
    }
    if (type === "tool_call_update") {
      const toolMeta = update._meta?.["x.ai/tool"] || {};
      const rawOutput = update.rawOutput || update.raw_output || {};
      const content = toolContentText(update.content);
      const output = rawOutput.output_for_prompt || content || rawOutput.output || "";
      this.emit("event", {
        type: "tool_update",
        toolCallId: update.toolCallId || update.tool_call_id,
        title: update.title || toolMeta.label || null,
        toolName: toolMeta.name || null,
        kind: update.kind || toolMeta.kind || null,
        status: update.status || null,
        input: update.rawInput || update.raw_input || toolMeta.input || null,
        output: typeof output === "string" ? output.slice(-40_000) : JSON.stringify(output).slice(-40_000),
        exitCode: rawOutput.exit_code,
        currentDir: rawOutput.current_dir,
        description: rawOutput.description || null,
        locations: update.locations || null,
        timestamp: Date.now()
      });
    }
  }

  #handlePermissionRequest(message) {
    const params = message.params || {};
    const toolCall = params.toolCall || params.tool_call || {};
    const toolCallId = toolCall.toolCallId || toolCall.tool_call_id || `perm-${message.id}`;
    const options = normalizeOptions(params.options || []);
    this.permissionByTool.set(toolCallId, { id: message.id, options });
    this.emit("event", {
      type: "permission_prompt",
      toolCallId,
      sessionId: params.sessionId || params.session_id || this.sessionId,
      title: toolCall.title || toolCall.fields?.title || "工具调用",
      options
    });
    this.emit("event", {
      type: "lifecycle",
      event: { type: "permission_requested", tool_name: toolCall.title || toolCallId }
    });
  }

  #request(method, params) {
    if (this.closed) return Promise.reject(new Error("agent already closed"));
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  #notify(method, params) {
    if (this.closed || !this.child?.stdin) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  #respond(id, result) {
    if (this.closed || !this.child?.stdin) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  #failAll(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

module.exports = { AcpAgentRun };
