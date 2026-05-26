# Runtime Monitor Implementation Plan

> **Status:** Completed on 2026-05-26. The runtime monitor panel, mock scenario engine, admin integration, responsive styling, tests, build fixes, and visual-readiness polish have been implemented. The plan checkboxes below are updated to reflect the completed task state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mock-driven Runtime Monitor panel to the CAAC admin page that animates access paths, attack paths, denials, blocks, and revocations for demo recording.

**Architecture:** Implement the monitor as a focused browser module loaded into the existing legacy admin stack. The HTML provides a single panel host, CSS owns the dashboard styling and responsive layout, and the JavaScript module owns scenario data, animation state, SVG rendering, and public controls. The first version uses deterministic mock scenarios only; later backend/SSE integration can feed the same event shape.

**Tech Stack:** Existing Vite 5 app, vanilla JavaScript legacy stack, CSS in `common.css`, Node built-in test runner for pure scenario/model tests.

---

## Requirement Summary

The boss wants a new admin-page runtime monitoring canvas:

- Place it in `frontend/caac-website/admin.html` between the existing `ops-hero` section and the `Analytics dashboard`.
- Show system nodes and access paths dynamically, not as static table data.
- Use nodes for user, file, Gateway, context resolver, anomaly detector, Oracle/Fabric, IPFS, and block/deny/revoke outcomes.
- Use edges to represent normal access, attack paths, and blocked paths.
- Make steps appear one by one with pauses so a screen recording can clearly show system feedback.
- Start with frontend mock data and local `npm run dev`; do not require backend changes for the first delivery.
- Keep the visual language consistent with the existing admin page.

## File Structure

- Modify: `frontend/caac-website/admin.html`
  - Adds the Runtime Monitor panel host between `ops-hero` and `Analytics dashboard`.
  - Adds buttons for replaying mock scenarios.

- Create: `frontend/caac-website/js/runtime-monitor.js`
  - Owns scenario definitions, monitor state, animation playback, SVG rendering, and status/log updates.
  - Exposes `window.CaacRuntimeMonitor`.

- Modify: `frontend/caac-website/src/entries/admin.js`
  - Loads `runtime-monitor.js` before `admin.js` in the existing raw legacy stack.

- Modify: `frontend/caac-website/js/admin.js`
  - Initializes the monitor after admin authentication and data loading.
  - Feeds existing live events into the monitor where useful.

- Modify: `frontend/caac-website/css/common.css`
  - Adds Runtime Monitor layout, SVG, node, edge, log, legend, and responsive styles.

- Create: `frontend/caac-website/test/runtime-monitor.test.js`
  - Tests pure scenario/model helpers with Node's built-in test runner.

- Modify: `frontend/caac-website/package.json`
  - Adds a `test` script for the new Node test.

---

### Task 1: Add Pure Runtime Monitor Scenario Module

