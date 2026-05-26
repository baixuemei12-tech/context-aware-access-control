#!/usr/bin/env bash
# lib/docker-ready.sh — patient Docker readiness check.
#
# After a host reboot Docker Desktop's WSL integration commonly takes
# 10–30s to come online. The original start.sh did `docker info` once
# and exited non-zero — meaning a user who launched start.sh right
# after boot would be told to "start Docker Desktop" even though it
# was already starting. This helper polls instead.
#
# Usage from start.sh:
#   source "$PROJ/lib/docker-ready.sh"
#   wait_for_docker 60 || { err "..."; exit 1; }
#
# Tunables:
#   $1 (positional) — max wait seconds (default 60)
#   $DOCKER_POLL_S  — seconds between polls (default 2)
#
# Side effects: prints a single "waiting for Docker" line the first
# time it has to wait, so the user knows the script isn't hung.

wait_for_docker() {
  local max_wait_s="${1:-60}"
  local poll_s="${DOCKER_POLL_S:-2}"
  local waited=0

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  # Use printf so this file is safe to source even if the caller's
  # `log`/`color` helpers aren't defined.
  printf '\033[1;33m[!] Docker not yet ready — waiting up to %ss (Desktop may still be starting)\033[0m\n' \
    "$max_wait_s" >&2

  while (( waited < max_wait_s )); do
    sleep "$poll_s"
    waited=$((waited + poll_s))
    if docker info >/dev/null 2>&1; then
      printf '\033[1;32m[OK] Docker is ready (took ~%ss)\033[0m\n' "$waited" >&2
      return 0
    fi
  done
  return 1
}
