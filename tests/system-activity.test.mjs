import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { WebSocket } from "ws";

import { createTutorServerApp } from "../.tmp-test/server.mjs";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const startApp = async () => {
  const { app } = await createTutorServerApp({ serveClient: false });
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const startVoiceApp = async () => {
  const { app, attachWebSockets } = await createTutorServerApp({
    serveClient: false,
    voiceProvider: "mock",
  });
  const server = app.listen(0);
  attachWebSockets(server);
  await once(server, "listening");
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/api/voice-agent?language=en`,
    brokerWsUrl: `ws://127.0.0.1:${port}/api/voice-broker?language=en`,
  };
};

const readActivity = async (baseUrl, headers = {}) => {
  const response = await originalFetch(`${baseUrl}/api/debug/system-activity`, {
    cache: "no-store",
    headers,
  });
  assert.equal(response.status, 200);
  return response.json();
};

const parseSseEvents = (streamText) =>
  streamText
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      assert.match(chunk, /^data: /);
      return JSON.parse(chunk.replace(/^data: /, ""));
    });

const startMisoHealthServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, modelLoaded: true }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const startMisoSpeechServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, modelLoaded: true }));
      return;
    }
    if (req.url === "/v1/audio/speech" && req.method === "POST") {
      res.setHeader("Content-Type", "audio/wav");
      res.end(Buffer.from("RIFFmock-wav"));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const waitForActivity = async (baseUrl, predicate) => {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const body = await readActivity(baseUrl);
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readActivity(baseUrl);
};

test("system activity endpoint exposes local ledger metadata", async (t) => {
  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const body = await readActivity(baseUrl);

  assert.equal(body.ok, true);
  assert.equal(body.localOnly, true);
  assert.equal(body.retention.limit, 250);
  assert.equal(body.summary.retentionLimit, 250);
  assert.ok(body.summary.total >= 1);
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.some((event) => event.kind === "system"));
  assert.equal(body.meters.graph.codeArchitecture, "Graphify");
  assert.equal(typeof body.meters.providers.misoTts, "boolean");
  assert.equal(body.meters.providerDetails.misoTts.configured, true);
});

test("public health reports server provider readiness without exposing keys", async (t) => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousOpenRouterFallback =
    process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  process.env.OPENROUTER_API_KEY = "openrouter-health-secret";
  process.env.ALLOW_SERVER_OPENROUTER_FALLBACK = "true";
  process.env.DEEPGRAM_API_KEY = "deepgram-health-secret";
  process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = "true";
  t.after(() => {
    if (previousOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    }
    if (previousOpenRouterFallback === undefined) {
      delete process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_OPENROUTER_FALLBACK = previousOpenRouterFallback;
    }
    if (previousDeepgramKey === undefined) {
      delete process.env.DEEPGRAM_API_KEY;
    } else {
      process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    }
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await originalFetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(body.providers.openRouter, true);
  assert.equal(body.providers.openRouterByok, true);
  assert.equal(body.providers.deepgram, true);
  assert.doesNotMatch(responseText, /openrouter-health-secret/);
  assert.doesNotMatch(responseText, /deepgram-health-secret/);
});

test("public health keeps server provider keys disabled without explicit sharing flags", async (t) => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousOpenRouterFallback =
    process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  process.env.OPENROUTER_API_KEY = "openrouter-disabled-secret";
  process.env.DEEPGRAM_API_KEY = "deepgram-disabled-secret";
  delete process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
  delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  t.after(() => {
    if (previousOpenRouterKey === undefined)
      delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousOpenRouterFallback === undefined) {
      delete process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_OPENROUTER_FALLBACK = previousOpenRouterFallback;
    }
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await originalFetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(body.providers.openRouter, false);
  assert.equal(body.providers.deepgram, false);
});

test("Deepgram server fallback and query keys stay disabled without explicit sharing", async (t) => {
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  process.env.DEEPGRAM_API_KEY = "deepgram-disabled-secret";
  delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  let providerCalled = false;
  globalThis.fetch = async () => {
    providerCalled = true;
    throw new Error("Provider fetch must stay blocked");
  };
  t.after(() => {
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await originalFetch(
    `${baseUrl}/api/tts?deepgramKey=query-secret`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "This must stay offline.",
        voice: "aura-asteria-en",
      }),
    },
  );
  const responseText = await response.text();

  assert.equal(response.status, 503);
  assert.match(responseText, /Deepgram API Key is missing/);
  assert.match(responseText, /PROVIDER_KEY_MISSING/);
  assert.equal(providerCalled, false);
  assert.doesNotMatch(responseText, /deepgram-disabled-secret|query-secret/);
});

