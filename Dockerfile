# strategy-dashboard — production container
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# --legacy-peer-deps: @builder.io/vite-plugin-jsx-loc требует vite@^4||^5, проект на vite@7
# (на маке node_modules ставился так же; npm ci строгий → ERESOLVE без флага)
RUN npm ci --legacy-peer-deps
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
# Ставим ВСЕ зависимости включая dev: esbuild бандлит с --packages=external, поэтому
# пакеты (googleapis и др. из devDependencies) нужны в node_modules в рантайме.
# --include=dev обязателен: ENV NODE_ENV=production выше → npm ci иначе пропускает devDeps.
RUN npm ci --include=dev --legacy-peer-deps
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/index.js"]
