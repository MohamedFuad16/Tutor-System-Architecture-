# Audit Report

Full audit of the Tutor-System codebase (server, client memory engines, views,
PDF pipeline, Mermaid rendering, UI, and the voice architecture) plus the
product changes requested alongside it. Verification gate after the work:
`format:check`, `lint` (tsc), `test` (280 node pass / 1 skipped, 591 DOM pass),
and `build` all green, with `pymupdf`/`pymupdf4llm` installed.

## Security — fixed

1. **Cross-site WebSocket hijack on `/api/voice-agent` (High).** The Deepgram
   Voice Agent upgrade accepted any origin, unlike the custom broker. It now
   uses the same `isAuthorizedLocalVoiceBrokerRequest` (same-origin / debug
   token) gate, closing the hijack + Deepgram-credit-drain vector.
2. **Mermaid XSS via `securityLevel: "loose"` (High).** Chat diagrams are
   influenced by untrusted PDF/OCR/web content and were rendered with HTML
   sanitization disabled + `innerHTML`. Switched to `securityLevel: "strict"`
   (matching RevisionView), which DOMPurifies the SVG and blocks in-diagram
   `click`/`javascript:` directives.
3. **Unbounded per-user SQLite handles (High, DoS + FD/memory leak).** Each
   client-supplied `userId` opened a WAL handle that was cached forever.
   `LearnerStore` now evicts idle handles with an LRU cap
   (`LEARNINGAI_MAX_OPEN_DBS`, default 64).
4. **Document-read identity mismatch (High, best-effort).** `/documents/:id/file`
   and `/text` trusted `req.query.userId`. They now reject a request whose
   header identity and query identity explicitly disagree, while still allowing
   the header-less react-pdf fetch. (True tenant isolation still requires real
   auth, which the local-first model defers.)
5. **Oversized-body DoS (Med).** `express.urlencoded` limit lowered from 100mb
   to 1mb.
6. **MisoTTS localhost probing (Low).** `MISO_TTS_ALLOW_HEADER_URL=false` lets
   deployments ignore the client-supplied Miso URL header. (MisoTTS has since
   been removed from the client entirely; the server routes are dormant.)

## Memory leaks — fixed

7. **Hot-mic on unmount.** A live voice session (mic `MediaStream`,
   `AudioContext`, `ScriptProcessorNode`, WebSocket) was never released if
   `ChatPanel` unmounted mid-session. Added an unmount cleanup.
8. **Web-search cache never evicted.** Expired entries are now dropped and the
   map is size-capped.
9. See security #3 (SQLite handle eviction).

## Correctness — fixed (previously open findings #3–#5)

10. **Blank reply when the tool budget is exhausted mid-tool-call (#3).** The
    `/api/chat` agent loop could exit with tool results appended but never
    synthesized. Added a final no-tools synthesis turn; telemetry now reports an
    honest model-turn count (fixes the #5 off-by-one).
11. **TTS deadline too tight (#4).** `VOICE_BROKER_TTS_DEADLINE_MS` default
    raised from 180ms to 1500ms.
12. **Misleading TTS model (#5).** `/api/tts` now calls the `gpt-4o-mini-tts`
    model it reports instead of silently substituting `tts-1`.
13. **Silent $0 cost (#5).** `openRouterCost` matches pricing across provider
    prefixes, so non-`openai/` models no longer read as $0.

## Product changes shipped alongside the audit

- **PDF page-aware context.** Extraction switched to page-indexed markdown
  (`pymupdf4llm` `page_chunks`); the current reader page's text is now injected
  as a labeled `CURRENT PAGE N of M` block (plus adjacent pages) into the tutor
  prompt. Previously the model was never told which page the learner was on and
  only ever saw the document's opening characters.
- **Mermaid redesign.** Diagrams render only once the source parses cleanly (no
  more raw parser errors flashing mid-stream), are static and fully visible
  (removed the perpetual dimming + auto-panning "focus tour"), with click-to-
  focus zoom, higher contrast, and reduced-motion support.
- **AdminView dark theme.** Converted the light cream/serif diagnostics surface
  to the dark Cosmic Obsidian theme for cross-view consistency (RevisionView's
  intentional paper look is preserved).
- **Voice: friction-free duplex + Realtime test mode.** Voice mode is a runtime
  Setting; the two-model Deepgram duplex is the default and runs in the app's own
  server with just a Deepgram key + an OpenAI or OpenRouter key (auto-detected);
  a default-off OpenAI Realtime (WebRTC) mode was added for full-duplex
  benchmarking with no persistent server.

## Deferred / not changed (with rationale)

- **StatusBadge light palette.** Its wrapper is unused in-app (only its
  `currentColor` icons are used, which adapt to dark), and its classes are
  pinned by tests — re-theming would break tests for no app benefit.
- **`.eslintrc.json` removed.** It referenced parsers/plugins that were never
  installed; `npm run lint` runs `tsc`, so the config only implied a lint that
  never ran.
- **True multi-tenant auth.** Local profiles remain "not real auth" by design;
  document-read hardening is best-effort within that model.
- **`new Function` JS runner / arbitrary model-authored code.** Retained behind
  the explicit "Run" gate; the passive Mermaid XSS path is now closed.

## Deployment notes

- Vercel serverless still cannot host the persistent voice-broker WebSocket, so
  `deepgram-duplex` needs a long-running Node host (or the
  separate voice server via `VITE_VOICE_WS_URL`). The `openai-realtime` test
  mode is the one voice path that works on serverless (browser↔OpenAI WebRTC +
  the tiny `/api/realtime/token` endpoint).
- A proxy terminating the voice WebSocket must strip inbound `X-Forwarded-Host`
  so the same-origin broker check cannot be spoofed.
