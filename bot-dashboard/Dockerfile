FROM node:20-slim

RUN apt-get update && apt-get install -y procps curl git && \
    curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | \
    tar xz --strip-components=1 -C /usr/local/bin docker/docker && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN bash build.sh && \
    git clone --depth=1 https://github.com/novnc/noVNC.git /app/novnc

EXPOSE 4000
CMD ["node", "release/server.cjs"]
