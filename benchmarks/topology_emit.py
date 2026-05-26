"""topology_emit — push BV-GCA attack events to the frontend runtime topology.

Pure mapping `attack_events(attack, outcome, **kwargs)` returns a list of
event dicts shaped like the JS bench-bus normalizer expects:

    {kind: 'edge'|'node'|'burst'|'meta',
     sourceNode: '<id>', targetNode?: '<id>',
     status: 'ok'|'pending'|'blocked'|...,
     phase?: 'evaluate'|'request'|...,
     reason?: '<short label>'}

`emit(events, base)` POSTs them to `${base}/bench/push`.

`base` defaults to http://127.0.0.1:5173 (Vite dev server). The Vite plugin
broadcasts every accepted event over SSE so the admin topology renders the
attacker's path in real time alongside the mock loop.

Tested by benchmarks/test_topology_emit.py.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Iterable

try:
    import requests
except ImportError:  # tests can run without requests installed
    requests = None  # type: ignore


_VALID_KINDS = {"node", "edge", "burst", "meta", "ctx-snapshot", "ctx-change"}
_seq = 0


# --------------------------------------------------------------- #
# 1. normalize_event — schema + defaults (mirrors bench-bus.js)
# --------------------------------------------------------------- #
def normalize_event(payload: dict) -> dict:
    global _seq
    if not isinstance(payload, dict):
        raise ValueError("event payload must be a dict")
    kind = payload.get("kind")
    if kind not in _VALID_KINDS:
        raise ValueError(
            f"event kind {kind!r} is invalid; expected one of {sorted(_VALID_KINDS)}"
        )
    if kind in ("edge", "burst"):
        if not payload.get("sourceNode"):
            raise ValueError(f"event kind={kind} requires sourceNode")
        if not payload.get("targetNode"):
            raise ValueError(f"event kind={kind} requires targetNode")
    elif kind in ("ctx-snapshot", "ctx-change"):
        if not payload.get("userId"):
            raise ValueError(f"event kind={kind} requires userId")
        if kind == "ctx-change" and not payload.get("field"):
            raise ValueError("event kind=ctx-change requires field")
    else:
        if not payload.get("sourceNode"):
            raise ValueError(f"event kind={kind} requires sourceNode")

    _seq += 1
    out = {
        "id": payload.get("id") or f"evt-{int(time.time() * 1000)}-{_seq}",
        "ts": payload.get("ts", int(time.time() * 1000)),
        "severity": payload.get("severity", "info"),
    }
    out.update(payload)
    out["kind"] = kind
    return out


# --------------------------------------------------------------- #
# 2. attack_events — pure mapping from attack name → events
# --------------------------------------------------------------- #
ATTACKER = "subj-attacker"


def _status_for(outcome: str) -> str:
    """In the BV-GCA suite `PASS`/`BLOCKED` both mean the system blocked the
    attack — topology should render those as blocked. `FAIL` would mean a
    vulnerability (attack reached its goal) — render as `ok` so the operator
    sees a green ✗ where a red ✓ should have been."""
    u = (outcome or "").upper()
    if u in ("PASS", "BLOCKED", "DENIED", "DENY"):
        return "blocked"
    if u in ("FAIL", "PERMIT", "OK"):
        return "ok"
    return "pending"


def _edge(src: str, tgt: str, status: str, reason: str = "", **extra) -> dict:
    return normalize_event({
        "kind": "edge",
        "sourceNode": src,
        "targetNode": tgt,
        "status": status,
        "reason": reason,
        "actionType": "attack",
        **extra,
    })


def _node(node_id: str, status: str, reason: str = "", **extra) -> dict:
    return normalize_event({
        "kind": "node",
        "sourceNode": node_id,
        "status": status,
        "reason": reason,
        **extra,
    })


# Default per-hop pacing (ms). The Vite plugin reads `delayMs` from each
# event and schedules `bus.publish` at the running offset so the cascade
# appears as a stepwise flow on the topology instead of a single-frame
# flash. Numbers tuned for live demo readability: each hop ~700 ms so a
# human observer can follow the chain; terminal DENY edge lingers 1.5 s.
_STEP_MS_DEFAULT = 700
_STEP_MS_FINAL_PAUSE = 1500  # last "blocked" edge lingers for emphasis


def _pace(events: list[dict], step_ms: int = _STEP_MS_DEFAULT) -> list[dict]:
    """Assign each event a `delayMs` = gap AFTER it before the next one.
    The terminal event gets 0 (no follow-up).  Mutates and returns the
    same list for chaining convenience.
    """
    last = len(events) - 1
    for i, ev in enumerate(events):
        if i == last:
            ev["delayMs"] = 0
        elif ev.get("status") in ("blocked", "denied"):
            # When a hop transitions to a terminal-style block, give the
            # operator extra time to absorb it before the next hop fires.
            ev["delayMs"] = _STEP_MS_FINAL_PAUSE
        else:
            ev["delayMs"] = step_ms
    return events


# --------------------------------------------------------------- #
# 2b. attacker context — baseline snapshot + per-attack mutations
# --------------------------------------------------------------- #
# The attacker's user node shows a hover tooltip with 12 fields (6 subject +
# 6 environment). Without a snapshot the tooltip is empty dashes. The baseline
# below puts the attacker on the canvas as a plausible low-priv user; each
# attack then emits one or more `ctx-change` events that flip a single field
# to a value the PDP would reject — operators see the mutation pulse on the
# node a few hundred ms before the matching edge cascade ends in DENY.
ATTACKER_BASELINE_SUBJECT = {
    "R":        1,
    "T":        0.10,
    "L_trust":  0.90,
    "D_sec":    0.85,
    "DT_score": 0.85,
    "N_status": 1.00,
}
ATTACKER_BASELINE_ENV = {
    "networkType": "wifi",
    "ip":          "192.168.1.42",
    "platform":    "Win11",
    "timezone":    "Asia/Shanghai",
    "screen":      "1920x1080",
    "language":    "zh-CN",
}

# attack id (upper) → list of (field, old, new, reason)
_ATTACK_CTX_MUTATIONS: dict[str, list[tuple]] = {
    "A1": [("N_status", 1.00, 0.10, "session replay anomaly")],
    "A2": [("L_trust",  0.90, 0.05, "forged sid evidence")],
    "A3": [("R",        1,    5,    "claim admin role")],
    "A4": [("L_trust",  0.90, 0.00, "HMAC signature failed")],
    "A5": [("N_status", 1.00, 0.20, "concurrent burst anomaly")],
    "A6": [("L_trust",  0.90, 0.05, "bearer token tampered")],
    "A7": [("R",        1,    5,    "cross-user session reuse"),
           ("N_status", 1.00, 0.10, "session-owner mismatch")],
    "A8": [("T",        0.10, 0.95, "request rate spike")],
    "A9": [("networkType", "wifi",      "enterprise-vpn",        "spoofed network type"),
           ("platform",    "Win11",     "SecureWorkstation/2.0", "spoofed platform"),
           ("screen",      "1920x1080", "2560x1440",             "spoofed screen size")],
}

# Pacing for the ctx prefix before the edge cascade. The last ctx-change has
# a longer delay so the floating badge has time to render before the request
# edge fires — the operator sees mutation, then half a beat, then the cascade.
_CTX_STEP_MS = 300
_CTX_LAST_GAP_MS = 600


def attacker_baseline_snapshot(attacker: str = ATTACKER) -> dict:
    """One `ctx-snapshot` event populating the attacker's tooltip on demo start."""
    return normalize_event({
        "kind":        "ctx-snapshot",
        "userId":      attacker,
        "subject":     dict(ATTACKER_BASELINE_SUBJECT),
        "environment": dict(ATTACKER_BASELINE_ENV),
        "reason":      "attacker baseline context",
    })


