# ------------------------------------------------------------------------------
# Stage 1: Base (Shared System Dependencies)
# ------------------------------------------------------------------------------
FROM node:20-slim AS base
# Using 'slim' (Debian-based) for better stability with native dependencies (like Prisma),
# avoiding musl/glibc issues and making manual installation of libc6-compat unnecessary.

# Install necessary system dependencies (curl and bash are standard, openssl is often needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    bash \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# wait-for-it (Removed from the original instructions as it is unused, but kept here 
# in case it is needed elsewhere, though the new setup doesn't need it.)
COPY wait-for-it.sh /usr/local/bin/wait-for-it
RUN chmod +x /usr/local/bin/wait-for-it

# ------------------------------------------------------------------------------
# Stage 2: Dependencies (Cached)
# ------------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 3: Development
# ------------------------------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3333
EXPOSE 5555

CMD ["npm", "run", "dev"]

# ------------------------------------------------------------------------------
# Stage 4: Builder (Production build)
# ------------------------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 5: Production
# ------------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3333

CMD ["npm", "run", "start:prod"]
