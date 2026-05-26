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
    void aliasPhasesUseConcreteExpectedMappings() {
        assertMapping("NETWORK_BLOCKED", "network-blocked", "block", "Blocked");
        assertMapping("POLICY_EVALUATED", "policy-fabric", "info", "Decision ready");
        assertMapping("SESSION_CREATED", "gateway-session", "ok", "Session ready");
        assertMapping("STREAM_CHUNK_DELIVERED", "gateway-ipfs", "ok", "Plaintext stream");
        assertMapping("BUDGET_RECHECK_DENIED", "budget-deny", "deny", "Denied");
        assertMapping("SESSION_REVOKED", "stream-revoked", "revoke", "Revoked");
    }

    @Test
    void extraCannotOverrideStableFields() {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("flowId", "evil-flow");
        extra.put("phase", "ACCESS_PERMITTED");
        extra.put("username", "mallory");
        extra.put("fileId", "evil-file");
        extra.put("sessionId", "evil-session");
        extra.put("edge", "evil-edge");
        extra.put("nodes", List.of("evil"));
        extra.put("tone", "evil-tone");
        extra.put("label", "Evil label");
        extra.put("dataState", "Evil data");

        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow", "POLICY_DECIDED", "user", "file", "sess-1", extra);

        assertThat(event).containsEntry("flowId", "flow")
                .containsEntry("phase", "POLICY_DECIDED")
                .containsEntry("username", "user")
                .containsEntry("fileId", "file")
                .containsEntry("sessionId", "sess-1")
                .containsEntry("edge", "policy-fabric")
                .containsEntry("nodes", List.of("policy", "fabric"))
                .containsEntry("tone", "info")
                .containsEntry("label", "Policy decided")
                .containsEntry("dataState", "Decision ready");
    }

    @Test
    void secretBearingExtraKeysAreDroppedCaseInsensitively() {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("token", "token-value");
        extra.put("authHeader", "Bearer abc");
        extra.put("Authorization", "Bearer def");
        extra.put("password", "password-value");
        extra.put("secret", "secret-value");

        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow", "REQUEST_RECEIVED", "user", "file", null, extra);

        assertThat(event).doesNotContainKeys("token", "authHeader", "Authorization", "password", "secret");
        assertThat(event.values()).doesNotContain("token-value", "Bearer abc", "Bearer def", "password-value", "secret-value");
    }

    @Test
    void safeExtraFieldsArePreserved() {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("decision", "allow");
        extra.put("dtScore", 0.42);
        extra.put("bytesDelivered", 4096);
        extra.put("riskMargin", 0.12);
        extra.put("reason", "policy matched");
        extra.put("blockedFor", "budget");

        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "flow", "ACCESS_PERMITTED", "user", "file", null, extra);

        assertThat(event).containsEntry("decision", "allow")
                .containsEntry("dtScore", 0.42)
                .containsEntry("bytesDelivered", 4096)
                .containsEntry("riskMargin", 0.12)
                .containsEntry("reason", "policy matched")
                .containsEntry("blockedFor", "budget");
        assertThat(event.values()).doesNotContain("null");
    }

    private void assertMapping(String phase, String edge, String tone, String dataState) {
        Map<String, Object> event = RuntimeMonitorEventFactory.step("flow", phase, "user", "file", null, Map.of());

        assertThat(event).containsEntry("edge", edge)
                .containsEntry("tone", tone)
                .containsEntry("dataState", dataState);
    }
}
