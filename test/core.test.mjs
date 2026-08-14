import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  TransientToolStore,
  dedupeCompatibilityAliases,
  estimateTokens,
  registerTransientTools,
  resetSharedTransientToolStoreForTests,
  renderInteraction,
  resolveConfig,
  transformMessageForPersistence
} from "../core.js";

test("defaults are 200 interactions, 40k aggregate, 2k per interaction", () => {
  const config = resolveConfig({});
  assert.equal(config.maxInteractions, 200);
  assert.equal(config.maxTransientTokens, 40_000);
  assert.equal(config.maxInteractionTokens, 2_000);
  assert.equal(config.persistToolHistory, false);
  assert.equal(config.dedupeAliases, true);
  assert.equal(config.injectSameModel, false);
});

test("per-interaction rendering is bounded to 2k estimated tokens", () => {
  const rendered = renderInteraction(
    {
      toolName: "browser",
      toolCallId: "call-1",
      params: { url: "https://example.test" },
      result: "x".repeat(50_000)
    },
    2_000
  );
  assert.equal(rendered.truncated, true);
  assert.ok(rendered.tokens <= 2_000, `tokens=${rendered.tokens}`);
  assert.match(rendered.text, /transient carry-forward truncated/);
});

test("compatibility aliases are removed only when exactly equivalent", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "toolCall", name: "exec", arguments: { a: 1 }, input: { a: 1 } },
      { type: "toolCall", name: "exec", arguments: { a: 1 }, input: { a: 2 } }
    ]
  };
  const deduped = dedupeCompatibilityAliases(message);
  assert.equal("input" in deduped.content[0], false);
  assert.equal("input" in deduped.content[1], true);
});

test("tool-result aliases dedupe when text and content match", () => {
  const deduped = dedupeCompatibilityAliases({
    role: "toolResult",
    content: [{ type: "toolResult", text: "hello", content: "hello" }]
  });
  assert.equal("content" in deduped.content[0], false);
  assert.equal(deduped.content[0].text, "hello");
});

test("toolResult persistence is blocked when transient mode is active", () => {
  const result = transformMessageForPersistence(
    { role: "toolResult", content: [{ type: "toolResult", text: "ok" }] },
    DEFAULT_CONFIG
  );
  assert.equal(result.block, true);
});

test("tool-call-only assistant rows are blocked", () => {
  const result = transformMessageForPersistence(
    { role: "assistant", content: [{ type: "toolCall", name: "exec", arguments: {} }] },
    DEFAULT_CONFIG
  );
  assert.equal(result.block, true);
});

test("mixed assistant rows keep visible text but strip tool calls", () => {
  const result = transformMessageForPersistence(
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking that now." },
        { type: "toolCall", name: "exec", arguments: { command: "pwd" } }
      ]
    },
    DEFAULT_CONFIG
  );
  assert.equal(result.block, false);
  assert.deepEqual(result.message.content, [{ type: "text", text: "Checking that now." }]);
});

test("ring retains only the configured interaction count", () => {
  const store = new TransientToolStore({ maxInteractions: 3, injectSameModel: true });
  store.rememberRun("run", "openai/model");
  for (let i = 0; i < 5; i += 1) {
    store.capture(
      "id:session",
      { toolName: "exec", toolCallId: `call-${i}`, params: { i }, result: `result-${i}` },
      "run"
    );
  }
  const state = store.stateFor("id:session", false);
  assert.equal(state.interactions.length, 3);
  assert.equal(state.interactions[0].toolCallId, "call-2");
  assert.equal(state.interactions[2].toolCallId, "call-4");
});

test("aggregate context budget keeps newest interactions first", () => {
  const store = new TransientToolStore({
    maxInteractions: 200,
    maxTransientTokens: 1_000,
    maxInteractionTokens: 600,
    injectSameModel: true
  });
  store.rememberRun("run", "openai/model");
  for (let i = 0; i < 5; i += 1) {
    store.capture(
      "id:session",
      {
        toolName: "exec",
        toolCallId: `call-${i}`,
        params: { i },
        result: `${i}:`.repeat(1_100)
      },
      "run"
    );
  }
  const context = store.buildContext("id:session", "openai/model");
  assert.ok(context.estimatedTokens <= 1_000);
  assert.match(context.text, /call-4/);
});

