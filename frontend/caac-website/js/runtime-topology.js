/* ============================================================
   CAAC runtime topology — pure logic module
   ============================================================
   - Used by tests directly (node:test, ESM import)
   - Exposed on window.CAAC_TOPOLOGY for the legacy IIFE renderer
     in js/runtime-monitor.js (which is loaded as raw text and
     cannot use ES imports)
   - No DOM / canvas dependency — pure functions over a small
     mutable layout state created by `createTopology`
   ============================================================
   Architecture, mirrored from the backend code:
     USERS         (subj-*)         ──┐
                                      │  HTTP (Spring Gateway, port 5051)
     Gateway   ─── AuthCtrl/FileCtrl ─┤
        │                             │
        │  HMAC POST /api/access/*    │  Oracle is a SIGNED RELAY
        ▼                             │  — not a decision maker
     Oracle (bridge)                  │
        │                             │
        │  Fabric gateway:            │
        │  evaluateAccess(...)        │
        │  recordSessionReceipt(...)  │
        ▼                             │  Fabric chaincode caac@mychannel v2.0
     Fabric PDP (on-chain)            │  IS the decision point (CAACContract)
                                      │
     Gateway ─────────────────── files (encrypted AES-256-GCM blobs)
                                      ↑ STORAGE row is populated at runtime
                                        from /api/files/admin/all (APPROVED)
   ============================================================ */

// ---- 静态架构关系 (永远显示的虚线连线，永远在 background 之上) ----
// user ↔ gateway is dynamic (per active user) so deliberately absent here.
// gateway ↔ file-* is also dynamic: every node in the STORAGE row gets a
// gateway edge drawn from `listFiles()` so the renderer doesn't need to know
// the file set in advance.
export const STRUCTURE_PAIRS = Object.freeze([
  ['gateway', 'oracle'],
  ['oracle',  'fabric']
]);

// 行顺序（USERS 顶部 → STORAGE 底部）
export const ROW_ORDER = Object.freeze(['USERS', 'SERVICES', 'STORAGE']);

// 行的 Y 比例
const ROW_Y = Object.freeze({ USERS: 0.22, SERVICES: 0.52, STORAGE: 0.82 });

// 左右内边距比例（0.06 = 6%）
const X_PAD = 0.06;

// 节点半径常数（用于 rowBounds 的边距）
const NODE_RADIUS = 22;

// STORAGE 行的文件瓦片网格参数（小方块横向排列，超出自动换行到下一子行）
const FILE_GRID_MAX_COLS = 12;
const FILE_TILE_PITCH_X  = 36;
const FILE_TILE_PITCH_Y  = 30;
const FILE_TILE_HALF     = 8;

// 静态 LAYOUT 模板 — createTopology() 会深拷贝出独立可变状态
// STORAGE 行不在此预声明：文件清单来自后端 FileRegistry，由
// runtime-monitor 在启动时通过 registerFile 注入，并随 LiveEvent 增删。
const DEFAULT_LAYOUT = Object.freeze({
  // ---- USERS ----
  'subj-admin':        { row: 'USERS',    idx: 0, type: 'user',     label: 'admin (R5)' },
  'subj-engineer':     { row: 'USERS',    idx: 1, type: 'user',     label: 'eng-01 (R3)' },
  'subj-guest':        { row: 'USERS',    idx: 2, type: 'user',     label: 'guest-1 (R1)' },
  'subj-attacker':     { row: 'USERS',    idx: 3, type: 'attacker', label: 'attacker' },

  // ---- SERVICES (gateway → oracle bridge → fabric PDP) ----
  'gateway':           { row: 'SERVICES', idx: 0, type: 'system',   label: 'Gateway' },
  'oracle':            { row: 'SERVICES', idx: 1, type: 'system',   label: 'Oracle bridge' },
  'fabric':            { row: 'SERVICES', idx: 2, type: 'policy',   label: 'Fabric' }
});

// 行标签（用于 box 头部文字）
export const ROW_LABELS = Object.freeze({
  USERS:    'USERS',
  SERVICES: 'GATEWAY · ORACLE · FABRIC PDP',
  STORAGE:  'STORAGE'
});

// 上下文子图字段顺序——subject 弧（用户上方）+ environment 弧（用户下方）
// subject:     来自 dashboard 的 resolvedScores（Algorithm 1 主体上下文）
// environment: 来自 js/context.js collectContext() 的 rawContext
// 顺序就是绘制顺序（左→右），所以两组都精确 6 个字段。
export const CONTEXT_FIELDS = Object.freeze({
  subject:     Object.freeze(['R', 'T', 'L_trust', 'D_sec', 'DT_score', 'N_status']),
  environment: Object.freeze(['networkType', 'ip', 'platform', 'timezone', 'screen', 'language'])
});

