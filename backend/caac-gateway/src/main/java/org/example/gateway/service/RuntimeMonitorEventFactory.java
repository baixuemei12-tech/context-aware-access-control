package org.example.gateway.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class RuntimeMonitorEventFactory {

    private static final Map<String, PhaseMapping> PHASES = Map.ofEntries(
            entry("REQUEST_RECEIVED", "user-gateway", List.of("user", "gateway"), "info", "Request received", "Raw request"),
            entry("AUTH_BLOCKED", "auth-blocked", List.of("gateway", "auth"), "block", "Authentication blocked", "Blocked"),
            entry("ANOMALY_BLOCKED", "anomaly-blocked", List.of("gateway", "anomaly"), "block", "Anomaly blocked", "Blocked"),
            entry("FILE_NOT_FOUND", "file-missing", List.of("gateway", "registry"), "warn", "File not found", "Missing file"),
            entry("CLUSTER_BLOCKED", "cluster-blocked", List.of("gateway", "cluster"), "block", "Cluster blocked", "Blocked"),
            entry("CONTEXT_RESOLVED", "gateway-context", List.of("gateway", "context"), "info", "Context resolved", "Context ready"),
            entry("CONTEXT_DEGRADED", "context-degraded", List.of("context", "policy"), "warn", "Context degraded", "Degraded context"),
            entry("POLICY_EVALUATING", "context-policy", List.of("context", "policy"), "info", "Policy evaluating", "Policy input"),
            entry("POLICY_DECIDED", "policy-fabric", List.of("policy", "fabric"), "info", "Policy decided", "Decision ready"),
            entry("POLICY_EVALUATED", "policy-fabric", List.of("policy", "fabric"), "info", "Policy evaluated", "Decision ready"),
            entry("ACCESS_DENIED", "fabric-deny", List.of("fabric", "deny"), "deny", "Access denied", "Denied"),
            entry("ACCESS_PERMITTED", "fabric-permit", List.of("fabric", "gateway"), "success", "Access permitted", "Permitted"),
            entry("RULE_DENIED", "rule-deny", List.of("policy", "deny"), "deny", "Rule denied", "Denied"),
            entry("BUDGET_DENIED", "budget-deny", List.of("budget", "deny"), "deny", "Budget denied", "Denied"),
            entry("BUDGET_RECHECK_DENIED", "budget-deny", List.of("budget", "deny"), "deny", "Budget recheck denied", "Denied"),
            entry("NETWORK_BLOCKED", "network-blocked", List.of("gateway", "network"), "block", "Network blocked", "Blocked"),
            entry("SESSION_CREATED", "gateway-session", List.of("gateway", "session"), "ok", "Session created", "Session ready"),
            entry("STREAM_STARTED", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream started", "Plaintext stream"),
            entry("STREAM_CHUNK", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream chunk", "Plaintext stream"),
            entry("STREAM_CHUNK_DELIVERED", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream chunk delivered", "Plaintext stream"),
            entry("STREAM_COMPLETED", "gateway-client", List.of("gateway", "user"), "success", "Stream completed", "Complete"),
            entry("STREAM_REVOKED", "stream-revoked", List.of("gateway", "session"), "revoke", "Stream revoked", "Revoked"),
            entry("SESSION_REVOKED", "stream-revoked", List.of("gateway", "session"), "revoke", "Session revoked", "Revoked")
    );

    private RuntimeMonitorEventFactory() {
    }

    public static LinkedHashMap<String, Object> step(
            String flowId,
            String phase,
            String username,
            String fileId,
            String sessionId,
            Map<String, Object> extra) {
        PhaseMapping mapping = PHASES.getOrDefault(phase, new PhaseMapping(
                "runtime-gateway",
                List.of("runtime", "gateway"),
                "info",
                phase != null ? phase : "Runtime step",
                "Runtime event"));

        LinkedHashMap<String, Object> event = new LinkedHashMap<>();
        putIfPresent(event, "flowId", flowId);
        putIfPresent(event, "phase", phase);
        putIfPresent(event, "username", username);
        putIfPresent(event, "fileId", fileId);
        putIfPresent(event, "sessionId", sessionId);
        event.put("edge", mapping.edge());
        event.put("nodes", mapping.nodes());
        event.put("tone", mapping.tone());
        event.put("label", mapping.label());
        event.put("dataState", mapping.dataState());
        if (extra != null) {
            extra.forEach((key, value) -> {
                if (value != null) {
                    event.put(key, value);
                }
            });
        }
        return event;
    }

    private static Map.Entry<String, PhaseMapping> entry(
            String phase,
            String edge,
            List<String> nodes,
            String tone,
            String label,
            String dataState) {
        return Map.entry(phase, new PhaseMapping(edge, nodes, tone, label, dataState));
    }

    private static void putIfPresent(Map<String, Object> event, String key, String value) {
        if (value != null && !value.isBlank()) {
            event.put(key, value);
        }
    }

    private record PhaseMapping(String edge, List<String> nodes, String tone, String label, String dataState) {
    }
}
