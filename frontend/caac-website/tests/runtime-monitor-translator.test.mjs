// runtime-monitor-translator — TDD spec.
//
// Pure translator that converts a backend SSE frame from /api/events/stream
// (envelope: { type, timestamp, data }) into a list of bench-bus events
// the runtime-monitor canvas already knows how to render (kind: node|edge|
// burst|meta|ctx-snapshot|ctx-change).
//
// Contract:
//   - translateGatewayEvent(msg, state) returns an array of events (possibly [])
//   - state is mutable per-listener: { lastScores: Map<sessionId, scoreSnapshot> }
//   - Each returned event MUST be schema-valid per bench-bus normalizeEvent
//
// Run:  node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../vite-plugins/bench-bus.js';
import { translateGatewayEvent, createTranslatorState }
  from '../js/runtime-monitor-translator.js';

const subj = (u) => 'subj-' + u;
const fileNode = (fid) => 'file-' + fid;

// Every event the translator emits must survive bench-bus normalization —
// regressions where a future translator change breaks the wire format
// land here, not in production.
function assertAllNormalizable(events) {
  for (const ev of events) {
    assert.doesNotThrow(() => normalizeEvent(ev),
      'translator produced an event that fails normalizeEvent: ' + JSON.stringify(ev));
  }
}

describe('translateGatewayEvent — FILE_ACCESS', () => {
  test('PERMIT emits cascade: snapshot + 3 pending edges + 3 ok return-legs + file node', () => {
    const state = createTranslatorState();
    const msg = {
      type: 'FILE_ACCESS',
      data: {
        username: 'alice',
        fileId: 'file-1',
        decision: 'PERMIT',
        dtScore: 0.85,
        ceScore: 0.74,
        sLevel: 2,
        sessionId: 'sess-1',
        riskMargin: 0.32,
        resolvedScores: { L_trust: '0.8', N_status: '0.7', D_sec: '0.85', T_req: '0.9' },
        rawContext: { clientIp: '10.0.0.5', networkType: 'wifi', platform: 'Linux x86_64' }
      }
    };
    const events = translateGatewayEvent(msg, state);
    assertAllNormalizable(events);

    const kinds = events.map(e => e.kind);
    assert.ok(kinds.includes('ctx-snapshot'),
      'PERMIT cascade must start with a ctx-snapshot populating the user tooltip');

    const edges = events.filter(e => e.kind === 'edge');
    assert.equal(edges.length, 6, 'PERMIT cascade is 3 pending edges + 3 ok return-legs');

    // First 3 edges: subj → gateway, gateway → oracle, oracle → fabric — all pending
    assert.equal(edges[0].sourceNode, subj('alice'));
    assert.equal(edges[0].targetNode, 'gateway');
    assert.equal(edges[0].status, 'pending');
    assert.equal(edges[1].sourceNode, 'gateway');
    assert.equal(edges[1].targetNode, 'oracle');
    assert.equal(edges[2].sourceNode, 'oracle');
    assert.equal(edges[2].targetNode, 'fabric');

    // Return-leg: fabric → oracle, oracle → gateway, gateway → subj — all ok
    assert.equal(edges[3].sourceNode, 'fabric');
    assert.equal(edges[3].status, 'ok');
    assert.equal(edges[5].targetNode, subj('alice'));

    // File node terminal status = ok
    const fileEv = events.find(e => e.kind === 'node' && e.sourceNode === fileNode('file-1'));
    assert.ok(fileEv, 'PERMIT must mark file node ok');
    assert.equal(fileEv.status, 'ok');
  });

  test('DENY emits cascade with blocked return-legs and blocked file node', () => {
    const state = createTranslatorState();
    const msg = {
      type: 'FILE_ACCESS',
      data: {
        username: 'mallory',
        fileId: 'file-99',
        decision: 'DENY',
        reason: 'rule:network=public',
        dtScore: 0.41,
        ceScore: 0.32,
        sLevel: 3
      }
    };
    const events = translateGatewayEvent(msg, state);
    assertAllNormalizable(events);

    const edges = events.filter(e => e.kind === 'edge');
    assert.equal(edges.length, 6);

    // Outbound trio = pending; return trio = blocked
    assert.equal(edges[0].status, 'pending');
    assert.equal(edges[1].status, 'pending');
    assert.equal(edges[2].status, 'pending');
    assert.equal(edges[3].status, 'blocked');
    assert.equal(edges[4].status, 'blocked');
    assert.equal(edges[5].status, 'blocked');

    const fileEv = events.find(e => e.kind === 'node' && e.sourceNode === fileNode('file-99'));
    assert.equal(fileEv.status, 'blocked', 'DENY paints the file tile red');
  });

  test('ERROR decision is treated like DENY for the cascade colors', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'FILE_ACCESS',
      data: { username: 'alice', fileId: 'file-1', decision: 'ERROR', dtScore: 0, ceScore: 0 }
    }, state);
    const edges = events.filter(e => e.kind === 'edge');
    assert.equal(edges[3].status, 'blocked');
    assert.equal(edges[5].status, 'blocked');
  });

  test('emitted edges carry delayMs > 0 so the canvas paces the cascade', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'FILE_ACCESS',
      data: { username: 'alice', fileId: 'file-1', decision: 'PERMIT', dtScore: 0.85, ceScore: 0.74 }
    }, state);
    const paced = events.filter(e => e.kind === 'edge');
    // Every edge after the first should have a non-zero delayMs so
    // scheduleBatch (or the canvas) staggers them visually.
    for (let i = 1; i < paced.length; i++) {
      assert.ok(paced[i].delayMs > 0,
        'edge ' + i + ' needs delayMs > 0 for visible cascade pacing');
    }
  });
});

