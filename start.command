#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
clearance_node="$(command -v node || true)"
if [[ -z "$clearance_node" ]]; then
  clearance_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$clearance_node" ]]; then
  print 'Node.js 22 or newer is required. Install Node.js, then run this launcher again.'
  exit 1
fi
print 'Starting Clearance. Open http://127.0.0.1:4173 in your browser.'
print 'Press Control-C to stop the server.'
exec "$clearance_node" src/server.mjs
