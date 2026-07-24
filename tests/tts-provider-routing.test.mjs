import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createTutorServerApp } from "../.tmp-test/server.mjs";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const settingsSource = readFileSync(
  `${repoRoot}/src/components/SettingsModal.tsx`,
  "utf8",
);
const chatPanelSource = readFileSync(
  `${repoRoot}/src/components/ChatPanel.tsx`,
  "utf8",
);

const startTutorApp = async () => {
  const { app } = await createTutorServerApp({ serveClient: false });
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const startMisoStub = async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: JSON.parse(body || "{}"),
      });
      res.writeHead(200, {
        "Content-Type": "audio/wav",
      });
      res.end(Buffer.from("RIFF0000WAVEfmt "));
    });
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
};

test("MisoTTS client settings have been removed", () => {
  // Miso is no longer offered in the client; the settings expose the three
  // model selectors and the two voice modes instead.
  assert.doesNotMatch(settingsSource, /miso-tts-8b/);
  assert.doesNotMatch(settingsSource, /setMisoTtsApiUrl/);
  assert.doesNotMatch(settingsSource, /MisoTTS API URL/);
  assert.match(settingsSource, /Chat model/);
  assert.match(settingsSource, /Voice foreground model/);
  assert.match(settingsSource, /Background smart model/);
});

test("chat read-aloud control no longer references the removed Miso voice", () => {
  assert.match(chatPanelSource, /READ_ALOUD_VOICE_LABELS/);
  assert.doesNotMatch(chatPanelSource, /"miso-tts-8b": "MisoTTS 8B"/);
  assert.doesNotMatch(chatPanelSource, /x-miso-tts-api-url/);
});

test("chat read-aloud keeps text out of URLs and cancels superseded playback", () => {
  assert.match(chatPanelSource, /fetch\("\/api\/tts", \{/);
  assert.match(chatPanelSource, /method: "POST"/);
  assert.match(chatPanelSource, /body: JSON\.stringify\(\{\s+text: safeText,/s);
  assert.match(chatPanelSource, /const controller = new AbortController\(\);/);
  assert.match(chatPanelSource, /ttsAbortRef\.current\?\.abort\(\);/);
  assert.match(
    chatPanelSource,
    /URL\.revokeObjectURL\(ttsObjectUrlRef\.current\)/,
  );
  assert.doesNotMatch(chatPanelSource, /\/api\/tts\?text=/);
});

test("Deepgram server fallback routes the environment key upstream without exposing it", async (t) => {
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousDeepgramFallback = process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK;
  process.env.DEEPGRAM_API_KEY = "deepgram-shared-secret";
  process.env.ALLOW_SERVER_DEEPGRAM_FALLBACK = "true";
  const upstreamRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (!target.includes("api.deepgram.com/v1/speak")) {
      throw new Error(`Unexpected fetch: ${target}`);
    }
    upstreamRequests.push({
      url: target,
      authorization: new Headers(init.headers).get("authorization"),
      body: JSON.parse(init.body),
    });
    return new Response(Buffer.from("ID3stubbed-deepgram-audio"), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
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

  const { server, baseUrl } = await startTutorApp();
  t.after(() => server.close());

  const response = await originalFetch(`${baseUrl}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voice: "aura-asteria-en",
      text: "Use the shared Deepgram fallback.",
    }),
  });
  const responseBuffer = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(
    upstreamRequests[0].authorization,
    "Token deepgram-shared-secret",
  );
  assert.deepEqual(upstreamRequests[0].body, {
    text: "Use the shared Deepgram fallback.",
  });
  assert.match(responseBuffer.toString("utf8"), /^ID3stubbed/);
  assert.doesNotMatch(
    responseBuffer.toString("utf8"),
    /deepgram-shared-secret/,
  );
});

test("TTS route proxies the MisoTTS voice to the local tunneled API", async (t) => {
  const miso = await startMisoStub();
  t.after(() => miso.server.close());

  const previousMisoUrl = process.env.MISO_TTS_API_URL;
  process.env.MISO_TTS_API_URL = miso.baseUrl;
  t.after(() => {
    if (previousMisoUrl === undefined) {
      delete process.env.MISO_TTS_API_URL;
    } else {
      process.env.MISO_TTS_API_URL = previousMisoUrl;
    }
  });

  const { server, baseUrl } = await startTutorApp();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voice: "miso-tts-8b",
      text: "Explain active recall in one sentence.",
    }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /audio\/wav/);
  assert.equal(response.headers.get("X-Usage-Provider"), "misotts");
  assert.equal(response.headers.get("X-Usage-Model"), "miso-tts-8b");
  assert.equal(response.headers.get("X-Usage-Estimated"), "true");
  assert.equal(miso.requests.length, 1);
  assert.equal(miso.requests[0].method, "POST");
  assert.equal(miso.requests[0].url, "/v1/audio/speech");
  assert.equal(
    miso.requests[0].body.text,
    "Explain active recall in one sentence.",
  );
  assert.equal(miso.requests[0].body.speaker, 0);
  assert.equal(typeof miso.requests[0].body.max_audio_length_ms, "number");

  const audio = Buffer.from(await response.arrayBuffer());
  assert.match(audio.toString("utf8"), /^RIFF/);
});

test("TTS route accepts a browser-provided MisoTTS API URL override", async (t) => {
  const miso = await startMisoStub();
  t.after(() => miso.server.close());

  const previousMisoUrl = process.env.MISO_TTS_API_URL;
  delete process.env.MISO_TTS_API_URL;
  t.after(() => {
    if (previousMisoUrl === undefined) {
      delete process.env.MISO_TTS_API_URL;
    } else {
      process.env.MISO_TTS_API_URL = previousMisoUrl;
    }
  });

  const { server, baseUrl } = await startTutorApp();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-miso-tts-api-url": miso.baseUrl,
    },
    body: JSON.stringify({
      voice: "miso-tts-8b",
      text: "Use the configured Miso endpoint.",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Usage-Provider"), "misotts");
  assert.equal(response.headers.get("X-Usage-Model"), "miso-tts-8b");
  assert.equal(miso.requests.length, 1);
  assert.equal(miso.requests[0].url, "/v1/audio/speech");
  assert.equal(miso.requests[0].body.text, "Use the configured Miso endpoint.");
});
