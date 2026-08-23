#!/usr/bin/env bash
# Ensures the `sainsburys` CLI is available. Safe to run repeatedly.
set -euo pipefail

if command -v sainsburys >/dev/null 2>&1; then
  echo "sainsburys $(sainsburys --version 2>/dev/null || echo '?') already installed: $(command -v sainsburys)"
  exit 0
fi

echo "sainsburys not found; installing globally from npm..."
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found. Install Node.js >= 20 first." >&2
  exit 1
fi

npm i -g sainsburys-groceries-cli

command -v sainsburys >/dev/null 2>&1 || { echo "error: install finished but binary not on PATH" >&2; exit 1; }
echo "installed: $(command -v sainsburys)"
