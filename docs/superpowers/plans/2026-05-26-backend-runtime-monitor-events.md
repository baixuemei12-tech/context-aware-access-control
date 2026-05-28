# Backend Runtime Monitor Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the admin Runtime Monitor from real backend Gateway events so attacks, normal access, denial, blocking, streaming, revocation, and data-state changes appear live in the topology.

**Architecture:** Keep `bvgca_attack_sim.py` as a request trigger only; do not make it control the frontend. Add a small backend runtime-event publisher on top of the existing `LiveEventService` SSE channel, emit `RUNTIME_PATH_STEP` events from the real `FileAccessController` access/stream/degrade paths, and teach the frontend Runtime Monitor to render those live event steps while preserving mock scenarios as a fallback/demo mode.

**Tech Stack:** Spring Boot 3.2, JUnit/Spring Boot Test, existing `SseEmitter` live event stream, vanilla JavaScript Runtime Monitor, Node built-in tests, Vite build.

---

## Requirement Summary

- The attack simulation script remains a simulator that sends real HTTP requests to the backend.
- The backend, not the script, emits Runtime Monitor events during real handling.
- Admin frontend receives events through existing `/api/events/stream`.
- Runtime Monitor displays live topology state from backend events.
- Successful data access shows success flow and file/IPFS node response.
- Denied/blocked/revoked access shows red rejection/cutoff animation on the relevant flow.
- The monitor shows information transformation during access: raw request, context score, policy decision, encrypted/IPFS fetch, plaintext stream, denied/blocked/revoked state.
- Mock scenarios remain available when no backend events arrive.

## Event Schema

Backend publishes only admin-visible runtime events:

```json
{
  "type": "RUNTIME_PATH_STEP",
  "timestamp": "2026-05-26T10:00:00",
  "data": {
    "flowId": "REQ-ABC123",
    "phase": "CONTEXT_RESOLVED",
    "edge": "gateway-context",
    "nodes": ["gateway", "context"],
    "tone": "info",
    "label": "Raw context -> L/N/D/T scores",
    "dataState": "Context score",
    "username": "admin",
    "fileId": "report.txt",
    "sessionId": "A1B2C3D4",
    "decision": "PERMIT",
    "dtScore": 0.83,
    "riskMargin": 0.31,
    "bytesDelivered": 8192
  }
}
```

Required phases:

- `REQUEST_RECEIVED`
- `AUTH_BLOCKED`
- `ANOMALY_BLOCKED`
- `FILE_NOT_FOUND`
- `CLUSTER_BLOCKED`
- `CONTEXT_RESOLVED`
- `POLICY_EVALUATING`
- `POLICY_DECIDED`
- `ACCESS_DENIED`
- `ACCESS_PERMITTED`
- `RULE_DENIED`
- `BUDGET_DENIED`
- `STREAM_STARTED`
- `STREAM_CHUNK`
- `STREAM_COMPLETED`
- `STREAM_REVOKED`
- `CONTEXT_DEGRADED`

---

## File Structure

- Modify: `backend/caac-gateway/src/main/java/org/example/gateway/service/LiveEventService.java`
  - Add `publishRuntimeStep(Map<String,Object> data)` and helper builders.
  - Publish `RUNTIME_PATH_STEP` only to admins.

- Create: `backend/caac-gateway/src/test/java/org/example/gateway/service/LiveEventServiceTest.java`
  - Verifies runtime events are admin-only and preserve payload fields.

- Modify: `backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java`
  - Emit runtime steps from real `webAccess`, `streamFile`, and `degradeSession` paths.

- Create: `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java`
- Create: `backend/caac-gateway/src/main/java/org/example/gateway/service/RuntimeMonitorEventFactory.java`
  - Centralizes phase-to-node/edge/tone/dataState mapping so controller code stays small and testable.

- Modify: `frontend/caac-website/js/runtime-monitor.js`
  - Add live-event ingestion for `RUNTIME_PATH_STEP`.
  - Render live steps without resetting zoom/pan.
  - Add rejection/cutoff animation classes and information-state label.
  - Replace independent floating data blocks with file/IPFS node response in a follow-up refinement if still present.

- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
  - Add live backend event ingestion tests.
  - Add success/reject/revoke/data-state markup tests.

- Modify: `frontend/caac-website/css/common.css`
  - Add styles for live data-state labels, file/IPFS node success response, and deny/block/revoke flow cutoff.

---

### Task 1: Add Backend Runtime Event Publisher

**Files:**
- Create: `backend/caac-gateway/src/test/java/org/example/gateway/service/LiveEventServiceTest.java`
- Modify: `backend/caac-gateway/src/main/java/org/example/gateway/service/LiveEventService.java`

- [ ] **Step 1: Write failing backend tests**

Create `backend/caac-gateway/src/test/java/org/example/gateway/service/LiveEventServiceTest.java`:

```java
package org.example.gateway.service;

import org.example.gateway.model.User;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class LiveEventServiceTest {

    static class RecordingEmitter extends SseEmitter {
        final AtomicReference<Object> last = new AtomicReference<>();

        RecordingEmitter() {
            super(0L);
        }

        @Override
        public void send(SseEventBuilder builder) {
            last.set(builder);
        }
    }

    private User user(String username, int rSub) {
        User user = new User(username, "hash", username);
        user.setRSub(rSub);
        return user;
    }

    private void addClient(LiveEventService service, String id, User user, RecordingEmitter emitter) throws Exception {
        Class<?> clientClass = Class.forName("org.example.gateway.service.LiveEventService$Client");
        var ctor = clientClass.getDeclaredConstructor(String.class, User.class, SseEmitter.class);
        ctor.setAccessible(true);
        Object client = ctor.newInstance(id, user, emitter);
        Field clientsField = LiveEventService.class.getDeclaredField("clients");
        clientsField.setAccessible(true);
        @SuppressWarnings("unchecked")
        ConcurrentHashMap<String, Object> clients = (ConcurrentHashMap<String, Object>) clientsField.get(service);
        clients.put(id, client);
    }

    @Test
    void publishRuntimeStepSendsOnlyToAdmins() throws Exception {
        LiveEventService service = new LiveEventService();
        RecordingEmitter adminEmitter = new RecordingEmitter();
        RecordingEmitter userEmitter = new RecordingEmitter();
        addClient(service, "admin", user("admin", 5), adminEmitter);
        addClient(service, "user", user("alice", 2), userEmitter);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("flowId", "REQ-1");
        data.put("phase", "REQUEST_RECEIVED");
        data.put("edge", "user-gateway");
        data.put("nodes", java.util.List.of("user", "gateway"));
        data.put("tone", "info");
        data.put("label", "Request received");
        data.put("dataState", "Raw request");

        service.publishRuntimeStep(data);

        assertNotNull(adminEmitter.last.get());
        assertNull(userEmitter.last.get());
    }

    @Test
    void runtimeStepPayloadContainsTypeTimestampAndData() throws Exception {
        LiveEventService service = new LiveEventService();
        RecordingEmitter adminEmitter = new RecordingEmitter();
        addClient(service, "admin", user("admin", 5), adminEmitter);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("flowId", "REQ-2");
        data.put("phase", "POLICY_DECIDED");
        data.put("decision", "DENY");

        service.publishRuntimeStep(data);

        Object eventBuilder = adminEmitter.last.get();
        assertNotNull(eventBuilder);
        String rendered = eventBuilder.toString();
        assertTrue(rendered.contains("RUNTIME_PATH_STEP"));
        assertTrue(rendered.contains("REQ-2"));
        assertTrue(rendered.contains("POLICY_DECIDED"));
    }
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=LiveEventServiceTest test
```

Expected: FAIL because `publishRuntimeStep` does not exist.

- [ ] **Step 3: Implement publisher**

In `LiveEventService.java`, add after `publishUserDeleted`:

```java
    public void publishRuntimeStep(Map<String, Object> data) {
        if (data == null || data.isEmpty()) return;
        publishToAdmins("RUNTIME_PATH_STEP", new LinkedHashMap<>(data));
    }
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=LiveEventServiceTest test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/caac-gateway/src/main/java/org/example/gateway/service/LiveEventService.java backend/caac-gateway/src/test/java/org/example/gateway/service/LiveEventServiceTest.java
git commit -m "feat: publish runtime monitor live events"
```

---

### Task 2: Add Runtime Event Mapping Factory

**Files:**
- Create: `backend/caac-gateway/src/main/java/org/example/gateway/service/RuntimeMonitorEventFactory.java`
- Create: `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java`

- [ ] **Step 1: Write failing mapping tests**

Create `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java`:

```java
package org.example.gateway.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class RuntimeMonitorEventFactoryTest {

    @Test
    void requestReceivedMapsToUserGatewayRawRequest() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "REQ-1", "REQUEST_RECEIVED", "admin", "report.txt", null, Map.of());

        assertEquals("REQ-1", event.get("flowId"));
        assertEquals("REQUEST_RECEIVED", event.get("phase"));
        assertEquals("user-gateway", event.get("edge"));
        assertEquals("info", event.get("tone"));
        assertEquals("Raw request", event.get("dataState"));
        assertTrue(event.toString().contains("gateway"));
    }

    @Test
    void deniedDecisionMapsToRedPolicyEdge() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "REQ-2", "ACCESS_DENIED", "low", "secret.pdf", null, Map.of("decision", "DENY"));

        assertEquals("fabric-deny", event.get("edge"));
        assertEquals("deny", event.get("tone"));
        assertEquals("Denied", event.get("dataState"));
        assertEquals("DENY", event.get("decision"));
    }

    @Test
    void streamChunkMapsToIpfsSuccessFlow() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "SID-1", "STREAM_CHUNK", "admin", "report.txt", "SID-1", Map.of("bytesDelivered", 8192));

        assertEquals("gateway-ipfs", event.get("edge"));
        assertEquals("ok", event.get("tone"));
        assertEquals("Plaintext stream", event.get("dataState"));
        assertEquals(8192, event.get("bytesDelivered"));
    }

    @Test
    void blockedMapsToAnomalyBlockedPath() {
        Map<String, Object> event = RuntimeMonitorEventFactory.step(
                "REQ-3", "ANOMALY_BLOCKED", "attacker", "report.txt", null, Map.of("blockedFor", 120));

        assertEquals("anomaly-blocked", event.get("edge"));
        assertEquals("block", event.get("tone"));
        assertEquals("Blocked", event.get("dataState"));
        assertEquals(120, event.get("blockedFor"));
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=RuntimeMonitorEventFactoryTest test
```

Expected: FAIL because `RuntimeMonitorEventFactory` does not exist.

- [ ] **Step 3: Implement factory**

Create `backend/caac-gateway/src/main/java/org/example/gateway/service/RuntimeMonitorEventFactory.java`:

