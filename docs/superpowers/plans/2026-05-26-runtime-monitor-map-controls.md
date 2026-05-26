# Runtime Monitor Map Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add map-like zoom, mouse-centered wheel zoom, drag panning, reset controls, and active path file-block ripple animation to the Runtime Monitor canvas.

**Architecture:** Keep the Runtime Monitor as a single legacy browser module, but split the new behavior into pure viewport helpers plus DOM interaction wiring inside `runtime-monitor.js`. SVG rendering will wrap the graph in a transformed `<g>` so zoom/pan affects only the graph, while side cards and logs remain fixed. Ripple effects are derived from the current playback frame and rendered as SVG shapes for active storage/resource path steps.

**Tech Stack:** Existing Vite 5 app, vanilla JavaScript, SVG, CSS animations in `common.css`, Node built-in test runner with VM-based DOM fakes.

---

## Requirement Summary

- Runtime Monitor canvas behaves like a small map.
- Mouse wheel zooms in/out centered on the mouse pointer, not the canvas center.
- Pointer drag pans the graph without changing the right-side status/log layout.
- `+`, `-`, and reset controls are available for mouse users.
- Zoom and pan state survive scenario replay; reset returns to the default graph view.
- Active file/IPFS transfer paths show a ripple-like animated data block effect.
- Implementation remains frontend-only and mock-driven.

## File Structure

- Modify: `frontend/caac-website/js/runtime-monitor.js`
  - Add pure viewport helpers: `createViewport`, `clampScale`, `zoomViewportAt`, `panViewport`, and `resetViewport`.
  - Wrap SVG graph markup in a transformed `<g class="runtime-viewport">`.
  - Add wheel, pointer, and control-button event wiring.
  - Render ripple data blocks when active playback steps traverse `file` or `ipfs`.
  - Expose pure helpers through `window.CaacRuntimeMonitor` for tests.

- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
  - Add failing tests for mouse-centered zoom math.
  - Add failing tests for pan/reset helper behavior.
  - Extend fake DOM elements enough to test wheel/pointer/control listeners.
  - Add renderer test for active ripple markup.

- Modify: `frontend/caac-website/css/common.css`
  - Add cursor/touch-action rules for draggable SVG.
  - Add positioned zoom controls inside `.runtime-canvas-shell`.
  - Add ripple/data-block animation styles.
  - Keep mobile layout stable.

---

### Task 1: Add Pure Viewport Math Tests

**Files:**
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/js/runtime-monitor.js`

- [ ] **Step 1: Add failing tests for zoom/pan/reset helpers**

Append these tests near the existing pure model tests in `frontend/caac-website/test/runtime-monitor.test.js`:

```javascript
test('zoomViewportAt keeps the pointer anchored while changing scale', () => {
  const monitor = loadMonitor();
  const viewport = { scale: 1, x: 0, y: 0 };
  const next = monitor.zoomViewportAt(viewport, 2, { x: 250, y: 140 });
  assert.equal(next.scale, 2);
  assert.equal(next.x, -250);
  assert.equal(next.y, -140);
});

test('zoomViewportAt clamps scale and uses the clamped scale for pointer anchoring', () => {
  const monitor = loadMonitor();
  const viewport = { scale: 2.4, x: -120, y: -60 };
  const next = monitor.zoomViewportAt(viewport, 2, { x: 300, y: 180 });
  assert.equal(next.scale, 2.5);
  assert.equal(Math.round(next.x), -138);
  assert.equal(Math.round(next.y), -70);
});

