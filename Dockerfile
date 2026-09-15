FROM node:24.19.0-bookworm-slim

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY web ./web

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/nogotochki.sqlite

EXPOSE 3000
VOLUME ["/data"]

WORKDIR /app/server
CMD ["node", "src/http/index.js"]
