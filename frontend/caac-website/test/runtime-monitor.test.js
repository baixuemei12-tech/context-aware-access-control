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