test("OpenRouter server fallback routes the environment key upstream without exposing it", async (t) => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousOpenRouterFallback =
    process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
  process.env.OPENROUTER_API_KEY = "openrouter-shared-secret";
  process.env.ALLOW_SERVER_OPENROUTER_FALLBACK = "true";
  const upstreamRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (!target.includes("openrouter.ai/api/v1/chat/completions")) {
      throw new Error(`Unexpected fetch: ${target}`);
    }
    upstreamRequests.push({
      url: target,
      authorization: new Headers(init.headers).get("authorization"),
    });
    return new Response(
      [
        'data: {"id":"chatcmpl-local","choices":[{"index":0,"delta":{"content":"Shared fallback works."},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-local","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  };
  t.after(() => {
    if (previousOpenRouterKey === undefined)
      delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousOpenRouterFallback === undefined) {
      delete process.env.ALLOW_SERVER_OPENROUTER_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_OPENROUTER_FALLBACK = previousOpenRouterFallback;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await originalFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "chat-shared-fallback-test",
      messages: [{ role: "user", content: "Use the shared server fallback." }],
      aiModel: "deepseek/deepseek-v4-flash",
    }),
  });
  const responseText = await response.text();

  assert.equal(response.status, 200);
  assert.match(responseText, /Shared fallback works\./);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(
    upstreamRequests[0].authorization,
    "Bearer openrouter-shared-secret",
  );
  assert.doesNotMatch(responseText, /openrouter-shared-secret/);
});

test("system activity marks MisoTTS reachable when the local API health endpoint responds", async (t) => {
  const previousMisoUrl = process.env.MISO_TTS_API_URL;
  const miso = await startMisoHealthServer();
  process.env.MISO_TTS_API_URL = miso.baseUrl;
  t.after(() => {
    miso.server.close();
    if (previousMisoUrl === undefined) {
      delete process.env.MISO_TTS_API_URL;
    } else {
      process.env.MISO_TTS_API_URL = previousMisoUrl;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const body = await readActivity(baseUrl);

  assert.equal(body.meters.providers.misoTts, true);
  assert.equal(body.meters.providerDetails.misoTts.configured, true);
  assert.equal(body.meters.providerDetails.misoTts.reachable, true);
  assert.equal(body.meters.providerDetails.misoTts.status, 200);
});

test("system activity uses a browser-provided MisoTTS API URL override", async (t) => {
  const previousMisoUrl = process.env.MISO_TTS_API_URL;
  delete process.env.MISO_TTS_API_URL;
  const miso = await startMisoHealthServer();
  t.after(() => {
    miso.server.close();
    if (previousMisoUrl === undefined) {
      delete process.env.MISO_TTS_API_URL;
    } else {
      process.env.MISO_TTS_API_URL = previousMisoUrl;
    }
  });

  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const body = await readActivity(baseUrl, {
    "x-miso-tts-api-url": miso.baseUrl,
  });

  assert.equal(body.meters.providers.misoTts, true);
  assert.equal(body.meters.providerDetails.misoTts.configured, true);
  assert.equal(body.meters.providerDetails.misoTts.reachable, true);
  assert.equal(body.meters.providerDetails.misoTts.status, 200);
});

test("blocked chat requests are recorded without live model calls", async (t) => {
  const { server, baseUrl } = await startApp();
  t.after(() => server.close());
  const requestId = "chat-blocked-sse-test-1";

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      messages: [{ role: "user", content: "Explain local observability." }],
      aiModel: "deepseek/deepseek-v4-flash",
    }),
  });

  assert.equal(response.status, 200);
  const streamText = await response.text();
  assert.match(streamText, /OpenRouter API key is required/);
  assert.match(streamText, /"type":"model_run"/);
  assert.match(streamText, /"status":"blocked"/);
  assert.match(streamText, /"requestedModel":"deepseek\/deepseek-v4-flash"/);
  const events = parseSseEvents(streamText);
  assert.deepEqual(
    events.map((event) => event.type),
    ["model_run", "error"],
  );
  assert.equal(events[0].requestId, requestId);
  assert.equal(events[0].status, "blocked");
  assert.equal(events[0].metadata.messageCount, 1);
  assert.equal(events[1].requestId, requestId);
  assert.match(events[1].error, /^OpenRouter API key is required/);

  const body = await readActivity(baseUrl);
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "model" &&
        event.status === "blocked" &&
        event.title === "Chat request blocked",
    ),
  );
  const blockedEvent = body.events.find(
    (event) =>
      event.kind === "model" &&
      event.status === "blocked" &&
      event.title === "Chat request blocked",
  );
  assert.equal(blockedEvent.requestId, requestId);
  assert.equal(blockedEvent.metadata.messageCount, 1);
  assert.equal(
    body.events.some(
      (event) =>
        event.kind === "model" &&
        event.status === "started" &&
        event.requestId === requestId,
    ),
    false,
  );
});

