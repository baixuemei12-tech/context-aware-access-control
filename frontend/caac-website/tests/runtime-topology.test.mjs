// CAAC runtime-topology — TDD spec.
//   Run:  npm test  (or  node --test tests/)
//
// Pure logic only; no DOM. The IIFE renderer in js/runtime-monitor.js
// must defer to these same functions via window.CAAC_TOPOLOGY.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTopology,
  STRUCTURE_PAIRS,
  ROW_ORDER,
  CONTEXT_FIELDS
} from '../js/runtime-topology.js';

// ---------------------------------------------------------------
// Helper: a fresh topology bound to a 1000 × 600 canvas
// ---------------------------------------------------------------
function freshTopo() {
  return createTopology({ cw: 1000, ch: 600 });
}

// ===============================================================
// 1.  Architectural truth — PDP is Fabric chaincode (on-chain).
//      Oracle is HMAC-signed bridge, NOT the PDP.
// ===============================================================
describe('decision point semantics', () => {
  test('fabric node is the PDP (type policy)', () => {
    const t = freshTopo();
    const fabric = t.getMeta('fabric');
    assert.equal(fabric.type, 'policy', 'fabric must be type=policy (the on-chain PDP)');
    assert.match(fabric.label, /fabric/i, 'fabric label must say "Fabric"');
  });

  test('oracle is a bridge/relay — type system, label NOT containing "PDP"', () => {
    const t = freshTopo();
    const oracle = t.getMeta('oracle');
    assert.equal(oracle.type, 'system', 'oracle must be type=system');
    assert.doesNotMatch(
      oracle.label, /PDP/i,
      'oracle label must not claim PDP (the PDP is on-chain)'
    );
  });

  test('STRUCTURE_PAIRS encodes oracle→fabric and gateway↔oracle as real edges', () => {
    const hasPair = (a, b) =>
      STRUCTURE_PAIRS.some(p =>
        (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
    assert.ok(hasPair('gateway', 'oracle'), 'missing gateway↔oracle');
    assert.ok(hasPair('oracle',  'fabric'), 'missing oracle↔fabric');
    // user↔gateway is NOT in structure-pairs (drawn dynamically per active user)
    assert.ok(
      !STRUCTURE_PAIRS.some(p => /^subj-/.test(p[0]) || /^subj-/.test(p[1])),
      'STRUCTURE_PAIRS must not include any subj-* edges (those are dynamic)'
    );
    // gateway↔file-* is also dynamic — drawn from listFiles() each frame,
    // so no file ids should leak into the static pair table.
    assert.ok(
      !STRUCTURE_PAIRS.some(p => /^file-/.test(p[0]) || /^file-/.test(p[1])),
      'STRUCTURE_PAIRS must not include file-* edges (those are dynamic)'
    );
  });
});

// ===============================================================
// 1b. Dynamic file registration — STORAGE row is populated from
//      FileRegistry at runtime, not from a frozen LAYOUT.
// ===============================================================
describe('registerFile / unregisterFile / listFiles', () => {
  test('starts with an empty STORAGE row (no hardcoded sample files)', () => {
    const t = freshTopo();
    assert.deepEqual(t.listFiles(), [],
      'STORAGE row must start empty — file nodes come from the backend');
  });

  test('registerFile adds a STORAGE node with the given label', () => {
    const t = freshTopo();
    const id = t.registerFile('flexiguard.pdf', 'flexiguard.pdf (S2)');
    assert.equal(id, 'file-flexiguard.pdf', 'returns prefixed id');
    const meta = t.getMeta(id);
    assert.equal(meta.row, 'STORAGE');
    assert.equal(meta.type, 'file');
    assert.equal(meta.label, 'flexiguard.pdf (S2)');
    assert.deepEqual(t.listFiles(), [id]);
  });

  test('registerFile is idempotent on fileId, updates label only', () => {
    const t = freshTopo();
    const a = t.registerFile('report.txt', 'report.txt (S3)');
    const b = t.registerFile('report.txt', 'report.txt (S5)');
    assert.equal(a, b, 'same fileId must return the same node id');
    assert.equal(t.listFiles().length, 1, 'no duplicate slots');
    assert.equal(t.getMeta(a).label, 'report.txt (S5)', 'label was updated');
  });

  test('registered files spread evenly across the STORAGE row', () => {
    const t = freshTopo();
    t.registerFile('a.txt', 'a');
    t.registerFile('b.txt', 'b');
    t.registerFile('c.txt', 'c');
    const xa = t.positionFor('file-a.txt').x;
    const xb = t.positionFor('file-b.txt').x;
    const xc = t.positionFor('file-c.txt').x;
    assert.ok(xa < xb && xb < xc, 'left-to-right by insertion order');
    // even spacing (within rounding tolerance)
    assert.ok(Math.abs((xc - xb) - (xb - xa)) < 1,
      `even spacing expected, got a=${xa} b=${xb} c=${xc}`);
  });

  test('unregisterFile removes the node and reflows remaining indices', () => {
    const t = freshTopo();
    t.registerFile('a.txt', 'a');
    t.registerFile('b.txt', 'b');
    t.registerFile('c.txt', 'c');
    const removed = t.unregisterFile('b.txt');
    assert.equal(removed, true);
    assert.deepEqual(t.listFiles(), ['file-a.txt', 'file-c.txt']);
    // c should now sit at idx=1 (was 2)
    assert.equal(t.getMeta('file-c.txt').idx, 1);
  });

  test('unregisterFile returns false for unknown files', () => {
    const t = freshTopo();
    assert.equal(t.unregisterFile('nope.txt'), false);
  });
});

// ===============================================================
// 2.  Row layout / positionFor — even horizontal distribution
// ===============================================================
describe('positionFor', () => {
  test('three SERVICES nodes spread across canvas with 6% side padding', () => {
    const t = freshTopo();
    const gw  = t.positionFor('gateway');
    const orc = t.positionFor('oracle');
    const fab = t.positionFor('fabric');
    // All three share the SERVICES row Y
    assert.equal(gw.y, orc.y);
    assert.equal(orc.y, fab.y);
    // Strict left-to-right order
    assert.ok(gw.x < orc.x, 'gateway left of oracle');
    assert.ok(orc.x < fab.x, 'oracle left of fabric');
    // Padding: leftmost / rightmost slot not flush against canvas edges
    assert.ok(gw.x  > 1000 * 0.05, 'gateway respects left padding');
    assert.ok(fab.x < 1000 * 0.95, 'fabric respects right padding');
  });

  test('adding a 5th USER dynamically reflows existing user x positions', () => {
    const t = freshTopo();
    const xAdminBefore = t.positionFor('subj-admin').x;
    t.positionFor('subj-attacker');                 // pre-existing in LAYOUT
    t.positionFor('subj-extra-user');               // dynamic registration
    const xAdminAfter = t.positionFor('subj-admin').x;
    // With more siblings in the row, admin shifts left
    assert.ok(xAdminAfter < xAdminBefore,
      'admin must shift left after row grows: ' +
      `before=${xAdminBefore}, after=${xAdminAfter}`);
  });

  test('ensureMeta places subj-* in USERS row and file-* in STORAGE row', () => {
    const t = freshTopo();
    const newUser = t.ensureMeta('subj-newbie');
    const newFile = t.ensureMeta('file-blueprint');
    assert.equal(newUser.row, 'USERS');
    assert.equal(newUser.type, 'user');
    assert.equal(newFile.row, 'STORAGE');
    assert.equal(newFile.type, 'file');
  });

  test('attacker subj is typed "attacker" even when dynamically registered', () => {
    const t = freshTopo();
    const m = t.ensureMeta('subj-attacker-2');
    assert.equal(m.type, 'attacker');
  });

  test('unknown id (neither subj- nor file-) falls back to center', () => {
    const t = freshTopo();
    const p = t.positionFor('mystery-thing');
    assert.equal(p.x, 500);
    assert.equal(p.y, 300);
  });
});

// ===============================================================
// 3.  rowBounds — the box that scales with view
// ===============================================================
describe('rowBounds — bounding boxes (the framed boxes user asked for)', () => {
  test('USERS row box wraps every active user with horizontal padding', () => {
    const t = freshTopo();
    // populate so default 4 USERS nodes have known positions
    const xAdmin    = t.positionFor('subj-admin').x;
    const xAttacker = t.positionFor('subj-attacker').x;
    const box = t.rowBounds('USERS');
    assert.ok(box.left   < xAdmin,   'box left edge left of leftmost user');
    assert.ok(box.right  > xAttacker,'box right edge right of rightmost user');
    assert.ok(box.top    < t.positionFor('subj-admin').y,
      'box top above user row Y');
    assert.ok(box.bottom > t.positionFor('subj-admin').y,
      'box bottom below user row Y');
  });

  test('rowBounds is in world (canvas) coords — independent of zoom', () => {
    const t = freshTopo();
    const a = t.rowBounds('SERVICES');
    // Same call twice should be stable
    const b = t.rowBounds('SERVICES');
    assert.deepEqual(a, b);
  });

  test('rowBounds returns a box for every declared row', () => {
    const t = freshTopo();
    for (const row of ROW_ORDER) {
      const b = t.rowBounds(row);
      assert.ok(b.right > b.left,   `${row} box has positive width`);
      assert.ok(b.bottom > b.top,   `${row} box has positive height`);
    }
  });
});

// ===============================================================
// 4.  computeAnchoredZoom — world point under cursor stays fixed
// ===============================================================
describe('computeAnchoredZoom', () => {
  const MIN = 0.4, MAX = 3.0;

  test('zooming in keeps the world point under the cursor anchored', () => {
    const view = { scale: 1, panX: 0, panY: 0 };
    const mx = 400, my = 200;
    // world point currently under cursor: (mx-panX)/scale = (400, 200)
    const next = createTopology({ cw: 1000, ch: 600 })
      .computeAnchoredZoom(view, mx, my, /*deltaY=*/-100, MIN, MAX);
    // After zoom, the screen-position of that same world point must still be (mx, my)
    const screenX = 400 * next.scale + next.panX;
    const screenY = 200 * next.scale + next.panY;
    assert.ok(Math.abs(screenX - mx) < 1e-6,
      `anchor x drifted: got ${screenX}, want ${mx}`);
    assert.ok(Math.abs(screenY - my) < 1e-6,
      `anchor y drifted: got ${screenY}, want ${my}`);
    assert.ok(next.scale > view.scale, 'wheel up should zoom IN');
  });

  test('scale is clamped to [MIN, MAX]', () => {
    const topo = createTopology({ cw: 1000, ch: 600 });
    // huge negative deltaY → would zoom past MAX
    const hi = topo.computeAnchoredZoom(
      { scale: 2.8, panX: 0, panY: 0 }, 0, 0, -100000, MIN, MAX);
    assert.equal(hi.scale, MAX, 'clamped to MAX');
    // huge positive deltaY → would zoom under MIN
    const lo = topo.computeAnchoredZoom(
      { scale: 0.5, panX: 0, panY: 0 }, 0, 0, +100000, MIN, MAX);
    assert.equal(lo.scale, MIN, 'clamped to MIN');
  });

  test('no-op when scale would not change (already at boundary)', () => {
    const topo = createTopology({ cw: 1000, ch: 600 });
    const view = { scale: MAX, panX: 50, panY: 70 };
    const r = topo.computeAnchoredZoom(view, 200, 300, -50, MIN, MAX);
    // already at MAX, wheel-up cannot increase further → pan unchanged
    assert.equal(r.scale, MAX);
    assert.equal(r.panX, 50);
    assert.equal(r.panY, 70);
  });
});

// ===============================================================
// 5.  Context sub-graph — focused user shows 12 attribute sub-nodes
//      (subject above, environment below, connected to the user)
// ===============================================================
describe('CONTEXT_FIELDS', () => {
  test('exactly 6 subject + 6 environment fields, in stable order', () => {
    assert.equal(CONTEXT_FIELDS.subject.length, 6,
      'subject must have 6 fields (R, T, L_trust, D_sec, DT_score, N_status)');
    assert.equal(CONTEXT_FIELDS.environment.length, 6,
      'environment must have 6 fields (networkType, ip, platform, timezone, screen, language)');
    // Spot-check the canonical fields that drive the demo cascade
    assert.ok(CONTEXT_FIELDS.subject.includes('L_trust'),
      'L_trust must be a subject field (it is the one the degrade demo flips)');
    assert.ok(CONTEXT_FIELDS.environment.includes('networkType'),
      'networkType must be an environment field');
  });
});
