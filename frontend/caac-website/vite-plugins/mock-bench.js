// ============================================================
// CAAC 运行时监控 - Mock Benchmark SSE 推送服务 (Vite 插件)
// ============================================================
// 简化拓扑（3 行 / 动态节点），与 runtime-topology.js DEFAULT_LAYOUT 一致：
//
//   USERS    : subj-admin / subj-engineer / subj-guest / subj-attacker
//              （动态节点：空闲超时自动淡出）
//   SERVICES : gateway          —— 合并 PEP + LOGIN/PIP/BV-GCA/BRIDGE 全部服务
//              oracle           —— HMAC verify + Fabric gateway 入口（仅中继）
//              fabric           —— Fabric PDP, chaincode caac v2.0
//   STORAGE  : 文件节点         —— gateway 直连密文存储 + 解密
//                                  （AES-256-GCM 解密在 gateway 内完成）
//
// 数据流（保留与代码一致的语义，但路径折叠到主节点）：
//   Flow A 登录    : user → gateway → user (token)
//   Flow B 决策    : user → gateway → oracle → fabric (PERMIT/DENY) →
//                    oracle → gateway → user
//   Flow B' 取文件 : gateway → file → user (PERMIT 后，gateway 内解密)
//   Flow C CAAR    : gateway → oracle → fabric (recordSessionReceipt)
//   Flow D 攻击    : 在对应节点被挡（gateway/oracle/fabric）
//
// 端点：
//   GET  /bench/health   健康检查 JSON
//   GET  /bench/stream   SSE 事件流，事件名 "caac-runtime"
//   POST /bench/push     外部事件注入 (bvgca_attack_sim.py 等真实攻击脚本)
// ============================================================

import { normalizeEvent, createBroadcastBus, scheduleBatch } from './bench-bus.js';

// 全局事件总线 —— 单例。mock 场景循环与 /bench/push 都向这里发布；
// 每个 SSE 客户端订阅它，所以 mock 流量 + 真实攻击事件 会合流推给浏览器。
const bus = createBroadcastBus();

let _seq = 0;
function makeEvent(partial) {
  _seq += 1;
  return {
    id: `evt-${Date.now()}-${_seq}`,
    ts: Date.now(),
    severity: 'info',
    ...partial,
  };
}

// ---- 实体 ID 池 ----
const SUB_USERS = {
  admin: { id: 'subj-admin',    label: 'admin (R5/T0.92)',   rSub: 5, tSub: 0.92 },
  eng:   { id: 'subj-engineer', label: 'eng-01 (R3/T0.71)',  rSub: 3, tSub: 0.71 },
  guest: { id: 'subj-guest',    label: 'guest-1 (R1/T0.55)', rSub: 1, tSub: 0.55 },
};
const SUB_ATTACKER = { id: 'subj-attacker', label: 'attacker (R?/T0.08)', rSub: 1, tSub: 0.08 };

const FILES = {
  s1: { id: 'file-public-pdf',   label: 'public.pdf (S1/P0.30)',    sLevel: 1, pReq: 0.30 },
  s3: { id: 'file-internal-doc', label: 'internal.docx (S3/P0.55)', sLevel: 3, pReq: 0.55 },
  s5: { id: 'file-topsecret',    label: 'topsecret.zip (S5/P0.80)', sLevel: 5, pReq: 0.80 },
};

// ============================================================
// 系统启动：注册核心节点（用户节点按需出现，不在 bootstrap 中注册）
// ============================================================
function* scenarioBootstrap() {
  yield { event: makeEvent({ kind: 'node', sourceNode: 'gateway', status: 'ok', phase: 'register', reason: 'Spring Boot Gateway up (PEP+services)' }), delayMs: 220 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'oracle',  status: 'ok', phase: 'register', reason: 'Oracle bridge (HMAC → Fabric gw)' }), delayMs: 220 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'fabric',  status: 'ok', phase: 'register', reason: 'Fabric peer + chaincode caac v2.0' }), delayMs: 220 };
  // 现有 FileRegistry 文件清单
  yield { event: makeEvent({ kind: 'node', sourceNode: 'file-public-pdf',   status: 'ok', phase: 'register', reason: 'public.pdf S1 P0.30' }), delayMs: 180 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'file-internal-doc', status: 'ok', phase: 'register', reason: 'internal.docx S3 P0.55' }), delayMs: 180 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'file-topsecret',    status: 'ok', phase: 'register', reason: 'topsecret.zip S5 P0.80' }), delayMs: 180 };
}

