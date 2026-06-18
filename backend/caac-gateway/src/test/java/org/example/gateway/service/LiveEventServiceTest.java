package org.example.gateway.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for the four new event emissions added so that the admin
 * runtime topology can be driven by the real gateway instead of the
 * Vite-side mock loop.
 *
 * We intercept the protected routing helpers (publishToAdmins /
 * publishToUser / publishToAll) with a recording subclass — that keeps
 * the SSE transport out of the test and lets us assert ONLY the routing
 * contract: who receives which envelope type with which keys.
 */
class LiveEventServiceTest {

    /** Records calls to the protected routing helpers. */
    static class RecordingLiveEventService extends LiveEventService {
        final List<Routed> adminCalls = new ArrayList<>();
        final List<Routed> userCalls = new ArrayList<>();
        final List<Routed> allCalls = new ArrayList<>();

        @Override
        protected void publishToAdmins(String type, Map<String, Object> data) {
            adminCalls.add(new Routed(null, type, data));
        }

        @Override
        protected void publishToUser(String username, String type, Map<String, Object> data) {
            userCalls.add(new Routed(username, type, data));
        }

        @Override
        protected void publishToAll(String type, Map<String, Object> data) {
            allCalls.add(new Routed(null, type, data));
        }
    }

    static class Routed {
        final String username;
        final String type;
        final Map<String, Object> data;
        Routed(String u, String t, Map<String, Object> d) {
            this.username = u; this.type = t; this.data = d;
        }
    }

    // ---- publishFileAccess -----------------------------------------------

    @Test
    void publishFileAccess_routesToAdminsAndAffectedUser() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("fileId", "file-1");
        data.put("decision", "PERMIT");
        data.put("dtScore", 0.81);
        data.put("ceScore", 0.74);
        data.put("sessionId", "sess-1");

        svc.publishFileAccess("alice", data);

        assertEquals(1, svc.adminCalls.size(),
                "FILE_ACCESS must be published to admins");
        assertEquals("FILE_ACCESS", svc.adminCalls.get(0).type);

        assertEquals(1, svc.userCalls.size(),
                "FILE_ACCESS must also fan out to the affected user");
        assertEquals("alice", svc.userCalls.get(0).username);
        assertEquals("FILE_ACCESS", svc.userCalls.get(0).type);

        assertEquals(0, svc.allCalls.size(),
                "FILE_ACCESS must not broadcast to all clients");
    }

    @Test
    void publishFileAccess_passesPayloadThroughUnchanged() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("fileId", "file-42");
        data.put("decision", "DENY");
        data.put("reason", "policy DENY: dtScore below threshold");

        svc.publishFileAccess("bob", data);

        Map<String, Object> received = svc.adminCalls.get(0).data;
        assertEquals("file-42", received.get("fileId"));
        assertEquals("DENY", received.get("decision"));
        assertEquals("policy DENY: dtScore below threshold", received.get("reason"));
    }

    @Test
    void publishFileAccess_tolerantOfNullUsername() {
        RecordingLiveEventService svc = new RecordingLiveEventService();
        // No username (e.g., anonymous request that hit auth) — must still
        // notify admins so the DENY still shows on the topology.
        svc.publishFileAccess(null, Map.of("fileId", "file-1", "decision", "DENY"));
        assertEquals(1, svc.adminCalls.size());
        assertEquals(0, svc.userCalls.size(),
                "null username must skip the per-user fan-out");
    }

    // ---- publishSessionScoreUpdated --------------------------------------

    @Test
    void publishSessionScoreUpdated_routesToAdminsAndUser() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", "sess-1");
        data.put("fileId", "file-1");
        data.put("dtScore", 0.83);
        data.put("ceScore", 0.71);
        data.put("margin", 0.12);
        data.put("tier", "HIGH");
        data.put("deltaT", 2);

        svc.publishSessionScoreUpdated("alice", data);

        assertEquals(1, svc.adminCalls.size());
        assertEquals("SESSION_SCORE_UPDATED", svc.adminCalls.get(0).type);
        assertEquals(1, svc.userCalls.size());
        assertEquals("alice", svc.userCalls.get(0).username);
    }

    @Test
    void publishSessionScoreUpdated_includesAlgo2Fields() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", "sess-9");
        data.put("dtScore", 0.55);
        data.put("ceScore", 0.61);
        data.put("margin", 0.06);
        data.put("tier", "MEDIUM");
        data.put("deltaT", 3);
        data.put("stableCheckCount", 4);
        data.put("accelerationActive", false);

        svc.publishSessionScoreUpdated("alice", data);

        Map<String, Object> received = svc.adminCalls.get(0).data;
        // Operator UI relies on these Algorithm 2 fields being present
        for (String k : List.of("dtScore", "ceScore", "margin", "tier", "deltaT")) {
            assertTrue(received.containsKey(k),
                    "SESSION_SCORE_UPDATED payload must include field: " + k);
        }
    }

    // ---- publishSessionRevoked -------------------------------------------

    @Test
    void publishSessionRevoked_routesToAdminsAndUser() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sessionId", "sess-1");
        data.put("fileId", "file-1");
        data.put("reason", "CLUSTER_RISK");
        data.put("dtScore", 0.31);
        data.put("ceScore", 0.40);
        data.put("margin", -0.09);

        svc.publishSessionRevoked("alice", data);

        assertEquals(1, svc.adminCalls.size());
        assertEquals("SESSION_REVOKED", svc.adminCalls.get(0).type);
        assertEquals(1, svc.userCalls.size());
        assertEquals("alice", svc.userCalls.get(0).username);
    }

    @Test
    void publishSessionRevoked_carriesReasonString() {
        RecordingLiveEventService svc = new RecordingLiveEventService();
        svc.publishSessionRevoked("alice", Map.of(
                "sessionId", "sess-1",
                "reason", "TIMEOUT"
        ));
        Map<String, Object> received = svc.adminCalls.get(0).data;
        assertEquals("TIMEOUT", received.get("reason"),
                "reason field must round-trip through the publisher");
    }

    // ---- publishClusterRiskUpdated ---------------------------------------

    @Test
    void publishClusterRiskUpdated_isAdminOnly() {
        RecordingLiveEventService svc = new RecordingLiveEventService();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("subnet", "10.0.5.0/24");
        data.put("rN", 0.42);
        data.put("blocked", false);

        svc.publishClusterRiskUpdated(data);

        assertEquals(1, svc.adminCalls.size(),
                "cluster risk updates go to operators");
        assertEquals("CLUSTER_RISK_UPDATED", svc.adminCalls.get(0).type);

        assertEquals(0, svc.userCalls.size(),
                "cluster risk has no per-user fan-out (subnets aren't owned by a user)");
        assertEquals(0, svc.allCalls.size(),
                "cluster risk must not broadcast to every connected client");

        Map<String, Object> received = svc.adminCalls.get(0).data;
        assertNotNull(received.get("subnet"));
        assertEquals(0.42, received.get("rN"));
        assertEquals(false, received.get("blocked"));
    }
}
