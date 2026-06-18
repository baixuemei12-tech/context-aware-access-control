/* ============================================================
   runtime-monitor-translator
   ============================================================
   Pure function that converts a backend SSE frame from
   /api/events/stream into a list of bench-bus events the runtime
   topology canvas already knows how to render.

   Wire envelope from LiveEventService.send():
     { type: 'FILE_ACCESS' | 'SESSION_SCORE_UPDATED' | ... ,
       timestamp: string,
       data:      object }

   Output events conform to bench-bus normalizeEvent (kinds:
   node | edge | burst | meta | ctx-snapshot | ctx-change).

   ES-module shape so node --test can import it; also re-exported
   to window.CAAC_TRANSLATOR by a small inline footer below for
   the browser bundle.
   ============================================================ */

const SUBJ = (u) => 'subj-' + (u || 'unknown');
const FILE_NODE = (fid) => 'file-' + fid;

// Pacing — keep the visual cascade clear without overwhelming the
// animation budget. Each edge after the first carries delayMs so
// scheduleBatch (or the canvas frame pump) staggers them.
const EDGE_STEP_MS = 220;

const SUBJECT_FIELDS = new Set(['L_trust', 'N_status', 'T_sub', 'R_sub', 'B_freq']);
const ENV_FIELDS = new Set(['D_sec', 'T_req', 'C_O', 'IP', 'Network', 'Platform']);

export function createTranslatorState() {
  return {
    lastScores: new Map() // sessionId -> { dtScore, ceScore, margin, tier, ... }
  };
}

export function translateGatewayEvent(msg, state) {
  if (!msg || typeof msg !== 'object') return [];
  const data = msg.data;
  if (!data || typeof data !== 'object') return [];

  switch (msg.type) {
    case 'FILE_ACCESS':
      return translateFileAccess(data);
    case 'SESSION_SCORE_UPDATED':
      return translateSessionScoreUpdated(data, state);
    case 'SESSION_REVOKED':
      return translateSessionRevoked(data);
    case 'CLUSTER_RISK_UPDATED':
      return translateClusterRisk(data);
    default:
      return [];
  }
}

// ------------------------------------------------------------
// FILE_ACCESS — three-hop request cascade + return-leg colored
// by the gateway's PERMIT / DENY / ERROR decision.
// ------------------------------------------------------------
function translateFileAccess(data) {
  const user = data.username || 'unknown';
  const decision = String(data.decision || '').toUpperCase();
  const ok = decision === 'PERMIT';
  const out = [];

  // ctx-snapshot first so the user's tooltip has fresh subject /
  // environment scores even before the cascade lands.
  if (data.resolvedScores || data.rawContext) {
    const subject = {};
    const environment = {};
    const rs = data.resolvedScores || {};
    for (const [k, v] of Object.entries(rs)) {
      if (SUBJECT_FIELDS.has(k)) subject[k] = v;
      else if (ENV_FIELDS.has(k)) environment[k] = v;
    }
    if (data.dtScore != null) subject.DT_score = data.dtScore;
    if (data.ceScore != null) environment.CE_score = data.ceScore;
    const rc = data.rawContext || {};
    if (rc.networkType) environment.Network = rc.networkType;
    if (rc.clientIp) environment.IP = rc.clientIp;
    if (rc.platform) environment.Platform = rc.platform;

    out.push({
      kind: 'ctx-snapshot',
      userId: SUBJ(user),
      subject,
      environment
    });
  }

  // Outbound trio: subj → gateway → oracle → fabric (all pending)
  const reason = ok
    ? ('PERMIT (DT=' + fmt(data.dtScore) + ')')
    : (decision + (data.reason ? ': ' + data.reason : ''));

  pushEdge(out, SUBJ(user), 'gateway', 'pending', 'request: ' + (data.fileId || '?'), 0);
  pushEdge(out, 'gateway', 'oracle', 'pending', 'evaluate', EDGE_STEP_MS);
  pushEdge(out, 'oracle', 'fabric', 'pending', 'verify policy', EDGE_STEP_MS);

  // Return-leg trio: fabric → oracle → gateway → subj
  const returnStatus = ok ? 'ok' : 'blocked';
  pushEdge(out, 'fabric', 'oracle', returnStatus, reason, EDGE_STEP_MS);
  pushEdge(out, 'oracle', 'gateway', returnStatus, reason, EDGE_STEP_MS);
  pushEdge(out, 'gateway', SUBJ(user), returnStatus, reason, EDGE_STEP_MS);

  // File tile state
  if (data.fileId) {
    out.push({
      kind: 'node',
      sourceNode: FILE_NODE(data.fileId),
      status: returnStatus,
      reason
    });
  }

  return out;
}

