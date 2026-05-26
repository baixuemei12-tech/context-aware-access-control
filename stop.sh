#!/usr/bin/env bash
# CAAC one-click stop script
# Stops: Vite -> Gateway -> Oracle -> IPFS -> Fabric network
#
# Usage:
#   bash stop.sh            # stop services, keep Fabric data
#   bash stop.sh --purge    # also tear down Fabric network + remove ledger data

set -uo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PURGE=0
if [[ "${1-}" == "--purge" ]]; then PURGE=1; fi

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
log()   { color "1;36" "[*] $*"; }
ok()    { color "1;32" "[OK] $*"; }
warn()  { color "1;33" "[!] $*"; }

kill_port() {
  local port="$1" name="$2"
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk -v p=":$port " '$4 ~ p { match($0, /pid=([0-9]+)/, a); if (a[1]) print a[1] }' | sort -u)
  if [[ -z "$pids" ]]; then
    warn "$name not running on :$port"
    return
  fi
  for pid in $pids; do
    log "killing $name (pid $pid)"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      warn "force-killing pid $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  ok "$name stopped"
}

log "stopping Vite (:5173)"
kill_port 5173 "Vite"

log "stopping Gateway (:5051)"
kill_port 5051 "Gateway"

log "stopping Oracle (:5050)"
kill_port 5050 "Oracle"

log "stopping IPFS (:5001)"
kill_port 5001 "IPFS"

if [[ $PURGE -eq 1 ]]; then
  warn "--purge: tearing down Fabric network and removing ledger data"
  cd "$PROJ/backend/fabric-samples/test-network"
  ./network.sh down 2>&1 | tail -5
  ok "Fabric network torn down"
else
  log "Fabric containers left running (use --purge to tear down)"
fi

echo
ok "stop complete"