// 文件节点 id 前缀：来自后端的 fileId（文件名）会被加上该前缀以满足
// ensureMeta 的命名约定，避免与 user/system 节点冲突。
const FILE_ID_PREFIX = 'file-';
function fileNodeId(fileId) {
  if (typeof fileId !== 'string' || fileId.length === 0) return null;
  return fileId.indexOf(FILE_ID_PREFIX) === 0 ? fileId : (FILE_ID_PREFIX + fileId);
}

/**
 * 创建一份独立的拓扑状态。每次调用都得到全新的 LAYOUT / ROW_SLOTS 副本。
 * @param {{cw:number, ch:number}} opts canvas 世界宽高（像素）
 */
export function createTopology(opts) {
  const cw = (opts && opts.cw) || 1000;
  const ch = (opts && opts.ch) || 600;

  // 深拷贝默认 LAYOUT
  const layout = {};
  for (const id of Object.keys(DEFAULT_LAYOUT)) {
    layout[id] = Object.assign({}, DEFAULT_LAYOUT[id]);
  }
  const rowSlots = { USERS: [], SERVICES: [], STORAGE: [] };
  for (const id of Object.keys(layout)) {
    const m = layout[id];
    rowSlots[m.row][m.idx] = id;
  }

  // 当前 canvas 尺寸（外部可通过 setCanvasSize 更新）
  let _cw = cw, _ch = ch;

  function setCanvasSize(w, h) { _cw = w; _ch = h; }

  function getMeta(id) {
    return layout[id] || null;
  }

  function rowCount(row) {
    return Math.max(1, rowSlots[row].length);
  }

  function ensureMeta(id) {
    if (layout[id]) return layout[id];
    let row, type;
    if (id.indexOf('subj-') === 0) {
      row  = 'USERS';
      type = (id.indexOf('attacker') >= 0) ? 'attacker' : 'user';
    } else if (id.indexOf(FILE_ID_PREFIX) === 0) {
      row  = 'STORAGE';
      type = 'file';
    } else {
      return null;
    }
    const idx = rowSlots[row].length;
    rowSlots[row].push(id);
    layout[id] = { row, idx, type, label: id };
    return layout[id];
  }

  /**
   * 把一个后端注册文件登记到 STORAGE 行。
   *   - 幂等：同 fileId 多次注册只更新 label
   *   - 返回该节点 id（含 'file-' 前缀），便于 caller 用作 touchNode 的 key
   */
  function registerFile(fileId, label) {
    const id = fileNodeId(fileId);
    if (!id) return null;
    const text = (typeof label === 'string' && label.length > 0) ? label : fileId;
    if (layout[id]) {
      layout[id].label = text;
      return id;
    }
    const idx = rowSlots.STORAGE.length;
    rowSlots.STORAGE.push(id);
    layout[id] = { row: 'STORAGE', idx, type: 'file', label: text };
    return id;
  }

  /**
   * 从 STORAGE 行删除一个文件节点；剩余文件 idx 重排以保持均匀分布。
   * 返回 true 表示确实存在并被删除。
   */
  function unregisterFile(fileId) {
    const id = fileNodeId(fileId);
    if (!id || !layout[id]) return false;
    if (layout[id].row !== 'STORAGE') return false;
    const slots = rowSlots.STORAGE;
    const i = slots.indexOf(id);
    if (i >= 0) slots.splice(i, 1);
    delete layout[id];
    // 重排剩余 idx，保持视觉均匀
    for (let k = 0; k < slots.length; k++) {
      const other = slots[k];
      if (layout[other]) layout[other].idx = k;
    }
    return true;
  }

  /** 列出当前已注册的全部文件节点 id（含 'file-' 前缀）。 */
  function listFiles() {
    return rowSlots.STORAGE.filter(Boolean).slice();
  }

  function positionFor(id) {
    const meta = layout[id] || ensureMeta(id);
    if (!meta) {
      return { x: _cw * 0.5, y: _ch * 0.5, type: 'unknown', label: id };
    }
    // 文件节点：在 STORAGE 行内以瓦片网格排布（小方块，超出自动换行）
    if (meta.row === 'STORAGE' && meta.type === 'file') {
      const total = rowSlots.STORAGE.filter(Boolean).length || 1;
      const cols = Math.max(1, Math.min(FILE_GRID_MAX_COLS, total));
      const col = meta.idx % cols;
      const row = Math.floor(meta.idx / cols);
      const rowsCount = Math.max(1, Math.ceil(total / cols));
      const xCenter = _cw * 0.5;
      const yCenter = _ch * ROW_Y.STORAGE;
      const xStart = xCenter - ((cols - 1) * FILE_TILE_PITCH_X) / 2;
      const yStart = yCenter - ((rowsCount - 1) * FILE_TILE_PITCH_Y) / 2;
      return {
        x: xStart + col * FILE_TILE_PITCH_X,
        y: yStart + row * FILE_TILE_PITCH_Y,
        type: meta.type,
        label: meta.label
      };
    }
    const n = rowCount(meta.row);
    const xSpan = 1 - 2 * X_PAD;
    const xRatio = (n === 1) ? 0.5 : ((meta.idx + 0.5) / n);
    return {
      x: _cw * (X_PAD + xRatio * xSpan),
      y: _ch * ROW_Y[meta.row],
      type: meta.type,
      label: meta.label
    };
  }

  /**
   * 一行（USERS / SERVICES / STORAGE）的视觉框 —— 把该行所有节点都装进去。
   * 返回坐标为 canvas 世界坐标，所以画在 applyView 之后就会随 zoom 缩放。
   */
  function rowBounds(row) {
    const ids = rowSlots[row].filter(Boolean);
    const yc = _ch * ROW_Y[row];
    // 行的固定高度 = 节点直径 + 上下 padding（容纳 icon + 标签）
    const halfH = NODE_RADIUS + 28;

    if (ids.length === 0) {
      // 空行：仍画一个跨整个宽度的占位框
      const xPadPx = _cw * X_PAD;
      return {
        left: xPadPx - NODE_RADIUS,
        right: _cw - xPadPx + NODE_RADIUS,
        top: yc - halfH,
        bottom: yc + halfH,
        label: ROW_LABELS[row] || row
      };
    }

    // STORAGE：网格瓦片 — 高度随子行数扩展，宽度随列数自适应
    if (row === 'STORAGE') {
      const total = ids.length;
      const cols = Math.max(1, Math.min(FILE_GRID_MAX_COLS, total));
      const rowsCount = Math.max(1, Math.ceil(total / cols));
      const gridW = (cols - 1) * FILE_TILE_PITCH_X + FILE_TILE_HALF * 2;
      const gridH = (rowsCount - 1) * FILE_TILE_PITCH_Y + FILE_TILE_HALF * 2;
      const padX = 28;
      const padY = 22;
      return {
        left:   _cw * 0.5 - gridW / 2 - padX,
        right:  _cw * 0.5 + gridW / 2 + padX,
        top:    yc - gridH / 2 - padY,
        bottom: yc + gridH / 2 + padY,
        label:  ROW_LABELS[row] || row
      };
    }

    let minX = Infinity, maxX = -Infinity;
    for (const id of ids) {
      const p = positionFor(id);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    const pad = NODE_RADIUS + 14; // 节点半径 + 文本余量
    return {
      left:   minX - pad,
      right:  maxX + pad,
      top:    yc   - halfH,
      bottom: yc   + halfH,
      label:  ROW_LABELS[row] || row
    };
  }

  /**
   * 滚轮缩放，以 (mouseX, mouseY) 为锚点。
   * 把 (mouseX-panX)/scale 处的世界点保持在 (mouseX, mouseY) 处。
   *
   * @returns 新的 {scale, panX, panY}
   */
  function computeAnchoredZoom(view, mouseX, mouseY, deltaY, minScale, maxScale) {
    const delta = -deltaY * 0.0015;
    const desired = view.scale * (1 + delta);
    const next = Math.max(minScale, Math.min(maxScale, desired));
    if (next === view.scale) {
      return { scale: view.scale, panX: view.panX, panY: view.panY };
    }
    const k = next / view.scale;
    return {
      scale: next,
      panX: mouseX - (mouseX - view.panX) * k,
      panY: mouseY - (mouseY - view.panY) * k
    };
  }

  return {
    // 几何
    positionFor,
    rowBounds,
    setCanvasSize,
    // 注册/元数据
    getMeta,
    ensureMeta,
    rowCount,
    registerFile,
    unregisterFile,
    listFiles,
    fileNodeId,
    // 缩放
    computeAnchoredZoom,
    // 常量直通（供 renderer 使用）
    ROW_Y,
    ROW_ORDER,
    ROW_LABELS,
    STRUCTURE_PAIRS,
    CONTEXT_FIELDS
  };
}

/* ------------------------------------------------------------
   Browser bridge — let the legacy IIFE renderer in
   js/runtime-monitor.js consume the same logic without an
   ES import (it's loaded as raw text via runLegacyStack).
   ------------------------------------------------------------ */
if (typeof window !== 'undefined') {
  window.CAAC_TOPOLOGY = {
    createTopology,
    STRUCTURE_PAIRS,
    ROW_ORDER,
    ROW_LABELS,
    CONTEXT_FIELDS,
    fileNodeId
  };
}