// ------------------------------------------------------------
// SESSION_SCORE_UPDATED — emit ctx-change only for fields that
// actually changed (delta-only emission keeps the canvas quiet
// during a session where Algorithm 2 ticks every 2-4s with no
// real change).
// ------------------------------------------------------------
function translateSessionScoreUpdated(data, state) {
  const user = data.username;
  const sid = data.sessionId;
  if (!sid || !user) return [];

  const out = [];
  const last = state.lastScores.get(sid);

  // Fields we track on the user's tooltip
  const NUMERIC_FIELDS = [
    ['dtScore', 'DT_score'],
    ['ceScore', 'CE_score'],
    ['margin', 'risk_margin']
  ];

  if (!last) {
    // First tick — seed the user's tooltip with whatever scores arrived
    // (one ctx-change per available field).
    for (const [src, field] of NUMERIC_FIELDS) {
      if (data[src] != null) {
        out.push({
          kind: 'ctx-change',
          userId: SUBJ(user),
          field,
          oldValue: null,
          newValue: data[src],
          reason: 'tier=' + (data.tier || '?')
        });
      }
    }
  } else {
    for (const [src, field] of NUMERIC_FIELDS) {
      if (data[src] != null && data[src] !== last[src]) {
        out.push({
          kind: 'ctx-change',
          userId: SUBJ(user),
          field,
          oldValue: last[src],
          newValue: data[src],
          reason: 'tier=' + (data.tier || '?')
        });
      }
    }
    // Tier flip = soft pulse on the user node
    if (data.tier && last.tier && data.tier !== last.tier) {
      out.push({
        kind: 'node',
        sourceNode: SUBJ(user),
        status: 'alert',
        reason: 'tier ' + last.tier + ' → ' + data.tier
      });
    }
  }

  state.lastScores.set(sid, {
    dtScore: data.dtScore,
    ceScore: data.ceScore,
    margin: data.margin,
    tier: data.tier
  });

  return out;
}

// ------------------------------------------------------------
// SESSION_REVOKED — terminal red cascade fabric → … → subj.
// ------------------------------------------------------------
function translateSessionRevoked(data) {
  const user = data.username;
  if (!user) return [];
  const out = [];
  const reason = 'Session revoked: ' + (data.reason || 'UNKNOWN');

  pushEdge(out, 'fabric', 'oracle', 'blocked', reason, 0);
  pushEdge(out, 'oracle', 'gateway', 'blocked', reason, EDGE_STEP_MS);
  pushEdge(out, 'gateway', SUBJ(user), 'blocked', reason, EDGE_STEP_MS);

  out.push({
    kind: 'node',
    sourceNode: SUBJ(user),
    status: 'blocked',
    reason
  });

  return out;
}

// ------------------------------------------------------------
// CLUSTER_RISK_UPDATED — log-only meta event. No subnet node on
// the canvas, so we just push a meta with the operator-visible
// reason text.
// ------------------------------------------------------------
function translateClusterRisk(data) {
  const subnet = data.subnet || 'unknown';
  const rN = data.rN;
  const blocked = !!data.blocked;
  const severity = blocked ? 'alert' : 'info';
  const reason = blocked
    ? 'subnet ' + subnet + ' AUTO-BLOCKED (R_N=' + fmt(rN) + ')'
    : 'subnet ' + subnet + ' risk update (R_N=' + fmt(rN) + ')';

  return [{
    kind: 'meta',
    sourceNode: 'cluster-risk',
    severity,
    reason,
    subnet,
    rN,
    blocked
  }];
}

function pushEdge(out, from, to, status, reason, delayMs) {
  out.push({
    kind: 'edge',
    sourceNode: from,
    targetNode: to,
    status,
    reason,
    delayMs
  });
}

function fmt(n) {
  if (n == null) return '?';
  if (typeof n !== 'number') return String(n);
  return Math.round(n * 10000) / 10000;
}

/* ------------------------------------------------------------
   Browser bridge — let the legacy IIFE in runtime-monitor.js
   consume the same logic without an ES import (loaded as raw
   text via runLegacyStack, same pattern as runtime-topology.js).
   ------------------------------------------------------------ */
if (typeof window !== 'undefined') {
  window.CAAC_TRANSLATOR = {
    translateGatewayEvent,
    createTranslatorState
  };
}
