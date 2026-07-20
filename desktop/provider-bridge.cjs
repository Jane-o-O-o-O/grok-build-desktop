const crypto = require("node:crypto");
const http = require("node:http");

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

function jsonArguments(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return null; }
}

function toolDefinition(tool) {
  if (tool?.type === "function" && tool.function) return tool.function;
  if (tool?.name) return { name: tool.name, parameters: tool.input_schema || tool.parameters || {} };
  return null;
}

function argumentsMatchSchema(args, schema = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => !(key in args))) return false;
  const keys = Object.keys(args);
  if (schema.additionalProperties === false && keys.some((key) => !(key in properties))) return false;
  return keys.every((key) => !Object.keys(properties).length || key in properties);
}

function inferToolName(rawArguments, tools = []) {
  const args = jsonArguments(rawArguments);
  if (!args) return null;
  const matches = tools
    .map(toolDefinition)
    .filter(Boolean)
    .filter((tool) => argumentsMatchSchema(args, tool.parameters || {}));
  return matches.length === 1 ? matches[0].name : null;
}

function normalizeToolCall(call, tools) {
  const source = call?.function || call || {};
  const rawArguments = source.arguments ?? call?.arguments ?? {};
  const requestedName = String(source.name || call?.name || "").trim();
  const knownNames = new Set(tools.map(toolDefinition).filter(Boolean).map((tool) => tool.name));
  const name = (knownNames.has(requestedName) ? requestedName : "") || inferToolName(rawArguments, tools);
  return {
    ...call,
    id: call?.id || `call_${crypto.randomBytes(12).toString("hex")}`,
    type: "function",
    function: {
      name: name || "",
      arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments)
    }
  };
}

function normalizeChatCompletion(body, tools = []) {
  if (!body || !Array.isArray(body.choices)) return body;
  return {
    ...body,
    choices: body.choices.map((choice) => {
      const message = choice?.message;
      if (!message) return choice;
      let calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length && message.function_call) calls = [message.function_call];
      if (!calls.length) return choice;
      const toolCalls = calls.map((call) => normalizeToolCall(call, tools));
      return {
        ...choice,
        finish_reason: choice.finish_reason || "tool_calls",
        message: { ...message, tool_calls: toolCalls }
      };
    })
  };
}

function normalizeChatRequest(body, { forceNonStreaming = false } = {}) {
  const normalized = { ...(body || {}) };
  if (forceNonStreaming) normalized.stream = false;
  if (normalized.stream !== true) delete normalized.stream_options;
  return normalized;
}

function chatCompletionSse(body) {
  const id = body.id || `chatcmpl_${crypto.randomBytes(10).toString("hex")}`;
  const created = Number(body.created) || Math.floor(Date.now() / 1000);
  const model = body.model || "custom-model";
  const events = [];
  for (const choice of body.choices || []) {
    const index = Number(choice.index) || 0;
    const message = choice.message || {};
    events.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index, delta: { role: "assistant" }, finish_reason: null }] });
    if (message.content) events.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index, delta: { content: message.content }, finish_reason: null }] });
    for (const [toolIndex, call] of (message.tool_calls || []).entries()) {
      events.push({
        id, object: "chat.completion.chunk", created, model,
        choices: [{ index, delta: { tool_calls: [{ index: toolIndex, id: call.id, type: "function", function: call.function }] }, finish_reason: null }]
      });
    }
    events.push({ id, object: "chat.completion.chunk", created, model, choices: [{ index, delta: {}, finish_reason: choice.finish_reason || (message.tool_calls?.length ? "tool_calls" : "stop") }] });
  }
  if (body.usage) events.push({ id, object: "chat.completion.chunk", created, model, choices: [], usage: body.usage });
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

function endpointUrl(baseUrl, endpoint) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  const suffix = endpoint === "chat/completions" ? "chat/completions" : endpoint;
  return `${clean}/${suffix}`;
}

function responseHeaders(response, bodyLength) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers["content-length"] = Buffer.byteLength(bodyLength);
  return headers;
}

function streamingResponseHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  return headers;
}

function waitForDrainOrClose(response) {
  return new Promise((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      response.off("error", done);
      resolve();
    };
    response.once("drain", done);
    response.once("close", done);
    response.once("error", done);
  });
}