def attack_ctx_events(attack: str, attacker: str = ATTACKER) -> list[dict]:
    """Per-attack `ctx-change` list. Empty for unknown attacks."""
    a = (attack or "").upper()
    mutations = _ATTACK_CTX_MUTATIONS.get(a, [])
    events: list[dict] = []
    for field, old, new, reason in mutations:
        events.append(normalize_event({
            "kind":     "ctx-change",
            "userId":   attacker,
            "field":    field,
            "oldValue": old,
            "newValue": new,
            "reason":   reason,
        }))
    return events


def _with_ctx_prefix(cascade: list[dict], attack: str, attacker: str) -> list[dict]:
    """Prepend `attack_ctx_events(...)` to a paced cascade and attach delays
    on the ctx prefix so the operator sees mutation badges land *before* the
    first request edge fires."""
    ctx = attack_ctx_events(attack, attacker)
    if not ctx:
        return cascade
    for ev in ctx[:-1]:
        ev["delayMs"] = _CTX_STEP_MS
    ctx[-1]["delayMs"] = _CTX_LAST_GAP_MS
    return ctx + cascade


def attack_events(
    attack: str,
    outcome: str = "BLOCKED",
    attacker: str = ATTACKER,
    target_file: str | None = None,
    n: int = 1,
    detail: str = "",
) -> list[dict]:
    """Returns the ordered event sequence that paints `attack` on the topology.

    Empty list for unknown attack names — callers can skip silently.
    """
    a = (attack or "").upper()
    final_status = _status_for(outcome)
    reason = detail or f"{a} {outcome}"

    # A1 Replay / A3 PrivEsc / A8 Budget / A9 Context — full path attacker→gateway→oracle→fabric
    if a in ("A1", "A3", "A8", "A9"):
        evs = [
            _edge(attacker,  "gateway",   "pending", f"{a}: request", phase="request"),
            _edge("gateway", "oracle",    "pending", f"{a}: evaluate", phase="evaluate"),
            _edge("oracle",  "fabric",    "pending", "Fabric PDP evaluateAccess()", phase="evaluate"),
            _edge("fabric",  "oracle",    final_status, reason, phase="decide"),
            _edge("oracle",  "gateway",   final_status, reason, phase="decide"),
            _edge("gateway", attacker,    final_status, reason, phase="respond"),
        ]
        if target_file:
            evs.append(_node(target_file, final_status, reason))
        return _with_ctx_prefix(_pace(evs), a, attacker)

    # A2 Session hijacking / A6 Token manipulation / A7 Cross-user — gateway rejects
    if a in ("A2", "A6", "A7"):
        return _with_ctx_prefix(_pace([
            _edge(attacker,  "gateway", "pending",     f"{a}: forged token / session", phase="request"),
            _edge("gateway", attacker,  final_status,  reason,                          phase="respond"),
        ]), a, attacker)

    # A4 HMAC forgery — direct hit on Oracle; never reaches Fabric
    if a == "A4":
        return _with_ctx_prefix(_pace([
            _edge(attacker, "oracle", "pending",    "A4: tampered HMAC", phase="request"),
            _edge("oracle", attacker, final_status, reason,              phase="respond"),
        ]), a, attacker)

    # A5 Concurrent flood — burst from attacker spraying gateway
    if a == "A5":
        burst = normalize_event({
            "kind": "burst",
            "sourceNode": attacker,
            "targetNode": "gateway",
            "via": [],
            "status": "pending",
            "reason": f"A5: {n}× concurrent sessions",
            "actionType": "attack",
        })
        # Trail of edges showing each parallel request, ending in the verdict
        rest = [
            _edge(attacker, "gateway", "pending", f"A5 burst #{i + 1}", phase="request")
            for i in range(min(n, 6))
        ]
        rest.append(_edge("gateway", attacker, final_status, reason, phase="respond"))
        return _with_ctx_prefix(_pace([burst, *rest], step_ms=320), a, attacker)

    return []


