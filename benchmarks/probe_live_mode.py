"""Live SSE probe — verify mock loop falls silent during /bench/push burst
and resumes after the grace tail. NOT a unit test; just a diagnostic.

Run with the Vite dev server up:
    python3 probe_live_mode.py
"""
import json
import threading
import time
import urllib.request
from collections import Counter
from topology_emit import attack_events

BASE = "http://127.0.0.1:5173"
DURATION = 12.0  # total seconds to capture

events = []     # (t_rel, source-of-truth-pubsub source, kind, phase, reason)
t0 = None


def sse_listener():
    global t0
    req = urllib.request.Request(f"{BASE}/bench/stream")
    with urllib.request.urlopen(req, timeout=DURATION + 5) as resp:
        t0 = time.monotonic()
        deadline = t0 + DURATION
        data_lines = []
        while time.monotonic() < deadline:
            raw = resp.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())
            elif line == "":
                if data_lines:
                    try:
                        ev = json.loads("".join(data_lines))
                        events.append((
                            round(time.monotonic() - t0, 3),
                            ev.get("sourceNode"),
                            ev.get("kind"),
                            ev.get("phase"),
                            (ev.get("reason") or "")[:60],
                        ))
                    except Exception:
                        pass
                    data_lines = []


t = threading.Thread(target=sse_listener, daemon=True)
t.start()

# Let SSE warm up + show some mock traffic
time.sleep(2.0)

# Push a real attack batch (A1 — full 6-edge replay chain, ~1980ms total span)
push_events = attack_events("A1", outcome="BLOCKED", attacker="subj-attacker")
total_delay = sum(e.get("delayMs", 0) for e in push_events)
print(f"[probe] pushing {len(push_events)} A1 events, batch span = {total_delay} ms")
req = urllib.request.Request(
    f"{BASE}/bench/push",
    data=json.dumps({"events": push_events}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
t_push = round(time.monotonic() - t0, 3) if t0 else "?"
with urllib.request.urlopen(req, timeout=3) as resp:
    body = json.loads(resp.read().decode("utf-8"))
print(f"[probe] push t={t_push}s, accepted={len(body.get('accepted', []))}, "
      f"rejected={len(body.get('rejected', []))}")

t.join()

# Slice events into windows: before push, during live window, after grace tail
push_at = float(t_push) if t_push != "?" else 2.0
live_ends = push_at + total_delay / 1000.0 + 3.0
print()
print(f"=== SSE capture: {len(events)} events over {DURATION}s ===")
print(f"push_at = {push_at}s; live_ends ≈ {live_ends:.2f}s\n")

windows = {
    "before-push": [],
    "during-live": [],
    "after-grace": [],
}
for ev in events:
    t_rel, src, kind, phase, reason = ev
    if t_rel < push_at - 0.05:
        windows["before-push"].append(ev)
    elif t_rel < live_ends:
        windows["during-live"].append(ev)
    else:
        windows["after-grace"].append(ev)

# Identify which events look like mock-loop traffic vs live-pushed traffic.
# Live A1 batch sources are a fixed set; mock chooses from a wider pool.
LIVE_A1_SOURCES = {"subj-attacker", "gateway", "oracle", "fabric"}


def classify(ev):
    t_rel, src, kind, phase, reason = ev
    if "live-attack" in (reason or "") or "Mock paused" in (reason or ""):
        return "live-meta"
    if phase == "request" and "A1" in reason:
        return "live-A1"
    if "A1" in (reason or ""):
        return "live-A1"
    if src in ("mock-bench",):
        return "mock-meta"
    return "mock"


for name, evs in windows.items():
    counts = Counter(classify(e) for e in evs)
    print(f"--- {name}: {len(evs)} events  {dict(counts)}")
    for e in evs[:10]:
        print(f"     t={e[0]:6.2f}  src={e[1]:<14}  kind={e[2]:<6}  phase={e[3]:<10}  {e[4]}")
    if len(evs) > 10:
        print(f"     ... and {len(evs) - 10} more")
    print()

# Pass/fail summary
during = windows["during-live"]
during_mock = [e for e in during if classify(e) == "mock"]
during_live = [e for e in during if classify(e).startswith("live")]
print("=== verdict ===")
print(f"mock events DURING live window: {len(during_mock)}  (target: 0)")
print(f"live events DURING live window: {len(during_live)}  (target: >=1)")
after = windows["after-grace"]
after_mock = [e for e in after if classify(e) == "mock"]
print(f"mock events AFTER grace tail:   {len(after_mock)}  (target: >=1, mock resumed)")