test("mock voice websocket records a local tool-call loop", async (t) => {
  const { server, baseUrl, wsUrl } = await startVoiceApp();
  t.after(() => server.close());
  const proofAttemptId = "beta-proof-voice-test";
  const hasVoiceProofMetadata = (event) =>
    event.metadata?.proofAttemptId === proofAttemptId &&
    event.metadata?.mode === "voice" &&
    event.metadata?.agentLayer === "voice_realtime";

  const ws = new WebSocket(wsUrl);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  await once(ws, "open");

  const settingsApplied = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("SettingsApplied was not received.")),
      1000,
    );
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === "SettingsApplied") {
        clearTimeout(timeout);
        resolve(parsed);
      }
    });
  });

  const functionRequest = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("FunctionCallRequest was not received.")),
      1000,
    );
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === "FunctionCallRequest") {
        clearTimeout(timeout);
        resolve(parsed);
      }
    });
  });

  ws.send(
    JSON.stringify({
      type: "voice_auth",
      voiceSessionId: "voice-test-session-1",
      requestId: "voice-test-session-1",
      proofAttemptId,
      inputSampleRate: 44100,
      studyContext: "Local websocket test study context.",
      activeBookId: "book:voice-test",
      activeBookTitle: "Voice Tool Test",
      activeDocumentId: "doc:voice-test",
      documentIds: ["doc:voice-test", "doc:voice-supplement"],
      documentCount: 2,
      readyDocumentIds: ["doc:voice-test"],
      readyDocumentCount: 1,
      contextDocumentIds: ["doc:voice-test"],
      unreadyDocumentCount: 1,
      omittedReadyDocumentCount: 0,
      studyContextChars: 35,
      studyContextMetadata: {
        proofAttemptId,
        mode: "voice",
        agentLayer: "voice_realtime",
        rawContextChars: 120,
        memoryContextChars: 20,
        activeBookContextChars: 30,
        documentContextChars: 70,
        contextCompacted: false,
      },
    }),
  );

  await settingsApplied;
  const request = await functionRequest;
  ws.send(Buffer.from(new Int16Array([180, -120, 90, -60]).buffer));
  const toolNames = request.functions.map((fn) => fn.name).sort();
  assert.deepEqual(toolNames, [
    "evaluate_answer",
    "generate_flashcards",
    "look_at_current_page",
    "look_at_study_context",
    "render_diagram",
    "update_graph",
    "web_search",
  ]);

  request.functions.forEach((fn) => {
    ws.send(
      JSON.stringify({
        type: "FunctionCallResponse",
        id: fn.id,
        name: fn.name,
        content: JSON.stringify({ status: "ok" }),
      }),
    );
  });

  const body = await waitForActivity(baseUrl, (activity) =>
    activity.events.some(
      (event) =>
        event.kind === "tool" &&
        event.status === "completed" &&
        event.title === "Voice client tool completed",
    ),
  );

  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "tool" &&
        event.status === "started" &&
        event.title === "Voice tool call requested" &&
        event.requestId === "voice-test-session-1" &&
        hasVoiceProofMetadata(event),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "tool" &&
        event.status === "completed" &&
        event.title === "Voice client tool completed" &&
        event.requestId === "voice-test-session-1" &&
        hasVoiceProofMetadata(event),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "voice" &&
        event.status === "progress" &&
        event.title === "Voice input audio received" &&
        event.requestId === "voice-test-session-1" &&
        event.metadata?.inputBytes > 0 &&
        event.metadata?.inputSampleRate === 44100 &&
        hasVoiceProofMetadata(event),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "voice" &&
        event.status === "started" &&
        event.title === "Voice session accepted" &&
        event.requestId === "voice-test-session-1" &&
        event.metadata?.studyContextChars === 35 &&
        event.metadata?.inputSampleRate === 44100 &&
        hasVoiceProofMetadata(event),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "voice" &&
        event.status === "completed" &&
        event.title === "Mock voice provider ready" &&
        event.requestId === "voice-test-session-1" &&
        hasVoiceProofMetadata(event),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "retrieval" &&
        event.status === "completed" &&
        event.title === "Voice study context attached" &&
        event.requestId === "voice-test-session-1" &&
        event.metadata?.documentCount === 2 &&
        event.metadata?.readyDocumentCount === 1 &&
        event.metadata?.unreadyDocumentCount === 1 &&
        event.metadata?.contextDocumentIds?.includes("doc:voice-test") &&
        event.metadata?.documentIds?.includes("doc:voice-supplement") &&
        hasVoiceProofMetadata(event),
    ),
  );
});

