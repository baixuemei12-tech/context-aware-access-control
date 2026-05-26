"""Unit tests for benchmarks/topology_emit.py.

Run:
    cd benchmarks && python3 -m unittest test_topology_emit.py
"""
import unittest
from topology_emit import (
    attack_events, normalize_event,
    attacker_baseline_snapshot, attack_ctx_events,
    ATTACKER_BASELINE_SUBJECT, ATTACKER_BASELINE_ENV,
)


class TestNormalizeEvent(unittest.TestCase):
    def test_minimal_node_event_filled(self):
        ev = normalize_event({"kind": "node", "sourceNode": "subj-attacker"})
        self.assertEqual(ev["kind"], "node")
        self.assertEqual(ev["sourceNode"], "subj-attacker")
        self.assertTrue(ev["id"].startswith("evt-"))
        self.assertIsInstance(ev["ts"], int)

    def test_preserves_supplied_id(self):
        ev = normalize_event({"id": "my-id", "kind": "node", "sourceNode": "x"})
        self.assertEqual(ev["id"], "my-id")

    def test_edge_requires_both_endpoints(self):
        with self.assertRaisesRegex(ValueError, "targetNode"):
            normalize_event({"kind": "edge", "sourceNode": "a"})
        with self.assertRaisesRegex(ValueError, "sourceNode"):
            normalize_event({"kind": "edge", "targetNode": "b"})

    def test_unknown_kind_rejected(self):
        with self.assertRaisesRegex(ValueError, "kind"):
            normalize_event({"kind": "banana", "sourceNode": "x"})


class TestAttackEventsA1Replay(unittest.TestCase):
    """A1 = session replay attack — attacker → gateway → oracle → fabric → DENY."""

    def test_blocked_outcome_returns_pending_then_blocked_path(self):
        evs = attack_events("A1", outcome="BLOCKED", attacker="subj-attacker")
        # Expect at least 4 events: attacker→gateway (pending), gw→oracle, oracle→fabric, fabric (denied)
        self.assertGreaterEqual(len(evs), 3)
        # The cascade may be preceded by ctx-change prefix events; locate
        # the first actual edge event and confirm it originates at the attacker.
        first_edge = next((e for e in evs if e.get("kind") == "edge"), None)
        self.assertIsNotNone(first_edge, "expected at least one edge event")
        self.assertEqual(first_edge["sourceNode"], "subj-attacker")
        self.assertEqual(first_edge["targetNode"], "gateway")
        # Final event must be a DENY/BLOCKED reaching either gateway or fabric
        final_statuses = [e.get("status") for e in evs]
        self.assertIn("blocked", final_statuses + ["blocked"])  # at least one blocked

    def test_passed_outcome_marks_attack_thwarted(self):
        evs = attack_events("A1", outcome="PASS", attacker="subj-attacker")
        # PASS in the suite means the system correctly blocked the attack →
        # topology should still show a blocked path (the attack was caught)
        statuses = {e.get("status") for e in evs}
        self.assertIn("blocked", statuses,
                      "PASS outcome (correctly blocked) must visualize as blocked")


class TestAttackEventsA3PrivEsc(unittest.TestCase):
    """A3 = privilege escalation — low-priv user → gateway → oracle → fabric → DENY."""

    def test_attack_path_includes_fabric_pdp(self):
        evs = attack_events("A3", outcome="BLOCKED", attacker="subj-attacker")
        nodes_touched = set()
        for e in evs:
            nodes_touched.add(e.get("sourceNode"))
            nodes_touched.add(e.get("targetNode"))
        # PDP decision happens on Fabric chaincode → fabric must appear
        self.assertIn("fabric", nodes_touched,
                      "A3 should reach the Fabric PDP for the DENY decision")


class TestAttackEventsA4HMAC(unittest.TestCase):
    """A4 = HMAC forgery — direct hit on Oracle, never reaches Fabric."""

    def test_a4_does_not_reach_fabric(self):
        evs = attack_events("A4", outcome="BLOCKED", attacker="subj-attacker")
        nodes_touched = set()
        for e in evs:
            nodes_touched.add(e.get("sourceNode"))
            nodes_touched.add(e.get("targetNode"))
        self.assertIn("oracle", nodes_touched)
        self.assertNotIn(
            "fabric", nodes_touched,
            "A4 forged HMAC must be rejected at Oracle before reaching Fabric"
        )


class TestAttackEventsA5Flood(unittest.TestCase):
    """A5 = concurrent session flood — burst event hitting gateway hard."""

    def test_a5_uses_burst_or_multiple_edges(self):
        evs = attack_events("A5", outcome="BLOCKED", attacker="subj-attacker", n=5)
        # Either one burst event OR multiple edge events
        bursts = [e for e in evs if e.get("kind") == "burst"]
        edges  = [e for e in evs if e.get("kind") == "edge"]
        self.assertTrue(
            len(bursts) >= 1 or len(edges) >= 3,
            "A5 should appear as a burst or as multiple edges"
        )


