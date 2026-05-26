import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadMonitor(codeOverride) {
  const code = codeOverride || fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
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

function loadMonitorWithWindowPrototypeMarker() {
  const code = fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  const windowPrototype = { runtimeWindowPrototypeMarker: true };
  const sandbox = {
    window: Object.create(windowPrototype),
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

function createElement(id) {
  return {
    id,
    _innerHTML: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    style: {},
    dataset: {},
    rect: { left: 10, top: 20, width: 1000, height: 560 },
    viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 560 } },
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); }
    },
    listeners: {},
    addEventListener(eventName, listener) {
      this.listeners[eventName] = listener;
    },
    dispatch(eventName, event) {
      if (this.listeners[eventName]) this.listeners[eventName](event);
    },
    getBoundingClientRect() {
      return this.rect;
    },
    setPointerCapture(pointerId) {
      this.capturedPointerId = pointerId;
    },
    releasePointerCapture(pointerId) {
      this.releasedPointerId = pointerId;
    },
    set innerHTML(value) {
      this._innerHTML = value;
      this.scrollHeight = value.length;
    },
    get innerHTML() {
      return this._innerHTML;
    },
    querySelectorAll(selector) {
      if (selector !== '[data-runtime-scenario]') return [];
      const ids = Array.from(this._innerHTML.matchAll(/data-runtime-scenario="([^"]+)"/g)).map(match => match[1]);
      return ids.map(runtimeScenario => ({
        dataset: { runtimeScenario },
        addEventListener: (eventName, listener) => {
          this.listeners[runtimeScenario + ':' + eventName] = listener;
        }
      }));
    }
  };
}

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const cleared = [];
  const timers = {
    setTimeout: (listener, delay) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { listener, delay });
      return id;
    },
    clearTimeout: id => {
      cleared.push(id);
      pending.delete(id);
    },
    runNext: () => {
      const id = Array.from(pending.keys())[0];
      if (!id) return false;
      const item = pending.get(id);
      pending.delete(id);
      item.listener();
      return true;
    },
    runAll: () => {
      while (pending.size) {
        timers.runNext();
      }
    },
    delays: () => Array.from(pending.values()).map(item => item.delay),
    pendingIds: () => Array.from(pending.keys()),
    clearedIds: () => cleared.slice()
  };
  return timers;
}

function loadMonitorWithDom(codeOverride) {
  const code = codeOverride || fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  const elements = {
    runtimeMonitorCanvas: createElement('runtimeMonitorCanvas'),
    runtimeScenarioButtons: createElement('runtimeScenarioButtons'),
    runtimeScenarioTitle: createElement('runtimeScenarioTitle'),
    runtimeScenarioSummary: createElement('runtimeScenarioSummary'),
    runtimeProgressBar: createElement('runtimeProgressBar'),
    runtimeProgressText: createElement('runtimeProgressText'),
    runtimeMonitorLog: createElement('runtimeMonitorLog')
  };
  const timers = createFakeTimers();
  const sandbox = {
    window: {},
    document: { getElementById: id => elements[id] || null },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    console
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { monitor: sandbox.window.CaacRuntimeMonitor, elements, timers };
}

test('mock scenarios include normal, denied, blocked, and revoked outcomes', () => {
  const monitor = loadMonitor();
  const outcomes = Array.from(monitor.getScenarios()).map(s => s.outcome);
  assert.deepEqual(outcomes.sort(), ['BLOCKED', 'DENIED', 'PERMIT', 'REVOKED']);
});

test('buildPlaybackFrame returns active node and edge ids up to a step index', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('attack-blocked');
  const frame = monitor.buildPlaybackFrame(scenario, 2);
  assert.ok(Array.from(frame.activeNodeIds).includes('attacker'));
  assert.ok(Array.from(frame.activeNodeIds).includes('gateway'));
  assert.ok(Array.from(frame.activeEdgeIds).includes('attacker-gateway'));
  assert.equal(frame.currentStep.label, 'Gateway receives burst');
});

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
  assert.deepEqual({ ...panned }, { scale: 1.4, x: 10, y: 5 });
  assert.deepEqual({ ...monitor.resetViewport() }, { scale: 1, x: 0, y: 0 });
});