// ============================================================
// Flow A — 登录
// ============================================================
function* scenarioLogin(user) {
  yield { event: makeEvent({ kind: 'node', sourceNode: user.id, status: 'pending', phase: 'request', reason: `${user.label} POST /api/auth/login` }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: user.id, targetNode: 'gateway', actionType: 'login', phase: 'request', status: 'pending', reason: 'AuthCtrl + CaptchaService + UserService(bcrypt)' + (user.rSub >= 5 ? ' + TOTP' : '') }), delayMs: 360 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: user.id, actionType: 'login', phase: 'decide', status: 'ok', reason: 'JWT issued', meta: { tSub: user.tSub } }), delayMs: 380 };
  yield { event: makeEvent({ kind: 'node', sourceNode: user.id, status: 'ok', phase: 'decide', reason: 'ACTIVE session', meta: { tSub: user.tSub } }), delayMs: 260 };
}

// ============================================================
// Flow B — 文件访问 PERMIT
// ============================================================
function* scenarioPermit(user, file) {
  const dtScore = Math.min(0.98, user.tSub + 0.05 + Math.random() * 0.05);
  const ceScore = Math.min(0.95, dtScore - 0.05);

  // 评估链：user → gateway → oracle → fabric
  yield { event: makeEvent({ kind: 'edge', sourceNode: user.id,  targetNode: 'gateway', actionType: 'access', phase: 'request', status: 'pending', reason: `GET ${file.label}` }), delayMs: 300 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'access', phase: 'evaluate', status: 'pending', reason: 'OracleClient.evaluate (HMAC sign)' }), delayMs: 320 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'access', phase: 'evaluate', status: 'pending', reason: 'evaluateAccess(16 args)', meta: { rSub: user.rSub, sLevel: file.sLevel } }), delayMs: 380 };
  // 结果回送：fabric → oracle → gateway
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'fabric',  targetNode: 'oracle', actionType: 'access', phase: 'decide', status: 'ok', reason: `PERMIT|DT=${dtScore.toFixed(3)}|CE=${ceScore.toFixed(3)}`, meta: { dtScore, ceScore, pReq: file.pReq } }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'gateway', actionType: 'access', phase: 'decide', status: 'ok', reason: 'PERMIT' }), delayMs: 220 };
  // 取回文件：gateway → file → user（gateway 内 AES-256-GCM 解密）
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: file.id, actionType: 'access', phase: 'deliver', status: 'ok', reason: 'fetch ciphertext + AES-256-GCM decrypt' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'burst', sourceNode: file.id, targetNode: user.id, via: ['gateway'], status: 'ok', phase: 'deliver', actionType: 'access', reason: 'plaintext streamed to user' }), delayMs: 320 };
  // CAAR receipt 上链
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'audit', phase: 'register', status: 'pending', reason: 'submitReceipt (CAAR)' }), delayMs: 260 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'audit', phase: 'register', status: 'ok', reason: 'recordSessionReceipt → world-state' }), delayMs: 320 };
}

// ============================================================
// Flow B — 文件访问 DENY
// ============================================================
function* scenarioDeny(user, file, denyReason) {
  const dtScore = Math.max(0.02, user.tSub - 0.25 - Math.random() * 0.10);
  const ceScore = Math.max(0.02, dtScore - 0.05);
  const reason = denyReason || `DT=${dtScore.toFixed(3)} < P_req=${file.pReq}`;

  yield { event: makeEvent({ kind: 'edge', sourceNode: user.id,  targetNode: 'gateway', actionType: 'access', phase: 'request', status: 'pending', reason: `GET ${file.label}` }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'access', phase: 'evaluate', status: 'pending', reason: 'OracleClient.evaluate' }), delayMs: 300 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'access', phase: 'evaluate', status: 'pending', reason: 'evaluateAccess()', meta: { rSub: user.rSub, sLevel: file.sLevel } }), delayMs: 360 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'fabric',  targetNode: 'oracle', actionType: 'access', phase: 'decide', status: 'denied', severity: 'warn', reason: `DENY|DT=${dtScore.toFixed(3)}|CE=${ceScore.toFixed(3)}`, meta: { dtScore, ceScore, pReq: file.pReq } }), delayMs: 360 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'gateway', actionType: 'access', phase: 'block', status: 'denied', severity: 'warn', reason }), delayMs: 600 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: user.id, actionType: 'access', phase: 'block', status: 'denied', severity: 'high', reason: '403 Forbidden' }), delayMs: 1100 };
  yield { event: makeEvent({ kind: 'node', sourceNode: user.id, status: 'alert', phase: 'block', severity: 'warn', reason }), delayMs: 1500 };
}