```java
package org.example.gateway.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class RuntimeMonitorEventFactory {
    private RuntimeMonitorEventFactory() {}

    public static Map<String, Object> step(String flowId, String phase, String username,
                                           String fileId, String sessionId,
                                           Map<String, Object> extra) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("flowId", safe(flowId));
        event.put("phase", safe(phase));
        event.put("username", safe(username));
        event.put("fileId", safe(fileId));
        if (sessionId != null && !sessionId.isBlank()) event.put("sessionId", sessionId);

        Mapping mapping = mappingFor(phase);
        event.put("edge", mapping.edge);
        event.put("nodes", mapping.nodes);
        event.put("tone", mapping.tone);
        event.put("label", mapping.label);
        event.put("dataState", mapping.dataState);

        if (extra != null) event.putAll(extra);
        return event;
    }

    private static Mapping mappingFor(String phase) {
        if ("REQUEST_RECEIVED".equals(phase)) return new Mapping("user-gateway", List.of("user", "gateway"), "info", "Request received by Gateway", "Raw request");
        if ("AUTH_BLOCKED".equals(phase)) return new Mapping("user-gateway", List.of("user", "gateway", "deny"), "deny", "Authentication required", "Denied");
        if ("ANOMALY_BLOCKED".equals(phase)) return new Mapping("anomaly-blocked", List.of("gateway", "anomaly", "blocked"), "block", "Anomaly detector blocked request", "Blocked");
        if ("FILE_NOT_FOUND".equals(phase)) return new Mapping("user-file", List.of("user", "file", "deny"), "deny", "Requested file not found", "Denied");
        if ("CLUSTER_BLOCKED".equals(phase)) return new Mapping("anomaly-blocked", List.of("gateway", "anomaly", "blocked"), "block", "Subnet blocked by cluster risk", "Blocked");
        if ("CONTEXT_RESOLVED".equals(phase)) return new Mapping("gateway-context", List.of("gateway", "context"), "info", "Raw context mapped to L/N/D/T scores", "Context score");
        if ("POLICY_EVALUATING".equals(phase)) return new Mapping("context-oracle", List.of("context", "oracle", "fabric"), "info", "Oracle relays evaluateAccess to Fabric", "Policy query");
        if ("POLICY_DECIDED".equals(phase)) return new Mapping("oracle-fabric", List.of("oracle", "fabric"), "warn", "Fabric returned policy decision", "Policy decision");
        if ("ACCESS_DENIED".equals(phase) || "RULE_DENIED".equals(phase) || "BUDGET_DENIED".equals(phase)) return new Mapping("fabric-deny", List.of("fabric", "deny"), "deny", "Access denied before streaming", "Denied");
        if ("ACCESS_PERMITTED".equals(phase)) return new Mapping("fabric-permit", List.of("fabric", "permit"), "ok", "Access permitted and session opened", "Permit");
        if ("STREAM_STARTED".equals(phase)) return new Mapping("gateway-ipfs", List.of("gateway", "ipfs"), "ok", "Gateway fetches encrypted IPFS object", "Encrypted/IPFS");
        if ("STREAM_CHUNK".equals(phase)) return new Mapping("gateway-ipfs", List.of("gateway", "ipfs", "permit"), "ok", "Gateway streams plaintext under RGCA budget", "Plaintext stream");
        if ("STREAM_COMPLETED".equals(phase)) return new Mapping("gateway-permit", List.of("gateway", "permit"), "ok", "Stream completed", "Receipt closing");
        if ("STREAM_REVOKED".equals(phase)) return new Mapping("fabric-revoked", List.of("fabric", "revoked"), "revoke", "Stream revoked by Algorithm 2", "Revoked");
        if ("CONTEXT_DEGRADED".equals(phase)) return new Mapping("gateway-context", List.of("gateway", "context"), "warn", "Session context degraded", "Context changed");
        return new Mapping("user-gateway", List.of("user", "gateway"), "info", safe(phase), "Runtime event");
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static final class Mapping {
        final String edge;
        final List<String> nodes;
        final String tone;
        final String label;
        final String dataState;

        Mapping(String edge, List<String> nodes, String tone, String label, String dataState) {
            this.edge = edge;
            this.nodes = nodes;
            this.tone = tone;
            this.label = label;
            this.dataState = dataState;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=RuntimeMonitorEventFactoryTest test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/caac-gateway/src/main/java/org/example/gateway/service/RuntimeMonitorEventFactory.java backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java
git commit -m "feat: map runtime monitor topology phases"
```

---

### Task 3: Emit Runtime Events from Real Access Decisions

**Files:**
- Modify: `backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java`
- Test: `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java`

- [ ] **Step 1: Add tests for all controller phases through factory**

Append this test to `RuntimeMonitorEventFactoryTest.java`:

```java
    @Test
    void requiredControllerPhasesHaveTopologyMappings() {
        String[] phases = {
                "REQUEST_RECEIVED", "AUTH_BLOCKED", "ANOMALY_BLOCKED", "FILE_NOT_FOUND",
                "CLUSTER_BLOCKED", "CONTEXT_RESOLVED", "POLICY_EVALUATING", "POLICY_DECIDED",
                "ACCESS_DENIED", "ACCESS_PERMITTED", "RULE_DENIED", "BUDGET_DENIED"
        };
        for (String phase : phases) {
            Map<String, Object> event = RuntimeMonitorEventFactory.step("REQ", phase, "admin", "report.txt", null, Map.of());
            assertFalse(String.valueOf(event.get("edge")).isBlank(), phase);
            assertFalse(String.valueOf(event.get("tone")).isBlank(), phase);
            assertFalse(String.valueOf(event.get("dataState")).isBlank(), phase);
        }
    }
```

- [ ] **Step 2: Run tests**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=RuntimeMonitorEventFactoryTest test
```

Expected: PASS before controller wiring because this test validates mapping completeness.

- [ ] **Step 3: Add controller helper methods**

In `FileAccessController.java`, add import:

```java
import org.example.gateway.service.RuntimeMonitorEventFactory;
```

Add private helpers near other private helpers:

```java
    private String runtimeFlowId(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    }

    private void publishRuntime(String flowId, String phase, String username,
                                String fileId, String sessionId, Map<String, Object> extra) {
        liveEventService.publishRuntimeStep(
                RuntimeMonitorEventFactory.step(flowId, phase, username, fileId, sessionId, extra));
    }
```

- [ ] **Step 4: Wire `webAccess` phases**

In `webAccess`, after `username` is computed:

```java
        String flowId = runtimeFlowId("REQ");
        publishRuntime(flowId, "REQUEST_RECEIVED", username, fileId, null, Map.of(
                "networkType", rawContext.getNetworkType(),
                "platform", rawContext.getPlatform()
        ));
```

Before each early return, emit:

```java
publishRuntime(flowId, "AUTH_BLOCKED", username, fileId, null, Map.of("reason", "Authentication required"));
publishRuntime(flowId, "ANOMALY_BLOCKED", username, fileId, null, Map.of("blockedFor", blockedSeconds));
publishRuntime(flowId, "FILE_NOT_FOUND", username, fileId, null, Map.of("reason", "File not found"));
publishRuntime(flowId, "CLUSTER_BLOCKED", username, fileId, null, Map.of("subnet", subnet, "remainingMin", remainingMin));
```

After context resolution and result scores are added:

```java
        publishRuntime(flowId, "CONTEXT_RESOLVED", username, fileId, null, Map.of(
                "resolvedScores", resolvedScores,
                "objectRisk", oRisk,
                "pReqEffective", pEff
        ));
        publishRuntime(flowId, "POLICY_EVALUATING", username, fileId, null, Map.of(
                "sLevel", fileEntry.getSLevel(),
                "rSub", authUser.getRSub()
        ));
```

After `oracleResult`:

```java
        publishRuntime(flowId, "POLICY_DECIDED", username, fileId, null, Map.of(
                "decision", oracleResult.getDecision(),
                "dtScore", oracleResult.getDtScore(),
                "ceScore", oracleResult.getCeScore(),
                "latencyMs", latencyMs
        ));
```

Before deny/error/rule/budget returns:

```java
publishRuntime(flowId, "ACCESS_DENIED", username, fileId, null, Map.of("decision", "DENY", "dtScore", oracleResult.getDtScore(), "reason", result.get("reason")));
publishRuntime(flowId, "RULE_DENIED", username, fileId, null, Map.of("reason", ruleViolation));
publishRuntime(flowId, "BUDGET_DENIED", username, fileId, null, Map.of("reason", "Risk budget exceeded"));
```

After session creation and before returning PERMIT:

```java
        publishRuntime(flowId, "ACCESS_PERMITTED", username, fileId, sessionId, Map.of(
                "decision", "PERMIT",
                "dtScore", oracleResult.getDtScore(),
                "riskMargin", riskMargin,
                "deliverySpeed", speedTier,
                "windowBudget", budget
        ));