test("same-model interactions are omitted by default but cross-model tools bridge", () => {
  const store = new TransientToolStore({ injectSameModel: false });
  store.rememberRun("sol-run", "openai/gpt-sol");
  store.capture(
    "id:session",
    { toolName: "exec", toolCallId: "sol-tool", params: {}, result: "sol-result" },
    "sol-run"
  );
  assert.equal(store.buildContext("id:session", "openai/gpt-sol"), undefined);
  const luna = store.buildContext("id:session", "openai/gpt-luna");
  assert.match(luna.text, /sol-result/);
});

test("plugin hooks capture tools, bridge cross-model context, and block tool persistence", async () => {
  const hooks = new Map();
  const api = {
    pluginConfig: {},
    logger: { info: () => undefined },
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerTool() {}
  };
  registerTransientTools(api);
  assert.deepEqual(
    [...hooks.keys()].sort(),
    ["after_tool_call", "before_message_write", "before_prompt_build", "gateway_stop", "session_end"].sort()
  );

  await hooks.get("before_prompt_build")(
    { prompt: "first", messages: [] },
    { runId: "run-sol", sessionId: "s1", modelProviderId: "openai", modelId: "gpt-sol" }
  );
  await hooks.get("after_tool_call")(
    { toolName: "exec", toolCallId: "c1", runId: "run-sol", params: { command: "echo hi" }, result: "hi" },
    { runId: "run-sol", sessionId: "s1" }
  );

  const same = await hooks.get("before_prompt_build")(
    { prompt: "same", messages: [] },
    { runId: "run-sol-2", sessionId: "s1", modelProviderId: "openai", modelId: "gpt-sol" }
  );
  assert.equal(same, undefined);

  const cross = await hooks.get("before_prompt_build")(
    { prompt: "switch", messages: [] },
    { runId: "run-luna", sessionId: "s1", modelProviderId: "openai", modelId: "gpt-luna" }
  );
  assert.match(cross.prependContext, /echo hi/);
  assert.match(cross.prependContext, /\bhi\b/);

  const blocked = await hooks.get("before_message_write")({
    message: { role: "toolResult", content: [{ type: "toolResult", text: "hi" }] }
  });
  assert.deepEqual(blocked, { block: true });
});


test("duplicate tool call ids are captured only once", () => {
  const store = new TransientToolStore({ injectSameModel: true });
  store.rememberRun("run", "openai/model");
  const event = { toolName: "exec", toolCallId: "same-call", params: {}, result: "one" };
  store.capture("id:session", event, "run");
  store.capture("id:session", { ...event, result: "duplicate" }, "run");
  const state = store.stateFor("id:session", false);
  assert.equal(state.interactions.length, 1);
  assert.match(state.interactions[0].text, /one/);
});

test("persistToolHistory keeps rows but still deduplicates exact aliases", () => {
  const config = resolveConfig({ persistToolHistory: true });
  const result = transformMessageForPersistence(
    {
      role: "assistant",
      content: [{ type: "toolCall", arguments: { x: 1 }, input: { x: 1 } }]
    },
    config
  );
  assert.equal(result.block, false);
  assert.equal("input" in result.message.content[0], false);
});

test("compaction without rotation keeps transient state; rotated compaction can migrate it", () => {
  const store = new TransientToolStore({ injectSameModel: true });
  store.rememberRun("run", "openai/model");
  store.capture(
    "id:old",
    { toolName: "exec", toolCallId: "c", params: {}, result: "kept" },
    "run"
  );
  assert.ok(store.stateFor("id:old", false));
  store.migrateSession("id:old", "id:new");
  assert.equal(store.stateFor("id:old", false), undefined);
  assert.match(store.buildContext("id:new", "other/model").text, /kept/);
});

test("token estimator remains bounded and positive", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcdefgh"), 2);
  assert.ok(estimateTokens("日本語") >= 3);
});

