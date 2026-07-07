#!/usr/bin/env bash
# Launch an isolated RemNote instance for e2e testing.
#
# A scratch HOME keeps it away from the real profile (separate Electron
# userData → no single-instance conflict with a running RemNote) and a
# CDP port lets Playwright drive it.
set -euo pipefail

APPIMAGE="${REMNOTE_APPIMAGE:-$(ls -v /home/onegraund/Applications/RemNote-*.AppImage | tail -1)}"
E2E_HOME="${REMNOTE_E2E_HOME:-/tmp/remnote-vim-e2e-home}"
PORT="${REMNOTE_CDP_PORT:-9223}"

mkdir -p "$E2E_HOME"
export HOME="$E2E_HOME"
export APPIMAGELAUNCHER_DISABLE=1
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME

exec "$APPIMAGE" --no-sandbox --remote-debugging-port="$PORT" "$@"
