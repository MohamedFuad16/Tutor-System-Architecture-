# Bug Review Report

Review of the Tutor-System codebase (server, client memory engines, views,
and the voice/bilateral architecture). Typecheck passes; 277/281 tests pass
(the 3 failures are environmental — `pymupdf` is not installed in the review
container — not code defects).

## Fixed in this branch

### 1. Chat SSE stream was buffered by the compression middleware (high impact)
`server.ts` applies `app.use(compression())` globally, and `/api/chat` streams
Server-Sent Events without flushing. `compression()` gzip-buffers a
`text/event-stream` body and releases it only when the response ends, so the
token-by-token streaming in `ChatPanel` never runs — the user sees a spinner,
then the whole answer at once. Verified in isolation: five events arrived in a
single trailing chunk.

**Fix:** mark the SSE response `Cache-Control: no-cache, no-transform`
(which `compression` respects and skips), set `X-Accel-Buffering: no`, and call
`res.flush()` after each event write. After the fix, events stream ~200ms apart.

### 2. Full-duplex voice broker was unreachable on a deployed host (high impact)
The `/api/voice-broker` WebSocket upgrade was gated by
`isAuthorizedLocalVoiceBrokerRequest`, which only passed for loopback or a debug
token. On a deployed persistent Node host the broker returned `403`, so the
foreground/background duplex voice design could never run in production.

**Fix:** also accept the upgrade when the request `Origin` matches the app host
(same-origin, with `x-forwarded-host` support behind a proxy). This blocks
cross-site WebSocket hijacking while letting the deployed app's own page connect.
Keys remain BYOK per connection; server fallback keys stay gated behind the
existing `ALLOW_SERVER_*` env flags. Verified with real handshakes under
`NODE_ENV=production`: same-origin → `101`, cross-site → `403`, no-origin → `403`.

## Open findings (not yet fixed)

### 3. Tool loop can terminate with no synthesized answer (medium)
In the `/api/chat` agent loop (`while (iterations < MAX_ITERATIONS)`), if the
model emits tool calls on the final allowed iteration, the tool results are
appended to the message list but the loop exits before another model turn turns
them into text. `finalContent` for that turn is empty, so the user can get a
blank/truncated reply when the tool-iteration budget is hit. Consider one extra
synthesis turn after the loop when the last turn was a tool call.

### 4. Voice broker TTS deadline is unrealistically tight (medium)
`VOICE_BROKER_TTS_DEADLINE_MS` defaults to `180`ms. MisoTTS/Deepgram audio
rarely returns that fast, so synthesis is almost always aborted before it
arrives. A value around `1500`ms is more realistic.

### 5. Minor
- `iterations + 1` is reported in telemetry after the loop already incremented,
  so iteration counts are off by one (`server.ts`).
- `openRouterCost` only falls back on an `openai/` prefix mismatch, so a
  non-OpenAI model with a pricing-key mismatch silently reads as `$0`.

## Deployment note

Vercel serverless cannot host the persistent WebSocket the voice broker needs
(`server/vercel-handler.ts` never calls `attachWebSockets`). Voice mode requires
a long-running Node host. With finding #2 fixed, setting
`VITE_VOICE_BROKER_MODE=custom` at build time enables the full-duplex broker
same-origin on such a host.

## Responsiveness

Measured in a real mobile browser (Chromium, 320–390px) across Study, Analytics,
Revision, and Admin: no horizontal overflow, cards stack, nav collapses to
icons, composer and voice blob fit. The app is already substantially responsive.
