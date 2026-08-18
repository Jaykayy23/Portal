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

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, not read
# at runtime, so they have to be present here. docker-compose passes them as
# build args. Both are safe to bake in: the publishable key is designed to be
# public, and RLS is what protects the data.
#
# SUPABASE_SECRET_KEY is deliberately NOT a build arg. It is read at runtime only,
# so it never ends up in an image layer.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# No data volume any more — state lives in Supabase, so this container is
# stateless and safe to replace or scale.
EXPOSE 4000
CMD ["node", "server.js"]
