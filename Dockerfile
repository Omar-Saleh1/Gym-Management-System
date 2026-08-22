# ─── Stage: runtime ───────────────────────────────────────────────────────────
# ghcr.io/puppeteer/puppeteer:24.10.0 ships Chrome 131 — matches puppeteer@24.x
# which whatsapp-web.js@1.34.7 installs as a dependency.
# Using 21.5.0 caused: "Protocol error: Execution context was destroyed"
# because puppeteer@24 needs Chrome 131+ but the old image only had Chrome 120.
FROM ghcr.io/puppeteer/puppeteer:24.10.0

USER root

WORKDIR /app

COPY package*.json ./

# Install production + dev deps (tsc is in devDependencies)
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV WHATSAPP_PROVIDER=local
ENV WWEBJS_AUTH_PATH=/tmp/.wwebjs_auth
ENV WWEBJS_CACHE_PATH=/tmp/.wwebjs_cache

# NOTE: Do NOT set PUPPETEER_EXECUTABLE_PATH here.
# The base image already sets it to the correct Chrome 131 path.
# Overriding it to /usr/bin/google-chrome-stable pointed at the wrong binary.

RUN mkdir -p /tmp/.wwebjs_auth /tmp/.wwebjs_cache && chmod -R 777 /tmp/.wwebjs_auth /tmp/.wwebjs_cache

CMD ["npm", "start"]
