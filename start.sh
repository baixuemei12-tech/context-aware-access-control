#!/usr/bin/env bash
# CAAC one-click startup script
# Brings up: Fabric network + chaincode -> IPFS daemon -> Oracle -> Gateway -> Vite frontend
# Idempotent: skips any service that's already healthy.
#
# Usage:
#   bash start.sh            # start everything
#   bash start.sh --fresh    # tear down Fabric first, then bring up clean
#
# Logs go to ./logs/<service>.log

set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJ/logs"
PID_DIR="$PROJ/.local/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

FRESH=0
if [[ "${1-}" == "--fresh" ]]; then FRESH=1; fi

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
log()   { color "1;36" "[*] $*"; }
ok()    { color "1;32" "[OK] $*"; }
warn()  { color "1;33" "[!] $*"; }
err()   { color "1;31" "[X] $*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "missing dependency: $1"; exit 1; }
}

wait_port() {
  local host="$1" port="$2" name="$3" tries="${4-60}"
  for ((i=1; i<=tries; i++)); do
    if (exec 3<>/dev/tcp/"$host"/"$port") 2>/dev/null; then
      exec 3>&- 3<&-
      ok "$name listening on $host:$port"
      return 0
    fi
    sleep 1
  done
  err "$name did not start on $host:$port within ${tries}s"
  return 1
}

port_busy() {
  (exec 3<>/dev/tcp/"$1"/"$2") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1
}

# ---------- 0. Sanity checks ----------
log "checking dependencies"
require docker
require java
require node
require npm

# Docker Desktop's WSL integration can take 10–30s after a host reboot,
# so we patiently poll instead of failing on the first probe.
# shellcheck disable=SC1091
source "$PROJ/lib/docker-ready.sh"
if ! wait_for_docker "${CAAC_DOCKER_WAIT_S:-60}"; then
  err "Docker is not running. Start Docker Desktop (with WSL integration) and retry."
  exit 1
fi
ok "docker is up"

if [[ ! -f "$PROJ/caac-env.sh" ]]; then
  err "caac-env.sh not found at $PROJ/caac-env.sh"
  exit 1
fi
# shellcheck disable=SC1091
source "$PROJ/caac-env.sh"
ok "loaded caac-env.sh"

ORACLE_JAR="$PROJ/backend/caac-oracle/target/demo-0.0.1-SNAPSHOT.jar"
GATEWAY_JAR="$PROJ/backend/caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar"
CHAINCODE_JAR="$PROJ/backend/fabric-samples/caac-chaincode/build/libs/caac-1.0-SNAPSHOT.jar"
IPFS_BIN="$PROJ/.local/bin/ipfs"
FRONT_DIR="$PROJ/frontend/caac-website"
NETWORK_DIR="$PROJ/backend/fabric-samples/test-network"

for f in "$ORACLE_JAR" "$GATEWAY_JAR" "$CHAINCODE_JAR" "$IPFS_BIN"; do
  [[ -e "$f" ]] || { err "missing artifact: $f (did you run the build steps?)"; exit 1; }
done
[[ -d "$FRONT_DIR/node_modules" ]] || { err "missing frontend deps. cd $FRONT_DIR && npm install"; exit 1; }
ok "all artifacts present"

# ---------- 1. Fabric network + chaincode ----------
log "Fabric network"
cd "$NETWORK_DIR"
export PATH="$NETWORK_DIR/../bin:$PATH"
export FABRIC_CFG_PATH="$NETWORK_DIR/../config"

if [[ $FRESH -eq 1 ]]; then
  warn "--fresh: tearing down existing Fabric network"
  ./network.sh down >>"$LOG_DIR/fabric.log" 2>&1 || true
fi

if docker ps --format '{{.Names}}' | grep -q '^peer0.org1.example.com$'; then
  ok "Fabric peers already running"