async function pipeStreamingResponse(upstream, response) {
  response.writeHead(upstream.status, streamingResponseHeaders(upstream));
  if (!upstream.body) { response.end(); return; }
  const reader = upstream.body.getReader();
  const cancelUpstream = () => { void reader.cancel(); };
  response.once("close", cancelUpstream);
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await waitForDrainOrClose(response);
    }
    if (response.destroyed) await reader.cancel();
    else response.end();
  } catch (error) {
    if (!response.destroyed) response.destroy(error);
  } finally {
    response.off("close", cancelUpstream);
    reader.releaseLock();
  }
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function createProviderBridge({ resolveProvider, fetchImpl = globalThis.fetch, host = "127.0.0.1", port = 0 } = {}) {
  if (typeof resolveProvider !== "function") throw new Error("resolveProvider is required");
  const token = crypto.randomBytes(18).toString("hex");
  let server = null;
  let address = null;

  const handle = async (request, response) => {
    try {
      if (request.method !== "POST") { response.writeHead(405).end("Method Not Allowed"); return; }
      const url = new URL(request.url, `http://${host}`);
      const match = url.pathname.match(new RegExp(`^/${token}/provider/([^/]+)/(?:v1/)?(chat/completions|responses|messages)$`));
      if (!match) { response.writeHead(404).end("Not Found"); return; }
      const providerId = decodeURIComponent(match[1]);
      const endpoint = match[2];
      const resolved = resolveProvider(providerId);
      if (!resolved?.provider || !resolved.apiKey) { response.writeHead(401).end("Provider credentials unavailable"); return; }

      const raw = await readRequest(request);
      const incoming = JSON.parse(raw || "{}");
      const hasTools = Array.isArray(incoming.tools) && incoming.tools.length > 0;
      const model = resolved.provider.models?.find((item) => item.id === incoming.model || item.localId === incoming.model);
      const needsToolRepair = endpoint === "chat/completions" && hasTools && model?.toolCapability === "bridge";
      const upstreamBody = endpoint === "chat/completions"
        ? normalizeChatRequest(incoming, { forceNonStreaming: needsToolRepair })
        : incoming;
      const headers = {
        "content-type": "application/json",
        accept: upstreamBody.stream ? "text/event-stream, application/json" : "application/json"
      };
      if (resolved.provider.protocol === "anthropic") {
        headers["x-api-key"] = resolved.apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else headers.authorization = `Bearer ${resolved.apiKey}`;

      const upstream = await fetchImpl(endpointUrl(resolved.provider.baseUrl, endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(120_000)
      });
      if (upstream.ok && upstreamBody.stream === true && !needsToolRepair) {
        await pipeStreamingResponse(upstream, response);
        return;
      }
      let output = await upstream.text();
      let contentType = upstream.headers.get("content-type") || "application/json";
      if (upstream.ok && needsToolRepair) {
        let parsed;
        try { parsed = normalizeChatCompletion(JSON.parse(output), incoming.tools); } catch { parsed = null; }
        if (parsed) {
          const missingName = parsed.choices?.some((choice) => choice.message?.tool_calls?.some((call) => !call.function?.name));
          if (missingName) {
            response.writeHead(502, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: { message: "第三方模型返回了无法唯一识别的工具调用" } }));
            return;
          }
          if (incoming.stream) {
            output = chatCompletionSse(parsed);
            contentType = "text/event-stream; charset=utf-8";
          } else output = JSON.stringify(parsed);
        }
      }
      response.writeHead(upstream.status, { ...responseHeaders(upstream, output), "content-type": contentType });
      response.end(output);
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `第三方模型桥接失败：${error.message}` } }));
    }
  };

  return {
    async start() {
      if (server) return address;
      server = http.createServer(handle);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      const info = server.address();
      address = `http://${host}:${info.port}/${token}`;
      return address;
    },
    baseUrlFor(providerId) {
      if (!address) throw new Error("Provider bridge is not running");
      return `${address}/provider/${encodeURIComponent(providerId)}/v1`;
    },
    async stop() {
      if (!server) return;
      const active = server; server = null; address = null;
      await new Promise((resolve) => active.close(resolve));
    }
  };
}

module.exports = {
  argumentsMatchSchema,
  chatCompletionSse,
  createProviderBridge,
  inferToolName,
  normalizeChatCompletion,
  normalizeChatRequest
};