test('viewport helpers return plain objects without inheriting from window or input prototypes', () => {
  const monitor = loadMonitorWithWindowPrototypeMarker();
  const customPrototype = { inheritedViewportMarker: true };
  const viewport = Object.assign(Object.create(customPrototype), { scale: 1.4, x: -20, y: 15 });
  assert.equal('runtimeWindowPrototypeMarker' in monitor.resetViewport(), false);
  assert.equal('inheritedViewportMarker' in monitor.createViewport(viewport), false);
  assert.equal('inheritedViewportMarker' in monitor.panViewport(viewport, 30, -10), false);
  assert.equal('inheritedViewportMarker' in monitor.zoomViewportAt(viewport, 2, { x: 0, y: 0 }), false);
});

test('production model does not use Function constructor or host realm array escape', () => {
  const code = fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  assert.equal(code.includes('constructor.constructor'), false);
  assert.equal(code.includes('Function('), false);
});

test('getScenario returns the first scenario for an unknown id', () => {
  const monitor = loadMonitor();
  const firstScenario = monitor.getScenarios()[0];
  const fallback = monitor.getScenario('does-not-exist');
  assert.equal(fallback.id, firstScenario.id);
});

test('buildPlaybackFrame defaults invalid step indexes to the first step', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('normal-permit');
  [undefined, NaN, 'not-a-number', -2].forEach(stepIndex => {
    const frame = monitor.buildPlaybackFrame(scenario, stepIndex);
    assert.equal(frame.currentStep.label, scenario.steps[0].label);
    assert.equal(frame.completedStepCount, 1);
  });
});

test('buildPlaybackFrame clamps overlarge step index to the final step', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('midstream-revoked');
  const frame = monitor.buildPlaybackFrame(scenario, 999);
  assert.equal(frame.currentStep.label, scenario.steps[scenario.steps.length - 1].label);
  assert.equal(frame.completedStepCount, scenario.steps.length);
  assert.equal(frame.totalStepCount, scenario.steps.length);
});

test('scenarios use shared graph playback step shape', () => {
  const monitor = loadMonitor();
  const scenario = monitor.getScenario('role-denied');
  const firstStep = scenario.steps[0];
  assert.ok(Array.from(firstStep.nodes).includes('user'));
  assert.equal(typeof firstStep.edge, 'string');
  assert.equal(typeof firstStep.tone, 'string');
  assert.equal('nodeIds' in firstStep, false);
  assert.equal('edgeIds' in firstStep, false);
});

test('init renders scenario buttons, first frame, and playback status', () => {
  const { monitor, elements, timers } = loadMonitorWithDom();
  monitor.init();
  assert.ok(elements.runtimeScenarioButtons.innerHTML.includes('normal-permit'));
  assert.ok(elements.runtimeScenarioButtons.innerHTML.includes('midstream-revoked'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-node'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Gateway'));
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Normal file access - PERMIT');
  assert.equal(elements.runtimeProgressText.textContent, '1/6');
  assert.equal(elements.runtimeProgressBar.style.width, '17%');
  assert.deepEqual(timers.delays(), [1150]);
});

test('rendered canvas wraps graph in a transformed runtime viewport group', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('class="runtime-viewport"'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('transform="translate(0 0) scale(1)"'));
});

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

test('wheel zoom maps rendered pixels to SVG viewBox coordinates', () => {
  const { monitor, elements } = loadMonitorWithDom();
  elements.runtimeMonitorCanvas.rect = { left: 10, top: 20, width: 500, height: 280 };
  monitor.init();
  elements.runtimeMonitorCanvas.dispatch('wheel', {
    deltaY: -100,
    clientX: 260,
    clientY: 160,
    preventDefault() {}
  });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('scale(1.12)'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(-60 -33.6)'));
});

test('wheel zoom prefers SVG screen CTM coordinate conversion when available', () => {
  const { monitor, elements } = loadMonitorWithDom();
  elements.runtimeMonitorCanvas.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform(matrix) {
      return {
        x: this.x * matrix.scaleX,
        y: this.y * matrix.scaleY
      };
    }
  });
  elements.runtimeMonitorCanvas.getScreenCTM = () => ({
    inverse() {
      return { scaleX: 2, scaleY: 2 };
    }
  });
  monitor.init();
  elements.runtimeMonitorCanvas.dispatch('wheel', {
    deltaY: -100,
    clientX: 260,
    clientY: 160,
    preventDefault() {}
  });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(-62.4 -38.4)'));
});

test('pointer drag maps rendered pixel deltas to SVG viewBox coordinates', () => {
  const { monitor, elements } = loadMonitorWithDom();
  elements.runtimeMonitorCanvas.rect = { left: 10, top: 20, width: 500, height: 280 };
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
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(60 30) scale(1)'));
});

