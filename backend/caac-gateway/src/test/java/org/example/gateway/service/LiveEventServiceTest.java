package org.example.gateway.service;

import org.example.gateway.model.User;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LiveEventServiceTest {

    @Test
    void publishRuntimePathStepSendsRuntimeEventOnlyToAdmins() throws Exception {
        LiveEventService service = new LiveEventService();
        SseEmitter adminEmitter = service.subscribe(user("admin", 5));
        SseEmitter nonAdminEmitter = service.subscribe(user("alice", 2));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("flowId", "flow-1");
        data.put("phase", "REQUEST_RECEIVED");
        data.put("edge", "user-gateway");

        service.publishRuntimePathStep(data);

        assertThat(eventPayloads(adminEmitter))
                .anySatisfy(payload -> {
                    assertThat(payload).containsEntry("type", "RUNTIME_PATH_STEP");
                    assertThat(payload.get("data")).isEqualTo(data);
                });
        assertThat(eventPayloads(nonAdminEmitter))
                .noneSatisfy(payload -> assertThat(payload).containsEntry("type", "RUNTIME_PATH_STEP"));

        service.shutdown();
    }

    @Test
    void publishRuntimeStepUsesSameAdminOnlyRuntimeEventChannel() throws Exception {
        LiveEventService service = new LiveEventService();
        SseEmitter adminEmitter = service.subscribe(user("admin", 5));

        Map<String, Object> data = Map.of("phase", "STREAM_CHUNK");

        service.publishRuntimeStep(data);

        assertThat(eventPayloads(adminEmitter))
                .anySatisfy(payload -> {
                    assertThat(payload).containsEntry("type", "RUNTIME_PATH_STEP");
                    assertThat(payload.get("data")).isEqualTo(data);
                });

        service.shutdown();
    }

    @Test
    void publishRuntimePathStepIgnoresNullAndEmptyPayloads() throws Exception {
        LiveEventService service = new LiveEventService();
        SseEmitter adminEmitter = service.subscribe(user("admin", 5));
        int before = eventPayloads(adminEmitter).size();

        service.publishRuntimePathStep(null);
        service.publishRuntimePathStep(Map.of());

        assertThat(eventPayloads(adminEmitter)).hasSize(before);
        service.shutdown();
    }

    private User user(String username, int role) {
        User user = new User(username, "hash", username);
        user.setRSub(role);
        return user;
    }

    private List<Map<String, Object>> eventPayloads(SseEmitter emitter) throws Exception {
        List<Map<String, Object>> payloads = new ArrayList<>();
        Object earlySendAttempts = field(emitter, "earlySendAttempts");
        for (Object dataWithMediaType : (Iterable<?>) earlySendAttempts) {
            Object data = field(dataWithMediaType, "data");
            if (data instanceof Map<?, ?> map) {
                LinkedHashMap<String, Object> payload = new LinkedHashMap<>();
                map.forEach((key, value) -> payload.put(String.valueOf(key), value));
                payloads.add(payload);
            }
        }
        return payloads;
    }

    private Object field(Object target, String name) throws Exception {
        Field field = null;
        Class<?> type = target.getClass();
        while (field == null && type != null) {
            try {
                field = type.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                type = type.getSuperclass();
            }
        }
        if (field == null) {
            throw new NoSuchFieldException(name);
        }
        field.setAccessible(true);
        return field.get(target);
    }
}
