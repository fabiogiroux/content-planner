FROM node:20-alpine

WORKDIR /app

# ── Chromium + fontes (para Puppeteer) ───────────────────────────────────────
# Instalado antes do npm ci para aproveitar cache de layer Docker.
# font-noto cobre Google Fonts comuns (Inter, Poppins, Roboto via CDN).
# ttf-liberation/dejavu como fallback para fontes sans-serif genéricas.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-liberation \
    ttf-dejavu \
    font-noto \
    font-noto-emoji

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# ── Dependências Node ─────────────────────────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Código fonte ──────────────────────────────────────────────────────────────
COPY server.js add-to-schedule.js publish.js ./
COPY public/ ./public/

# ── Volumes persistentes ──────────────────────────────────────────────────────
RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "server.js"]