test('panViewport and resetViewport update viewport without mutating the original object', () => {
  const monitor = loadMonitor();
  const viewport = { scale: 1.4, x: -20, y: 15 };
  const panned = monitor.panViewport(viewport, 30, -10);
  assert.deepEqual(viewport, { scale: 1.4, x: -20, y: 15 });
  assert.deepEqual(panned, { scale: 1.4, x: 10, y: 5 });
  assert.deepEqual(monitor.resetViewport(), { scale: 1, x: 0, y: 0 });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL with messages showing `monitor.zoomViewportAt is not a function`, `monitor.panViewport is not a function`, and `monitor.resetViewport is not a function`.

- [ ] **Step 3: Implement minimal viewport helper API**

In `frontend/caac-website/js/runtime-monitor.js`, add these constants and functions after `let activeScenarioId = 'normal-permit';`:

```javascript
  const DEFAULT_VIEWPORT = { scale: 1, x: 0, y: 0 };
  const MIN_VIEWPORT_SCALE = 0.65;
  const MAX_VIEWPORT_SCALE = 2.5;
  let viewport = resetViewport();

  function clampScale(value) {
    const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : 1;
    return Math.max(MIN_VIEWPORT_SCALE, Math.min(numericValue, MAX_VIEWPORT_SCALE));
  }

  function resetViewport() {
    return { ...DEFAULT_VIEWPORT };
  }

  function createViewport(value) {
    if (!value) return resetViewport();
    return {
      scale: clampScale(value.scale),
      x: typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0,
      y: typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0
    };
  }

  function zoomViewportAt(currentViewport, factor, point) {
    const current = createViewport(currentViewport);
    const zoomFactor = typeof factor === 'number' && Number.isFinite(factor) ? factor : 1;
    const nextScale = clampScale(current.scale * zoomFactor);
    const ratio = nextScale / current.scale;
    const anchor = point || { x: 0, y: 0 };
    return {
      scale: nextScale,
      x: anchor.x - (anchor.x - current.x) * ratio,
      y: anchor.y - (anchor.y - current.y) * ratio
    };
  }

  function panViewport(currentViewport, dx, dy) {
    const current = createViewport(currentViewport);
    return {
      scale: current.scale,
      x: current.x + dx,
      y: current.y + dy
    };
  }
```

Update the public API object near the bottom of the file:

```javascript
  const api = {
    getScenarios,
    getScenario,
    buildPlaybackFrame,
    createViewport,
    zoomViewportAt,
    panViewport,
    resetViewport,
    init,
    play: playScenario,
    ingestLiveEvent
  };
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: PASS for all runtime monitor tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js
git commit -m "test: cover runtime monitor viewport math"
```

---

### Task 2: Render the Graph Through a Persistent SVG Viewport

**Files:**
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/js/runtime-monitor.js`

- [ ] **Step 1: Add failing renderer test for viewport transform**

Append this test in `frontend/caac-website/test/runtime-monitor.test.js` after `init renders scenario buttons, first frame, and playback status`:

```javascript
test('rendered canvas wraps graph in a transformed runtime viewport group', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('class="runtime-viewport"'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('transform="translate(0 0) scale(1)"'));
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because `runtime-viewport` markup does not exist yet.

- [ ] **Step 3: Add viewport transform helper and wrap graph markup**

In `frontend/caac-website/js/runtime-monitor.js`, add this helper after `panViewport`:

```javascript
  function viewportTransform(value) {
    const current = createViewport(value);
    return 'translate(' + current.x + ' ' + current.y + ') scale(' + current.scale + ')';
  }
```

In `renderCanvas(canvas, scenario, frame)`, replace the final `canvas.innerHTML = ...` assignment with:

```javascript
    canvas.innerHTML = '<defs>' +
      '<filter id="runtimeGlow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/>' +
      '<feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs><g class="runtime-viewport" transform="' + viewportTransform(viewport) + '">' +
      edgeMarkup + nodeMarkup + '</g>';
```

Add `viewportTransform` to the public API object:

```javascript
    viewportTransform,
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js
git commit -m "feat: render runtime monitor through viewport group"
```

---

### Task 3: Add Wheel Zoom and Drag Pan Interaction

**Files:**
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/js/runtime-monitor.js`

- [ ] **Step 1: Extend fake DOM elements with listener dispatch and bounding rect**

In `frontend/caac-website/test/runtime-monitor.test.js`, update `createElement(id)` so the returned object includes these members:

```javascript
    dataset: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); }
    },
    addEventListener(eventName, listener) {
      this.listeners[eventName] = listener;
    },
    dispatch(eventName, event) {
      if (this.listeners[eventName]) this.listeners[eventName](event);
    },
    getBoundingClientRect() {
      return { left: 10, top: 20, width: 1000, height: 560 };
    },
    setPointerCapture(pointerId) {
      this.capturedPointerId = pointerId;
    },
    releasePointerCapture(pointerId) {
      this.releasedPointerId = pointerId;
    },
