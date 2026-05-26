#!/usr/bin/env bash
# Tests for lib/docker-ready.sh::wait_for_docker
#
# Strategy: shim `docker` on PATH with a stub whose exit code is controlled
# by a counter file. This lets us simulate Docker-not-ready-then-ready
# without actually touching the real Docker daemon.
#
# Run:
#   bash tests/test_docker_ready.sh

set -uo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$PROJ/lib/docker-ready.sh"

PASS=0; FAIL=0
trap 'rm -rf "$TMP"' EXIT
TMP="$(mktemp -d)"

# ---- docker stub ---------------------------------------------------
# The stub reads $TMP/fail_remaining; if >0 it decrements and exits 1,
# else exits 0. Mimics Docker Desktop slowly becoming ready.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
# args ignored — we only care about `docker info`'s exit code.
COUNTER="${DOCKER_STUB_COUNTER:?}"
n="$(cat "$COUNTER" 2>/dev/null || echo 0)"
if [[ "$n" -gt 0 ]]; then
  echo "$((n - 1))" > "$COUNTER"
  echo "Cannot connect to the Docker daemon" >&2
  exit 1
fi
echo "Server Version: 99.0-stub"
exit 0
STUB
chmod +x "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export DOCKER_STUB_COUNTER="$TMP/counter"

assert_eq() {
  local got="$1" want="$2" msg="$3"
  if [[ "$got" == "$want" ]]; then
    echo "  ok   — $msg"
    PASS=$((PASS + 1))
  else
    echo "  FAIL — $msg  (got=$got want=$want)"
    FAIL=$((FAIL + 1))
  fi
}

# ---- T1: library exists & is sourceable ----------------------------
echo "T1: lib is sourceable"
if [[ ! -f "$LIB" ]]; then
  echo "  FAIL — $LIB does not exist yet"
  FAIL=$((FAIL + 1))
else
  # shellcheck disable=SC1090
  ( source "$LIB" && declare -F wait_for_docker >/dev/null ) \
    && { echo "  ok   — wait_for_docker defined"; PASS=$((PASS + 1)); } \
    || { echo "  FAIL — wait_for_docker missing after source"; FAIL=$((FAIL + 1)); }
fi

# Bail if lib missing — remaining tests need it.
[[ -f "$LIB" ]] || { echo; echo "$PASS pass / $FAIL fail"; exit 1; }

# shellcheck disable=SC1090
source "$LIB"

# ---- T2: returns 0 immediately when docker is ready ----------------
echo "T2: ready on first check"
echo 0 > "$DOCKER_STUB_COUNTER"
t0=$(date +%s)
DOCKER_POLL_S=1 wait_for_docker 5 >/dev/null
rc=$?
elapsed=$(( $(date +%s) - t0 ))
assert_eq "$rc" "0" "exit code is 0 when docker is immediately up"
[[ "$elapsed" -le 1 ]] \
  && { echo "  ok   — returns within 1s when ready"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL — took ${elapsed}s when ready"; FAIL=$((FAIL + 1)); }

# ---- T3: waits and succeeds when docker becomes ready --------------
echo "T3: ready after a few failures (Docker Desktop warming up)"
echo 2 > "$DOCKER_STUB_COUNTER"
t0=$(date +%s)
DOCKER_POLL_S=1 wait_for_docker 10 >/dev/null
rc=$?
elapsed=$(( $(date +%s) - t0 ))
assert_eq "$rc" "0" "returns 0 once docker becomes ready"
[[ "$elapsed" -ge 1 && "$elapsed" -le 6 ]] \
  && { echo "  ok   — waited ~${elapsed}s for warmup"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL — wait was ${elapsed}s (expected 1..6)"; FAIL=$((FAIL + 1)); }

# ---- T4: gives up after timeout with non-zero exit -----------------
echo "T4: gives up if docker never comes ready"
echo 999 > "$DOCKER_STUB_COUNTER"
t0=$(date +%s)
DOCKER_POLL_S=1 wait_for_docker 3 >/dev/null 2>&1
rc=$?
elapsed=$(( $(date +%s) - t0 ))
[[ "$rc" -ne 0 ]] \
  && { echo "  ok   — non-zero exit on timeout (rc=$rc)"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL — exited 0 even though docker never readied"; FAIL=$((FAIL + 1)); }
[[ "$elapsed" -ge 3 && "$elapsed" -le 6 ]] \
  && { echo "  ok   — respected the ~3s timeout (took ${elapsed}s)"; PASS=$((PASS + 1)); } \
  || { echo "  FAIL — timeout window wrong (took ${elapsed}s, want 3..6)"; FAIL=$((FAIL + 1)); }

# ---- T5: defaults — no args should still work, picking a sensible timeout
echo "T5: default timeout is callable"
echo 0 > "$DOCKER_STUB_COUNTER"
DOCKER_POLL_S=1 wait_for_docker >/dev/null
assert_eq "$?" "0" "callable with no args when docker is ready"

echo
echo "----------------------------"
echo "$PASS pass / $FAIL fail"
[[ "$FAIL" -eq 0 ]] || exit 1