test("diagnostic snapshot exposes capture and context decisions", () => {
  const store = new TransientToolStore({ injectSameModel: false });
  store.rememberRun("sol-run", "openai/gpt-sol");
  store.notePromptBuild("id:s1", "sol-run", "openai/gpt-sol");
  store.capture(
    "id:s1",
    { toolName: "exec", toolCallId: "proof-call", params: { command: "echo 123456" }, result: "123456" },
    "sol-run"
  );
  assert.equal(store.buildContext("id:s1", "openai/gpt-sol"), undefined);
  const cross = store.buildContext("id:s1", "openai/gpt-luna");
  assert.match(cross.text, /123456/);
  const snapshot = store.diagnosticSnapshot();
  assert.equal(snapshot.counters.captureAttempts, 1);
  assert.equal(snapshot.counters.captured, 1);
  assert.equal(snapshot.counters.contextsBuilt, 1);
  assert.equal(snapshot.counters.sameModelSkipped, 1);
  assert.equal(snapshot.sessions[0].interactions[0].toolCallId, "proof-call");
  assert.ok(snapshot.recentEvents.some((event) => event.type === "context_not_built"));
  assert.ok(snapshot.recentEvents.some((event) => event.type === "context_built"));
});

test("plugin registers the live-ring diagnostic agent tool", async () => {
  const hooks = new Map();
  let tool;
  let toolOptions;
  const api = {
    pluginConfig: {},
    logger: { info: () => undefined },
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerTool(definition, options) {
      tool = definition;
      toolOptions = options;
    }
  };
  registerTransientTools(api);
  assert.equal(tool.name, "transient_tools_dump");
  assert.equal(typeof tool.execute, "function");
  assert.equal(tool.parameters.type, "object");
  assert.deepEqual(toolOptions, { optional: false });
});

test("diagnostic dump tool is not captured into the transient ring", () => {
  const store = new TransientToolStore({ injectSameModel: true });
  store.rememberRun("run", "openai/model");
  store.capture(
    "id:session",
    { toolName: "transient_tools_dump", toolCallId: "dump-call", params: {}, result: "path" },
    "run"
  );
  assert.equal(store.stateFor("id:session", false), undefined);
  assert.equal(store.diagnosticSnapshot().counters.captured, 0);
});


test("repeated plugin registrations share one process-global store", async () => {
  resetSharedTransientToolStoreForTests();
  const hooksA = new Map();
  const hooksB = new Map();
  const makeApi = (hooks) => ({
    pluginConfig: {},
    logger: { info: () => undefined },
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerTool() {}
  });

  const storeA = registerTransientTools(makeApi(hooksA));
  const storeB = registerTransientTools(makeApi(hooksB));
  assert.equal(storeA, storeB);

  await hooksA.get("before_prompt_build")(
    { prompt: "sol", messages: [] },
    { runId: "shared-sol", sessionId: "shared", modelProviderId: "openai", modelId: "gpt-sol" }
  );
  await hooksA.get("after_tool_call")(
    { toolName: "exec", toolCallId: "shared-call", runId: "shared-sol", params: {}, result: "654321" },
    { runId: "shared-sol", sessionId: "shared" }
  );

  const snapshot = storeB.diagnosticSnapshot();
  assert.equal(snapshot.counters.registrations, 2);
  assert.equal(snapshot.counters.promptBuilds, 1);
  assert.equal(snapshot.counters.captured, 1);
  assert.match(snapshot.sessions[0].interactions[0].text, /654321/);
  resetSharedTransientToolStoreForTests();
});

