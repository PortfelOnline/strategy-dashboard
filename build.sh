#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "📦 Building frontend..."
pnpm vite build --outDir release/public --emptyOutDir

echo "⚙️  Bundling server..."
./node_modules/.bin/esbuild server/prod.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile=release/server.cjs \
  --external:fsevents

echo "✅  Done → release/"