// ============================================================
// Flow C — 流式过程中触发中途撤销（Algorithm 2）
// ============================================================
function* scenarioRevoke(user, file) {
  // 已经在流式分发中
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'monitor', phase: 'evaluate', status: 'pending', reason: 'periodic poll (Alg.2)' }), delayMs: 300 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'monitor', phase: 'evaluate', status: 'pending', reason: 're-evaluateAccess()' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'fabric',  targetNode: 'oracle', actionType: 'monitor', phase: 'block', status: 'blocked', severity: 'high', reason: 'DT_score dropped → REVOKE' }), delayMs: 360 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'gateway', actionType: 'monitor', phase: 'block', status: 'blocked', severity: 'high', reason: 'mid-stream revoke fired' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: user.id, actionType: 'monitor', phase: 'block', status: 'blocked', severity: 'high', reason: 'session.close() — RGCA window exceeded' }), delayMs: 700 };
  yield { event: makeEvent({ kind: 'node', sourceNode: user.id, status: 'alert', phase: 'block', severity: 'warn', reason: 'access revoked mid-stream' }), delayMs: 900 };
  // 撤销 receipt 上链
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'audit', phase: 'register', status: 'denied', reason: 'submitReceipt(wasRevoked=true)' }), delayMs: 260 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'audit', phase: 'register', status: 'denied', reason: 'recordSessionReceipt' }), delayMs: 280 };
}

// ============================================================
// Flow D — 9 类 BV-GCA 攻击场景（拦截点收敛到 4 主节点）
// ============================================================

// A1 暴力破解 → gateway (RateLimit + AnomalyDetector BURST)
function* attackA1_BruteForce() {
  const a = SUB_ATTACKER;
  yield { event: makeEvent({ kind: 'node', sourceNode: a.id, status: 'alert', phase: 'attack', severity: 'high', reason: 'A1: brute-force login burst' }), delayMs: 240 };
  for (let i = 1; i <= 4; i++) {
    yield { event: makeEvent({ kind: 'edge', sourceNode: a.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'denied', reason: `bad password #${i}` }), delayMs: 240 };
  }
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: a.id, actionType: 'attack', phase: 'block', status: 'blocked', severity: 'critical', reason: 'RateLimit + BURST τ → IP throttled, account quarantined' }), delayMs: 500 };
  yield { event: makeEvent({ kind: 'node', sourceNode: a.id, status: 'blocked', phase: 'block', severity: 'critical', reason: 'attacker BLOCKED' }), delayMs: 600 };
}

// A2 凭证窃取后异地登录 → fabric DENY（低 L_trust 拉低 DT）
function* attackA2_StolenCreds() {
  const a = SUB_ATTACKER;
  yield { event: makeEvent({ kind: 'node', sourceNode: a.id, status: 'pending', phase: 'attack', severity: 'high', reason: 'A2: stolen cred, off-network' }), delayMs: 240 };
  // 登录成功（密码确实正确）
  yield { event: makeEvent({ kind: 'edge', sourceNode: a.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'pending', reason: 'login with valid pwd' }), delayMs: 260 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: a.id, actionType: 'attack', phase: 'decide', status: 'ok', reason: 'token (low-trust)' }), delayMs: 240 };
  // 取文件时被拒
  yield* scenarioDeny(a, FILES.s3, 'A2: low L_trust + anomalous N_status → DT < P_req');
}

// A3 越权 R_sub < S_level → fabric DENY
function* attackA3_PrivEscalation() {
  const a = SUB_USERS.guest;
  yield* scenarioDeny(a, FILES.s5, `A3: R_sub=${a.rSub} < S_level=${FILES.s5.sLevel}`);
}