```

Keep the existing `querySelectorAll` method, because the scenario button tests depend on it.

- [ ] **Step 2: Add failing DOM interaction tests**

Append these tests after the viewport transform renderer test:

```javascript
test('wheel zooms around the mouse position and updates rendered transform', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  elements.runtimeMonitorCanvas.dispatch('wheel', {
    deltaY: -100,
    clientX: 260,
    clientY: 160,
    preventDefault() { this.defaultPrevented = true; }
  });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('scale(1.12)'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(-30 -16.8)'));
});

test('pointer drag pans the runtime viewport', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  elements.runtimeMonitorCanvas.dispatch('pointerdown', {
    pointerId: 7,
    clientX: 200,
    clientY: 120,
    button: 0,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointermove', {
    pointerId: 7,
    clientX: 230,
    clientY: 135,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointerup', { pointerId: 7 });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(30 15) scale(1)'));
  assert.equal(elements.runtimeMonitorCanvas.capturedPointerId, 7);
  assert.equal(elements.runtimeMonitorCanvas.releasedPointerId, 7);
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because `wheel`, `pointerdown`, `pointermove`, and `pointerup` listeners are not wired.

- [ ] **Step 4: Track active monitor and add interaction wiring**

In `frontend/caac-website/js/runtime-monitor.js`, add module-level state after `let activeScenarioId = 'normal-permit';`:

```javascript
  let activeMonitor = null;
  let activeScenario = getScenario(activeScenarioId);
  let activeFrame = buildPlaybackFrame(activeScenario, 0);
  let isDraggingViewport = false;
  let lastDragPoint = null;
```

Add these helper functions after `viewportTransform`:

```javascript
  function canvasPointFromEvent(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function rerenderActiveFrame() {
    if (activeMonitor && activeScenario && activeFrame) {
      renderFrame(activeMonitor, activeScenario, activeFrame);
    }
  }

  function handleWheelZoom(canvas, event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    viewport = zoomViewportAt(viewport, factor, canvasPointFromEvent(canvas, event));
    rerenderActiveFrame();
  }

  function handlePointerDown(canvas, event) {
    if (event.button !== 0) return;
    isDraggingViewport = true;
    lastDragPoint = { x: event.clientX, y: event.clientY };
    canvas.classList.add('dragging');
    if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(event.pointerId);
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!isDraggingViewport || !lastDragPoint) return;
    viewport = panViewport(viewport, event.clientX - lastDragPoint.x, event.clientY - lastDragPoint.y);
    lastDragPoint = { x: event.clientX, y: event.clientY };
    rerenderActiveFrame();
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  }

  function handlePointerEnd(canvas, event) {
    isDraggingViewport = false;
    lastDragPoint = null;
    canvas.classList.remove('dragging');
    if (typeof canvas.releasePointerCapture === 'function') canvas.releasePointerCapture(event.pointerId);
  }

  function installViewportInteractions(monitor) {
    if (monitor.canvas.dataset.runtimeViewportReady === 'true') return;
    monitor.canvas.dataset.runtimeViewportReady = 'true';
    monitor.canvas.addEventListener('wheel', event => handleWheelZoom(monitor.canvas, event), { passive: false });
    monitor.canvas.addEventListener('pointerdown', event => handlePointerDown(monitor.canvas, event));
    monitor.canvas.addEventListener('pointermove', handlePointerMove);
    monitor.canvas.addEventListener('pointerup', event => handlePointerEnd(monitor.canvas, event));
    monitor.canvas.addEventListener('pointercancel', event => handlePointerEnd(monitor.canvas, event));
  }
```

Update `playScenario(id, delayMs)`:

```javascript
    activeMonitor = monitor;
    installViewportInteractions(monitor);
```

Inside `tick`, after computing `const frame = buildPlaybackFrame(scenario, stepIndex);`, add:

```javascript
      activeScenario = scenario;
      activeFrame = frame;
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js
git commit -m "feat: add map-style runtime monitor navigation"
```

---

### Task 4: Add Zoom Controls and Reset Button

**Files:**
- Modify: `frontend/caac-website/admin.html`
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/js/runtime-monitor.js`
- Modify: `frontend/caac-website/css/common.css`

- [ ] **Step 1: Add control markup to the admin panel**

In `frontend/caac-website/admin.html`, inside `.runtime-canvas-shell` and before the `<svg id="runtimeMonitorCanvas"...>`, add:

```html
        <div class="runtime-map-controls" aria-label="Runtime monitor map controls">
          <button type="button" id="runtimeZoomIn" class="runtime-map-btn" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" id="runtimeZoomOut" class="runtime-map-btn" title="Zoom out" aria-label="Zoom out">-</button>
          <button type="button" id="runtimeZoomReset" class="runtime-map-btn" title="Reset view" aria-label="Reset view">Reset</button>
        </div>
```

- [ ] **Step 2: Extend test DOM and add failing control test**

In `loadMonitorWithDom()`, add these fake elements:

```javascript
    runtimeZoomIn: createElement('runtimeZoomIn'),
    runtimeZoomOut: createElement('runtimeZoomOut'),
    runtimeZoomReset: createElement('runtimeZoomReset')
```

Append this test:

```javascript
test('zoom controls zoom and reset the viewport', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  elements.runtimeZoomIn.dispatch('click', {});
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('scale(1.18)'));
  elements.runtimeZoomOut.dispatch('click', {});
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('scale(1)'));
  elements.runtimeZoomIn.dispatch('click', {});
  elements.runtimeZoomReset.dispatch('click', {});
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(0 0) scale(1)'));
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because zoom control listeners are not installed.

