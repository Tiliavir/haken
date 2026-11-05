#!/bin/sh
# Local development: Radicale on 127.0.0.1:5232 (data in $HAKEN_DEV_DATA, default radicale-data/,
# git-ignored) and the gateway on :8080 serving the current build.
# Needs `radicale` (pip install radicale==3.9.0) and a prior `make gateway`.
# Test users: dev / dev and eve / eve (plain htpasswd — for local development only).
set -eu
cd "$(dirname "$0")/.."
DATA=${HAKEN_DEV_DATA:-radicale-data}
RPORT=${RADICALE_PORT:-5232}
# Optional request body limit in bytes (E2E: provokes 413). Unset: Radicale's default.
MAXLEN=${RADICALE_MAX_CONTENT_LENGTH:-}
case $MAXLEN in
  *[!0-9]*) echo "RADICALE_MAX_CONTENT_LENGTH must be a number" >&2; exit 1 ;;
  *) ;;
esac
mkdir -p "$DATA/collections"
[ -f "$DATA/users" ] || printf 'dev:dev\neve:eve\n' > "$DATA/users"
cat > "$DATA/config" <<CONF
[server]
hosts = 127.0.0.1:$RPORT
${MAXLEN:+max_content_length = $MAXLEN}
[auth]
type = htpasswd
htpasswd_filename = $DATA/users
htpasswd_encryption = plain
[rights]
type = owner_only
[storage]
filesystem_folder = $DATA/collections
[logging]
level = warning
CONF
radicale --config "$DATA/config" &
RADICALE=$!
trap 'kill $RADICALE 2>/dev/null' EXIT INT TERM
HAKEN_RADICALE_URL=http://127.0.0.1:$RPORT HAKEN_LISTEN=127.0.0.1:${PORT:-8080} ./dist/haken
