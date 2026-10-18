#!/usr/bin/env bash
# Install the `dsh` agent type into an agmsg install and trust it.
#
# Usage: install-agmsg-type.sh [agmsg_skill_dir]
#
# agmsg_skill_dir defaults to $AGMSG_SKILL_DIR, then ~/.agents/skills/agmsg.
# The type is copied to <skill>/plugins/types/dsh (agmsg keeps that directory
# across `npx agmsg install --update`) and trusted with agmsg's own plugin.sh,
# which pins the trust to that path. Re-running replaces the copy.
set -euo pipefail

SKILL_DIR="${1:-${AGMSG_SKILL_DIR:-$HOME/.agents/skills/agmsg}}"
SRC_DIR="$(cd "$(dirname "$0")/../agmsg-type/types/dsh" && pwd)"

if [ ! -f "$SKILL_DIR/scripts/plugin.sh" ]; then
  echo "error: no agmsg install at $SKILL_DIR (missing scripts/plugin.sh)" >&2
  echo "install agmsg first (npx agmsg) or pass its directory as the first argument" >&2
  exit 1
fi

DEST_DIR="$SKILL_DIR/plugins/types/dsh"
mkdir -p "$SKILL_DIR/plugins/types"
rm -rf "$DEST_DIR"
cp -R "$SRC_DIR" "$DEST_DIR"
chmod 644 "$DEST_DIR"/*

bash "$SKILL_DIR/scripts/plugin.sh" trust types/dsh

if bash "$SKILL_DIR/scripts/whoami.sh" "$HOME" dsh >/dev/null 2>&1; then
  echo "agmsg now accepts agent type 'dsh' ($DEST_DIR)"
else
  echo "error: agmsg still rejects agent type 'dsh'; run: bash $SKILL_DIR/scripts/plugin.sh list" >&2
  exit 1
fi
