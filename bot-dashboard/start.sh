#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/release/server.cjs"
