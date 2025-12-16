# ---------------------------------------------------------------------------
# Stage 1: Base
# ---------------------------------------------------------------------------
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app


# ---------------------------------------------------------------------------
# Stage 2: Dependencies (cached)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=optional

# ---------------------------------------------------------------------------
# Stage 3: Builder
# ---------------------------------------------------------------------------
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --include=optional
COPY . .
RUN npx prisma generate
RUN npm run build
RUN rm -rf node_modules \
 && npm ci --omit=dev --include=optional \
 && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 4: Production
# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

RUN addgroup --system nodejs && adduser --system --ingroup nodejs nodejs
USER nodejs

EXPOSE 3333
CMD ["node", "dist/server.js"]