test("Codex transcript persistence fallback captures a blocked tool pair into the shared ring", async () => {
  resetSharedTransientToolStoreForTests();
  const hooks = new Map();
  const api = {
    pluginConfig: {},
    logger: { info: () => undefined },
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerTool() {}
  };
  const store = registerTransientTools(api);

  await hooks.get("before_prompt_build")(
    { prompt: "run proof", messages: [] },
    {
      runId: "run-sol",
      sessionId: "physical-1",
      sessionKey: "agent:main:discord:channel:proof"
    }
  );

  const blockedCall = hooks.get("before_message_write")(
    {
      sessionKey: "agent:main:discord:channel:proof",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5.6-sol",
        content: [
          {
            type: "toolCall",
            id: "exec-proof",
            name: "bash",
            arguments: { command: "Write-Output 483921" }
          }
        ]
      }
    },
    { sessionKey: "agent:main:discord:channel:proof" }
  );
  assert.deepEqual(blockedCall, { block: true });

  const blockedResult = hooks.get("before_message_write")(
    {
      sessionKey: "agent:main:discord:channel:proof",
      message: {
        role: "toolResult",
        toolCallId: "exec-proof",
        toolName: "bash",
        isError: false,
        content: [
          {
            type: "toolResult",
            id: "exec-proof",
            toolCallId: "exec-proof",
            toolName: "bash",
            text: "483921"
          }
        ]
      }
    },
    { sessionKey: "agent:main:discord:channel:proof" }
  );
  assert.deepEqual(blockedResult, { block: true });

  const next = await hooks.get("before_prompt_build")(
    { prompt: "what was it", messages: [] },
    {
      runId: "run-luna",
      sessionId: "physical-1",
      sessionKey: "agent:main:discord:channel:proof"
    }
  );
  assert.match(next.prependContext, /483921/);
  assert.match(next.prependContext, /Write-Output 483921/);

  const snapshot = store.diagnosticSnapshot();
  assert.equal(snapshot.counters.persistenceToolCallsSeen, 1);
  assert.equal(snapshot.counters.persistenceToolResultsSeen, 1);
  assert.equal(snapshot.counters.persistenceCaptures, 1);
  assert.equal(snapshot.counters.captured, 1);
  assert.equal(snapshot.sessions[0].ref, "key:agent:main:discord:channel:proof");
  assert.equal(snapshot.sessions[0].interactionCount, 1);
  resetSharedTransientToolStoreForTests();
});

test("Codex mirror rows without hook sessionKey correlate through the mirrored user scope", async () => {
  resetSharedTransientToolStoreForTests();
  const hooks = new Map();
  const api = {
    pluginConfig: {},
    logger: { info: () => undefined },
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerTool() {}
  };
  const store = registerTransientTools(api);
  const sessionKey = "agent:main:discord:default:direct:417040269712687105";
  const scope = "019ff8a4-106a-75a2-a03d-a1003f70d5b0";
  const userText = "Generate the hidden six digit proof number.";

  await hooks.get("before_prompt_build")(
    { prompt: `[Discord inbound]\n${userText}\n[/Discord inbound]`, messages: [] },
    { runId: "run-sol", sessionId: "physical-1", sessionKey, agentId: "main" }
  );

  hooks.get("before_message_write")(
    {
      message: {
        role: "user",
        content: userText,
        idempotencyKey: `codex-app-server:${scope}:turn-proof:prompt`
      }
    },
    { agentId: "main" }
  );

  assert.deepEqual(
    hooks.get("before_message_write")(
      {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.6-sol",
          idempotencyKey: `codex-app-server:${scope}:turn-proof:tool:exec-proof:call`,
          content: [
            {
              type: "toolCall",
              id: "exec-proof",
              name: "bash",
              arguments: { command: "Write-Output 711312" }
            }
          ]
        }
      },
      { agentId: "main" }
    ),
    { block: true }
  );

  assert.deepEqual(
    hooks.get("before_message_write")(
      {
        message: {
          role: "toolResult",
          toolCallId: "exec-proof",
          toolName: "bash",
          isError: false,
          idempotencyKey: `codex-app-server:${scope}:turn-proof:tool:exec-proof:result`,
          content: [
            {
              type: "toolResult",
              id: "exec-proof",
              toolCallId: "exec-proof",
              toolName: "bash",
              text: "711312"
            }
          ]
        }
      },
      { agentId: "main" }
    ),
    { block: true }
  );

  const next = await hooks.get("before_prompt_build")(
    { prompt: "What number was it?", messages: [] },
    { runId: "run-luna", sessionId: "physical-1", sessionKey, agentId: "main" }
  );
  assert.match(next.prependContext, /711312/);

  const snapshot = store.diagnosticSnapshot();
  assert.equal(snapshot.counters.persistenceRefsCorrelated, 1);
  assert.equal(snapshot.counters.persistenceCaptures, 1);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].ref, `key:${sessionKey}`);
  assert.match(snapshot.sessions[0].interactions[0].text, /711312/);
  resetSharedTransientToolStoreForTests();
});