```

- [ ] **Step 5: Run compile/tests**

Run:

```powershell
cd backend/caac-gateway
mvn -DskipTests=false test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java
git commit -m "feat: emit runtime monitor access events"
```

---

### Task 4: Emit Stream, Revocation, and Degrade Events

**Files:**
- Modify: `backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java`
- Test: `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java`

- [ ] **Step 1: Add mapping completeness test for stream phases**

Append to `RuntimeMonitorEventFactoryTest.java`:

```java
    @Test
    void streamAndRevocationPhasesHaveTopologyMappings() {
        String[] phases = {"STREAM_STARTED", "STREAM_CHUNK", "STREAM_COMPLETED", "STREAM_REVOKED", "CONTEXT_DEGRADED"};
        for (String phase : phases) {
            Map<String, Object> event = RuntimeMonitorEventFactory.step("SID", phase, "admin", "report.txt", "SID", Map.of("bytesDelivered", 10));
            assertFalse(String.valueOf(event.get("edge")).isBlank(), phase);
            assertFalse(String.valueOf(event.get("tone")).isBlank(), phase);
            assertFalse(String.valueOf(event.get("dataState")).isBlank(), phase);
        }
    }
```

- [ ] **Step 2: Run test**

Run:

```powershell
cd backend/caac-gateway
mvn -Dtest=RuntimeMonitorEventFactoryTest test
```

Expected: PASS after Task 2 mappings.

- [ ] **Step 3: Wire `streamFile` events**

In `streamFile`, after session ownership checks and `fileId` is known:

```java
        publishRuntime(sessionId, "STREAM_STARTED", session.getOwnerUsername(), fileId, sessionId, Map.of(
                "riskMargin", margin,
                "rgcaTier", rgcaTier
        ));
```

Inside the streaming loop after `session.addBytesDelivered(remaining);`, emit only on meaningful intervals to avoid SSE spam:

```java
                if (totalBytes == remaining || totalBytes == fileData.length || totalBytes % 32768 < remaining) {
                    publishRuntime(sessionId, "STREAM_CHUNK", session.getOwnerUsername(), fileId, sessionId, Map.of(
                            "bytesDelivered", totalBytes,
                            "windowBudget", budget,
                            "rgcaTier", session.getRgcaTier()
                    ));
                }
```

Before every revocation return:

```java
                    publishRuntime(sessionId, "STREAM_REVOKED", session.getOwnerUsername(), fileId, sessionId, Map.of(
                            "bytesDelivered", totalBytes,
                            "reason", "Context degradation detected mid-session"
                    ));
```

After stream completed before `finally` closes:

```java
            publishRuntime(sessionId, "STREAM_COMPLETED", session.getOwnerUsername(), fileId, sessionId, Map.of(
                    "bytesDelivered", totalBytes
            ));
```

- [ ] **Step 4: Wire `degradeSession`**

After context values are degraded:

```java
        publishRuntime(sessionId, "CONTEXT_DEGRADED", target.getOwnerUsername(), target.getFileId(), sessionId, Map.of(
                "lTrust", "0.1",
                "nStatus", "0.1",
                "dSec", "0.1",
                "tReq", "0.0"
        ));
```

If immediate revocation happens:

```java
            publishRuntime(sessionId, "STREAM_REVOKED", target.getOwnerUsername(), target.getFileId(), sessionId, Map.of(
                    "dtScore", result.getDtScore(),
                    "reason", "Immediate revocation after context degradation"
            ));
```

- [ ] **Step 5: Run backend tests**

Run:

```powershell
cd backend/caac-gateway
mvn test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimeMonitorEventFactoryTest.java
git commit -m "feat: emit runtime monitor streaming events"
```

---

### Task 5: Render Backend Runtime Events in Frontend Monitor

**Files:**
- Modify: `frontend/caac-website/js/runtime-monitor.js`
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/css/common.css`

- [ ] **Step 1: Add failing frontend tests**

Append to `frontend/caac-website/test/runtime-monitor.test.js`:

