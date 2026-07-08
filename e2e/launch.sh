#!/usr/bin/env bash
# Launch an isolated RemNote instance for e2e testing.
#
# A scratch HOME keeps it away from the real profile (separate Electron
# userData → no single-instance conflict with a running RemNote) and a
# CDP port lets Playwright drive it.
#
# If an extracted AppImage exists at $E2E_HOME/squashfs-root (create with
# `cd $E2E_HOME && RemNote-*.AppImage --appimage-extract`), its AppRun is
# launched DIRECTLY — this bypasses binfmt_misc/AppImageLauncher, which can
# interpose on AppImage execution and interfere with second instances.
#
# NOTE on sign-in: do NOT use the browser "Log in" flow in this instance —
# it bounces through a remnote://desktop_login deep link that the OS hands
# to a NEW RemNote process with your REAL profile, not this one. Use
# "Create a local knowledge base" instead (no account needed; the e2e
# scripts only require a Daily Document and the dev plugin).
set -euo pipefail

APPIMAGE="${REMNOTE_APPIMAGE:-$(ls -v "$HOME"/Applications/RemNote-*.AppImage | tail -1)}"
E2E_HOME="${REMNOTE_E2E_HOME:-/tmp/remnote-vim-e2e-home}"
PORT="${REMNOTE_CDP_PORT:-9223}"

mkdir -p "$E2E_HOME"
export HOME="$E2E_HOME"
export APPIMAGELAUNCHER_DISABLE=1
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME

if [[ -x "$E2E_HOME/squashfs-root/AppRun" ]]; then
  # AppRun expects the AppImage runtime to have set APPDIR
  export APPDIR="$E2E_HOME/squashfs-root"
  exec "$APPDIR/AppRun" --no-sandbox --remote-debugging-port="$PORT" "$@"
fi
exec "$APPIMAGE" --no-sandbox --remote-debugging-port="$PORT" "$@"
