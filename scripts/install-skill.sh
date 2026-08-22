#!/usr/bin/env bash
# Install the sainsburys-groceries agent skill into ~/.claude/skills (and ~/.agents/skills if present)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/skills/sainsburys-groceries"
for dest_base in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  [ -d "$dest_base" ] || continue
  dest="$dest_base/sainsburys-groceries"
  rm -rf "$dest"
  mkdir -p "$dest_base"
  ln -s "$SRC" "$dest"
  echo "linked $dest -> $SRC"
done
