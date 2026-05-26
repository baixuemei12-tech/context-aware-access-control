package org.example.gateway.service;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RuntimeMonitorEventFactoryTest {

    @Test
    void requestReceivedUsesStableTopologyAndEnvelopeFields() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow-1", "REQUEST_RECEIVED", "alice", "file-7", null, Map.of("ip", "10.0.0.8"));

        assertThat(event.keySet()).containsSequence("flowId", "phase", "username", "fileId", "edge", "nodes", "tone", "label", "dataState");
        assertThat(event).containsEntry("flowId", "flow-1")
                .containsEntry("phase", "REQUEST_RECEIVED")
                .containsEntry("username", "alice")
                .containsEntry("fileId", "file-7")
                .containsEntry("edge", "user-gateway")
                .containsEntry("tone", "info")
                .containsEntry("dataState", "Raw request")
                .containsEntry("ip", "10.0.0.8");
        assertThat(event).doesNotContainKey("sessionId");
    }

    @Test
    void accessDeniedAndStreamChunkUseExpectedMappings() {
        Map<String, Object> denied = RuntimeMonitorEventFactory.step(
                "flow-1", "ACCESS_DENIED", "alice", "file-7", "sess-1", Map.of());
        Map<String, Object> chunk = RuntimeMonitorEventFactory.step(
                "flow-1", "STREAM_CHUNK", "alice", "file-7", "sess-1", Map.of());

        assertThat(denied).containsEntry("edge", "fabric-deny")
                .containsEntry("tone", "deny")
                .containsEntry("dataState", "Denied")
                .containsEntry("sessionId", "sess-1");
        assertThat(chunk).containsEntry("edge", "gateway-ipfs")
                .containsEntry("tone", "ok")
                .containsEntry("dataState", "Plaintext stream");
    }

    @Test
    void anomalyBlockedUsesBlockMapping() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow-1", "ANOMALY_BLOCKED", "alice", "file-7", null, Map.of());

        assertThat(event).containsEntry("edge", "anomaly-blocked")
                .containsEntry("tone", "block")
                .containsEntry("dataState", "Blocked");
    }

    @Test
    void supportsRequiredControllerAndStreamPhases() {
        List<String> phases = List.of(
                "REQUEST_RECEIVED", "AUTH_BLOCKED", "ANOMALY_BLOCKED", "FILE_NOT_FOUND",
                "CLUSTER_BLOCKED", "CONTEXT_RESOLVED", "POLICY_EVALUATING", "POLICY_DECIDED",
                "ACCESS_DENIED", "ACCESS_PERMITTED", "RULE_DENIED", "BUDGET_DENIED",
                "STREAM_STARTED", "STREAM_CHUNK", "STREAM_COMPLETED", "STREAM_REVOKED",
                "CONTEXT_DEGRADED", "NETWORK_BLOCKED", "POLICY_EVALUATED", "SESSION_CREATED",
                "STREAM_CHUNK_DELIVERED", "BUDGET_RECHECK_DENIED", "SESSION_REVOKED"
        );

        for (String phase : phases) {
            Map<String, Object> event = RuntimeMonitorEventFactory.step("flow", phase, "user", "file", null, Map.of());

            assertThat(event).containsKeys("edge", "nodes", "tone", "label", "dataState");
            assertThat(event.get("edge")).isNotEqualTo("unknown");
            assertThat(event.get("tone")).isIn("info", "warn", "ok", "success", "deny", "block", "revoke");
        }
    }

    @Test
    void extraFieldsOverrideDefaultMappingOnlyWhenExplicitlyProvided() {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("label", "Custom label");
        extra.put("sessionId", null);
        extra.put("details", "manual override");

        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow", "POLICY_DECIDED", "user", "file", "sess-1", extra);

        assertThat(event).containsEntry("label", "Custom label")
                .containsEntry("details", "manual override")
                .containsEntry("sessionId", "sess-1");
        assertThat(event.values()).doesNotContain("null");
    }
}
