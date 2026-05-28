# Runtime Monitor Backend Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Each implementation task must start with failing tests, then code, then review.

**Goal:** Runtime Monitor should stop relying on front-end-only simulated data blocks for the access path. Real backend access, stream, denial, revocation, anomaly, and degradation decisions should emit live runtime path events over the existing SSE channel. The frontend topology should render those events in real time: successful data flow produces file/node-centered ripple feedback, rejected access produces a rejection animation on the flow path, and every step can display how the access information changes.

**Architecture:** Keep the attack script as a traffic generator only. The script calls the real gateway endpoints; the gateway emits `RUNTIME_PATH_STEP` events through `LiveEventService`; the admin frontend consumes those events through the existing `/api/events/stream` SSE connection and renders them on the Runtime Monitor canvas. Do not make `bvgca_attack_sim.py` directly drive the frontend.

**Tech Stack:** Java Spring Boot gateway, existing `SseEmitter` live event channel, Vite/static frontend JavaScript, Node test runner, Maven/Spring Boot tests.

## Event Contract

Backend emits:

```json
{
  "type": "RUNTIME_PATH_STEP",
  "timestamp": "2026-05-26T10:00:00Z",
  "data": {
    "flowId": "session-or-request-id",
    "phase": "CONTEXT_RESOLVED",
    "edge": "gateway-context",
    "nodes": ["gateway", "context"],
    "tone": "info",
    "label": "Context resolved",
    "dataState": "Raw request context -> L=3,N=4,D=2,T=1",
    "payload": {
      "fileId": 10,
      "sessionId": "optional-session-id",
      "decision": "PERMIT",
      "reason": "optional-safe-summary"
    }
  }
}
```

Frontend semantics:

- `tone: "success"`: animate the current edge and add node/file-centered ripple to `nodes`.
- `tone: "deny" | "block" | "revoke"`: animate the current edge with a rejection effect and do not show success ripple.
- `tone: "info" | "warn"`: show active traversal and information transformation label.
- `dataState`: shown as the current transformation text near the path and in the event log/status area.

## Tasks

- [ ] Backend event schema tests
  - Create `backend/caac-gateway/src/test/java/org/example/gateway/service/RuntimePathEventBuilderTest.java`.
  - Add tests first for these builder cases:
    - `requestReceived` contains `flowId`, `phase`, `edge`, `nodes`, `tone`, `label`, and safe `payload`.
    - `contextResolved` formats `dataState` from resolved context scores without exposing secrets.
    - `policyDenied` uses a denial tone and includes decision/reason.
    - `streamChunk` uses success tone and targets file/IPFS nodes.
    - Null optional values are omitted or rendered as safe defaults, not as `"null"` strings.
  - Implement `backend/caac-gateway/src/main/java/org/example/gateway/service/RuntimePathEventBuilder.java`.
  - Use `LinkedHashMap` for stable payload ordering in tests.

- [ ] Backend live publisher
  - Add a public method to `backend/caac-gateway/src/main/java/org/example/gateway/service/LiveEventService.java`:

    ```java
    public void publishRuntimePathStep(Map<String, Object> data) {
        if (data == null || data.isEmpty()) {
            return;
        }
        publishToAdmins("RUNTIME_PATH_STEP", new LinkedHashMap<>(data));
    }
    ```

  - Add or update tests so a non-admin subscriber does not receive admin runtime monitor events and an admin subscriber is eligible to receive them. If direct `SseEmitter` assertion is awkward, extract the admin routing decision into a package-private helper and test that helper.
  - Run backend unit tests for the service package before continuing.

- [ ] Backend access decision instrumentation
  - Modify `backend/caac-gateway/src/main/java/org/example/gateway/controller/FileAccessController.java`.
  - In `webAccess`, publish runtime steps at these points:
    - request enters gateway: `REQUEST_RECEIVED`, edge `user-gateway`, nodes `["user", "gateway"]`, tone `info`.
    - anomaly block before evaluation: `ANOMALY_BLOCKED`, edge `gateway-anomaly`, nodes `["gateway", "anomaly"]`, tone `block`.
    - subnet/CSRP block: `NETWORK_BLOCKED`, edge `gateway-anomaly`, nodes `["gateway", "anomaly"]`, tone `block`.
    - after `contextResolver.resolve`: `CONTEXT_RESOLVED`, edge `gateway-context`, nodes `["gateway", "context"]`, tone `info`, with `dataState` describing raw context to score transformation.
    - before/after Oracle/Fabric decision: `POLICY_EVALUATED`, edge `context-fabric`, nodes `["context", "fabric"]`, tone `success` for permit and `deny` for deny.
    - risk budget or rule violation denial: `ACCESS_DENIED`, edge `fabric-deny`, nodes `["fabric", "deny"]`, tone `deny`.
    - session creation success: `SESSION_CREATED`, edge `fabric-permit`, nodes `["fabric", "permit"]`, tone `success`.
  - Derive `flowId` from session ID when available; before session creation use a request-scoped ID such as `req-<timestamp>-<fileId>-<userId>`.
  - Tests should cover at least one permit path and one deny/block path with mocked `LiveEventService`, verifying `publishRuntimePathStep` is called with the expected phase and tone.

