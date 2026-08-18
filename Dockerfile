# Multi-stage build. The runner image contains only the standalone Next.js
# output, so it doesn't ship the toolchain or dev dependencies.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
ENV PORT=4000
# db.json lives here; docker-compose mounts a named volume over it.
ENV SOMO_DB_PATH=/app/data/db.json

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
USER nextjs

EXPOSE 4000
CMD ["node", "server.js"]