test("local voice broker stages brain context and background jobs without provider traffic", async (t) => {
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  t.after(() => {
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
  });

  const { server, baseUrl, brokerWsUrl } = await startVoiceApp();
  t.after(() => server.close());
  const proofAttemptId = "beta-proof-voice-broker-test";
  const ws = new WebSocket(brokerWsUrl);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  await once(ws, "open");

  const waitForMessageType = (type, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${type} was not received.`)),
        1000,
      );
      const onMessage = (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === type && predicate(parsed)) {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      };
      ws.on("message", onMessage);
    });

  const settingsApplied = waitForMessageType("SettingsApplied");
  const brokerReady = waitForMessageType("VoiceBrokerReady");
  ws.send(
    JSON.stringify({
      type: "voice_auth",
      voiceSessionId: "voice-broker-test-session-1",
      requestId: "voice-broker-test-session-1",
      proofAttemptId,
      inputSampleRate: 48000,
      language: "en",
      voiceBrokerMode: "custom",
      foregroundModel: "openai/gpt-4o-mini",
      backgroundModel: "openai/gpt-5.5",
      ttsModel: "aura-2-thalia-en",
      studyContext:
        "Previous conversation: the learner likes Pokemon examples. Active book: Voice Brain Architecture.",
      activeBookId: "book:voice-brain",
      activeBookTitle: "Voice Brain Architecture",
      activeDocumentId: "doc:voice-brain",
      documentIds: ["doc:voice-brain", "doc:latency"],
      documentCount: 2,
      readyDocumentIds: ["doc:voice-brain", "doc:latency"],
      readyDocumentCount: 2,
      contextDocumentIds: ["doc:voice-brain"],
      unreadyDocumentCount: 0,
      omittedReadyDocumentCount: 1,
      studyContextChars: 90,
      studyContextMetadata: {
        proofAttemptId,
        mode: "voice",
        agentLayer: "voice_realtime",
        voiceBrokerMode: "custom",
        rawContextChars: 420,
        memoryContextChars: 120,
        activeBookContextChars: 160,
        documentContextChars: 140,
        contextCompacted: false,
      },
    }),
  );

  await settingsApplied;
  const ready = await brokerReady;
  assert.equal(ready.foregroundModel, "openai/gpt-4o-mini");
  assert.equal(ready.backgroundModel, "openai/gpt-5.5");
  assert.equal(ready.ttsModel, "aura-2-thalia-en");
  assert.equal(ready.ttsProvider, "miso");
  assert.equal(ready.sttModel, "nova-3");

  const backgroundStarted = waitForMessageType("BackgroundJobStarted");
  const backgroundResult = waitForMessageType("BackgroundJobResult");
  const assistantTurn = waitForMessageType("ConversationText");
  ws.send(
    JSON.stringify({
      type: "InjectUserMessage",
      content:
        "Tell me about Pikachu and also look up the current Nvidia price.",
    }),
  );

  const background = await backgroundStarted;
  assert.equal(background.model, "openai/gpt-5.5");
  assert.match(background.query, /Nvidia price/i);
  const result = await backgroundResult;
  assert.equal(result.status, "pending_provider_key");
  const assistant = await assistantTurn;
  assert.equal(assistant.role, "assistant");
  assert.match(assistant.content, /local learning book/i);
  // Model-agnostic: the background model is configurable in Settings, so the
  // spoken fallback names the layer, not a specific model id.
  assert.match(assistant.content, /background layer/i);

  const genericBackgroundStarted = waitForMessageType(
    "BackgroundJobStarted",
    (message) => /code error|PDF summary/i.test(message.query || ""),
  );
  ws.send(
    JSON.stringify({
      type: "InjectUserMessage",
      content:
        "Also review this code error in the background and create a PDF summary.",
    }),
  );
  const genericStarted = await genericBackgroundStarted;
  assert.equal(genericStarted.model, "openai/gpt-5.5");
  assert.ok(genericStarted.tools.includes("inspect_code"));
  assert.ok(genericStarted.tools.includes("create_pdf"));
  const genericBackgroundResult = waitForMessageType(
    "BackgroundJobResult",
    (message) => message.jobId === genericStarted.jobId,
  );
  const genericResult = await genericBackgroundResult;
  assert.equal(genericResult.status, "pending_provider_key");

  const body = await waitForActivity(baseUrl, (activity) =>
    activity.events.some(
      (event) =>
        event.title === "Voice broker foreground reply emitted" &&
        event.requestId === "voice-broker-test-session-1",
    ),
  );

  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "voice" &&
        event.status === "started" &&
        event.title === "Local voice broker accepted" &&
        event.metadata?.brokerMode === "custom_local_ready" &&
        event.metadata?.foregroundModel === "openai/gpt-4o-mini" &&
        event.metadata?.backgroundModel === "openai/gpt-5.5" &&
        event.metadata?.ttsModel === "aura-2-thalia-en" &&
        event.metadata?.ttsProvider === "miso" &&
        event.metadata?.proofAttemptId === proofAttemptId,
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "retrieval" &&
        event.title === "Voice broker brain context attached" &&
        event.metadata?.memoryContextChars === 120 &&
        event.metadata?.activeBookContextChars === 160 &&
        event.metadata?.documentContextChars === 140 &&
        event.metadata?.contextDocumentIds?.includes("doc:voice-brain"),
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "tool" &&
        event.status === "blocked" &&
        event.title === "Voice broker background job waiting for provider key",
    ),
  );
});

test("local voice broker refuses non-loopback MisoTTS endpoints", async (t) => {
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  const upstreamRequests = [];
  globalThis.fetch = async (target, init) => {
    upstreamRequests.push({ target: String(target), init });
    throw new Error(`Unexpected external fetch: ${target}`);
  };
  t.after(() => {
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl, brokerWsUrl } = await startVoiceApp();
  t.after(() => server.close());
  const ws = new WebSocket(brokerWsUrl);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  await once(ws, "open");

  const waitForMessageType = (type) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${type} was not received.`)),
        1000,
      );
      const onMessage = (data, isBinary) => {
        if (isBinary) return;
        const parsed = JSON.parse(data.toString());
        if (parsed.type === type) {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      };
      ws.on("message", onMessage);
    });

  const ready = waitForMessageType("VoiceBrokerReady");
  ws.send(
    JSON.stringify({
      type: "voice_auth",
      voiceSessionId: "voice-broker-hostile-miso-session",
      requestId: "voice-broker-hostile-miso-session",
      inputSampleRate: 48000,
      misoTtsApiUrl: "http://169.254.169.254/latest/meta-data",
      studyContext: "Hostile endpoint test.",
    }),
  );
  await ready;

  const assistantTurn = waitForMessageType("ConversationText");
  ws.send(
    JSON.stringify({
      type: "InjectUserMessage",
      content: "Teach me one sentence about variables.",
    }),
  );
  await assistantTurn;

  const body = await waitForActivity(baseUrl, (activity) =>
    activity.events.some(
      (event) =>
        event.title === "Voice broker MisoTTS unavailable" &&
        event.requestId === "voice-broker-hostile-miso-session",
    ),
  );

  assert.equal(
    upstreamRequests.some((request) =>
      request.target.includes("169.254.169.254"),
    ),
    false,
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.title === "Voice broker MisoTTS unavailable" &&
        /loopback host/i.test(event.detail || ""),
    ),
  );
});