// A4 HMAC 重放/伪造 → oracle 拒
function* attackA4_HMACReplay() {
  const a = SUB_ATTACKER;
  yield { event: makeEvent({ kind: 'node', sourceNode: a.id, status: 'alert', phase: 'attack', severity: 'high', reason: 'A4: replay gateway→oracle with stale ts' }), delayMs: 240 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: a.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'pending', reason: 'forged request' }), delayMs: 220 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'attack', phase: 'evaluate', status: 'pending', reason: 'POST /api/access/evaluate (replayed sig)' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'gateway', actionType: 'attack', phase: 'block', status: 'blocked', severity: 'critical', reason: '401 HMAC invalid / nonce replay' }), delayMs: 500 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: a.id, actionType: 'attack', phase: 'block', status: 'blocked', severity: 'critical', reason: '401' }), delayMs: 700 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'oracle', status: 'alert', phase: 'block', severity: 'warn', reason: 'HMAC verify FAIL' }), delayMs: 600 };
}

// A5 密文存储篡改 → gateway 完整性校验失败（CID/哈希在 gateway 内核对）
function* attackA5_StorageTamper() {
  const u = SUB_USERS.eng;
  yield { event: makeEvent({ kind: 'edge', sourceNode: u.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'pending', reason: 'A5: GET internal.docx (tampered ciphertext)' }), delayMs: 260 };
  // 决策通过
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'attack', phase: 'evaluate', status: 'pending', reason: 'evaluate' }), delayMs: 240 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle', targetNode: 'fabric', actionType: 'attack', phase: 'evaluate', status: 'ok', reason: 'PERMIT' }), delayMs: 240 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle', targetNode: 'gateway', actionType: 'attack', phase: 'decide', status: 'ok', reason: 'PERMIT' }), delayMs: 200 };
  // 但 gateway 在解密前的完整性校验失败
  yield { event: makeEvent({ kind: 'node', sourceNode: 'gateway', status: 'alert', phase: 'block', severity: 'critical', reason: 'observed CID/hash ≠ requested → REFUSE' }), delayMs: 600 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: u.id, actionType: 'attack', phase: 'block', status: 'denied', severity: 'high', reason: '502 integrity error' }), delayMs: 700 };
}

// A6 越界下载 → 中途撤销
function* attackA6_QuotaBreach() {
  const u = SUB_USERS.eng;
  // 先 PERMIT 起一个会话
  yield* scenarioPermit(u, FILES.s3);
  // 然后撤销
  yield* scenarioRevoke(u, FILES.s3);
}

// A7 同子网联动暴增 → gateway (RevocationScheduler 子网封禁)
function* attackA7_ClusterSurge() {
  yield { event: makeEvent({ kind: 'node', sourceNode: 'gateway', status: 'alert', phase: 'attack', severity: 'high', reason: 'A7: cluster R_N(t) ≥ 0.7 for 5min' }), delayMs: 280 };
  // 3 个虚拟来源同子网
  for (let i = 0; i < 3; i++) {
    yield { event: makeEvent({ kind: 'edge', sourceNode: SUB_ATTACKER.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'denied', reason: `sibling #${i} (198.51.100.0/24)` }), delayMs: 280 };
  }
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: SUB_ATTACKER.id, actionType: 'attack', phase: 'block', status: 'blocked', severity: 'critical', reason: 'subnet hard-block 15min' }), delayMs: 600 };
  yield { event: makeEvent({ kind: 'node', sourceNode: SUB_ATTACKER.id, status: 'blocked', phase: 'block', severity: 'critical', reason: 'subnet blocked' }), delayMs: 700 };
}

// A8 流式超预算 → gateway (RiskBudget hard-limit)
function* attackA8_BudgetExhaust() {
  const u = SUB_USERS.eng;
  yield { event: makeEvent({ kind: 'edge', sourceNode: u.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'pending', reason: 'A8: drain S_remaining via bulk GETs' }), delayMs: 260 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: u.id, actionType: 'attack', phase: 'block', status: 'denied', severity: 'high', reason: 'RiskBudget: bytes > S_remaining + grace → 429' }), delayMs: 800 };
  yield { event: makeEvent({ kind: 'node', sourceNode: 'gateway', status: 'alert', phase: 'block', severity: 'warn', reason: 'budget hard-limit' }), delayMs: 600 };
  yield { event: makeEvent({ kind: 'node', sourceNode: u.id, status: 'alert', phase: 'block', severity: 'warn', reason: 'budget exhausted' }), delayMs: 700 };
}

