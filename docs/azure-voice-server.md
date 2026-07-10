# Azure Voice / Signaling Server

Voice mode rides on WebSocket endpoints served by `server.ts`:

- `/api/voice-agent` — Deepgram Voice Agent proxy (default mode).
- `/api/voice-broker` — custom broker: browser audio → Deepgram STT →
  OpenRouter foreground/background models → Deepgram Aura TTS.
- `/ws/debug` — trace broadcaster used by the Admin view.

The production web app is served from Vercel, whose serverless runtime cannot
hold WebSocket connections, so voice mode needs a long-lived host. The voice
server runs on an Azure VM instead; HTTP APIs stay wherever the app is hosted.

## How the split works

1. **Azure VM** runs the same server build (`npm run build && npm start`,
   which serves `dist/server.cjs`). Only the WebSocket endpoints need to be
   reachable from browsers.
2. **Web app build** sets `VITE_VOICE_WS_URL` (e.g. `wss://voice.example.com`)
   so `ChatPanel` opens voice sockets against the Azure host instead of the
   page's own origin.
3. **Azure server env** sets `VOICE_ALLOWED_ORIGINS` to the web app's
   origin(s) (comma-separated, full origins) so the cross-origin WebSocket
   handshake passes the broker's origin check, e.g.:

   ```
   VOICE_ALLOWED_ORIGINS=https://tutor-system-architecture.vercel.app
   ```

## VM requirements

- Node.js ≥ 20.19 (see `package.json#engines`).
- TLS in front of the Node process. The app is served over HTTPS, so browsers
  will only open `wss://` sockets — put Caddy or nginx (with a Let's Encrypt
  cert) in front of the server's port 3000 and proxy WebSocket upgrades.
- Open inbound 443 (and 80 for ACME) in the VM's network security group.
- A process manager (systemd unit or pm2) so the server restarts on reboot.

## Server environment

Copy `.env.example` to `.env` on the VM. Voice keys are BYOK — supplied by
each browser session — so the VM only strictly needs:

```
NODE_ENV=production
VOICE_ALLOWED_ORIGINS=<web app origin(s)>
```

Optional: `DEEPGRAM_API_KEY`/`OPENROUTER_API_KEY` plus their
`ALLOW_SERVER_*_FALLBACK=true` flags if the deployment owner wants shared
server keys as a fallback.
