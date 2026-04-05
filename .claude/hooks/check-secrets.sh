#!/bin/bash
# Pre-commit secrets check hook
# Checks staged files for common secret patterns

STAGED=$(git diff --cached --name-only 2>/dev/null)
if [ -z "$STAGED" ]; then
  exit 0
fi

PATTERNS=(
  'password\s*=\s*["\x27][^"'\'']{4,}'
  'api_key\s*=\s*["\x27][^"'\'']{8,}'
  'secret\s*=\s*["\x27][^"'\'']{8,}'
  'token\s*=\s*["\x27][^"'\'']{8,}'
  'AKIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z-_]{35}'
  'sk-[a-zA-Z0-9]{32,}'
)

FOUND=0
for FILE in $STAGED; do
  [ -f "$FILE" ] || continue
  for PATTERN in "${PATTERNS[@]}"; do
    MATCH=$(git diff --cached "$FILE" | grep "^\+" | grep -iE "$PATTERN" 2>/dev/null)
    if [ -n "$MATCH" ]; then
      echo "⚠️  SECRETS CHECK: Possible secret in $FILE"
      echo "   Pattern: $PATTERN"
      echo "   Match: $(echo "$MATCH" | head -1 | cut -c1-80)"
      FOUND=1
    fi
  done
done

# Block .env files with actual values
for FILE in $STAGED; do
  case "$FILE" in
    .env|.env.local|.env.production|.env.staging)
      echo "⚠️  SECRETS CHECK: Staging .env file: $FILE"
      echo "   Consider: is this intentional? .env files often contain secrets."
      FOUND=1
      ;;
  esac
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "Secrets check found potential issues. Review before committing."
  echo "To skip: git commit --no-verify (use only if false positive)"
  exit 2
fi

exit 0
