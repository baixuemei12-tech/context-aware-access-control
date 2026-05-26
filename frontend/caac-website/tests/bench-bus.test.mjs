// bench-bus — TDD spec.
//   Run:  node --test tests/
//
// Pure event-bus + event-normalizer. Used by the Vite plugin
// to broadcast both mock-scenario events AND externally-pushed
// events (POST /bench/push) to every SSE client.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvent,
  createBroadcastBus,
  scheduleBatch
} from '../vite-plugins/bench-bus.js';

// ============================================================
// 1.  normalizeEvent — schema + defaults
// ============================================================
describe('normalizeEvent', () => {
  test('accepts a minimal node event and fills id + ts', () => {
    const out = normalizeEvent({ kind: 'node', sourceNode: 'gateway' });
    assert.equal(out.kind, 'node');
    assert.equal(out.sourceNode, 'gateway');
    assert.match(out.id, /^evt-/, 'id should be auto-assigned');
    assert.ok(typeof out.ts === 'number' && out.ts > 0, 'ts should be a unix ms');
  });

  test('preserves caller-supplied id and ts', () => {
    const out = normalizeEvent({
      id: 'my-id', ts: 42, kind: 'edge',
      sourceNode: 'subj-attacker', targetNode: 'gateway',
      status: 'blocked'
    });
    assert.equal(out.id, 'my-id');
    assert.equal(out.ts, 42);
    assert.equal(out.targetNode, 'gateway');
  });

  test('rejects payload missing kind', () => {
    assert.throws(
      () => normalizeEvent({ sourceNode: 'gateway' }),
      /kind/i,
      'missing kind must throw'
    );
  });

  test('rejects unknown kind', () => {
    assert.throws(
      () => normalizeEvent({ kind: 'banana', sourceNode: 'x' }),
      /kind/i
    );
  });

  test('rejects null / non-object payloads', () => {
    assert.throws(() => normalizeEvent(null), /object/i);
    assert.throws(() => normalizeEvent('hello'), /object/i);
    assert.throws(() => normalizeEvent(42), /object/i);
  });

  test('edge events without sourceNode + targetNode are rejected', () => {
    assert.throws(
      () => normalizeEvent({ kind: 'edge', sourceNode: 'a' }),
      /targetNode/i
    );
    assert.throws(
      () => normalizeEvent({ kind: 'edge', targetNode: 'b' }),
      /sourceNode/i
    );
  });

  test('node + meta events need only sourceNode', () => {
    assert.doesNotThrow(
      () => normalizeEvent({ kind: 'node', sourceNode: 'gateway' }));
    assert.doesNotThrow(
      () => normalizeEvent({ kind: 'meta', sourceNode: 'mock' }));
  });

  test('burst events need sourceNode + targetNode + optional via', () => {
    const out = normalizeEvent({
      kind: 'burst', sourceNode: 'subj-attacker', targetNode: 'fabric',
      via: ['gateway', 'oracle'], status: 'blocked'
    });
    assert.deepEqual(out.via, ['gateway', 'oracle']);
  });
});

// ============================================================
// 2.  createBroadcastBus — publish / subscribe
// ============================================================
describe('createBroadcastBus', () => {
  test('publish reaches every subscriber', () => {
    const bus = createBroadcastBus();
    const a = [], b = [];
    bus.subscribe(ev => a.push(ev));
    bus.subscribe(ev => b.push(ev));
    bus.publish(normalizeEvent({ kind: 'node', sourceNode: 'gateway' }));
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].sourceNode, 'gateway');
  });

  test('unsubscribe handle removes only that listener', () => {
    const bus = createBroadcastBus();
    const a = [], b = [];
    const unsubA = bus.subscribe(ev => a.push(ev));
    bus.subscribe(ev => b.push(ev));
    unsubA();
    bus.publish(normalizeEvent({ kind: 'node', sourceNode: 'oracle' }));
    assert.equal(a.length, 0, 'unsubscribed listener must not be called');
    assert.equal(b.length, 1, 'remaining listener still fires');
  });

  test('publishMany broadcasts each event in order', () => {
    const bus = createBroadcastBus();
    const seen = [];
    bus.subscribe(ev => seen.push(ev.sourceNode));
    bus.publishMany([
      normalizeEvent({ kind: 'node', sourceNode: 'gateway' }),
      normalizeEvent({ kind: 'node', sourceNode: 'oracle'  }),
      normalizeEvent({ kind: 'node', sourceNode: 'fabric'  })
    ]);
    assert.deepEqual(seen, ['gateway', 'oracle', 'fabric']);
  });

  test('subscriber that throws does not break other subscribers', () => {
    const bus = createBroadcastBus();
    const good = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe(ev => good.push(ev));
    bus.publish(normalizeEvent({ kind: 'node', sourceNode: 'gateway' }));
    assert.equal(good.length, 1, 'good subscriber still received the event');
  });

  test('subscriberCount reflects subscribe / unsubscribe', () => {
    const bus = createBroadcastBus();
    assert.equal(bus.subscriberCount(), 0);
    const off1 = bus.subscribe(() => {});
    const off2 = bus.subscribe(() => {});
    assert.equal(bus.subscriberCount(), 2);
    off1();
    assert.equal(bus.subscriberCount(), 1);
    off2();
    assert.equal(bus.subscriberCount(), 0);
  });
});