**Files:**
- Create: `frontend/caac-website/js/runtime-monitor.js`
- Test: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/package.json`

- [x] **Step 1: Add a failing model test**

Create `frontend/caac-website/test/runtime-monitor.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadMonitor() {
  const code = fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  const sandbox = {
    window: {},
    document: { getElementById: () => null },
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.CaacRuntimeMonitor;
}

test('mock scenarios include normal, denied, blocked, and revoked outcomes', () => {
  const monitor = loadMonitor();
  const outcomes = monitor.getScenarios().map(s => s.outcome);
  assert.deepEqual(outcomes.sort(), ['BLOCKED', 'DENIED', 'PERMIT', 'REVOKED']);
});

test('buildPlaybackFrame returns active node and edge ids up to a step index', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('attack-blocked');
  const frame = monitor.buildPlaybackFrame(scenario, 2);
  assert.ok(frame.activeNodeIds.includes('attacker'));
  assert.ok(frame.activeNodeIds.includes('gateway'));
  assert.ok(frame.activeEdgeIds.includes('attacker-gateway'));
  assert.equal(frame.currentStep.label, 'Gateway receives burst');
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because `../js/runtime-monitor.js` does not exist.

- [x] **Step 3: Implement the scenario/model API**

Create `frontend/caac-website/js/runtime-monitor.js`:

```javascript
(function () {
  const NODE_POSITIONS = {
    user: [8, 46],
    attacker: [8, 72],
    gateway: [26, 46],
    context: [44, 30],
    anomaly: [44, 64],
    oracle: [62, 30],
    fabric: [80, 30],
    ipfs: [80, 54],
    file: [62, 54],
    permit: [94, 46],
    deny: [94, 66],
    blocked: [94, 82],
    revoked: [94, 18]
  };

  const NODES = [
    { id: 'user', label: 'User', kind: 'subject' },
    { id: 'attacker', label: 'Attacker', kind: 'threat' },
    { id: 'gateway', label: 'Gateway', kind: 'pep' },
    { id: 'context', label: 'Context Resolver', kind: 'score' },
    { id: 'anomaly', label: 'Anomaly Detector', kind: 'guard' },
    { id: 'oracle', label: 'Oracle', kind: 'bridge' },
    { id: 'fabric', label: 'Fabric PDP', kind: 'chain' },
    { id: 'ipfs', label: 'IPFS Ciphertext', kind: 'storage' },
    { id: 'file', label: 'File Registry', kind: 'resource' },
    { id: 'permit', label: 'Permit', kind: 'ok' },
    { id: 'deny', label: 'Deny', kind: 'deny' },
    { id: 'blocked', label: 'Blocked', kind: 'block' },
    { id: 'revoked', label: 'Revoked', kind: 'revoke' }
  ].map(node => ({ ...node, x: NODE_POSITIONS[node.id][0], y: NODE_POSITIONS[node.id][1] }));

  const SCENARIOS = [
    {
      id: 'normal-permit',
      title: 'Normal file access',
      outcome: 'PERMIT',
      summary: 'Trusted user accesses an approved file and receives a risk-budgeted stream.',
      steps: [
        { label: 'User requests file', nodes: ['user', 'file'], edge: 'user-file', tone: 'info' },
        { label: 'Gateway authenticates token', nodes: ['user', 'gateway'], edge: 'user-gateway', tone: 'ok' },
        { label: 'Context scores resolved', nodes: ['gateway', 'context'], edge: 'gateway-context', tone: 'info' },
        { label: 'Oracle relays evaluateAccess', nodes: ['context', 'oracle', 'fabric'], edge: 'context-oracle', tone: 'info' },
        { label: 'Fabric returns PERMIT', nodes: ['fabric', 'permit'], edge: 'fabric-permit', tone: 'ok' },
        { label: 'Gateway streams from IPFS', nodes: ['gateway', 'ipfs', 'permit'], edge: 'gateway-ipfs', tone: 'ok' }
      ]
    },
    {
      id: 'role-denied',
      title: 'Sensitivity mismatch',
      outcome: 'DENIED',
      summary: 'A low-role user requests a high-sensitivity object and is denied by the PDP.',
      steps: [
        { label: 'User requests S5 file', nodes: ['user', 'file'], edge: 'user-file', tone: 'info' },
        { label: 'Gateway builds access request', nodes: ['user', 'gateway', 'file'], edge: 'user-gateway', tone: 'info' },
        { label: 'Fabric checks R_sub < S_level', nodes: ['gateway', 'oracle', 'fabric'], edge: 'oracle-fabric', tone: 'warn' },
        { label: 'Decision DENY returned', nodes: ['fabric', 'deny'], edge: 'fabric-deny', tone: 'deny' }
      ]
    },
    {
      id: 'attack-blocked',
      title: 'Attack path blocked',
      outcome: 'BLOCKED',
      summary: 'Burst access and suspicious context trigger anomaly blocking before data delivery.',
      steps: [
        { label: 'Suspicious client connects', nodes: ['attacker'], edge: null, tone: 'warn' },
        { label: 'Gateway receives burst', nodes: ['attacker', 'gateway'], edge: 'attacker-gateway', tone: 'warn' },
        { label: 'Anomaly detector scores behavior', nodes: ['gateway', 'anomaly'], edge: 'gateway-anomaly', tone: 'warn' },
        { label: 'Runtime monitor marks path', nodes: ['anomaly', 'blocked'], edge: 'anomaly-blocked', tone: 'block' },
        { label: 'Access blocked before IPFS', nodes: ['blocked', 'ipfs'], edge: 'blocked-ipfs', tone: 'block' }
      ]
    },
    {
      id: 'midstream-revoked',
      title: 'Mid-stream revocation',
      outcome: 'REVOKED',
      summary: 'A permitted session degrades during streaming and Algorithm 2 revokes it.',
      steps: [
        { label: 'Session starts as PERMIT', nodes: ['user', 'gateway', 'permit'], edge: 'gateway-permit', tone: 'ok' },
        { label: 'Windowed stream begins', nodes: ['gateway', 'ipfs'], edge: 'gateway-ipfs', tone: 'ok' },
        { label: 'Context degrades', nodes: ['gateway', 'context'], edge: 'gateway-context', tone: 'warn' },
        { label: 'Scheduler re-evaluates', nodes: ['context', 'oracle', 'fabric'], edge: 'context-oracle', tone: 'warn' },
        { label: 'Session revoked', nodes: ['fabric', 'revoked'], edge: 'fabric-revoked', tone: 'revoke' }
      ]
    }
  ];

  const EDGES = {
    'user-file': ['user', 'file'],
    'user-gateway': ['user', 'gateway'],
    'attacker-gateway': ['attacker', 'gateway'],
    'gateway-context': ['gateway', 'context'],
    'gateway-anomaly': ['gateway', 'anomaly'],
    'context-oracle': ['context', 'oracle'],
    'oracle-fabric': ['oracle', 'fabric'],
    'fabric-permit': ['fabric', 'permit'],
    'fabric-deny': ['fabric', 'deny'],
    'fabric-revoked': ['fabric', 'revoked'],
    'gateway-ipfs': ['gateway', 'ipfs'],
    'gateway-permit': ['gateway', 'permit'],
    'anomaly-blocked': ['anomaly', 'blocked'],
    'blocked-ipfs': ['blocked', 'ipfs']
  };

  function getScenarios() {
    return SCENARIOS.map(s => ({ ...s, steps: s.steps.map(step => ({ ...step })) }));
  }

  function getScenario(id) {
    return getScenarios().find(s => s.id === id) || getScenarios()[0];
  }

  function buildPlaybackFrame(scenario, stepIndex) {
    const max = Math.max(0, Math.min(stepIndex, scenario.steps.length - 1));
    const visibleSteps = scenario.steps.slice(0, max + 1);
    const activeNodeIds = Array.from(new Set(visibleSteps.flatMap(step => step.nodes || [])));
    const activeEdgeIds = visibleSteps.map(step => step.edge).filter(Boolean);
    return {
      scenarioId: scenario.id,
      currentStep: scenario.steps[max],
      activeNodeIds,
      activeEdgeIds,
      completedStepCount: visibleSteps.length,
      totalStepCount: scenario.steps.length
    };
  }

  window.CaacRuntimeMonitor = {
    getScenarios,
    getScenario,
    buildPlaybackFrame
  };
})();
```

- [x] **Step 4: Run the model test**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: PASS, both tests pass.

- [x] **Step 5: Add npm test script**

Modify `frontend/caac-website/package.json`:

```json
{
  "name": "caac-website",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "chart.js": "^4.4.9"
  },
  "devDependencies": {
    "vite": "^5.4.14"
  }
}
```

- [x] **Step 6: Run package test**

Run:

```bash
cd frontend/caac-website
npm test
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js frontend/caac-website/package.json
git commit -m "test: add runtime monitor scenario model"
```

---

### Task 2: Add Runtime Monitor Panel Markup

**Files:**
- Modify: `frontend/caac-website/admin.html:77-80`

- [x] **Step 1: Insert panel after `</div>` closing `.ops-hero`**

In `frontend/caac-website/admin.html`, insert this block immediately after line 77 and before `<!-- ANALYTICS DASHBOARD -->`:

```html
  <!-- RUNTIME MONITOR -->
  <section class="runtime-monitor-panel" aria-label="Runtime access monitor">
    <div class="runtime-monitor-header">
      <div>
        <span class="runtime-kicker">Runtime monitor</span>
        <h2>Access path canvas</h2>
        <p>Mock-driven live view for request paths, attack detection, blocking, and revocation demos.</p>
      </div>
      <div class="runtime-actions" id="runtimeScenarioButtons" aria-label="Runtime monitor scenarios"></div>
    </div>
    <div class="runtime-monitor-grid">
      <div class="runtime-canvas-shell">
        <svg id="runtimeMonitorCanvas" class="runtime-canvas" viewBox="0 0 1000 560" role="img" aria-label="Animated CAAC runtime access path"></svg>
      </div>
      <aside class="runtime-side">
        <div class="runtime-status-card">
          <span class="runtime-status-label">Current scenario</span>
          <strong id="runtimeScenarioTitle">Loading monitor</strong>
          <small id="runtimeScenarioSummary">Preparing mock timeline...</small>
        </div>
        <div class="runtime-meter">
          <span>Playback</span>
          <div><i id="runtimeProgressBar"></i></div>
          <b id="runtimeProgressText">0/0</b>
        </div>
        <div class="runtime-log" id="runtimeMonitorLog" aria-live="polite"></div>
      </aside>
    </div>
  </section>
```

- [x] **Step 2: Build to verify markup still compiles**

Run:

```bash
cd frontend/caac-website
npm run build
```

Expected: PASS, Vite writes `dist`.

- [x] **Step 3: Commit**

```bash
git add frontend/caac-website/admin.html
git commit -m "feat: add runtime monitor panel markup"
```

---

### Task 3: Add Runtime Monitor Styling

**Files:**
- Modify: `frontend/caac-website/css/common.css`

- [x] **Step 1: Add panel styles near the existing `.ops-hero` styles**

Append this block after the existing admin ops styles around `.ops-hero`:

```css
.runtime-monitor-panel {
  margin: 18px 0;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background:
    linear-gradient(180deg, rgba(94, 164, 248, 0.08), rgba(8, 14, 26, 0.18)),
    var(--bg2);
  box-shadow: var(--shadow);
  position: relative;
  overflow: hidden;
}

.runtime-monitor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.runtime-kicker,
.runtime-status-label {
  display: block;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .8px;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 5px;
}

.runtime-monitor-header h2 {
  margin: 0;
  font-size: 20px;
  color: var(--text);
}

.runtime-monitor-header p {
  margin: 6px 0 0;
  max-width: 720px;
  color: var(--text3);
  font-size: 13px;
}

.runtime-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.runtime-scenario-btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text2);
  border-radius: 6px;
  padding: 7px 10px;
  font-family: var(--mono);
  font-size: 10px;
  cursor: pointer;
}

.runtime-scenario-btn.active,
.runtime-scenario-btn:hover {
  border-color: var(--border-hi);
  color: var(--accent);
  background: var(--bg3);
}

.runtime-monitor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
}

.runtime-canvas-shell {
  min-height: 360px;
  border: 1px solid rgba(94, 164, 248, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(rgba(94, 164, 248, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(94, 164, 248, 0.05) 1px, transparent 1px),
    rgba(4, 9, 18, 0.72);
  background-size: 32px 32px;
  overflow: hidden;
}

.runtime-canvas {
  width: 100%;
  height: 360px;
  display: block;
}

.runtime-edge {
  stroke: rgba(148, 163, 184, 0.26);
  stroke-width: 3;
  fill: none;
  stroke-linecap: round;
}

.runtime-edge.active {
  stroke: var(--accent);
  stroke-dasharray: 10 10;
  animation: runtimeDash 900ms linear infinite;
}

.runtime-edge.warn { stroke: var(--amber); }
.runtime-edge.deny,
.runtime-edge.block,
.runtime-edge.revoke { stroke: var(--red); }
.runtime-edge.ok { stroke: var(--green); }

.runtime-node rect {
  fill: rgba(15, 23, 42, 0.94);
  stroke: rgba(148, 163, 184, 0.28);
  stroke-width: 1.5;
  rx: 8;
}

.runtime-node.active rect {
  stroke: var(--accent);
  filter: drop-shadow(0 0 10px rgba(94, 164, 248, 0.45));
}

.runtime-node.ok rect { stroke: var(--green); }
.runtime-node.deny rect,
.runtime-node.block rect,
.runtime-node.revoke rect,
.runtime-node.threat rect { stroke: var(--red); }

.runtime-node text {
  fill: var(--text2);
  font-family: var(--mono);
  font-size: 12px;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

.runtime-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.runtime-status-card,
.runtime-meter,
.runtime-log {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(8, 14, 26, 0.62);
  padding: 12px;
}

.runtime-status-card strong {
  display: block;
  color: var(--text);
  margin-bottom: 6px;
}

.runtime-status-card small {
  color: var(--text3);
  line-height: 1.5;
}

.runtime-meter span,
.runtime-meter b {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text3);
}

.runtime-meter div {
  height: 7px;
  margin: 8px 0;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  overflow: hidden;
}

.runtime-meter i {
  display: block;
  width: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--green));
  transition: width 240ms ease;
}

.runtime-log {
  min-height: 190px;
  max-height: 190px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text3);
}

.runtime-log-entry {
  padding: 6px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.runtime-log-entry.ok { color: var(--green); }
.runtime-log-entry.warn { color: var(--amber); }
.runtime-log-entry.deny,
.runtime-log-entry.block,
.runtime-log-entry.revoke { color: var(--red); }

@keyframes runtimeDash {
  to { stroke-dashoffset: -20; }
}

@media (max-width: 900px) {
  .runtime-monitor-header,
  .runtime-monitor-grid {
    grid-template-columns: 1fr;
  }

  .runtime-monitor-header {
    flex-direction: column;
  }

  .runtime-actions {
    justify-content: flex-start;
  }
}
```

- [x] **Step 2: Build to catch CSS syntax issues**

Run:

```bash
cd frontend/caac-website
npm run build
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add frontend/caac-website/css/common.css
git commit -m "style: add runtime monitor dashboard styles"
```

---

### Task 4: Render and Animate the Monitor

**Files:**
- Modify: `frontend/caac-website/js/runtime-monitor.js`

- [x] **Step 1: Extend the module with DOM rendering**

Replace the final `window.CaacRuntimeMonitor = ...` assignment in `runtime-monitor.js` with this implementation:

```javascript
  let playbackTimer = null;
  let activeScenarioId = 'normal-permit';

  function edgeTone(edgeId, scenario, frame) {
    const step = scenario.steps.find(s => s.edge === edgeId && frame.activeEdgeIds.includes(edgeId));
    return step ? step.tone : '';
  }

  function nodeTone(nodeId, scenario, frame) {
    const step = [...scenario.steps].reverse().find(s => (s.nodes || []).includes(nodeId) && frame.activeNodeIds.includes(nodeId));
    if (nodeId === 'attacker') return 'threat';
    return step ? step.tone : '';
  }

  function renderCanvas(canvas, scenario, frame) {
    const edgeMarkup = Object.entries(EDGES).map(([id, pair]) => {
      const from = NODES.find(n => n.id === pair[0]);
      const to = NODES.find(n => n.id === pair[1]);
      const active = frame.activeEdgeIds.includes(id);
      const tone = active ? edgeTone(id, scenario, frame) : '';
      return `<line class="runtime-edge ${active ? 'active' : ''} ${tone}" x1="${from.x * 10}" y1="${from.y * 5.6}" x2="${to.x * 10}" y2="${to.y * 5.6}"></line>`;
    }).join('');

    const nodeMarkup = NODES.map(node => {
      const active = frame.activeNodeIds.includes(node.id);
      const tone = active ? nodeTone(node.id, scenario, frame) : node.kind;
      return `<g class="runtime-node ${active ? 'active' : ''} ${tone}" transform="translate(${node.x * 10},${node.y * 5.6})">
        <rect x="-58" y="-20" width="116" height="40"></rect>
        <text>${node.label}</text>
      </g>`;
    }).join('');

    canvas.innerHTML = `<defs>
      <filter id="runtimeGlow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>${edgeMarkup}${nodeMarkup}`;
  }

  function renderButtons(root, monitor) {
    root.innerHTML = getScenarios().map(s =>
      `<button type="button" class="runtime-scenario-btn ${s.id === activeScenarioId ? 'active' : ''}" data-runtime-scenario="${s.id}">${s.title}</button>`
    ).join('');
    root.querySelectorAll('[data-runtime-scenario]').forEach(btn => {
      btn.addEventListener('click', () => monitor.play(btn.dataset.runtimeScenario));
    });
  }

  function renderFrame(monitor, scenario, frame) {
    renderCanvas(monitor.canvas, scenario, frame);
    monitor.title.textContent = scenario.title + ' — ' + scenario.outcome;
    monitor.summary.textContent = scenario.summary;
    monitor.progressText.textContent = frame.completedStepCount + '/' + frame.totalStepCount;
    monitor.progressBar.style.width = Math.round((frame.completedStepCount / frame.totalStepCount) * 100) + '%';
    const entries = scenario.steps.slice(0, frame.completedStepCount).map((step, index) =>
      `<div class="runtime-log-entry ${step.tone}">T+${String(index + 1).padStart(2, '0')} ${step.label}</div>`
    ).join('');
    monitor.log.innerHTML = entries;
    monitor.log.scrollTop = monitor.log.scrollHeight;
  }

  function createMonitor() {
    const monitor = {
      canvas: document.getElementById('runtimeMonitorCanvas'),
      buttons: document.getElementById('runtimeScenarioButtons'),
      title: document.getElementById('runtimeScenarioTitle'),
      summary: document.getElementById('runtimeScenarioSummary'),
      progressBar: document.getElementById('runtimeProgressBar'),
      progressText: document.getElementById('runtimeProgressText'),
      log: document.getElementById('runtimeMonitorLog')
    };
    if (!monitor.canvas || !monitor.buttons || !monitor.title || !monitor.summary || !monitor.progressBar || !monitor.progressText || !monitor.log) {
      return null;
    }
    return monitor;
  }

  function playScenario(id, delayMs) {
    const monitor = createMonitor();
    if (!monitor) return;
    const scenario = getScenario(id);
    activeScenarioId = scenario.id;
    renderButtons(monitor.buttons, api);
    if (playbackTimer) clearTimeout(playbackTimer);
    let stepIndex = 0;
    const tick = () => {
      const frame = buildPlaybackFrame(scenario, stepIndex);
      renderFrame(monitor, scenario, frame);
      stepIndex += 1;
      if (stepIndex < scenario.steps.length) {
        playbackTimer = setTimeout(tick, delayMs || 1150);
      }
    };
    tick();
  }

  function init() {
    const monitor = createMonitor();
    if (!monitor) return;
    renderButtons(monitor.buttons, api);
    playScenario(activeScenarioId, 1150);
  }

  function ingestLiveEvent(type) {
    if (type === 'FILE_UPLOADED') playScenario('normal-permit', 900);
    if (type === 'USER_STATUS_CHANGED') playScenario('role-denied', 900);
    if (type && type.indexOf('ANOMALY') >= 0) playScenario('attack-blocked', 900);
  }

  const api = {
    getScenarios,
    getScenario,
    buildPlaybackFrame,
    init,
    play: playScenario,
    ingestLiveEvent
  };

  window.CaacRuntimeMonitor = api;
```

- [x] **Step 2: Re-run tests**

Run:

```bash
cd frontend/caac-website
npm test
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js
git commit -m "feat: render animated runtime monitor"
```

---

### Task 5: Load and Initialize Runtime Monitor in Admin Stack

**Files:**
- Modify: `frontend/caac-website/src/entries/admin.js`
- Modify: `frontend/caac-website/js/admin.js`

- [x] **Step 1: Load `runtime-monitor.js` in the Vite entry**

Modify `frontend/caac-website/src/entries/admin.js`:

```javascript
import Chart from 'chart.js/auto';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import runtimeMonitor from '../../js/runtime-monitor.js?raw';
import admin from '../../js/admin.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

window.Chart = Chart;

runLegacyStack([
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/runtime-monitor.js', runtimeMonitor],
  ['js/admin.js', admin]
]);
```

- [x] **Step 2: Initialize after admin data loads**

In `frontend/caac-website/js/admin.js`, modify the `DOMContentLoaded` handler:

```javascript
window.addEventListener('DOMContentLoaded', async () => {
  const ok = await checkAdmin();
  if (!ok) return;
  await Promise.all([loadUsers(), loadFiles(), loadConversations(), loadAudit(), loadStats(), loadAnalytics(), loadAnomalies()]);
  if (window.CaacRuntimeMonitor && typeof window.CaacRuntimeMonitor.init === 'function') {
    window.CaacRuntimeMonitor.init();
  }
  installAdminLiveEvents();
  caacVisibleInterval(loadUsers, 10000);
  caacVisibleInterval(loadFiles, 15000);
  caacVisibleInterval(loadConversations, 5000);
  caacVisibleInterval(() => { if (activeConversation) loadConversationMessages(); }, 3000);
  caacVisibleInterval(loadAudit, 10000);
  caacVisibleInterval(loadStats, 10000);
  caacVisibleInterval(loadAnalytics, 30000);
  caacVisibleInterval(loadAnomalies, 15000);
});
```

- [x] **Step 3: Feed live events into the monitor**

At the top of `handleAdminLiveEvent(event)`, after `const data = payload.data || {};`, add:

```javascript
  if (window.CaacRuntimeMonitor && typeof window.CaacRuntimeMonitor.ingestLiveEvent === 'function') {
    window.CaacRuntimeMonitor.ingestLiveEvent(type, data);
  }
```

- [x] **Step 4: Run tests and build**

Run:

```bash
cd frontend/caac-website
npm test
npm run build
```

Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add frontend/caac-website/src/entries/admin.js frontend/caac-website/js/admin.js
git commit -m "feat: initialize runtime monitor in admin console"
```

---

### Task 6: Local Visual Verification and Demo Readiness

**Files:**
- No source changes required unless verification finds a defect.

- [x] **Step 1: Start dev server**

Run:

```bash
cd frontend/caac-website
npm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [x] **Step 2: Open admin page**

Open:

```text
http://localhost:5173/admin.html
```

Expected: existing admin authentication flow appears. If local backend is not available, use the built page only for visual verification after temporarily bypassing auth in browser dev tools or by running with the normal local CAAC backend.

- [x] **Step 3: Verify monitor behavior**

Manual checks:

- Runtime Monitor appears between Security operations and Analytics dashboard.
- Four scenario buttons are visible.
- Each scenario animates nodes and edges step by step.
- Logs append one line per step.
- Progress bar advances.
- `Attack path blocked` visibly ends in the `Blocked` node.
- `Mid-stream revocation` visibly ends in the `Revoked` node.
- Layout remains usable at desktop width and at a narrow mobile viewport.

- [x] **Step 4: Final build**

Run:

```bash
cd frontend/caac-website
npm test
npm run build
```

Expected: both PASS.

- [x] **Step 5: Commit verification fixes if needed**

If any visual or build fixes were made:

```bash
git add frontend/caac-website
git commit -m "fix: polish runtime monitor visual behavior"
```

---

## Self-Review

**Completion update:** All implementation and verification steps are marked complete. The current git history includes runtime-monitor commits through responsive/mobile and renderer hardening fixes, and the working tree was clean before this plan-status update.

**Spec coverage:** The plan covers placement, runtime canvas, graph nodes and edges, animated step playback, block/deny/revoke outcomes, mock-first frontend development, local dev/build, and recording-friendly timing.

**Placeholder scan:** No task uses TBD, TODO, "implement later", or unspecified testing instructions.

**Type consistency:** Scenario IDs used by tests and runtime code are consistent: `normal-permit`, `role-denied`, `attack-blocked`, and `midstream-revoked`. Public API methods are consistently named `getScenarios`, `getScenario`, `buildPlaybackFrame`, `init`, `play`, and `ingestLiveEvent`.