describe('translateGatewayEvent — SESSION_SCORE_UPDATED', () => {
  test('first tick (no prior snapshot) returns at least one ctx-change per scored field', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'SESSION_SCORE_UPDATED',
      data: {
        sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
        dtScore: 0.85, ceScore: 0.72,
        margin: 0.32, tier: 'LOW-RISK', deltaT: 4,
        stableCheckCount: 3, accelerationActive: false
      }
    }, state);
    assertAllNormalizable(events);

    const ctxChanges = events.filter(e => e.kind === 'ctx-change');
    assert.ok(ctxChanges.length >= 1,
      'first SESSION_SCORE_UPDATED for a session must seed at least one ctx-change');
    const fields = new Set(ctxChanges.map(c => c.field));
    assert.ok(fields.has('DT_score'),
      'DT_score is the canonical badge field — must be emitted on first tick');
  });

  test('same scores as last tick → empty (delta-only emission)', () => {
    const state = createTranslatorState();
    const msg = {
      type: 'SESSION_SCORE_UPDATED',
      data: {
        sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
        dtScore: 0.85, ceScore: 0.72, margin: 0.32, tier: 'LOW-RISK', deltaT: 4
      }
    };
    translateGatewayEvent(msg, state);             // first tick — seeds state
    const second = translateGatewayEvent(msg, state); // identical second tick

    const ctxChanges = second.filter(e => e.kind === 'ctx-change');
    assert.equal(ctxChanges.length, 0,
      'a tick with identical scores must NOT spam ctx-change events');
  });

  test('DT_score delta → emits one ctx-change with old + new', () => {
    const state = createTranslatorState();
    translateGatewayEvent({
      type: 'SESSION_SCORE_UPDATED',
      data: { sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
              dtScore: 0.85, ceScore: 0.72, margin: 0.32, tier: 'LOW-RISK' }
    }, state);
    const events = translateGatewayEvent({
      type: 'SESSION_SCORE_UPDATED',
      data: { sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
              dtScore: 0.50, ceScore: 0.72, margin: 0.05, tier: 'LOW-RISK' }
    }, state);
    const dtChange = events.find(e => e.kind === 'ctx-change' && e.field === 'DT_score');
    assert.ok(dtChange, 'DT_score delta must produce a ctx-change');
    assert.equal(dtChange.userId, subj('alice'));
    assert.equal(dtChange.oldValue, 0.85);
    assert.equal(dtChange.newValue, 0.50);
  });

  test('tier flip emits a node alert pulse', () => {
    const state = createTranslatorState();
    translateGatewayEvent({
      type: 'SESSION_SCORE_UPDATED',
      data: { sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
              dtScore: 0.85, ceScore: 0.72, tier: 'LOW-RISK', margin: 0.32 }
    }, state);
    const events = translateGatewayEvent({
      type: 'SESSION_SCORE_UPDATED',
      data: { sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
              dtScore: 0.85, ceScore: 0.72, tier: 'HIGH-RISK', margin: 0.05 }
    }, state);
    const alertNode = events.find(e => e.kind === 'node' && e.sourceNode === subj('alice'));
    assert.ok(alertNode, 'tier flip must emit a subj node event');
    assert.equal(alertNode.status, 'alert',
      'tier flip is a soft warning, not a terminal block — status=alert');
  });
});

