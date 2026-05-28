import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import config from '../vite.config.js';

test('Vite Rollup HTML inputs stay portable on Windows', () => {
  const input = config.build.rollupOptions.input;
  const expectedPages = [
    'index',
    'admin',
    'login',
    'messages',
    'overview',
    'profile',
    'scenarios'
  ];

  assert.deepEqual(new Set(Object.keys(input)), new Set(expectedPages));

  for (const page of expectedPages) {
    const entry = input[page];
    assert.equal(entry, `${page}.html`);
    assert.equal(path.isAbsolute(entry), false);
    assert.equal(entry.startsWith('./'), false);
    assert.equal(entry.startsWith('../'), false);
  }
});