- [ ] Backend stream/revocation instrumentation
  - Continue in `FileAccessController`.
  - In `streamFile`, publish:
    - `STREAM_STARTED`, edge `gateway-ipfs`, nodes `["gateway", "ipfs", "file"]`, tone `success`, `dataState` such as `Authorized session -> file stream`.
    - `STREAM_CHUNK_DELIVERED` only for first chunk and coarse progress milestones, not every tiny write.
    - `STREAM_REVOKED`, edge `fabric-revoked`, nodes `["fabric", "revoked"]`, tone `revoke` when `session.isRevoked()` interrupts streaming.
    - `BUDGET_RECHECK_DENIED`, edge `fabric-revoked`, nodes `["fabric", "revoked"]`, tone `revoke` when budget exhaustion causes denial.
    - `STREAM_COMPLETED`, edge `gateway-permit`, nodes `["gateway", "permit"]`, tone `success`.
  - In `degradeSession`, publish:
    - `CONTEXT_DEGRADED`, edge `gateway-context`, nodes `["gateway", "context"]`, tone `warn`, `dataState` describing old context to degraded context.
    - `SESSION_REVOKED`, edge `fabric-revoked`, nodes `["fabric", "revoked"]`, tone `revoke` when degradation revokes the session.
  - Add tests for revocation/denial event phases and for stream success event phases.

- [ ] Frontend live event ingestion tests
  - Update `frontend/caac-website/test/runtime-monitor.test.js` before implementation.
  - Add tests for `window.CaacRuntimeMonitor.ingestLiveEvent("RUNTIME_PATH_STEP", payload)`:
    - stores/renders the backend-provided edge and nodes instead of replacing it with a mock scenario.
    - renders `dataState` text.
    - applies success ripple only to the active file/IPFS nodes on success events.
    - applies rejection animation classes/markup to the active edge on deny/block/revoke events.
    - preserves existing mock scenario behavior for non-runtime event types such as `FILE_UPLOADED` and `ANOMALY`.

- [ ] Frontend Runtime Monitor renderer
  - Modify `frontend/caac-website/js/runtime-monitor.js`.
  - Add a live event mode for `RUNTIME_PATH_STEP` payloads:
    - normalize backend payload into the existing topology model.
    - keep `flowId`, `phase`, `edge`, `nodes`, `tone`, `label`, `dataState`, and `payload`.
    - use a short queue or latest-event-per-flow buffer so rapid backend events animate smoothly without freezing the UI.
  - Replace the current independent ripple data-block animation for live backend path events:
    - active success nodes render node-centered wave/ripple markup, for example `runtime-node-wave`.
    - denied/blocked/revoked events render an edge rejection overlay, for example `runtime-edge-reject`.
    - information transformation renders a path label, for example `runtime-transform-label`.
  - Keep map-style pan/zoom behavior from the existing Runtime Monitor implementation.

- [ ] Frontend styles
  - Modify `frontend/caac-website/css/runtime-monitor.css`.
  - Add styles/keyframes for:
    - node/file-centered success wave, visually tied to the file block or active node.
    - rejection animation on the active path, using red interruption/dash/pulse semantics.
    - compact transformation label that does not overlap topology nodes at desktop or mobile widths.
  - Avoid returning to the old meaning where a separate floating data block is the primary ripple.

- [ ] Admin SSE integration verification
  - Confirm `frontend/caac-website/js/admin.js` continues to route SSE events through `safeIngestRuntimeMonitor(type, data)`.
  - Add or update tests if existing coverage can verify `RUNTIME_PATH_STEP` reaches Runtime Monitor through `handleAdminLiveEvent`.
  - Do not add a second SSE connection for Runtime Monitor.

- [ ] End-to-end validation
  - Run backend tests:

    ```powershell
    cd G:\ContextAwareAccessControl\backend\caac-gateway
    mvn test
    ```

  - Run frontend tests and build:

    ```powershell
    cd G:\ContextAwareAccessControl\frontend\caac-website
    node --test test/*.test.js
    npm.cmd run build
    ```

  - Manual acceptance:
    - Start the backend and frontend normally.
    - Log in as an admin user so `/api/events/stream` is connected.
    - Run the attack simulation script only as traffic input against the backend.
    - Verify the Runtime Monitor shows backend-driven topology updates:
      - context information transformation appears during access evaluation.
      - permitted stream causes file/IPFS node-centered success waves.
      - denied or blocked request causes rejection animation on the relevant data flow path.
      - session revocation or budget denial is visually distinct from a normal success path.

## Review Requirements

- Every implementation subtask must receive code review before the next dependent task begins.
- Review should check for:
  - no secrets or raw tokens in SSE payloads;
  - no excessive event spam during streaming;
  - no direct coupling from `bvgca_attack_sim.py` to frontend UI;
  - frontend animations match the requested semantics: success ripple on encountered file blocks/nodes, rejection animation on denied flow, and visible information transformation.

## Acceptance Criteria

- `RUNTIME_PATH_STEP` is emitted by backend access and stream paths.
- Frontend Runtime Monitor can render backend events without using mock scenarios for those events.
- Success and rejection animations are both present and semantically different.
- Information transformation is visible during the access lifecycle.
- Existing pan/zoom and mouse-centered wheel zoom continue working.
- Backend and frontend automated tests pass.
