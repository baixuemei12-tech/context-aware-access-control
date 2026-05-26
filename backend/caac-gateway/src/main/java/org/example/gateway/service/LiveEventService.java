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

    public void publishRuntimeStep(Map<String, Object> data) {
        publishRuntimePathStep(data);
    }

    public void publishRuntimePathStep(Map<String, Object> data) {
        if (data == null || data.isEmpty()) return;
        publishToAdmins("RUNTIME_PATH_STEP", new LinkedHashMap<>(data));
    }

    private void publishToAll(String type, Map<String, Object> data) {
        clients.values().forEach(client -> send(client, type, data));
    }

    private void publishToAdmins(String type, Map<String, Object> data) {
        clients.values().stream()
                .filter(client -> client.admin)
                .forEach(client -> send(client, type, data));
    }

    private void publishToUser(String username, String type, Map<String, Object> data) {
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