```javascript
test('ingestLiveEvent renders backend runtime path steps', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  monitor.ingestLiveEvent('RUNTIME_PATH_STEP', {
    flowId: 'REQ-1',
    phase: 'CONTEXT_RESOLVED',
    edge: 'gateway-context',
    nodes: ['gateway', 'context'],
    tone: 'info',
    label: 'Raw context -> L/N/D/T scores',
    dataState: 'Context score'
  });

  assert.equal(elements.runtimeScenarioTitle.textContent, 'Live runtime - CONTEXT_RESOLVED');
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-info-state'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Context score'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('gateway-context'));
});

test('backend denied runtime step renders rejection flow without success ripple', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  monitor.ingestLiveEvent('RUNTIME_PATH_STEP', {
    flowId: 'REQ-2',
    phase: 'ACCESS_DENIED',
    edge: 'fabric-deny',
    nodes: ['fabric', 'deny'],
    tone: 'deny',
    label: 'Access denied before streaming',
    dataState: 'Denied'
  });

  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-reject-flow'));
  assert.equal(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-data-ripple'), false);
});

test('backend stream chunk activates file node response', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  monitor.ingestLiveEvent('RUNTIME_PATH_STEP', {
    flowId: 'SID-1',
    phase: 'STREAM_CHUNK',
    edge: 'gateway-ipfs',
    nodes: ['gateway', 'ipfs', 'permit'],
    tone: 'ok',
    label: 'Gateway streams plaintext under RGCA budget',
    dataState: 'Plaintext stream',
    bytesDelivered: 8192
  });

  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-node-wave'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Plaintext stream'));
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because live runtime steps are not rendered.

- [ ] **Step 3: Add live runtime scenario frame builder**

In `runtime-monitor.js`, add:

```javascript
  function buildLiveRuntimeFrame(data) {
    const step = {
      label: data.label || data.phase || 'Runtime event',
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edge: data.edge || null,
      tone: data.tone || 'info',
      dataState: data.dataState || data.phase || 'Runtime event'
    };
    const activeNodeIds = Array.from(new Set(step.nodes));
    const activeEdgeIds = step.edge ? [step.edge] : [];
    const blockingTone = step.tone === 'deny' || step.tone === 'block' || step.tone === 'revoke';
    return {
      scenarioId: data.flowId || 'live-runtime',
      outcome: data.phase || 'LIVE',
      currentStep: clone(step),
      activeNodeIds,
      activeEdgeIds,
      filePathActive: !blockingTone && (step.edge === 'user-file' || step.edge === 'gateway-ipfs'),
      rejectFlowActive: blockingTone,
      dataState: step.dataState,
      completedStepCount: 1,
      totalStepCount: 1
    };
  }
```

- [ ] **Step 4: Render data-state and rejection flow**

Add helper:

```javascript
  function renderInfoState(frame) {
    if (!frame.dataState) return '';
    return '<g class="runtime-info-state" transform="translate(500 514)">' +
      '<rect x="-120" y="-18" width="240" height="36" rx="8"></rect>' +
      '<text>' + escapeText(frame.dataState) + '</text>' +
      '</g>';
  }
```

Update active edge markup to include reject class:

```javascript
      const reject = active && (tone === 'deny' || tone === 'block' || tone === 'revoke');
      return '<line class="runtime-edge ' + (active ? 'active' : '') + ' ' + tone +
        (reject ? ' runtime-reject-flow' : '') + '" ...
```

Update node markup so `ipfs`/`file` active transfer nodes get wave class:

```javascript
      const wave = frame.filePathActive && (node.id === 'ipfs' || node.id === 'file');
      return '<g class="runtime-node ' + (active ? 'active' : '') + ' ' + tone +
        (wave ? ' runtime-node-wave' : '') + '" ...
```

Add `const infoStateMarkup = renderInfoState(frame);` and include it inside viewport after ripple/node markup.

- [ ] **Step 5: Ingest backend events**

Update `ingestLiveEvent(type, data)`:

```javascript
    if (type === 'RUNTIME_PATH_STEP') {
      const monitor = createMonitor();
      if (!monitor) return;
      activeMonitor = monitor;
      installViewportInteractions(monitor);
      installViewportControls(monitor);
      const frame = buildLiveRuntimeFrame(data || {});
      activeScenario = {
        id: frame.scenarioId,
        title: 'Live runtime',
        outcome: frame.outcome,
        summary: data && data.label ? data.label : 'Backend runtime event',
        steps: [frame.currentStep]
      };
      activeFrame = frame;
      renderFrame(monitor, activeScenario, frame);
      return;
    }