// A9 攻击工具特征（sqlmap/burp/nmap UA）→ fabric DENY (D_sec=0.1)
function* attackA9_ToolFingerprint() {
  const a = SUB_ATTACKER;
  yield { event: makeEvent({ kind: 'edge', sourceNode: a.id, targetNode: 'gateway', actionType: 'attack', phase: 'request', status: 'pending', reason: 'A9: UA=sqlmap/1.7' }), delayMs: 240 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: 'oracle', actionType: 'attack', phase: 'evaluate', status: 'pending', reason: 'ContextResolver: D_sec=0.1 (attack tool)' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'fabric', actionType: 'attack', phase: 'evaluate', status: 'pending', reason: 'evaluateAccess()' }), delayMs: 280 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'fabric',  targetNode: 'oracle', actionType: 'attack', phase: 'block', status: 'denied', severity: 'high', reason: 'DENY (D_sec=0.1 collapses DT)' }), delayMs: 500 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'oracle',  targetNode: 'gateway', actionType: 'attack', phase: 'block', status: 'denied', severity: 'high', reason: '403' }), delayMs: 300 };
  yield { event: makeEvent({ kind: 'edge', sourceNode: 'gateway', targetNode: a.id, actionType: 'attack', phase: 'block', status: 'denied', severity: 'high', reason: '403 (tool blocked)' }), delayMs: 700 };
  yield { event: makeEvent({ kind: 'node', sourceNode: a.id, status: 'blocked', phase: 'block', severity: 'critical', reason: 'attacker blocked' }), delayMs: 700 };
}

// ============================================================
// 上下文场景 —— 演示 click-to-focus 用户的 12 字段 + 上下文变化级联
// ============================================================
//   1) ctx-snapshot: 注入用户当前 subject_context + environment_context
//   2) ctx-change : 修改某一字段值，前端立刻闪烁并触发 PDP 重评估级联
//
// 这里数据是 demo 用的伪造值，结构与后端 ContextResolver +
// 前端 js/context.js collectContext() 完全一致。
const MOCK_ENV_GOOD = {
  networkType: 'wifi',
  ip:          '192.168.1.42',
  platform:    'Linux',
  timezone:    'Asia/Shanghai',
  screen:      '1920x1080',
  language:    'en-US'
};
const MOCK_ENV_DEGRADED = Object.assign({}, MOCK_ENV_GOOD, {
  networkType: 'public-wifi',
  ip:          '203.0.113.7',
  timezone:    'America/Anchorage'
});

function snapshotEvent(user, env) {
  return makeEvent({
    kind: 'ctx-snapshot',
    userId:  user.id,
    subject: {
      R:        user.rSub,
      T:        user.tSub,
      L_trust:  0.92,
      D_sec:    0.90,
      DT_score: 0.88,
      N_status: 0.85
    },
    environment: env || MOCK_ENV_GOOD,
    reason: 'snapshot: subject + environment context'
  });
}

function* scenarioContextSnapshotAll() {
  yield { event: snapshotEvent(SUB_USERS.admin),                     delayMs: 200 };
  yield { event: snapshotEvent(SUB_USERS.eng),                       delayMs: 200 };
  yield { event: snapshotEvent(SUB_USERS.guest),                     delayMs: 200 };
  yield { event: snapshotEvent(SUB_ATTACKER, MOCK_ENV_DEGRADED),     delayMs: 200 };
}

// 上下文降级：L_trust 0.92 → 0.10 (Algorithm 2 触发的典型场景)
// 前端会闪红子节点并跑 5 段 PDP 重评估 → DENY 级联。
function* scenarioContextDegrade(user) {
  yield {
    event: makeEvent({
      kind: 'ctx-change',
      userId:   user.id,
      field:    'L_trust',
      oldValue: 0.92,
      newValue: 0.10,
      reason:   `${user.label} L_trust drop → PDP re-evaluation`
    }),
    delayMs: 2800
  };
  // 之后注入恢复值，避免一直停在告警状态。
  yield {
    event: makeEvent({
      kind: 'ctx-snapshot', userId: user.id,
      subject:     { L_trust: 0.92 },
      environment: {},
      reason: 'context restored (L_trust ← 0.92)'
    }),
    delayMs: 600
  };
}

