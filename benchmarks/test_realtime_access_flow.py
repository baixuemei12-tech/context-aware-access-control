"""End-to-end SSE integration test for the realtime access-flow feed.

Run:
    # Bring up the full stack first (start.sh).
    CAAC_GATEWAY_URL=http://localhost:5051 \
    CAAC_TEST_USER=admin \
    CAAC_TEST_PASSWORD='<admin-pw>' \
        python -m unittest benchmarks.test_realtime_access_flow

Skipped automatically when CAAC_GATEWAY_URL is not set, so the unit-test
run stays fast and self-contained.

What we verify against the real gateway:
  1. Subscribing to /api/events/stream as a logged-in user works.
  2. Hitting POST /api/files/<id>/web-access produces a FILE_ACCESS frame
     on the SSE stream whose data.decision is PERMIT / DENY / ERROR (the
     exact value depends on whether Fabric Oracle is reachable; either is
     a valid "saw the event" outcome).
  3. The event payload carries the Algorithm 1 fields the topology
     translator needs (dtScore, ceScore, decision).
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import unittest
from typing import Optional

import requests


GATEWAY_URL = os.environ.get("CAAC_GATEWAY_URL")
TEST_USER = os.environ.get("CAAC_TEST_USER", "admin")
TEST_PASSWORD = os.environ.get("CAAC_TEST_PASSWORD", "")
TEST_FILE = os.environ.get("CAAC_TEST_FILE", "")


def _login(base: str, username: str, password: str) -> str:
    r = requests.post(
        f"{base}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    token = data.get("token") or data.get("accessToken")
    if not token:
        raise RuntimeError(f"login response missing token: {data}")
    return token


def _pick_approved_file(base: str, token: str) -> str:
    r = requests.get(
        f"{base}/api/files/admin/all",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    r.raise_for_status()
    files = r.json().get("files", [])
    for f in files:
        if f.get("status") == "APPROVED":
            return f["fileId"]
    raise RuntimeError("no APPROVED file in registry to exercise web-access against")


def _stream_caac_events(base: str, token: str, q: queue.Queue, stop: threading.Event) -> None:
    """Long-poll /api/events/stream; push each parsed event into `q`."""
    try:
        with requests.get(
            f"{base}/api/events/stream",
            headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
            stream=True,
            timeout=(10, 30),
        ) as resp:
            resp.raise_for_status()
            buf: list[str] = []
            for raw in resp.iter_lines(decode_unicode=True):
                if stop.is_set():
                    return
                if raw is None:
                    continue
                if raw == "":
                    if buf:
                        for line in buf:
                            if line.startswith("data:"):
                                payload = line[5:].strip()
                                try:
                                    q.put(json.loads(payload))
                                except json.JSONDecodeError:
                                    pass
                        buf = []
                    continue
                buf.append(raw)
    except requests.exceptions.RequestException as e:
        q.put({"__error__": str(e)})


def _wait_for(q: queue.Queue, predicate, timeout: float) -> Optional[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            msg = q.get(timeout=max(0.1, remaining))
        except queue.Empty:
            continue
        if "__error__" in msg:
            raise AssertionError(f"SSE stream errored: {msg['__error__']}")
        if predicate(msg):
            return msg
    return None


@unittest.skipUnless(
    GATEWAY_URL and TEST_PASSWORD,
    "set CAAC_GATEWAY_URL and CAAC_TEST_PASSWORD to run E2E against a live gateway",
)
class TestRealtimeAccessFlow(unittest.TestCase):
    """Live SSE integration — requires the full stack running locally."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.token = _login(GATEWAY_URL, TEST_USER, TEST_PASSWORD)
        cls.file_id = TEST_FILE or _pick_approved_file(GATEWAY_URL, cls.token)

    def test_web_access_emits_file_access_frame(self) -> None:
        q: queue.Queue = queue.Queue()
        stop = threading.Event()
        thread = threading.Thread(
            target=_stream_caac_events,
            args=(GATEWAY_URL, self.token, q, stop),
            daemon=True,
        )
        thread.start()
        # Let the subscription handshake settle (CONNECTED frame).
        connected = _wait_for(q, lambda m: m.get("type") == "CONNECTED", timeout=5.0)
        self.assertIsNotNone(
            connected,
            "expected a CONNECTED handshake frame on subscription",
        )

        # Trigger the access decision in a background thread so the SSE
        # consumer doesn't miss the immediate FILE_ACCESS push.
        def fire_request():
            try:
                requests.post(
                    f"{GATEWAY_URL}/api/files/{self.file_id}/web-access",
                    headers={"Authorization": f"Bearer {self.token}"},
                    json={
                        "networkType": "wifi",
                        "platform": "Linux x86_64",
                        "screenWidth": 1920,
                        "screenHeight": 1080,
                        "timezone": "Asia/Shanghai",
                        "language": "en-US",
                        "userAgent": "caac-e2e-test/1.0",
                    },
                    timeout=20,
                )
            except requests.exceptions.RequestException:
                pass

        threading.Thread(target=fire_request, daemon=True).start()

        msg = _wait_for(
            q,
            lambda m: m.get("type") == "FILE_ACCESS"
            and isinstance(m.get("data"), dict)
            and m["data"].get("fileId") == self.file_id,
            timeout=15.0,
        )
        stop.set()

        self.assertIsNotNone(msg, "no FILE_ACCESS frame arrived within 15s")
        data = msg["data"]
        self.assertIn(
            data.get("decision"),
            {"PERMIT", "DENY", "ERROR"},
            f"unexpected decision: {data.get('decision')!r}",
        )
        self.assertIn("dtScore", data, "FILE_ACCESS payload missing Algorithm 1 dtScore")
        self.assertIn("ceScore", data, "FILE_ACCESS payload missing Algorithm 1 ceScore")
        self.assertEqual(data.get("username"), TEST_USER)


if __name__ == "__main__":
    unittest.main()