test("local voice broker delegates foreground and background web search through OpenRouter", async (t) => {
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  t.after(() => {
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousDeepgramFallback === undefined) {
      delete process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
    } else {
      process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = previousDeepgramFallback;
    }
  });

  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  const miso = await startMisoSpeechServer();
  t.after(() => miso.server.close());
  const headerValue = (headers, name) =>
    headers?.get?.(name) ||
    headers?.get?.(name.toLowerCase()) ||
    headers?.[name] ||
    headers?.[name.toLowerCase()] ||
    "";
  globalThis.fetch = async (target, init = {}) => {
    const url = String(target);
    if (url.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(String(init.body || "{}"));
      upstreamRequests.push({
        type: "openrouter",
        model: body.model,
        authorization: headerValue(init.headers, "Authorization"),
        tools: body.tools || [],
        messages: body.messages || [],
      });
      const isBackground = body.model === "openai/gpt-5.5";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: isBackground
                  ? "Background check: **Apple** (AAPL) stock price is around USD 234.56 according to the background web search."
                  : "Okay, I'll search that and let you know. In Python, variables are names that point to values.",
                annotations: isBackground
                  ? [
                      {
                        type: "url_citation",
                        url_citation: {
                          url: "https://finance.yahoo.com/quote/AAPL",
                          title: "Apple Inc. (AAPL) Stock Price",
                          content: "Mock current Apple price result.",
                        },
                      },
                    ]
                  : [],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("google.serper.dev/search")) {
      throw new Error("Voice broker background layer must not call Serper.");
    }
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart/")) {
      throw new Error(
        "Voice broker background layer must not call a local stock quote shortcut.",
      );
    }
    if (url === `${miso.baseUrl}/v1/audio/speech`) {
      upstreamRequests.push({ type: "miso" });
      return new Response(Buffer.from("RIFFmock-wav"), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    }
    return originalFetch(target, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { server, baseUrl, brokerWsUrl } = await startVoiceApp();
  t.after(() => server.close());
  const ws = new WebSocket(brokerWsUrl);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  await once(ws, "open");
  const receivedTextFrames = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const parsed = JSON.parse(data.toString());
      receivedTextFrames.push({
        type: parsed.type,
        source: parsed.source || "",
        jobId: parsed.jobId || "",
      });
    } catch {}
  });

  const waitForMessageType = (type, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${type} was not received.`)),
        1000,
      );
      const onMessage = (data, isBinary) => {
        if (isBinary) return;
        const parsed = JSON.parse(data.toString());
        if (parsed.type === type && predicate(parsed)) {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      };
      ws.on("message", onMessage);
    });

  const waitForBinary = () =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("binary audio was not received.")),
        1000,
      );
      const onMessage = (data, isBinary) => {
        if (!isBinary) return;
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(Buffer.from(data));
      };
      ws.on("message", onMessage);
    });

  const ready = waitForMessageType("VoiceBrokerReady");
  ws.send(
    JSON.stringify({
      type: "voice_auth",
      voiceSessionId: "voice-broker-configured-session",
      requestId: "voice-broker-configured-session",
      inputSampleRate: 48000,
      language: "en",
      openRouterKey: "openrouter-session-secret",
      misoTtsApiUrl: miso.baseUrl,
      studyContext:
        "Previous conversation: use Pokemon analogies. Active book: Voice Brain Architecture.",
      studyContextMetadata: {
        mode: "voice",
        agentLayer: "voice_realtime",
      },
    }),
  );
  await ready;

  const backgroundResult = waitForMessageType("BackgroundJobResult");
  const assistantTurn = waitForMessageType(
    "ConversationText",
    (message) => message.source !== "background",
  );
  const backgroundInsertion = waitForMessageType(
    "ConversationText",
    (message) => message.source === "background",
  );
  const audio = waitForBinary();
  ws.send(
    JSON.stringify({
      type: "InjectUserMessage",
      content:
        "Teach me about Python variables and search the web for the current Apple stock price.",
    }),
  );

  const assistant = await assistantTurn;
  assert.match(assistant.content, /I'll search that and let you know/i);
  assert.match(assistant.content, /Python.*variables/i);
  assert.doesNotMatch(assistant.content, /focus on Python first/i);
  const binary = await audio;
  assert.equal(binary.slice(0, 4).toString("utf8"), "RIFF");
  const background = await backgroundResult;
  assert.equal(background.status, "completed");
  assert.match(
    background.summary,
    /^(Also,|By the way,|Quick update:|One more thing:|I found it:)/i,
  );
  assert.match(background.summary, /Apple/i);
  assert.match(background.summary, /234\.56/i);
  assert.doesNotMatch(background.summary, /\*\*/);
  assert.doesNotMatch(background.summary, /Background check:/i);
  assert.equal(background.sources.length, 1);
  assert.ok(
    background.tools.some(
      (tool) =>
        tool.name === "openrouter:web_search" && tool.status === "delegated",
    ),
  );
  const inserted = await backgroundInsertion;
  assert.equal(inserted.source, "background");
  assert.equal(inserted.displayMode, "paced");
  assert.ok(Number(inserted.estimatedSpeechMs) >= 1600);
  assert.match(
    inserted.content,
    /^(Also,|By the way,|Quick update:|One more thing:|I found it:)/i,
  );
  assert.match(inserted.content, /Apple|AAPL/i);
  assert.match(inserted.content, /234\.56/i);
  assert.doesNotMatch(inserted.content, /\*\*/);
  assert.doesNotMatch(inserted.content, /Background check:/i);
  const foregroundTextIndex = receivedTextFrames.findIndex(
    (frame) =>
      frame.type === "ConversationText" && frame.source !== "background",
  );
  const backgroundResultIndex = receivedTextFrames.findIndex(
    (frame) => frame.type === "BackgroundJobResult",
  );
  const backgroundTextIndex = receivedTextFrames.findIndex(
    (frame) =>
      frame.type === "ConversationText" && frame.source === "background",
  );
  assert.ok(foregroundTextIndex >= 0);
  assert.ok(backgroundResultIndex > foregroundTextIndex);
  assert.ok(backgroundTextIndex > foregroundTextIndex);

  assert.ok(
    upstreamRequests.some(
      (request) =>
        request.type === "openrouter" &&
        request.model === "openai/gpt-4o-mini" &&
        request.authorization === "Bearer openrouter-session-secret",
    ),
  );
  const foregroundRequest = upstreamRequests.find(
    (request) =>
      request.type === "openrouter" && request.model === "openai/gpt-4o-mini",
  );
  assert.ok(foregroundRequest);
  assert.match(
    foregroundRequest.messages.map((message) => message.content).join("\n"),
    /Okay, I'll search that and let you know|Okay, I'll check that in the background/i,
  );
  assert.match(
    foregroundRequest.messages.map((message) => message.content).join("\n"),
    /Never say 'let's focus on Python first'/i,
  );
  assert.ok(
    upstreamRequests.some(
      (request) =>
        request.type === "openrouter" &&
        request.model === "openai/gpt-5.5" &&
        request.authorization === "Bearer openrouter-session-secret" &&
        request.tools.some((tool) => tool.type === "openrouter:web_search"),
    ),
  );
  assert.equal(
    upstreamRequests.some((request) => request.type === "serper"),
    false,
  );
  assert.equal(
    upstreamRequests.some((request) => request.type === "stock_quote"),
    false,
  );
  assert.ok(upstreamRequests.some((request) => request.type === "miso"));

  const body = await waitForActivity(baseUrl, (activity) =>
    activity.events.some(
      (event) =>
        event.title === "Voice broker background result inserted" &&
        event.requestId === "voice-broker-configured-session",
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.title === "Voice broker foreground model completed" &&
        event.model === "openai/gpt-4o-mini",
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.title === "Voice broker background job completed" &&
        event.model === "openai/gpt-5.5",
    ),
  );
});

test("voice websocket rejects a non-auth first frame before starting a provider", async (t) => {
  const { server, wsUrl } = await startVoiceApp();
  t.after(() => server.close());
  const ws = new WebSocket(wsUrl);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  await once(ws, "open");

  const closed = once(ws, "close");
  ws.send(Buffer.from(new Int16Array([180, -120]).buffer));
  const [code, reason] = await closed;

  assert.equal(code, 1008);
  assert.match(reason.toString(), /authentication must be the first message/i);
});

test("blocked voice current-page vision writes correlated system activity", async (t) => {
  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/voice-current-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "voice-page-test-1",
      query: "What is visible here?",
      image: "",
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.requestId, "voice-page-test-1");
  assert.equal(payload.error, "Current page image is required.");

  const body = await readActivity(baseUrl);
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "tool" &&
        event.status === "blocked" &&
        event.title === "Voice current-page vision blocked" &&
        event.requestId === "voice-page-test-1" &&
        event.toolName === "look_at_current_page",
    ),
  );
});

test("blocked voice web search writes correlated system activity", async (t) => {
  const { server, baseUrl } = await startApp();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/voice-web-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "voice-web-test-1",
      query: "",
      mode: "search",
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.requestId, "voice-web-test-1");
  assert.equal(payload.error, "Query is required.");

  const body = await readActivity(baseUrl);
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "web" &&
        event.status === "blocked" &&
        event.title === "Voice web search blocked" &&
        event.requestId === "voice-web-test-1" &&
        event.toolName === "web_search",
    ),
  );
});

test("voice web search route uses a stubbed Serper fetch and records returned sources", async (t) => {
  const { server, baseUrl } = await startApp();
  t.after(() => server.close());
  const seenRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (!target.includes("google.serper.dev")) {
      throw new Error(`Unexpected fetch: ${target}`);
    }
    seenRequests.push({
      url: target,
      apiKey: init.headers?.["X-API-KEY"],
      body: JSON.parse(init.body),
    });
    return Response.json({
      organic: [
        {
          title: "Stubbed Voice Source",
          link: "https://example.com/voice-source?utm_source=test#proof",
          snippet: "A stubbed source for the local voice tool route.",
          position: 1,
        },
      ],
      images: [
        {
          title: "Stubbed Voice Diagram",
          link: "https://example.com/voice-diagram",
          imageUrl: "https://cdn.example.com/voice-diagram.png",
          thumbnailUrl: "https://cdn.example.com/voice-diagram-thumb.png",
          source: "Example Images",
        },
      ],
    });
  };

  const response = await originalFetch(`${baseUrl}/api/voice-web-search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-serper-api-key": "stub-serper-key",
    },
    body: JSON.stringify({
      requestId: "voice-web-stub-test-1",
      query: "stubbed voice diagram source",
      mode: "search",
      maxResults: 4,
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.requestId, "voice-web-stub-test-1");
  assert.equal(payload.sources.length, 2);
  assert.equal(payload.sources[0].title, "Stubbed Voice Source");
  assert.equal(payload.sources[0].url, "https://example.com/voice-source");
  assert.equal(payload.sources[1].sourceType, "image");
  assert.equal(
    payload.sources[1].thumbnailUrl,
    "https://cdn.example.com/voice-diagram-thumb.png",
  );
  assert.deepEqual(seenRequests, [
    {
      url: "https://google.serper.dev/search",
      apiKey: "stub-serper-key",
      body: { q: "stubbed voice diagram source", num: 4 },
    },
  ]);

  const body = await readActivity(baseUrl);
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "web" &&
        event.status === "started" &&
        event.title === "Voice web search started" &&
        event.requestId === "voice-web-stub-test-1" &&
        event.metadata?.mode === "search",
    ),
  );
  assert.ok(
    body.events.some(
      (event) =>
        event.kind === "web" &&
        event.status === "completed" &&
        event.title === "Voice web search completed" &&
        event.requestId === "voice-web-stub-test-1" &&
        event.metadata?.sourceCount === 2 &&
        event.metadata?.domains?.includes("example.com"),
    ),
  );
});