// ============================================================
// 主循环
// ============================================================
function* mainScenarioLoop() {
  yield* scenarioBootstrap();
  // 立刻把所有用户的上下文快照推下去，让 click-to-focus 一上来就有数据可看
  yield* scenarioContextSnapshotAll();

  let cycle = 0;
  while (true) {
    cycle += 1;
    const subjects = [SUB_USERS.admin, SUB_USERS.eng, SUB_USERS.guest];
    const subj = subjects[cycle % subjects.length];

    // 登录
    yield* scenarioLogin(subj);

    // PERMIT (R_sub 匹配档)
    const permitFile = subj.rSub >= 5 ? FILES.s5 : (subj.rSub >= 3 ? FILES.s3 : FILES.s1);
    yield* scenarioPermit(subj, permitFile);

    // 偶数轮：尝试越权 DENY
    if (cycle % 2 === 0 && subj.rSub < 5) {
      const targetFile = subj.rSub < 3 ? FILES.s3 : FILES.s5;
      yield* scenarioDeny(subj, targetFile, `R_sub=${subj.rSub} < S_level=${targetFile.sLevel}`);
    }

    // 每轮 1 个攻击场景
    const attacks = [
      attackA1_BruteForce,
      attackA2_StolenCreds,
      attackA3_PrivEscalation,
      attackA4_HMACReplay,
      attackA5_StorageTamper,
      attackA6_QuotaBreach,
      attackA7_ClusterSurge,
      attackA8_BudgetExhaust,
      attackA9_ToolFingerprint,
    ];
    yield* attacks[(cycle - 1) % attacks.length]();

    // 每 3 轮演示一次 "上下文变化触发阻断" —— 展示 click-to-focus 子图
    if (cycle % 3 === 0) {
      yield* scenarioContextDegrade(subj);
    }
  }
}

// ---- SSE 发送辅助 ----
function writeSSE(res, event) {
  res.write(`event: caac-runtime\ndata: ${JSON.stringify(event)}\n\n`);
}
function withJitter(ms, ratio = 0.30) {
  return Math.max(80, ms + (Math.random() * 2 - 1) * ratio * ms);
}

async function runScenarioForClient(res, signal) {
  // 启动消息直接写到这个客户端（不进入 bus，避免后接客户端重放）
  writeSSE(res, makeEvent({ kind: 'meta', sourceNode: 'mock-bench', status: 'ok', phase: 'register', reason: 'Mock scenario engine started' }));
  const gen = mainScenarioLoop();
  while (!signal.aborted) {
    const next = gen.next();
    if (next.done) break;
    const { event, delayMs } = next.value;
    // 通过总线扇出到所有 SSE 客户端 —— 包含本客户端 + 任何后接客户端
    try { bus.publish(event); } catch (_) { break; }
    await new Promise(resolve => setTimeout(resolve, withJitter(delayMs)));
  }
}

// ---- 读取 POST body 的小工具（不引入 body-parser 依赖） ----
function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new Error('invalid JSON: ' + err.message)); }
    });
    req.on('error', reject);
  });
}

// ---- 全局唯一的 mock 循环 (跨多个 SSE 客户端不会重复启动) ----
let _mockLoopStarted = false;
function startMockLoopOnce() {
  if (_mockLoopStarted) return;
  _mockLoopStarted = true;
  (async () => {
    // 仅在有订阅者时驱动循环，避免空跑浪费 CPU
    // 检测到 bus.isLiveMode() 也暂停 —— 让真实攻击 cascade 独占舞台
    const gen = mainScenarioLoop();
    while (true) {
      if (bus.subscriberCount() === 0 || bus.isLiveMode()) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      const next = gen.next();
      if (next.done) break;
      const { event, delayMs } = next.value;
      bus.publish(event);
      await new Promise(r => setTimeout(r, withJitter(delayMs)));
    }
  })().catch(err => console.error('[mock-bench] global loop error:', err));
}

// Grace window AFTER the last live event before mock resumes.
// Long enough for the 2.5s blocked-edge animation to fully play out.
const LIVE_TAIL_GRACE_MS = 3000;