- [ ] **Step 4: Wire control buttons in the monitor module**

In `createMonitor()`, add:

```javascript
      zoomIn: document.getElementById('runtimeZoomIn'),
      zoomOut: document.getElementById('runtimeZoomOut'),
      zoomReset: document.getElementById('runtimeZoomReset')
```

Do not add these three controls to the required-element guard; the monitor should still no-op safely if old markup is loaded.

Add this helper after `installViewportInteractions`:

```javascript
  function installViewportControls(monitor) {
    if (monitor.controlsReady) return;
    monitor.controlsReady = true;
    const centerPoint = { x: 500, y: 280 };
    if (monitor.zoomIn) {
      monitor.zoomIn.addEventListener('click', () => {
        viewport = zoomViewportAt(viewport, 1.18, centerPoint);
        rerenderActiveFrame();
      });
    }
    if (monitor.zoomOut) {
      monitor.zoomOut.addEventListener('click', () => {
        viewport = zoomViewportAt(viewport, 1 / 1.18, centerPoint);
        rerenderActiveFrame();
      });
    }
    if (monitor.zoomReset) {
      monitor.zoomReset.addEventListener('click', () => {
        viewport = resetViewport();
        rerenderActiveFrame();
      });
    }
  }
```

Update `playScenario(id, delayMs)` after `installViewportInteractions(monitor);`:

```javascript
    installViewportControls(monitor);
```

- [ ] **Step 5: Add control and cursor styles**

In `frontend/caac-website/css/common.css`, update `.runtime-canvas-shell`:

```css
.runtime-canvas-shell {
  position: relative;
  min-height: 360px;
  min-width: 0;
  border: 1px solid rgba(94, 164, 248, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(rgba(94, 164, 248, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(94, 164, 248, 0.05) 1px, transparent 1px),
    rgba(4, 9, 18, 0.72);
  background-size: 32px 32px;
  overflow: hidden;
}
```

Update `.runtime-canvas`:

```css
.runtime-canvas {
  width: 100%;
  max-width: 100%;
  height: 360px;
  display: block;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.runtime-canvas.dragging {
  cursor: grabbing;
}
```

Add after `.runtime-canvas`:

```css
.runtime-map-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: flex;
  gap: 6px;
}

.runtime-map-btn {
  min-width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(8, 14, 26, 0.82);
  color: var(--text2);
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
}

.runtime-map-btn:hover {
  border-color: var(--border-hi);
  color: var(--accent);
  background: var(--bg3);
}
```

Add light-theme styles after the existing `.runtime-canvas-shell` light block:

```css
html[data-theme="light"] .runtime-map-btn {
  background: color-mix(in srgb, var(--bg2) 92%, white);
  border-color: color-mix(in srgb, var(--border-hi) 58%, transparent);
  color: var(--text2);
}
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
cd frontend/caac-website
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/caac-website/admin.html frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js frontend/caac-website/css/common.css
git commit -m "feat: add runtime monitor zoom controls"
```

---

### Task 5: Add Active File-Path Ripple Animation

**Files:**
- Modify: `frontend/caac-website/test/runtime-monitor.test.js`
- Modify: `frontend/caac-website/js/runtime-monitor.js`
- Modify: `frontend/caac-website/css/common.css`

- [ ] **Step 1: Add failing tests for ripple markup**

Append these tests:

```javascript
test('buildPlaybackFrame reports file path activity for file and ipfs steps', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('normal-permit');
  const fileRequestFrame = monitor.buildPlaybackFrame(scenario, 0);
  assert.equal(fileRequestFrame.filePathActive, true);
  const streamFrame = monitor.buildPlaybackFrame(scenario, 5);
  assert.equal(streamFrame.filePathActive, true);
});

test('renderer adds ripple data blocks when active path touches file storage nodes', () => {
  const { monitor, elements, timers } = loadMonitorWithDom();
  monitor.play('normal-permit', 0);
  timers.runAll();
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-data-ripple'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-data-block'));
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd frontend/caac-website
node --test test/runtime-monitor.test.js
```

Expected: FAIL because `filePathActive` and ripple markup do not exist.

- [ ] **Step 3: Mark file-path activity in playback frames**

In `buildPlaybackFrame(scenario, stepIndex)`, add:

```javascript
    const filePathActive = visibleSteps.some(step => {
      const nodes = step.nodes || [];
      return nodes.includes('file') || nodes.includes('ipfs') || step.edge === 'gateway-ipfs' || step.edge === 'user-file';
    });
```

Return it in the frame object:

```javascript
      filePathActive,
```

- [ ] **Step 4: Render ripple shapes inside the viewport group**

Add this function after `nodeTone`:

```javascript
  function renderFileRipples(frame) {
    if (!frame.filePathActive) return '';
    return [
      '<g class="runtime-data-ripple" transform="translate(720 302)">',
      '<circle class="runtime-ripple-ring ring-a" r="18"></circle>',
      '<circle class="runtime-ripple-ring ring-b" r="28"></circle>',
      '<rect class="runtime-data-block block-a" x="-20" y="-8" width="40" height="16" rx="5"></rect>',
      '<rect class="runtime-data-block block-b" x="-12" y="12" width="26" height="10" rx="4"></rect>',
      '</g>'
    ].join('');
  }
```

In `renderCanvas(canvas, scenario, frame)`, define:

```javascript
    const rippleMarkup = renderFileRipples(frame);
```

Then include `rippleMarkup` before `nodeMarkup` in the viewport group:

```javascript
      edgeMarkup + rippleMarkup + nodeMarkup + '</g>';
```

