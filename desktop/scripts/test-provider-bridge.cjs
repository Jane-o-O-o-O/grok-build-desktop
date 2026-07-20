const assert = require("node:assert/strict");
const {
  createProviderBridge,
  inferToolName,
  normalizeChatCompletion,
  normalizeChatRequest
} = require("../provider-bridge.cjs");

const tools = [
  { type: "function", function: { name: "run_terminal_command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } },
  { type: "function", function: { name: "list_dir", parameters: { type: "object", properties: { target_directory: { type: "string" } }, required: ["target_directory"], additionalProperties: false } } }
];

(async () => {
  assert.equal(inferToolName('{"command":"pwd"}', tools), "run_terminal_command");
  assert.equal(inferToolName('{"target_directory":"."}', tools), "list_dir");

  const normalized = normalizeChatCompletion({
    choices: [{ index: 0, message: { role: "assistant", tool_calls: [{ id: "call_fixture", type: "function", function: { name: "", arguments: '{"command":"pwd"}' } }] } }]
  }, tools);
  assert.equal(normalized.choices[0].message.tool_calls[0].function.name, "run_terminal_command");
  assert.deepEqual(
    normalizeChatRequest({ stream: true, stream_options: { include_usage: true } }),
    { stream: true, stream_options: { include_usage: true } }
  );
  assert.deepEqual(
    normalizeChatRequest({ stream: true, stream_options: { include_usage: true } }, { forceNonStreaming: true }),
    { stream: false }
  );
  assert.deepEqual(
    normalizeChatRequest({ stream: false, stream_options: { include_usage: true } }),
    { stream: false }
  );

  let upstreamRequest = null;
  const bridge = createProviderBridge({
    resolveProvider: () => ({ provider: { id: "provider-fixture", baseUrl: "https://upstream.invalid/v1", protocol: "openai" }, apiKey: "sk-fixture" }),
    fetchImpl: async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        id: "chatcmpl_fixture",
        model: "fixture-model",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "call_fixture", type: "function", function: { name: "", arguments: '{"command":"pwd"}' } }] } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await bridge.start();
  try {
    const response = await fetch(`${bridge.baseUrlFor("provider-fixture")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "run pwd" }], tools, stream: true, stream_options: { include_usage: true } })
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(upstreamRequest.url, "https://upstream.invalid/v1/chat/completions");
    assert.equal(upstreamRequest.body.stream, false);
    assert.equal("stream_options" in upstreamRequest.body, false);
    assert.equal(upstreamRequest.init.headers.accept, "application/json");
    assert.equal(upstreamRequest.init.headers.authorization, "Bearer sk-fixture");
    assert.match(body, /run_terminal_command/);
    assert.match(body, /data: \[DONE\]/);
  } finally {
    await bridge.stop();
  }
  console.log("Provider bridge tool-name repair and non-streaming compatibility verified.");
})().catch((error) => { console.error(error); process.exit(1); });
