package org.example.gateway.service;

import org.example.gateway.model.AccessRequest;
import org.example.gateway.model.OracleResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies that the per-tick Algorithm 2 scheduler emits live events for
 * the admin runtime topology:
 *   - SESSION_SCORE_UPDATED on every ALLOW tick (so DT/CE badges refresh
 *     at the natural per-tier 2/3/4s cadence)
 *   - SESSION_REVOKED on the revoke branch
 *   - CLUSTER_RISK_UPDATED on recordNetworkRevocation
 *
 * No real Oracle / Fabric — collaborators are mocked.
 */
class RevocationSchedulerEventsTest {

    private SessionManager sessionManager;
    private OracleClient oracleClient;
    private LiveEventService liveEventService;
    private RevocationScheduler scheduler;

    @BeforeEach
    void setUp() {
        sessionManager = mock(SessionManager.class);
        oracleClient = mock(OracleClient.class);
        liveEventService = mock(LiveEventService.class);
        // Constructor must accept LiveEventService as the 3rd arg
        scheduler = new RevocationScheduler(sessionManager, oracleClient, liveEventService);
    }

    private SessionManager.ActiveSession permissiveSession(String sid, String owner, String fileId) {
        SessionManager.ActiveSession s = mock(SessionManager.ActiveSession.class);
        when(s.isActive()).thenReturn(true);
        when(s.getSessionId()).thenReturn(sid);
        when(s.getOwnerUsername()).thenReturn(owner);
        when(s.getFileId()).thenReturn(fileId);
        when(s.riskMargin()).thenReturn(0.35);
        when(s.getDtScore()).thenReturn(0.85);
        when(s.getCeScore()).thenReturn(0.72);
        when(s.getNetworkFingerprint()).thenReturn("10.0.0.");
        when(s.getStableCheckCount()).thenReturn(3);
        when(s.isAccelerationActive()).thenReturn(false);
        when(s.getLastAlgo2DtScore()).thenReturn(-1.0); // no previous tick
        when(s.getLastRgcaTier()).thenReturn(null);
        when(s.getContext()).thenReturn(new AccessRequest());
        return s;
    }

    @SuppressWarnings("unchecked")
    private static ArgumentCaptor<Map<String, Object>> mapCaptor() {
        return (ArgumentCaptor<Map<String, Object>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(Map.class);
    }

    @Test
    void allowTick_emitsSessionScoreUpdated() {
        SessionManager.ActiveSession s = permissiveSession("sess-1", "alice", "file-1");
        when(sessionManager.getActiveSessions()).thenReturn(List.of(s));

        // Oracle ALLOWS — DT remains high
        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("PERMIT", 0.85, 0.72));

        scheduler.continuousRevocationCheck();

        ArgumentCaptor<Map<String, Object>> c = mapCaptor();
        verify(liveEventService, atLeastOnce()).publishSessionScoreUpdated(eq("alice"), c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("sess-1", data.get("sessionId"));
        assertEquals("file-1", data.get("fileId"));
        assertNotNull(data.get("dtScore"));
        assertNotNull(data.get("ceScore"));
        assertNotNull(data.get("tier"));
        assertNotNull(data.get("margin"));
        assertNotNull(data.get("deltaT"),
                "operator UI needs the per-tier baseDt (2/3/4s) for the per-session tick badge");
    }

    @Test
    void allowTick_doesNotEmitRevoked() {
        SessionManager.ActiveSession s = permissiveSession("sess-1", "alice", "file-1");
        when(sessionManager.getActiveSessions()).thenReturn(List.of(s));
        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("PERMIT", 0.85, 0.72));

        scheduler.continuousRevocationCheck();

        verify(liveEventService, times(0))
                .publishSessionRevoked(anyString(), any());
    }

    @Test
    void denyTick_emitsSessionRevoked() {
        SessionManager.ActiveSession s = permissiveSession("sess-1", "alice", "file-1");
        when(s.getBytesDelivered()).thenReturn(4096L);
        when(sessionManager.getActiveSessions()).thenReturn(List.of(s));

        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("DENY", 0.32, 0.40));

        scheduler.continuousRevocationCheck();

        ArgumentCaptor<Map<String, Object>> c = mapCaptor();
        verify(liveEventService).publishSessionRevoked(eq("alice"), c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("sess-1", data.get("sessionId"));
        assertEquals("file-1", data.get("fileId"));
        assertNotNull(data.get("reason"));
        // bytes delivered before revoke — drives the operator's "leakage" badge
        assertEquals(4096L, data.get("bytesDelivered"));
    }

    @Test
    void denyTick_doesNotEmitScoreUpdated() {
        SessionManager.ActiveSession s = permissiveSession("sess-1", "alice", "file-1");
        when(sessionManager.getActiveSessions()).thenReturn(List.of(s));
        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("DENY", 0.32, 0.40));

        scheduler.continuousRevocationCheck();

        // A revoked tick MUST NOT also fire SESSION_SCORE_UPDATED — that
        // would race the terminal cascade on the topology.
        verify(liveEventService, times(0))
                .publishSessionScoreUpdated(anyString(), any());
    }

    @Test
    void recordNetworkRevocation_emitsClusterRiskUpdated() {
        SessionManager.ActiveSession s = permissiveSession("sess-1", "alice", "file-1");
        when(s.getNetworkFingerprint()).thenReturn("10.0.0.");
        when(sessionManager.getActiveSessions()).thenReturn(Collections.emptyList());

        scheduler.recordNetworkRevocation(s);

        ArgumentCaptor<Map<String, Object>> c = mapCaptor();
        verify(liveEventService).publishClusterRiskUpdated(c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("10.0.0.", data.get("subnet"));
        assertNotNull(data.get("rN"));
        // Subnet not yet sustained-blocked → blocked = false
        assertEquals(false, data.get("blocked"));
    }

    @Test
    void emptySessions_emitsNothing() {
        when(sessionManager.getActiveSessions()).thenReturn(Collections.emptyList());

        scheduler.continuousRevocationCheck();

        verify(liveEventService, times(0))
                .publishSessionScoreUpdated(anyString(), any());
        verify(liveEventService, times(0))
                .publishSessionRevoked(anyString(), any());
    }
}
