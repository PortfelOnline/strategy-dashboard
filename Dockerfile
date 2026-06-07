# strategy-dashboard — production container
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# Runtime deps: webp (cwebp для конвертации картинок), chromium (Puppeteer SERP-фолбэк),
# ffmpeg (видео-пайплайн), шрифты.
RUN apt-get update && apt-get install -y --no-install-recommends \
      webp ffmpeg chromium ca-certificates fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm ci
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/index.js"]