describe('translateGatewayEvent — SESSION_REVOKED', () => {
  test('emits terminal blocked cascade ending at subj node', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'SESSION_REVOKED',
      data: {
        sessionId: 'sess-1', username: 'alice', fileId: 'file-1',
        dtScore: 0.32, ceScore: 0.4, margin: -0.05,
        bytesDelivered: 4096, reason: 'CLUSTER_RISK'
      }
    }, state);
    assertAllNormalizable(events);

    const edges = events.filter(e => e.kind === 'edge');
    // Terminal cascade fabric → oracle → gateway → subj, all blocked
    assert.ok(edges.length >= 3, 'terminal cascade needs at least 3 hops');
    for (const e of edges) {
      assert.equal(e.status, 'blocked',
        'every terminal-cascade edge must be blocked (status=blocked)');
    }
    assert.equal(edges[edges.length - 1].targetNode, subj('alice'),
      'last hop must terminate on the user');

    const subjNode = events.find(e => e.kind === 'node' && e.sourceNode === subj('alice'));
    assert.ok(subjNode, 'must emit a node event on the user');
    assert.equal(subjNode.status, 'blocked');
  });
});

describe('translateGatewayEvent — CLUSTER_RISK_UPDATED', () => {
  test('emits one meta event referencing the subnet', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'CLUSTER_RISK_UPDATED',
      data: { subnet: '10.0.0.', rN: 0.42, blocked: false }
    }, state);
    assertAllNormalizable(events);

    assert.equal(events.length, 1, 'cluster-risk is log-only — one meta event');
    assert.equal(events[0].kind, 'meta');
    // meta must reference the subnet somewhere visible to the operator log
    const allText = JSON.stringify(events[0]);
    assert.ok(allText.includes('10.0.0.'),
      'meta event must mention the subnet so the log row is informative');
  });

  test('subnet-block (blocked=true) raises severity to warn or alert', () => {
    const state = createTranslatorState();
    const events = translateGatewayEvent({
      type: 'CLUSTER_RISK_UPDATED',
      data: { subnet: '10.0.0.', rN: 0.85, blocked: true, expiresAt: Date.now() + 60000 }
    }, state);
    assert.equal(events.length, 1);
    assert.ok(['warn', 'alert'].includes(events[0].severity),
      'a sustained subnet block deserves elevated severity');
  });
});

describe('translateGatewayEvent — unknown / missing payloads', () => {
  test('unknown msg.type → []', () => {
    const events = translateGatewayEvent({ type: 'NOT_A_REAL_EVENT', data: {} }, createTranslatorState());
    assert.deepEqual(events, []);
  });

  test('null msg → []', () => {
    assert.deepEqual(translateGatewayEvent(null, createTranslatorState()), []);
  });

  test('msg with no data → []', () => {
    assert.deepEqual(translateGatewayEvent({ type: 'FILE_ACCESS' }, createTranslatorState()), []);
  });
});
