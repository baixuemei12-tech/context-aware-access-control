package org.example.gateway.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class RuntimeMonitorEventFactory {

    private static final Set<String> RESERVED_EXTRA_KEYS = Set.of(
            "flowid", "phase", "username", "fileid", "sessionid",
            "edge", "nodes", "tone", "label", "datastate");
    private static final List<String> SECRET_KEY_PARTS = List.of(
            "token", "password", "secret");
    private static final Set<String> SECRET_EXTRA_KEYS = Set.of("authheader", "authorization");

    private static final Map<String, PhaseMapping> PHASES = Map.ofEntries(
            entry("REQUEST_RECEIVED", "user-gateway", List.of("user", "gateway"), "info", "Request received", "Raw request"),
            entry("AUTH_BLOCKED", "user-gateway", List.of("user", "gateway", "deny"), "block", "Authentication blocked", "Blocked"),
            entry("ANOMALY_BLOCKED", "anomaly-blocked", List.of("gateway", "anomaly"), "block", "Anomaly blocked", "Blocked"),
            entry("FILE_NOT_FOUND", "user-file", List.of("user", "file", "deny"), "warn", "File not found", "Missing file"),
            entry("CLUSTER_BLOCKED", "anomaly-blocked", List.of("gateway", "anomaly", "blocked"), "block", "Cluster blocked", "Blocked"),
            entry("CONTEXT_RESOLVED", "gateway-context", List.of("gateway", "context"), "info", "Context resolved", "Context ready"),
            entry("CONTEXT_DEGRADED", "gateway-context", List.of("gateway", "context"), "warn", "Context degraded", "Degraded context"),
            entry("POLICY_EVALUATING", "context-oracle", List.of("context", "oracle", "fabric"), "info", "Policy evaluating", "Policy input"),
            entry("POLICY_DECIDED", "oracle-fabric", List.of("oracle", "fabric"), "info", "Policy decided", "Decision ready"),
            entry("POLICY_EVALUATED", "oracle-fabric", List.of("oracle", "fabric"), "info", "Policy evaluated", "Decision ready"),
            entry("ACCESS_DENIED", "fabric-deny", List.of("fabric", "deny"), "deny", "Access denied", "Denied"),
            entry("ACCESS_PERMITTED", "fabric-permit", List.of("fabric", "permit"), "success", "Access permitted", "Permitted"),
            entry("RULE_DENIED", "fabric-deny", List.of("fabric", "deny"), "deny", "Rule denied", "Denied"),
            entry("BUDGET_DENIED", "fabric-deny", List.of("fabric", "deny"), "deny", "Budget denied", "Denied"),
            entry("BUDGET_RECHECK_DENIED", "fabric-deny", List.of("fabric", "deny"), "deny", "Budget recheck denied", "Denied"),
            entry("NETWORK_BLOCKED", "anomaly-blocked", List.of("gateway", "anomaly", "blocked"), "block", "Network blocked", "Blocked"),
            entry("SESSION_CREATED", "fabric-permit", List.of("fabric", "permit"), "ok", "Session created", "Session ready"),
            entry("STREAM_STARTED", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream started", "Plaintext stream"),
            entry("STREAM_CHUNK", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream chunk", "Plaintext stream"),
            entry("STREAM_CHUNK_DELIVERED", "gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Stream chunk delivered", "Plaintext stream"),
            entry("STREAM_COMPLETED", "gateway-permit", List.of("gateway", "permit"), "success", "Stream completed", "Complete"),
            entry("STREAM_REVOKED", "fabric-revoked", List.of("fabric", "revoked"), "revoke", "Stream revoked", "Revoked"),
            entry("SESSION_REVOKED", "fabric-revoked", List.of("fabric", "revoked"), "revoke", "Session revoked", "Revoked")
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
                "user-gateway",
                List.of("user", "gateway"),
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
                if (value != null && isSafeExtraKey(key)) {
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

    private static boolean isSafeExtraKey(String key) {
        if (key == null || key.isBlank()) return false;
        String normalized = key.toLowerCase(Locale.ROOT);
        if (RESERVED_EXTRA_KEYS.contains(normalized)) return false;
        String compact = normalized.replaceAll("[^a-z0-9]", "");
        return !SECRET_EXTRA_KEYS.contains(compact)
                && SECRET_KEY_PARTS.stream().noneMatch(compact::contains);
    }

    private record PhaseMapping(String edge, List<String> nodes, String tone, String label, String dataState) {
    }
}
