"""Unit tests covering transport-error resilience of the BV-GCA attack suite.

Run:
    cd benchmarks && python3 -m unittest test_attack_resilience.py

The real gateway sometimes hangs (no fast 410/404 path) when a streaming
session has been revoked. The attack suite must NOT crash on such a
timeout — from a security standpoint, a transport timeout = attacker
received nothing = the attack was effectively blocked. We just need to
record it as PASS / BLOCKED instead of letting requests.ReadTimeout
escape and kill the whole run.
"""
from __future__ import annotations

import unittest
from unittest import mock

import requests
import bvgca_attack_sim as sim


class TestAttackSessionReplayTransportErrors(unittest.TestCase):
    """A1 — replay attempt against a closed session.

    The vulnerable behaviour we're guarding against: the second GET in
    attack_session_replay is unwrapped, so a slow / hanging gateway
    raises ReadTimeout up out of main() and kills every subsequent
    attack. After the fix the function must swallow the transport
    error and log it as PASS (attack effectively blocked).
    """

    def setUp(self):
        sim.results_log.clear()

    def test_readtimeout_on_replay_does_not_propagate(self):
        """A ReadTimeout on the replay GET must NOT escape the function."""

        def always_timeout(*_a, **_kw):
            raise requests.exceptions.ReadTimeout("simulated gateway hang")

        with mock.patch.object(sim, "access_file", return_value=("sess-1", {})), \
                mock.patch("requests.get", side_effect=always_timeout), \
                mock.patch("requests.post", side_effect=always_timeout):
            try:
                sim.attack_session_replay("http://x", "tok", "file-1")
            except requests.exceptions.RequestException as e:
                self.fail(
                    f"attack_session_replay leaked a transport error: {e!r}. "
                    "Transport timeouts should be caught and logged, not "
                    "propagated."
                )

    def test_readtimeout_on_replay_logged_not_as_failure(self):
        """Timeout on a replay attempt = attacker got nothing.  The
        log entry's status must NOT be FAIL (which would falsely report
        a vulnerability)."""

        # First stream call: succeeds & exhausts, so stream_closed=True.
        # Second stream call: gateway hangs → ReadTimeout.
        # Third call (POST degrade): also ReadTimeout.
        call_state = {"get_n": 0}

        class _FakeStream:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def iter_content(self, chunk_size=2048): return iter([])

        def fake_get(*_a, **_kw):
            call_state["get_n"] += 1
            if call_state["get_n"] == 1:
                return _FakeStream()
            raise requests.exceptions.ReadTimeout("simulated")

        def fake_post(*_a, **_kw):
            raise requests.exceptions.ReadTimeout("simulated")

        with mock.patch.object(sim, "access_file", return_value=("sess-1", {})), \
                mock.patch.object(sim.time, "sleep", lambda *_a, **_kw: None), \
                mock.patch("requests.get", side_effect=fake_get), \
                mock.patch("requests.post", side_effect=fake_post):
            sim.attack_session_replay("http://x", "tok", "file-1")

        a1 = [r for r in sim.results_log if r["test"] == "A1-Replay"]
        self.assertTrue(a1, "expected at least one A1-Replay log entry")
        statuses = {r["status"] for r in a1}
        self.assertNotIn(
            "FAIL", statuses,
            f"Transport timeout must not be recorded as FAIL (would falsely "
            f"claim a vulnerability). Got entries: {a1}"
        )
        # Replay entry must exist regardless of which branch fired.
        replay_entries = [r for r in a1 if r["metric"].startswith("Replay")]
        self.assertTrue(replay_entries,
                        "expected a 'Replay closed session' entry even when "
                        "the gateway times out")

    def test_replay_with_real_403_still_passes(self):
        """Regression: when the gateway DOES respond cleanly with 403,
        the existing PASS-path must still fire (we didn't break the happy
        case)."""

        class _FakeStream:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def iter_content(self, chunk_size=2048): return iter([])

        class _Resp:
            def __init__(self, code): self.status_code = code

        get_calls = {"n": 0}
        def fake_get(*_a, **_kw):
            get_calls["n"] += 1
            if get_calls["n"] == 1:
                return _FakeStream()
            return _Resp(403)

        def fake_post(*_a, **_kw):
            return _Resp(404)

        with mock.patch.object(sim, "access_file", return_value=("sess-1", {})), \
                mock.patch.object(sim.time, "sleep", lambda *_a, **_kw: None), \
                mock.patch("requests.get", side_effect=fake_get), \
                mock.patch("requests.post", side_effect=fake_post):
            sim.attack_session_replay("http://x", "tok", "file-1")

        a1 = [r for r in sim.results_log if r["test"] == "A1-Replay"]
        replay = [r for r in a1 if r["metric"].startswith("Replay")]
        self.assertEqual(len(replay), 1)
        self.assertEqual(replay[0]["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
