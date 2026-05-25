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

function createElement(id) {
  return {
    id,
    _innerHTML: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    style: {},
    listeners: {},
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

function loadMonitorWithDom() {
  const code = fs.readFileSync(new URL('../js/runtime-monitor.js', import.meta.url), 'utf8');
  const elements = {
    runtimeMonitorCanvas: createElement('runtimeMonitorCanvas'),
    runtimeScenarioButtons: createElement('runtimeScenarioButtons'),
    runtimeScenarioTitle: createElement('runtimeScenarioTitle'),
    runtimeScenarioSummary: createElement('runtimeScenarioSummary'),
    runtimeProgressBar: createElement('runtimeProgressBar'),
    runtimeProgressText: createElement('runtimeProgressText'),
    runtimeMonitorLog: createElement('runtimeMonitorLog')
  };
  const timeouts = [];
  const sandbox = {
    window: {},
    document: { getElementById: id => elements[id] || null },
    setTimeout: (listener, delay) => {
      timeouts.push({ listener, delay });
      return timeouts.length;
    },
    clearTimeout: () => {},
    console
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { monitor: sandbox.window.CaacRuntimeMonitor, elements, timeouts };
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
  const { monitor, elements, timeouts } = loadMonitorWithDom();
  monitor.init();
  assert.ok(elements.runtimeScenarioButtons.innerHTML.includes('normal-permit'));
  assert.ok(elements.runtimeScenarioButtons.innerHTML.includes('midstream-revoked'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('runtime-node'));
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Gateway'));
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Normal file access - PERMIT');
  assert.equal(elements.runtimeProgressText.textContent, '1/6');
  assert.equal(elements.runtimeProgressBar.style.width, '17%');
  assert.equal(timeouts[0].delay, 1150);
});

test('play renders the requested blocked scenario without waiting for timers', () => {
  const { monitor, elements, timeouts } = loadMonitorWithDom();
  monitor.play('attack-blocked', 900);
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Attack path blocked - BLOCKED');
  assert.ok(elements.runtimeMonitorCanvas.innerHTML.includes('Attacker'));
  assert.ok(elements.runtimeMonitorLog.innerHTML.includes('Suspicious client connects'));
  assert.equal(timeouts[0].delay, 900);
});

test('ingestLiveEvent maps anomaly events to the attack-blocked scenario', () => {
  const { monitor, elements } = loadMonitorWithDom();
  monitor.ingestLiveEvent('ANOMALY_DETECTED', {});
  assert.equal(elements.runtimeScenarioTitle.textContent, 'Attack path blocked - BLOCKED');
});
