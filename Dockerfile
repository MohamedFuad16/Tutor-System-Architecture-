# Voice / signaling server image (the long-lived WebSocket host).
# Serves the built client + the /api/voice-broker, /api/voice-agent, /ws/debug
# WebSocket endpoints. Put a TLS reverse proxy (see deploy/Caddyfile) in front.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 needs a toolchain; python3 is used by the PDF extraction helper.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3 python3-pip build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# python3 + pymupdf for document extraction at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
  || pip3 install --no-cache-dir -r requirements.txt
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