- [ ] **Step 5: Add ripple CSS animation**

In `frontend/caac-website/css/common.css`, add after `.runtime-edge.ok`:

```css
.runtime-data-ripple {
  pointer-events: none;
}

.runtime-ripple-ring {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  opacity: 0.55;
  transform-origin: center;
  animation: runtimeRipple 1500ms ease-out infinite;
}

.runtime-ripple-ring.ring-b {
  animation-delay: 360ms;
  stroke: var(--green);
}

.runtime-data-block {
  fill: color-mix(in srgb, var(--accent) 62%, white);
  opacity: 0.88;
  filter: drop-shadow(0 0 10px rgba(94, 164, 248, 0.48));
  animation: runtimeDataPulse 1200ms ease-in-out infinite;
}

.runtime-data-block.block-b {
  fill: color-mix(in srgb, var(--green) 68%, white);
  animation-delay: 240ms;
}
```

Add keyframes after `@keyframes runtimeDash`:

```css
@keyframes runtimeRipple {
  0% {
    opacity: 0.7;
    transform: scale(0.78);
  }
  100% {
    opacity: 0;
    transform: scale(1.75);
  }
}

@keyframes runtimeDataPulse {
  0%, 100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-4px) scale(1.08);
  }
}
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
cd frontend/caac-website
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/caac-website/js/runtime-monitor.js frontend/caac-website/test/runtime-monitor.test.js frontend/caac-website/css/common.css
git commit -m "feat: animate runtime monitor file-path ripples"
```

---

### Task 6: Local Visual Verification

**Files:**
- No source changes required unless verification finds a defect.

- [ ] **Step 1: Start the local dev server**

Run:

```bash
cd frontend/caac-website
npm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 2: Open the admin page**

Open:

```text
http://localhost:5173/admin.html
```

Expected: admin page loads. If backend auth blocks the admin screen, use the existing project-approved local admin flow or inspect the built page after authentication.

- [ ] **Step 3: Verify map interaction behavior**

Manual checks:

- Wheel up zooms in around the cursor position.
- Wheel down zooms out around the cursor position.
- Dragging the SVG pans the graph.
- `+` zooms in.
- `-` zooms out.
- `Reset` returns the graph to `translate(0 0) scale(1)`.
- Scenario replay does not reset the view unless `Reset` is clicked.
- Right-side status, progress, and log panels do not move during pan/zoom.

- [ ] **Step 4: Verify ripple behavior**

Manual checks:

- `Normal file access` shows ripple/data-block motion when the path reaches file/IPFS steps.
- `Sensitivity mismatch` shows ripple on the initial file request, then ends in deny.
- `Attack path blocked` does not show a misleading successful stream ripple at the blocked outcome.
- `Mid-stream revocation` shows ripple during stream, then ends in revoked.
- Ripple animation remains readable at desktop width and narrow mobile width.

- [ ] **Step 5: Final verification**

Run:

```bash
cd frontend/caac-website
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 6: Commit visual fixes if needed**

If visual verification required any source changes:

```bash
git add frontend/caac-website
git commit -m "fix: polish runtime monitor map interactions"
```

If no fixes were needed, leave the working tree clean.

---

## Self-Review

**Spec coverage:** Task 1 covers pure viewport math. Task 2 makes SVG zoom/pan possible without moving panel chrome. Task 3 implements mouse-centered wheel zoom and drag panning. Task 4 adds visible controls. Task 5 adds file/IPFS path ripple animation. Task 6 covers local visual verification.

**Placeholder scan:** This plan contains no TBD, TODO, "implement later", unspecified tests, or vague implementation instructions.

**Type consistency:** Viewport helpers use `{ scale, x, y }` consistently. DOM IDs are `runtimeZoomIn`, `runtimeZoomOut`, `runtimeZoomReset`, and `runtimeMonitorCanvas`. Public API methods are `createViewport`, `zoomViewportAt`, `panViewport`, `resetViewport`, and `viewportTransform`.