```

Add `buildLiveRuntimeFrame` to public API for tests.

- [ ] **Step 6: Add CSS**

In `common.css`, add:

```css
.runtime-info-state rect {
  fill: rgba(8, 14, 26, 0.82);
  stroke: var(--border-hi);
}

.runtime-info-state text {
  fill: var(--text2);
  font-family: var(--mono);
  font-size: 12px;
  text-anchor: middle;
  dominant-baseline: middle;
}

.runtime-reject-flow {
  stroke: var(--red);
  stroke-dasharray: 4 12;
  animation: runtimeRejectPulse 700ms ease-in-out infinite;
}

.runtime-node-wave rect {
  animation: runtimeNodeWave 760ms ease-in-out infinite;
  filter: drop-shadow(0 0 12px rgba(74, 222, 128, 0.52));
}

@keyframes runtimeRejectPulse {
  0%, 100% { stroke-width: 3; opacity: 0.8; }
  50% { stroke-width: 7; opacity: 1; }
}

@keyframes runtimeNodeWave {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  50% { transform: translateX(2px); }
  75% { transform: translateX(-1px); }
}
```

- [ ] **Step 7: Run frontend tests/build**

Run:

```powershell
cd frontend/caac-website
node --test test/*.test.js
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js frontend/caac-website/css/common.css
git commit -m "feat: render backend runtime monitor events"
```

---

### Task 6: End-to-End Verification With Attack Script as Trigger

**Files:**
- No source changes unless verification finds a defect.

- [ ] **Step 1: Run backend tests**

Run:

```powershell
cd backend/caac-gateway
mvn test
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests/build**

Run:

```powershell
cd frontend/caac-website
node --test test/*.test.js
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 3: Manual/live verification**

Start the CAAC backend and frontend using the project’s normal local or server deployment process.

Open:

```text
http://<frontend-host>/admin.html
```

Run attack script against the Gateway:

```powershell
python "D:\WeiXing\history\xwechat_files\wxid_5wno8jy1cas122_2d31\temp\RWTemp\2026-05\10756745a45e2c37b7cea06b74997234\bvgca_attack_sim.py" --gateway http://localhost:5051 --password "<ADMIN_PASS>"
```

Expected Runtime Monitor behavior:

- A1 replay shows session/stream request then rejected closed-session flow.
- A3 privilege escalation shows request -> context -> policy decision -> denied red flow.
- A5 flood shows repeated request path -> anomaly detector -> blocked red flow.
- A8 budget bypass shows permit/stream chunks until budget denial or inconclusive status.
- A9 context spoofing shows raw context -> context score -> policy decision information-state changes.
- Successful streams show file/IPFS node wave; denied/blocked/revoked steps show red rejection flow and no success wave.

- [ ] **Step 4: Commit verification fixes if needed**

If source changes were required:

```powershell
git add backend/caac-gateway frontend/caac-website
git commit -m "fix: polish backend runtime monitor events"
```

If no fixes were needed, leave the working tree as-is.

---

## Self-Review

**Spec coverage:** Tasks cover backend publisher, event mapping, access decision instrumentation, streaming/revocation/degrade instrumentation, frontend live rendering, and attack-script-triggered end-to-end verification.

**Placeholder scan:** No implementation step uses TBD, TODO, "implement later", or vague testing instructions.

**Type consistency:** Event type is consistently `RUNTIME_PATH_STEP`. Event fields are consistently `flowId`, `phase`, `edge`, `nodes`, `tone`, `label`, `dataState`, `username`, `fileId`, `sessionId`, `decision`, `dtScore`, `riskMargin`, and `bytesDelivered`.

**Scope check:** The attack script is not modified. It remains a simulator that triggers real backend behavior; Gateway is the source of truth for runtime monitor events.
