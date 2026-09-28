# Coolify: point a new application at this repo. It detects this Dockerfile.
# Set CREDENTIAL_MASTER_KEY (base64, 32 bytes decoded) before storing cloud credentials.
# Add persistent storage mounted at /data so the SQLite file survives redeploys.

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY client client
COPY server server
RUN npm run build \
  && mkdir -p server/dist/data/mitre \
  && cp server/src/data/mitre/enterprise-attack.json server/dist/data/mitre/

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/cyber-range.db \
    CLIENT_DIST=/app/client/dist

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /data

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "server"]
