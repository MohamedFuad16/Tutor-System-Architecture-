# Azure Voice / Signaling Server

Voice mode (the Deepgram two-model duplex — a fast **interaction tutor** plus a
smarter **background worker**) rides on WebSocket endpoints served by
`server.ts`:

- `/api/voice-broker` — the two-model duplex: browser audio → Deepgram STT →
  OpenRouter foreground/background models → Deepgram Aura TTS.
- `/api/voice-agent` — Deepgram Voice Agent proxy.
- `/ws/debug` — trace broadcaster used by the Admin view.

The production web app is served from Vercel, whose serverless runtime cannot
hold WebSocket connections, so voice needs a long-lived host. The voice server
runs on an **Azure VM**; the HTTP app stays on Vercel.

> A browser on an HTTPS page can only open a `wss://` (TLS) socket, so the VM
> must be reachable at a real domain with a certificate — a bare IP will not
> work. The steps below use Caddy for automatic Let's Encrypt TLS.

## How the split works

1. **Azure VM** runs the same server build (`npm run build && npm start`, which
   serves `dist/server.cjs`), configured with server-side provider keys so the
   interaction tutor + background worker run on the server.
2. **Web app build** sets `VITE_VOICE_WS_URL=wss://voice.<your-domain>` so
   `ChatPanel` opens voice sockets against the VM instead of the Vercel origin.
3. **Azure server env** sets `VOICE_ALLOWED_ORIGINS` to the web app origin(s) so
   the cross-origin WebSocket handshake passes the broker's origin check.

## Repo artifacts

| File | Purpose |
| ---- | ------- |
| `Dockerfile` | Container image for the voice server (optional). |
| `deploy/Caddyfile` | TLS reverse proxy → `127.0.0.1:3000` (auto HTTPS + wss). |
| `deploy/tutor-voice.service` | systemd unit to run the server. |
| `deploy/deploy.sh` | Pull + `npm ci` + build + restart. |
| `deploy/voice-server.env.example` | Server env template (copy to `.env`). |

## Provisioning steps (Ubuntu 22.04 Azure VM, non-container)

1. **Create the VM.** Azure Portal → Virtual machines → Create → Ubuntu Server
   22.04 LTS, a small size (e.g. `Standard_B2s`). In **Networking**, open
   inbound ports **80** and **443** in the Network Security Group (SSH 22 for
   yourself only).
2. **DNS.** Point an A record `voice.<your-domain>` at the VM's public IP.
3. **SSH in** and install prerequisites:
   ```bash
   sudo apt-get update
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs python3 python3-pip build-essential git
   # Caddy (TLS reverse proxy)
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update && sudo apt-get install -y caddy
   ```
4. **Clone + configure:**
   ```bash
   sudo useradd -r -m -d /opt/tutor-system -s /usr/sbin/nologin tutor || true
   sudo git clone https://github.com/MohamedFuad16/Tutor-System.git /opt/tutor-system
   sudo chown -R tutor:tutor /opt/tutor-system
   cd /opt/tutor-system
   sudo -u tutor cp deploy/voice-server.env.example .env
   sudo -u tutor nano .env    # set VOICE_ALLOWED_ORIGINS + provider keys
   ```
5. **Build + run as a service:**
   ```bash
   sudo -u tutor bash -c 'cd /opt/tutor-system && npm ci && pip3 install --break-system-packages -r requirements.txt && npm run build'
   sudo cp deploy/tutor-voice.service /etc/systemd/system/tutor-voice.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now tutor-voice
   ```
6. **TLS reverse proxy:** edit `deploy/Caddyfile` and replace
   `voice.example.com` with `voice.<your-domain>`, then:
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy    # Caddy fetches the Let's Encrypt cert automatically
   ```
7. **Point the web app at the VM.** In the Vercel project's build environment,
   set `VITE_VOICE_WS_URL=wss://voice.<your-domain>` and redeploy.
8. **Verify:** open the app, start voice (Deepgram duplex). In the browser
   Network tab the WebSocket should connect to `wss://voice.<your-domain>/api/voice-broker`
   with a `101` response.

## Docker alternative

```bash
docker build -t tutor-voice .
docker run -d --name tutor-voice --env-file .env -p 3000:3000 tutor-voice
# then front it with Caddy/nginx TLS as above
```

## VM requirements

- Node.js ≥ 20.19 (see `package.json#engines`), Python 3 + pip for extraction.
- TLS terminator (Caddy/nginx + Let's Encrypt) proxying WebSocket upgrades to
  port 3000; open inbound 443 (and 80 for ACME).
- A process manager (systemd unit or pm2) so the server restarts on reboot.

## Security note

If a proxy or load balancer terminates the WebSocket, it must **strip any
inbound `X-Forwarded-Host` header** so the broker's same-origin check cannot be
spoofed (see `VOICE_ALLOWED_ORIGINS` in `server.ts`).

## Server environment

The interaction tutor + background worker are configured on the VM via `.env`
(see `deploy/voice-server.env.example`): `VOICE_ALLOWED_ORIGINS`, the provider
keys with their `ALLOW_SERVER_*_FALLBACK=true` flags, and the
`VOICE_FOREGROUND_MODEL` / `VOICE_BACKGROUND_MODEL` model ids.