// ============================================================
// 3.  scheduleBatch — paces a batch of events using each event's
//     delayMs hint, so attack pushes cascade visually instead of
//     firing simultaneously.
//
//     Contract:
//       - first event publishes synchronously (delayMs is "wait
//         after this one before the next one")
//       - cumulative offset = sum of preceding events' delayMs
//       - normalization errors land in `rejected` without crashing
// ============================================================
describe('scheduleBatch', () => {
  test('with no delayMs, publishes every event synchronously', () => {
    const seen = [];
    const r = scheduleBatch(
      [
        { id: '1', kind: 'node', sourceNode: 'a' },
        { id: '2', kind: 'node', sourceNode: 'b' },
      ],
      (ev) => seen.push(ev.id)
    );
    assert.deepEqual(seen, ['1', '2']);
    assert.deepEqual(r.accepted, ['1', '2']);
    assert.deepEqual(r.rejected, []);
  });

  test('paces events by cumulative delayMs (first event immediate)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen = [];
    const r = scheduleBatch(
      [
        { id: 'a', kind: 'edge', sourceNode: 'subj-attacker', targetNode: 'gateway', delayMs: 200 },
        { id: 'b', kind: 'edge', sourceNode: 'gateway',       targetNode: 'oracle',  delayMs: 200 },
        { id: 'c', kind: 'edge', sourceNode: 'oracle',        targetNode: 'fabric',  delayMs: 0 },
      ],
      (ev) => seen.push(ev.id)
    );
    assert.deepEqual(seen, ['a'],
      'first event must publish synchronously (delayMs is delay AFTER, not BEFORE)');
    assert.deepEqual(r.accepted, ['a', 'b', 'c'], 'all 3 ids are accepted up front');

    t.mock.timers.tick(199);
    assert.deepEqual(seen, ['a'], 'still only first event before 200ms');

    t.mock.timers.tick(1); // total 200ms
    assert.deepEqual(seen, ['a', 'b'], 'second event fires at +200ms');

    t.mock.timers.tick(200); // total 400ms
    assert.deepEqual(seen, ['a', 'b', 'c'], 'third event fires at +400ms');
  });

  test('rejects invalid events but still schedules the valid ones', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen = [];
    const r = scheduleBatch(
      [
        { id: 'good1', kind: 'edge', sourceNode: 'x', targetNode: 'y', delayMs: 100 },
        { id: 'bad', sourceNode: 'x' },                  // missing kind → rejected
        { id: 'good2', kind: 'edge', sourceNode: 'y', targetNode: 'z', delayMs: 0 },
      ],
      (ev) => seen.push(ev.id)
    );
    assert.deepEqual(r.accepted, ['good1', 'good2']);
    assert.equal(r.rejected.length, 1);
    assert.deepEqual(seen, ['good1']);
    t.mock.timers.tick(100);
    assert.deepEqual(seen, ['good1', 'good2']);
  });

  test('publisher errors do not stop the rest of the batch', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen = [];
    scheduleBatch(
      [
        { id: 'a', kind: 'node', sourceNode: 'a', delayMs: 0 },
        { id: 'b', kind: 'node', sourceNode: 'b', delayMs: 100 },
        { id: 'c', kind: 'node', sourceNode: 'c', delayMs: 0 },
      ],
      (ev) => {
        if (ev.id === 'a') throw new Error('subscriber blew up');
        seen.push(ev.id);
      }
    );
    t.mock.timers.tick(200);
    assert.deepEqual(seen, ['b', 'c'],
      'a publisher throw on the first event must not abort scheduled timers');
  });
});

// ============================================================
// 4.  Live-mode gate — markLiveUntil / isLiveMode
//
//     Purpose: while an external attack script is pushing events
//     via POST /bench/push, the mock scenario loop should fall
//     silent so the operator can clearly see the real attack
//     cascade.  After the live grace window expires, mock resumes
//     automatically.
// ============================================================
describe('live-mode gate', () => {
  test('isLiveMode is false on a fresh bus', () => {
    const bus = createBroadcastBus();
    assert.equal(typeof bus.markLiveUntil, 'function',
      'bus.markLiveUntil must exist');
    assert.equal(typeof bus.isLiveMode, 'function',
      'bus.isLiveMode must exist');
    assert.equal(bus.isLiveMode(), false);
  });

  test('markLiveUntil(future) flips isLiveMode true until that ts', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const bus = createBroadcastBus();
    const now = Date.now();
    bus.markLiveUntil(now + 1000);
    assert.equal(bus.isLiveMode(), true,
      'right after markLiveUntil we are in live mode');
    t.mock.timers.tick(999);
    assert.equal(bus.isLiveMode(), true,
      'one ms before the deadline we are still in live mode');
    t.mock.timers.tick(2);
    assert.equal(bus.isLiveMode(), false,
      'after the deadline we leave live mode automatically');
  });

  test('markLiveUntil takes the later of (existing, new)', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const bus = createBroadcastBus();
    const now = Date.now();
    bus.markLiveUntil(now + 500);
    bus.markLiveUntil(now + 200);                 // earlier than current — ignored
    assert.equal(bus.isLiveMode(), true);
    t.mock.timers.tick(450);
    assert.equal(bus.isLiveMode(), true,
      'must use the later deadline, not the more recent call');
    t.mock.timers.tick(100);
    assert.equal(bus.isLiveMode(), false);
  });

  test('markLiveUntil(past or 0) leaves live mode immediately', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const bus = createBroadcastBus();
    bus.markLiveUntil(Date.now() - 1);
    assert.equal(bus.isLiveMode(), false);
  });

  test('setForceLive(true) pins live mode regardless of deadline', () => {
    const bus = createBroadcastBus();
    assert.equal(typeof bus.setForceLive, 'function',
      'bus.setForceLive must exist (hard switch for attack-sim demo)');
    assert.equal(bus.isLiveMode(), false);
    bus.setForceLive(true);
    assert.equal(bus.isLiveMode(), true,
      'setForceLive(true) flips isLiveMode on with no deadline');
    bus.setForceLive(false);
    assert.equal(bus.isLiveMode(), false,
      'setForceLive(false) clears it (and there is no pending grace window)');
  });
});