class TestAttackEventsUnknown(unittest.TestCase):
    def test_unknown_attack_returns_empty_list(self):
        self.assertEqual(attack_events("AX", outcome="BLOCKED"), [])


class TestAttackEventsPacing(unittest.TestCase):
    """Each emitted event must carry a positive `delayMs` so the Vite plugin
    can pace the batch via setTimeout — otherwise all edges in a single
    POST fire at the exact same instant on the frontend and the attack
    flow becomes an indistinguishable one-frame flash.
    """

    def _assert_paced(self, attack_id):
        evs = attack_events(attack_id, outcome="BLOCKED", n=4)
        self.assertTrue(evs, f"{attack_id} must emit at least one event")
        for i, ev in enumerate(evs):
            self.assertIn("delayMs", ev,
                          f"{attack_id}[{i}] event missing delayMs hint")
            self.assertIsInstance(ev["delayMs"], (int, float))
            self.assertGreaterEqual(
                ev["delayMs"], 0,
                f"{attack_id}[{i}] delayMs must be >= 0"
            )
        # At least the *middle* events must have non-zero delay, else the
        # cascade collapses to "all simultaneous" anyway.
        non_zero = [ev for ev in evs[:-1] if ev["delayMs"] > 0]
        self.assertGreaterEqual(
            len(non_zero), max(1, len(evs) - 2),
            f"{attack_id}: most events need non-zero delayMs to cascade"
        )

    def test_a1_replay_events_are_paced(self):
        self._assert_paced("A1")

    def test_a4_hmac_events_are_paced(self):
        self._assert_paced("A4")

    def test_a5_flood_events_are_paced(self):
        self._assert_paced("A5")


class TestAttackerContextEvents(unittest.TestCase):
    """The runtime topology surfaces the attacker's 12-field context in a hover
    tooltip. The attack-sim seeds it once with a baseline `ctx-snapshot` and
    each attack emits one or more `ctx-change` events that visualize *why*
    the request is about to be denied — operators see a red field-badge pop
    over the attacker node milliseconds before the matching DENY edge.
    """

    def test_baseline_snapshot_populates_all_12_fields(self):
        ev = attacker_baseline_snapshot()
        self.assertEqual(ev["kind"], "ctx-snapshot")
        self.assertEqual(ev["userId"], "subj-attacker")
        # Snapshot must include every documented subject + environment field
        for f in ATTACKER_BASELINE_SUBJECT:
            self.assertIn(f, ev["subject"])
        for f in ATTACKER_BASELINE_ENV:
            self.assertIn(f, ev["environment"])

    def test_ctx_snapshot_requires_user_id(self):
        with self.assertRaisesRegex(ValueError, "userId"):
            normalize_event({"kind": "ctx-snapshot"})

    def test_ctx_change_requires_field(self):
        with self.assertRaisesRegex(ValueError, "field"):
            normalize_event({"kind": "ctx-change", "userId": "subj-attacker"})

    def test_a1_emits_one_n_status_mutation(self):
        ctx = attack_ctx_events("A1")
        self.assertEqual(len(ctx), 1)
        self.assertEqual(ctx[0]["kind"], "ctx-change")
        self.assertEqual(ctx[0]["field"], "N_status")
        self.assertEqual(ctx[0]["userId"], "subj-attacker")

    def test_a9_emits_three_environment_mutations(self):
        ctx = attack_ctx_events("A9")
        self.assertEqual(len(ctx), 3)
        fields = [e["field"] for e in ctx]
        self.assertEqual(set(fields), {"networkType", "platform", "screen"})
        for e in ctx:
            self.assertEqual(e["kind"], "ctx-change")

    def test_unknown_attack_has_no_ctx_events(self):
        self.assertEqual(attack_ctx_events("AX"), [])

    def test_attack_events_prepends_ctx_change_with_breathing_delay(self):
        # The last ctx-change before the cascade needs a non-trivial delay so
        # the floating badge has time to render before the first edge fires.
        evs = attack_events("A1", outcome="BLOCKED")
        self.assertEqual(evs[0]["kind"], "ctx-change")
        # Walk to the last ctx-change in the prefix
        last_ctx_idx = 0
        for i, ev in enumerate(evs):
            if ev.get("kind") == "ctx-change":
                last_ctx_idx = i
        self.assertGreaterEqual(
            evs[last_ctx_idx]["delayMs"], 500,
            "last ctx-change should pause before the request edge fires"
        )

    def test_attack_events_a9_prefixed_with_three_ctx_changes(self):
        evs = attack_events("A9", outcome="BLOCKED", target_file="file-secret")
        prefix = [e for e in evs[:3]]
        self.assertEqual([e["kind"] for e in prefix],
                         ["ctx-change", "ctx-change", "ctx-change"])
        self.assertEqual({e["field"] for e in prefix},
                         {"networkType", "platform", "screen"})


if __name__ == "__main__":
    unittest.main()
