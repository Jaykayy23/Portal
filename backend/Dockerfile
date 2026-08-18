FROM node:20-alpine

WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/ ./
COPY frontend/ ../frontend/

# Persisted database lives here — mount a volume at this path in production
# so data survives container rebuilds (see docker-compose.yml).
VOLUME ["/app/backend/data"]

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