else
  log "starting Fabric network (this takes ~30s)"
  ./network.sh up createChannel -c mychannel -ca >>"$LOG_DIR/fabric.log" 2>&1
  ok "Fabric network up"
fi

# Check if chaincode is committed on the channel (needs Org1 peer creds)
CC_COMMITTED=0
(
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=Org1MSP
  export CORE_PEER_TLS_ROOTCERT_FILE="$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
  export CORE_PEER_ADDRESS=localhost:7051
  peer lifecycle chaincode querycommitted -C mychannel 2>/dev/null | grep -q 'Name: caac,'
) && CC_COMMITTED=1 || true

if [[ $CC_COMMITTED -eq 1 ]]; then
  ok "chaincode 'caac' already committed"
else
  log "deploying chaincode 'caac' (this takes ~1min)"
  ./network.sh deployCC -c mychannel -ccn caac \
    -ccp "$PROJ/backend/fabric-samples/caac-chaincode" \
    -ccl java >>"$LOG_DIR/fabric.log" 2>&1
  ok "chaincode deployed"
fi

# ---------- 2. IPFS daemon ----------
log "IPFS daemon"
if port_busy 127.0.0.1 5001; then
  ok "IPFS already running on :5001"
else
  if [[ ! -d "$IPFS_PATH" ]]; then
    log "initializing IPFS repo at $IPFS_PATH"
    mkdir -p "$IPFS_PATH"
    "$IPFS_BIN" init >>"$LOG_DIR/ipfs.log" 2>&1 || true
  fi
  log "starting IPFS daemon (offline mode)"
  setsid -f "$IPFS_BIN" daemon --offline >>"$LOG_DIR/ipfs.log" 2>&1
  wait_port 127.0.0.1 5001 "IPFS API" 30
fi

# ---------- 3. Oracle ----------
log "CAAC Oracle"
if port_busy 127.0.0.1 5050; then
  ok "Oracle already running on :5050"
else
  log "starting Oracle"
  cd "$PROJ/backend/caac-oracle"
  setsid -f java -jar "$ORACLE_JAR" >>"$LOG_DIR/oracle.log" 2>&1
  wait_port 127.0.0.1 5050 "Oracle" 90
fi

# ---------- 4. Gateway ----------
log "CAAC Gateway"
if port_busy 127.0.0.1 5051; then
  ok "Gateway already running on :5051"
else
  log "starting Gateway"
  cd "$PROJ/backend/caac-gateway"
  setsid -f java -jar "$GATEWAY_JAR" >>"$LOG_DIR/gateway.log" 2>&1
  wait_port 127.0.0.1 5051 "Gateway" 90
fi

# ---------- 5. Frontend (Vite dev) ----------
log "Vite frontend"
if port_busy 127.0.0.1 5173; then
  ok "Vite already running on :5173"
else
  log "starting Vite dev server"
  cd "$FRONT_DIR"
  setsid -f npm run dev -- --host 127.0.0.1 >>"$LOG_DIR/frontend.log" 2>&1
  wait_port 127.0.0.1 5173 "Vite" 60
fi

# ---------- 6. Health summary ----------
echo
color "1;35" "================ CAAC system is up ================"
printf '  Frontend       : http://127.0.0.1:5173/\n'
printf '  Gateway API    : http://127.0.0.1:5051/api/\n'
printf '  Oracle API     : http://127.0.0.1:5050/api/access/evaluate\n'
printf '  IPFS API       : http://127.0.0.1:5001/\n'
printf '  IPFS Gateway   : http://127.0.0.1:8080/ipfs/\n'
printf '  Admin password : %s\n' "${CAAC_INITIAL_ADMIN_PASSWORD:-<see caac-env.sh>}"
echo
printf '  Logs           : %s/{fabric,ipfs,oracle,gateway,frontend}.log\n' "$LOG_DIR"
printf '  Stop all       : bash %s/stop.sh\n' "$PROJ"
color "1;35" "===================================================="
