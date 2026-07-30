#!/bin/sh
# Seeds the swappable web release directory. Installed as /docker-entrypoint.d/20-trm-seed-releases.sh,
# so nginx:alpine's own entrypoint runs it before nginx starts.
#
# nginx serves from $ROOT/current (a symlink). The server applies a web OTA by writing a new
# $ROOT/releases/<commit> into this same volume and re-pointing that symlink — nginx follows it at
# open(2) on every request, so a flip needs no reload and no restart (docs/release/server-ota.md).
#
# This script's whole job is the two boot cases:
#   fresh image  (baked build id changed) → point `current` at the baked release: an image pull must
#                                           always win over whatever OTA release the volume holds.
#   plain restart (baked build id same)   → leave `current` alone, so a restart does not roll the
#                                           deployment back off an applied OTA.
set -eu

ROOT=${TRM_WEB_RELEASES_DIR:-/srv/web}
BAKED=/srv/web/baked

# The build id the Vite build stamped into build.json (busybox sed — no jq in nginx:alpine).
BUILD_ID=$(sed -n 's/.*"buildId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BAKED/build.json" 2>/dev/null || true)
[ -n "$BUILD_ID" ] || BUILD_ID=baked

RELEASE="$ROOT/releases/$BUILD_ID"
mkdir -p "$ROOT/releases"

if [ ! -e "$RELEASE/index.html" ]; then
  rm -rf "$RELEASE.tmp"
  cp -a "$BAKED" "$RELEASE.tmp"
  mv "$RELEASE.tmp" "$RELEASE"
  echo "[trm] seeded web release $BUILD_ID"
fi

LAST_BAKED=$(cat "$ROOT/.baked" 2>/dev/null || true)
if [ ! -L "$ROOT/current" ] || [ ! -e "$ROOT/current" ] || [ "$LAST_BAKED" != "$BUILD_ID" ]; then
  ln -sfn "$RELEASE" "$ROOT/current"
  echo "[trm] serving web release $BUILD_ID"
fi
[ -L "$ROOT/previous" ] || ln -sfn "$RELEASE" "$ROOT/previous"
printf '%s' "$BUILD_ID" > "$ROOT/.baked"

# Sentinel: proves to the server that the volume it writes releases into is the one THIS nginx
# serves. Without it (volume not mounted, or mounted only on one side) the server reports web OTA as
# unavailable instead of quietly writing releases nobody ever serves.
printf '%s' "$BUILD_ID" > "$ROOT/.web-tier"