test('pointer drag ignores events from pointers that were not captured', () => {
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
    pointerId: 8,
    clientX: 260,
    clientY: 150,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointerup', { pointerId: 8 });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(0 0) scale(1)'));
  assert.equal(elements.runtimeMonitorCanvas.releasedPointerId, undefined);
  elements.runtimeMonitorCanvas.dispatch('pointermove', {
    pointerId: 7,
    clientX: 230,
    clientY: 135,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointerup', { pointerId: 7 });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(30 15) scale(1)'));
  assert.equal(elements.runtimeMonitorCanvas.releasedPointerId, 7);
});

test('pointer drag ignores second pointerdown while a pointer is already captured', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  elements.runtimeMonitorCanvas.dispatch('pointerdown', {
    pointerId: 7,
    clientX: 200,
    clientY: 120,
    button: 0,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointerdown', {
    pointerId: 8,
    clientX: 260,
    clientY: 150,
    button: 0,
    preventDefault() {}
  });
  assert.equal(elements.runtimeMonitorCanvas.capturedPointerId, 7);
  elements.runtimeMonitorCanvas.dispatch('pointermove', {
    pointerId: 7,
    clientX: 230,
    clientY: 135,
    preventDefault() {}
  });
  elements.runtimeMonitorCanvas.dispatch('pointerup', { pointerId: 7 });
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('translate(30 15) scale(1)'));
  assert.equal(elements.runtimeMonitorCanvas.releasedPointerId, 7);
});

test('play renders the requested blocked scenario without waiting for timers', () => {
  const { monitor, elements, timers } = loadMonitorWithDom();
  monitor.play('attack-blocked', 900);
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Attack path blocked - BLOCKED');
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Attacker'));
  assert.ok(elements.runtimeMonitorLog.innerHTML.includes('Suspicious client connects'));
  assert.deepEqual(timers.delays(), [900]);
});

test('ingestLiveEvent maps anomaly events to the attack-blocked scenario', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.ingestLiveEvent('ANOMALY_DETECTED', {});
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Attack path blocked - BLOCKED');
});

test('renderer escapes scenario text before inserting markup', () => {
  const baseCode = fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  const hostileCode = baseCode
    .replace("label: 'User'", "label: '<img src=x onerror=alert(1)>'")
    .replace("label: 'User requests file'", "label: '<script>alert(1)</script>'");
  const { monitor, elements } = loadMonitorWithDom(hostileCode);
  monitor.init();
  assert.equal(elements.runtimeMonitorCanvas.innerHTML.includes('<img'), false);
  assert.equal(elements.runtimeMonitorLog.innerHTML.includes('<script>'), false);
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('&lt;img'));
  assert.ok(elements.runtimeMonitorLog.innerHTML.includes('&lt;script&gt;'));
});

test('playback timers progress through a full multi-step scenario', () => {
  const { monitor, elements, timers } = loadMonitorWithDom();
  monitor.play('role-denied', 0);
  assert.equal(elements.runtimeProgressText.textContent, '1/4');
  assert.deepEqual(timers.delays(), [0]);
  timers.runNext();
  assert.equal(elements.runtimeProgressText.textContent, '2/4');
  timers.runNext();
  assert.equal(elements.runtimeProgressText.textContent, '3/4');
  timers.runNext();
  assert.equal(elements.runtimeProgressText.textContent, '4/4');
  assert.deepEqual(timers.delays(), []);
});

test('replay clears stale playback timer before starting another scenario', () => {
  const { monitor, elements, timers } = loadMonitorWithDom();
  monitor.play('normal-permit', 50);
  const staleId = timers.pendingIds()[0];
  monitor.play('attack-blocked', 25);
  assert.ok(timers.clearedIds().includes(staleId));
  timers.runNext();
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Attack path blocked - BLOCKED');
  assert.equal(elements.runtimeProgressText.textContent, '2/6');
});

test('scenario buttons trigger playback by click handler', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.init();
  elements.runtimeScenarioButtons.listeners['midstream-revoked:click']();
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Mid-stream revocation - REVOKED');
});

test('public DOM APIs no-op when monitor markup is absent', () => {
  const monitor = loadMonitor();
  assert.doesNotThrow(() => monitor.init());
  assert.doesNotThrow(() => monitor.play('attack-blocked', 0));
  assert.doesNotThrow(() => monitor.ingestLiveEvent('ANOMALY_DETECTED', {}));
});
