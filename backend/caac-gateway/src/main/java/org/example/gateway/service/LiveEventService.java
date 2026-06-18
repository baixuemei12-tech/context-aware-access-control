package org.example.gateway.service;

import jakarta.annotation.PreDestroy;
import org.example.gateway.config.FileRegistry;
import org.example.gateway.model.User;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Service
public class LiveEventService {

    private static class Client {
        final String id;
        final String username;
        final boolean admin;
        final SseEmitter emitter;

        Client(String id, User user, SseEmitter emitter) {
            this.id = id;
            this.username = user.getUsername();
            this.admin = user.getRSub() == 5;
            this.emitter = emitter;
        }
    }

    private final ConcurrentHashMap<String, Client> clients = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "caac-live-events-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public LiveEventService() {
        heartbeatExecutor.scheduleAtFixedRate(this::heartbeat, 25, 25, TimeUnit.SECONDS);
    }

    public SseEmitter subscribe(User user) {
        SseEmitter emitter = new SseEmitter(0L);
        String id = UUID.randomUUID().toString();
        Client client = new Client(id, user, emitter);
        clients.put(id, client);

        emitter.onCompletion(() -> clients.remove(id));
        emitter.onTimeout(() -> clients.remove(id));
        emitter.onError(error -> clients.remove(id));

        send(client, "CONNECTED", Map.of(
                "username", user.getUsername(),
                "admin", client.admin
        ));
        return emitter;
    }

    public void publishFileChanged(String type, FileRegistry.FileEntry entry) {
        if (entry == null) return;
        Map<String, Object> data = new LinkedHashMap<>(entry.toMap());
        if ("FILE_UPLOADED".equals(type)) {
            publishToAdmins(type, data);
        } else {
            publishToAll(type, data);
        }
    }

    public void publishUserChanged(String type, User user) {
        if (user == null) return;
        Map<String, Object> data = new LinkedHashMap<>(user.toPublicMap());
        publishToAdmins(type, data);
        publishToUser(user.getUsername(), type, data);
    }

    public void publishUserDeleted(String username) {
        if (username == null || username.trim().isEmpty()) return;
        Map<String, Object> data = Map.of("username", username.toLowerCase());
        publishToAdmins("USER_DELETED", data);
        publishToUser(username, "USER_DELETED", data);
    }

    /**
     * Emitted from FileAccessController on every PERMIT / DENY / ERROR
     * decision (the 5 audit-log sites). Operators see this as a 3-hop
     * cascade on the topology and the user sees their own decision in
     * their dashboard.
     */
    public void publishFileAccess(String username, Map<String, Object> data) {
        if (data == null) return;
        publishToAdmins("FILE_ACCESS", data);
        if (username != null) {
            publishToUser(username, "FILE_ACCESS", data);
        }
    }

    /**
     * Emitted from RevocationScheduler on every Algorithm 2 tick that
     * did NOT revoke. Operators see the user's risk badges refresh at
     * the per-tier 2/3/4s cadence Algorithm 2 already enforces.
     */
    public void publishSessionScoreUpdated(String username, Map<String, Object> data) {
        if (data == null) return;
        publishToAdmins("SESSION_SCORE_UPDATED", data);
        if (username != null) {
            publishToUser(username, "SESSION_SCORE_UPDATED", data);
        }
    }

    /**
     * Emitted whenever an active session is terminated mid-stream by
     * Algorithm 2, by a policy hit, or by an admin action. Drives the
     * terminal red cascade on the runtime topology.
     */
    public void publishSessionRevoked(String username, Map<String, Object> data) {
        if (data == null) return;
        publishToAdmins("SESSION_REVOKED", data);
        if (username != null) {
            publishToUser(username, "SESSION_REVOKED", data);
        }
    }

    /**
     * Cluster-level risk update from RevocationScheduler.recordNetworkRevocation.
     * No per-user fan-out — subnets aren't owned by a single user.
     */
    public void publishClusterRiskUpdated(Map<String, Object> data) {
        if (data == null) return;
        publishToAdmins("CLUSTER_RISK_UPDATED", data);
    }

    protected void publishToAll(String type, Map<String, Object> data) {
        clients.values().forEach(client -> send(client, type, data));
    }

    protected void publishToAdmins(String type, Map<String, Object> data) {
        clients.values().stream()
                .filter(client -> client.admin)
                .forEach(client -> send(client, type, data));
    }

    protected void publishToUser(String username, String type, Map<String, Object> data) {
        if (username == null) return;
        String normalized = username.toLowerCase();
        clients.values().stream()
                .filter(client -> normalized.equalsIgnoreCase(client.username))
                .forEach(client -> send(client, type, data));
    }

    private void heartbeat() {
        if (clients.isEmpty()) return;
        Map<String, Object> data = Map.of("clients", clients.size());
        clients.values().forEach(client -> send(client, "HEARTBEAT", data));
    }

    private void send(Client client, String type, Map<String, Object> data) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("timestamp", LocalDateTime.now().toString());
        payload.put("data", data);
        try {
            client.emitter.send(SseEmitter.event().name("caac").data(payload));
        } catch (IOException | IllegalStateException e) {
            clients.remove(client.id);
        }
    }

    @PreDestroy
    public void shutdown() {
        heartbeatExecutor.shutdownNow();
        clients.values().forEach(client -> {
            try { client.emitter.complete(); } catch (Exception ignored) {}
        });
        clients.clear();
    }
}
