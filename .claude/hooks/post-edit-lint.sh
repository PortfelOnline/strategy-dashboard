#!/bin/bash
# Post-edit lint hook
# Runs appropriate linter based on file extension

FILE="$1"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

EXT="${FILE##*.}"

case "$EXT" in
  js|mjs|cjs)
    if command -v eslint &>/dev/null; then
      eslint --quiet "$FILE" 2>&1 | head -20
    fi
    ;;
  ts|tsx)
    if command -v eslint &>/dev/null; then
      eslint --quiet "$FILE" 2>&1 | head -20
    fi
    ;;
  php)
    if command -v php &>/dev/null; then
      php -l "$FILE" 2>&1
    fi
    ;;
  py)
    if command -v ruff &>/dev/null; then
      ruff check --quiet "$FILE" 2>&1 | head -10
    elif command -v flake8 &>/dev/null; then
      flake8 --max-line-length=120 "$FILE" 2>&1 | head -10
    fi
    ;;
  sh|bash)
    if command -v shellcheck &>/dev/null; then
      shellcheck -S warning "$FILE" 2>&1 | head -20
    fi
    ;;
  yml|yaml)
    if command -v yamllint &>/dev/null; then
      yamllint -d relaxed "$FILE" 2>&1 | head -10
    fi
    ;;
esac

exit 0
