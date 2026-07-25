# ---- Base Stage ----
FROM node:20-alpine AS base
# openssl is required by the Prisma query engine on Alpine (musl).
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json bun.lock ./

# The previous command here was:
#   npm install --frozen-lockfile 2>/dev/null || bun install --frozen-lockfile 2>/dev/null || npm install
# Three things wrong with it:
#   1. --frozen-lockfile is not an npm flag (it is bun/pnpm/yarn), so npm ignored it.
#   2. 2>/dev/null hid the real ERESOLVE error, making the failure look like a bun problem.
#   3. bun is not installed in node:20-alpine, so that branch could never run.
# The chain then fell through to a bare `npm install`, which fails on an optional peer
# conflict: @hookform/resolvers wants valibot ^1.0.0 while @typeschema/valibot pins 0.39.0.
# Neither is used directly by this app — zod is the validation library in package.json —
# so skipping strict peer resolution is safe and deterministic.
RUN npm install --legacy-peer-deps --no-audit --no-fund

# ---- Build Stage ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma schema, plus the generated client and query engine binary.
# Next.js standalone tracing does not reliably include the .prisma engine, which shows up
# at runtime as "Query engine library could not be found" rather than at build time.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["node", "server.js"]