function totalBatchDurationMs(events) {
  let total = 0;
  for (const raw of events) {
    const d = Number(raw && raw.delayMs);
    if (Number.isFinite(d) && d > 0) total += d;
  }
  return total;
}

// ---- Vite 插件导出 ----
export default function caacMockBenchPlugin() {
  return {
    name: 'caac-mock-bench',
    configureServer(server) {
      server.middlewares.use('/bench/health', (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          status: 'UP', mode: 'mock', engine: 'in-process',
          subscribers: bus.subscriberCount()
        }));
      });

      // POST /bench/push  —— 外部攻击脚本注入事件
      server.middlewares.use('/bench/push', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405; res.end('method not allowed'); return;
        }
        let body;
        try { body = await readJsonBody(req); }
        catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
          return;
        }
        const events = Array.isArray(body && body.events) ? body.events : [];
        if (events.length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'events array required' }));
          return;
        }
        // Silence the mock loop for the whole duration of this batch
        // plus a grace tail. While in live mode the operator sees ONLY
        // attack events on the topology.
        const wasLive = bus.isLiveMode();
        const totalMs = totalBatchDurationMs(events);
        bus.markLiveUntil(Date.now() + totalMs + LIVE_TAIL_GRACE_MS);

        // Announce the mode flip on the first transition so the UI
        // log shows a clear demarcation ("--- LIVE ATTACK ---") rather
        // than leaving the operator to guess.
        if (!wasLive) {
          try {
            bus.publish(normalizeEvent({
              kind: 'meta', sourceNode: 'mock-bench',
              status: 'alert', phase: 'live-attack',
              reason: 'Mock paused — live attack feed active',
            }));
          } catch (_) { /* never fatal */ }
        }

        // Schedule the batch through the bus, honoring each event's
        // `delayMs` so the visual cascade matches mock-loop pacing
        // instead of collapsing into a single same-frame flash.
        const { accepted, rejected } = scheduleBatch(events, (ev) => bus.publish(ev));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          ok: true, accepted, rejected,
          liveUntilMs: Date.now() + totalMs + LIVE_TAIL_GRACE_MS,
        }));
      });

      // POST /bench/mode  —— 外部脚本切换 live-only / mixed 模式
      // body: { mode: 'live' | 'mixed' }
      //   'live'  → bus.setForceLive(true)  : mock loop 完全停摆
      //   'mixed' → bus.setForceLive(false) : mock 在 grace 窗口外恢复
      server.middlewares.use('/bench/mode', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405; res.end('method not allowed'); return;
        }
        let body;
        try { body = await readJsonBody(req); }
        catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
          return;
        }
        const mode = body && body.mode;
        if (mode !== 'live' && mode !== 'mixed') {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'mode must be "live" or "mixed"' }));
          return;
        }
        bus.setForceLive(mode === 'live');
        try {
          bus.publish(normalizeEvent({
            kind: 'meta', sourceNode: 'mock-bench',
            status: mode === 'live' ? 'alert' : 'ok',
            phase: mode === 'live' ? 'live-attack' : 'register',
            reason: mode === 'live'
              ? '--- LIVE-ONLY MODE ON (mock silenced) ---'
              : '--- mock resumed ---',
          }));
        } catch (_) { /* never fatal */ }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, mode }));
      });

      server.middlewares.use('/bench/stream', async (req, res) => {
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        res.setHeader('x-accel-buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        const heartbeat = setInterval(() => {
          try { res.write(': heartbeat\n\n'); } catch (_) { /* ignore */ }
        }, 25000);

        // 启动信息只发给本客户端
        writeSSE(res, makeEvent({
          kind: 'meta', sourceNode: 'mock-bench', status: 'ok',
          phase: 'register', reason: 'SSE attached (mock + live attack feed)'
        }));

        // 把这个客户端订阅到全局总线
        const unsub = bus.subscribe(ev => {
          try { writeSSE(res, ev); } catch (_) { /* socket closed */ }
        });

        // 第一个订阅者到来时启动全局 mock 循环
        startMockLoopOnce();

        const cleanup = () => { unsub(); clearInterval(heartbeat); try { res.end(); } catch (_) {} };
        req.on('close', cleanup);
        req.on('aborted', cleanup);
      });
    },
  };
}
