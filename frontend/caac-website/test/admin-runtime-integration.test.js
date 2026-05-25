import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadAdminSandbox(runtimeMonitor) {
  const code = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const warnings = [];
  const sandbox = {
    console: {
      warn: (...args) => warnings.push(args),
      log: () => {},
      error: () => {}
    },
    window: {
      CaacRuntimeMonitor: runtimeMonitor,
      addEventListener: () => {}
    },
    document: {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    EventSource: function EventSource() {},
    alert: () => {},
    confirm: () => true,
    location: { href: '' }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.__warnings = warnings;
  return sandbox;
}

test('admin Vite entry loads runtime monitor before admin legacy script', () => {
  const code = fs.readFileSync(new URL('../src/entries/admin.js', import.meta.url), 'utf8');
  assert.match(code, /import runtimeMonitor from '\.\.\/\.\.\/js\/runtime-monitor\.js\?raw';/);
  assert.ok(code.indexOf("['js/runtime-monitor.js', runtimeMonitor]") < code.indexOf("['js/admin.js', admin]"));
});

test('admin legacy script initializes monitor and forwards live events', () => {
  const code = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(code, /safeInitRuntimeMonitor\(\)/);
  assert.match(code, /safeIngestRuntimeMonitor\(type, data\)/);
  assert.ok(code.indexOf('safeInitRuntimeMonitor()') < code.indexOf('installAdminLiveEvents();'));
});

test('admin runtime monitor init is optional and non-blocking', () => {
  const sandbox = loadAdminSandbox({
    init() {
      throw new Error('init failed');
    }
  });

  assert.doesNotThrow(() => sandbox.safeInitRuntimeMonitor());
  assert.equal(sandbox.__warnings.length, 1);
  assert.match(String(sandbox.__warnings[0][0]), /Runtime monitor init failed/);
});

test('admin live event monitor ingest is optional and non-blocking', () => {
  const sandbox = loadAdminSandbox({
    ingestLiveEvent() {
      throw new Error('ingest failed');
    }
  });

  assert.doesNotThrow(() => sandbox.safeIngestRuntimeMonitor('FILE_UPLOADED', { fileId: 'f-1' }));
  assert.equal(sandbox.__warnings.length, 1);
  assert.match(String(sandbox.__warnings[0][0]), /Runtime monitor event ingest failed/);
});