# --------------------------------------------------------------- #
# 3. emit — HTTP push to the Vite plugin
# --------------------------------------------------------------- #
def emit(events: Iterable[dict], base: str = "http://127.0.0.1:5173", timeout: float = 1.5) -> dict:
    """Best-effort POST to /bench/push. Silent on transport failure so the
    attack run keeps going even if the topology UI is closed."""
    payload = list(events)
    if not payload:
        return {"ok": True, "accepted": [], "rejected": []}
    if requests is None:
        return {"ok": False, "error": "requests not installed"}
    try:
        r = requests.post(
            f"{base.rstrip('/')}/bench/push",
            data=json.dumps({"events": payload}),
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return {"ok": True}
        return {"ok": False, "status": r.status_code, "body": r.text[:200]}
    except Exception as e:
        # Don't let topology pushing crash the attack suite.
        return {"ok": False, "error": str(e)[:200]}


# Convenience wrapper for callers that already know the attack name.
def emit_attack(
    attack: str,
    outcome: str = "BLOCKED",
    base: str = "http://127.0.0.1:5173",
    **kwargs,
) -> dict:
    return emit(attack_events(attack, outcome, **kwargs), base=base)


# --------------------------------------------------------------- #
# 4. set_mode / emit_meta — demo orchestration helpers
# --------------------------------------------------------------- #
def set_mode(mode: str, base: str = "http://127.0.0.1:5173", timeout: float = 1.5) -> dict:
    """Toggle the bus into live-only or mixed mode. Best-effort; swallows
    transport errors so the attack suite keeps running even if the Vite
    dev server is down."""
    if mode not in ("live", "mixed"):
        return {"ok": False, "error": f"mode must be 'live' or 'mixed', got {mode!r}"}
    if requests is None:
        return {"ok": False, "error": "requests not installed"}
    try:
        r = requests.post(
            f"{base.rstrip('/')}/bench/mode",
            data=json.dumps({"mode": mode}),
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return {"ok": True, "mode": mode}
        return {"ok": False, "status": r.status_code, "body": r.text[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def emit_meta(
    reason: str,
    base: str = "http://127.0.0.1:5173",
    status: str = "ok",
    phase: str = "register",
    source_node: str = "attack-sim",
) -> dict:
    """Fire a single `meta` event — used by the attack sim to drop phase
    banners ("PHASE 1", "PHASE 2") into the topology log."""
    ev = normalize_event({
        "kind": "meta",
        "sourceNode": source_node,
        "status": status,
        "phase": phase,
        "reason": reason,
        "delayMs": 0,
    })
    return emit([ev], base=base)
