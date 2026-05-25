import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('admin Vite entry loads runtime monitor before admin legacy script', () => {
  const code = fs.readFileSync(new URL('../src/entries/admin.js', import.meta.url), 'utf8');
  assert.match(code, /import runtimeMonitor from '\.\.\/\.\.\/js\/runtime-monitor\.js\?raw';/);
  assert.ok(code.indexOf("['js/runtime-monitor.js', runtimeMonitor]") < code.indexOf("['js/admin.js', admin]"));
});

test('admin legacy script initializes monitor and forwards live events', () => {
  const code = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(code, /CaacRuntimeMonitor\.init\(\)/);
  assert.match(code, /CaacRuntimeMonitor\.ingestLiveEvent\(type, data\)/);
  assert.ok(code.indexOf('CaacRuntimeMonitor.init()') < code.indexOf('installAdminLiveEvents();'));
});
