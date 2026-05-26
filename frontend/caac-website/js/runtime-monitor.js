/* ============================================================
   CAAC 运行时监控 - 拓扑画布前端模块
   ============================================================
   职责：
     1. 用 EventSource 订阅 /bench/stream，把流式事件压入待办队列
     2. 维护节点 / 边的可视化状态（淡入、闪烁、拦截高亮）
     3. 使用 Canvas 2D + requestAnimationFrame 持续渲染
     4. 高频事件用队列限速，单帧最多消费 N 条，防止主线程卡顿

   注：与现有 visuals.js / dynamic-fx.js 风格一致 —— 自执行 IIFE，
   依赖 CSS 变量（--accent/--green/--red/--amber），无任何第三方库。
   ============================================================ */

(function () {
  // 容器存在性检查：当前页面不渲染该模块则安全退出
  var host = document.querySelector('#runtimeMonitor');
  if (!host) return;
  var canvas = host.querySelector('canvas.runtime-canvas');
  if (!canvas) return;

  // ---- 性能档位（复用全局 CAAC_PERF） ----
  var perf = window.CAAC_PERF || {};
  var reduceMotion = perf.reduceMotion ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var targetFps = reduceMotion ? 24 : 48;
  var frameInterval = 1000 / targetFps;

  // ---- 画布尺寸 / DPR 适配 ----
  var ctx = canvas.getContext('2d', { alpha: true });
  var dpr = window.devicePixelRatio || 1;
  var cw = 0, ch = 0;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    cw = rect.width;
    ch = rect.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (topology) topology.setCanvasSize(cw, ch);
  }

  // ---- 纯几何/拓扑逻辑（由 js/runtime-topology.js 注入到 window） ----
  // 单元测试覆盖：tests/runtime-topology.test.mjs
  var TOPO_FACTORY = (window.CAAC_TOPOLOGY && window.CAAC_TOPOLOGY.createTopology);
  if (!TOPO_FACTORY) {
    console.error('[runtime-monitor] window.CAAC_TOPOLOGY missing — load runtime-topology.js first');
    return;
  }
  var topology = TOPO_FACTORY({ cw: 1, ch: 1 });
  var STRUCTURE_PAIRS = window.CAAC_TOPOLOGY.STRUCTURE_PAIRS;
  var ROW_ORDER       = window.CAAC_TOPOLOGY.ROW_ORDER;
  var ROW_LABELS      = window.CAAC_TOPOLOGY.ROW_LABELS;
  var CONTEXT_FIELDS  = window.CAAC_TOPOLOGY.CONTEXT_FIELDS;
  var fileNodeId      = window.CAAC_TOPOLOGY.fileNodeId;

  resize();
  window.addEventListener('resize', resize, { passive: true });

  // ---- 视图变换（缩放 + 平移） ----
  // view 表示画布坐标 → 屏幕坐标：screen = world * scale + pan
  var view = { scale: 1, panX: 0, panY: 0 };
  var MIN_SCALE = 0.4, MAX_SCALE = 3.0;

  function applyView() {
    ctx.setTransform(
      dpr * view.scale, 0,
      0, dpr * view.scale,
      dpr * view.panX, dpr * view.panY
    );
  }
  function applyScreen() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resetView() {
    view.scale = 1; view.panX = 0; view.panY = 0;
  }

  // 滚轮缩放（以光标位置为锚点）—— 数学由 topology.computeAnchoredZoom 提供
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var next = topology.computeAnchoredZoom(view, mx, my, e.deltaY, MIN_SCALE, MAX_SCALE);
    view.scale = next.scale;
    view.panX  = next.panX;
    view.panY  = next.panY;
  }, { passive: false });

  // 拖拽平移
  var dragging = null;
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', function (e) {
    dragging = {
      x: e.clientX, y: e.clientY,
      panX: view.panX, panY: view.panY, id: e.pointerId
    };
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  // 鼠标 hover 状态 —— 用于文件 / 用户瓦片悬浮显示上下文
  var hoverMouse = { x: -1, y: -1, inside: false };
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) {
      var rect = canvas.getBoundingClientRect();
      hoverMouse.x = e.clientX - rect.left;
      hoverMouse.y = e.clientY - rect.top;
      hoverMouse.inside = true;
      return;
    }
    var dx = e.clientX - dragging.x;
    var dy = e.clientY - dragging.y;
    view.panX = dragging.panX + dx;
    view.panY = dragging.panY + dy;
  });
  function endDrag(e) {
    if (!dragging) return;
    try { canvas.releasePointerCapture(dragging.id); } catch (_) {}
    dragging = null;
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerup',     endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave',  function (e) {
    hoverMouse.inside = false;
    endDrag(e);
  });
  // 双击重置视图
  canvas.addEventListener('dblclick', resetView);

  // ---- 节点布局（委托给 topology；定义见 js/runtime-topology.js） ----
  // 真实架构（来自 backend 代码）：
  //   USERS ↔ gateway  (HTTP REST,  AuthCtrl + FileAccessCtrl + LiveEventCtrl)
  //   gateway → oracle (HMAC POST   /api/access/evaluate, /api/access/receipt)
  //   oracle  → fabric (Fabric gw   evaluateAccess + recordSessionReceipt)
  //                    ↑ Fabric chaincode caac@mychannel v2.0 is the PDP
  //   gateway → file   (Gateway 直接读取本地密文，FileRegistry 持 fileId)
  function positionFor(id) { return topology.positionFor(id); }

  // 用户/攻击者节点空闲多久后淡出（单位 ms）
  var USER_IDLE_MS = 20000;

  // ---- 状态容器 ----
  var nodes = new Map();     // id -> { id, type, label, alpha, status, pulseUntil, activeUntil, lastSeen }
  var edges = [];            // 动态边数组（短时动画）
  var pendingQueue = [];     // 待消费事件
  var seen = new Set();      // 已应用事件 id（去重）
  var recentLog = [];        // 右侧侧栏最近事件
  // 文件节点完整元数据（供悬浮 tooltip 多行显示，瓦片本身仍是小方块）
  var fileMetadata = new Map();

  // 文件节点 "正在被访问" 的高亮窗口（ms）。期间显示亮绿 + 文件名。
  var FILE_ACTIVE_MS = 2500;

  function markFileActive(id, now) {
    if (!id || id.indexOf('file-') !== 0) return;
    var n = nodes.get(id);
    if (n) n.activeUntil = (now || performance.now()) + FILE_ACTIVE_MS;
  }

  // ---- 颜色：从 CSS 变量动态读取，便于跟随主题切换 ----
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function readPalette() {
    return {
      ok:      cssVar('--green',  '#2eff7a'),
      pending: cssVar('--amber',  '#ffb347'),
      denied:  cssVar('--red',    '#ff4d4d'),
      info:    cssVar('--accent', '#4f8df7'),
      text:    cssVar('--text',   '#e0e6f0'),
      text3:   cssVar('--text3',  '#687385'),
      border:  cssVar('--border', 'rgba(255,255,255,.10)')
    };
  }
  function statusColor(p, status) {
    if (status === 'ok')                                  return p.ok;
    if (status === 'pending')                             return p.pending;
    if (status === 'denied' || status === 'blocked' ||
        status === 'alert')                               return p.denied;
    return p.info;
  }

  // ---- 颜色 helper：附加 alpha 通道 ----
  function withAlpha(color, a) {
    var s = String(color || '').trim();
    if (s.charAt(0) === '#') {
      var raw = s.slice(1);
      if (raw.length === 3) raw = raw.split('').map(function (c) { return c + c; }).join('');
      var r = parseInt(raw.slice(0, 2), 16) || 0;
      var g = parseInt(raw.slice(2, 4), 16) || 0;
      var b = parseInt(raw.slice(4, 6), 16) || 0;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    if (s.indexOf('rgb') === 0) {
      return s.replace(/rgba?\(([^)]+)\)/, function (_, parts) {
        var p = parts.split(',').map(function (x) { return x.trim(); });
        return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
      });
    }
    return 'rgba(255,255,255,' + a + ')';
  }

  // ---- 事件应用：把一条 mock 事件转成画布状态变化 ----
  function touchNode(id) {
    if (!nodes.has(id)) {
      var pos = positionFor(id);
      nodes.set(id, {
        id: id,
        pos: pos,
        type: pos.type,
        label: pos.label,
        alpha: 0,          // 0 -> 1 淡入动画
        status: 'idle',
        pulseUntil: 0,
        lastSeen: performance.now()
      });
    }
    var n = nodes.get(id);
    n.lastSeen = performance.now();
    return n;
  }

  function applyEvent(ev) {
    if (!ev || !ev.id || seen.has(ev.id)) return;
    seen.add(ev.id);
    // 限制 seen 大小，避免内存无限增长
    if (seen.size > 2000) {
      var it = seen.values();
      for (var i = 0; i < 1000; i++) seen.delete(it.next().value);
    }

    // ---- ctx-snapshot：注入/更新某用户的完整上下文（不触发动画） ----
    if (ev.kind === 'ctx-snapshot' && ev.userId) {
      touchNode(ev.userId);
      setUserContext(ev.userId, {
        subject:     ev.subject     || {},
        environment: ev.environment || {}
      });
      return;
    }

    // ---- ctx-change：把变化后的字段落地到 userContexts（供 hover tooltip 展示）----
    if (ev.kind === 'ctx-change' && ev.userId && ev.field) {
      var userNode = touchNode(ev.userId);
      var group = (CONTEXT_FIELDS.subject.indexOf(ev.field) >= 0) ? 'subject'
                : (CONTEXT_FIELDS.environment.indexOf(ev.field) >= 0) ? 'environment'
                : null;
      if (group) {
        var patch = { subject: {}, environment: {} };
        patch[group][ev.field] = ev.newValue;
        setUserContext(ev.userId, patch);
      }
      // 触发"上下文冲击"特效：浮动 pill + 节点红色双环脉冲
      var nowFx = performance.now();
      var list = userCtxFlashes.get(ev.userId);
      if (!list) { list = []; userCtxFlashes.set(ev.userId, list); }
      list.push({
        field:    ev.field,
        oldValue: ev.oldValue,
        newValue: ev.newValue,
        startedAt: nowFx,
        expiresAt: nowFx + CTX_FLASH_MS
      });
      userNode.shockPulseUntil = nowFx + CTX_FLASH_MS;
      return;
    }

    // 推入日志
    if (ev.reason || ev.phase) {
      recentLog.unshift({
        ts: ev.ts || Date.now(),
        status: ev.status || 'info',
        text: (ev.sourceNode || '?') + ' → ' + (ev.targetNode || ev.phase || '?') + ': ' + (ev.reason || ev.phase || '')
      });
      if (recentLog.length > 14) recentLog.length = 14;
      renderLog();
    }

    // ---- node 事件：单点状态变化 ----
    if (ev.kind === 'node' && ev.sourceNode) {
      var nodeRef = touchNode(ev.sourceNode);
      if (ev.status) nodeRef.status = ev.status;
      if (ev.status === 'blocked' || ev.status === 'alert' || ev.status === 'denied') {
        // 拦截 / 告警：高亮停留 2.5s
        nodeRef.pulseUntil = performance.now() + 2500;
      }
      return;
    }

    // ---- edge 事件：单条连线动画 ----
    if (ev.kind === 'edge' && ev.sourceNode && ev.targetNode) {
      touchNode(ev.sourceNode);
      touchNode(ev.targetNode);
      var isBlock = (ev.status === 'blocked' || ev.status === 'denied');
      edges.push({
        from: ev.sourceNode,
        to: ev.targetNode,
        status: ev.status || 'pending',
        actionType: ev.actionType || 'access',
        progress: 0,
        // 拦截边停留时间更长，让用户看清拦截过程
        ttl: isBlock ? 2500 : 1200,
        startedAt: performance.now(),
        completed: false
      });
      if (isBlock) {
        // 目标节点闪烁警示
        var target = nodes.get(ev.targetNode);
        if (target) target.pulseUntil = performance.now() + 2500;
      }
      // 任一端是文件节点 → 标记 "访问中"
      markFileActive(ev.sourceNode);
      markFileActive(ev.targetNode);
      return;
    }

    // ---- burst 事件：一次性下发整条路径，错位启动每段 ----
    if (ev.kind === 'burst' && ev.sourceNode && ev.targetNode) {
      var path = [ev.sourceNode].concat(ev.via || []).concat([ev.targetNode]);
      for (var j = 0; j < path.length - 1; j++) {
        touchNode(path[j]);
        touchNode(path[j + 1]);
        edges.push({
          from: path[j],
          to: path[j + 1],
          status: ev.status || 'ok',
          actionType: ev.actionType || 'access',
          progress: 0,
          ttl: 1200,
          startedAt: performance.now() + j * 200,
          completed: false
        });
      }
      // 路径任意端点是文件 → 标记 "访问中"
      for (var b = 0; b < path.length; b++) markFileActive(path[b]);
    }
    // meta 事件不影响视觉，仅打日志
  }

  // 单帧消费：限速防卡顿（最多 25 条 / 帧）
  function pumpQueue() {
    var n = Math.min(25, pendingQueue.length);
    while (n-- > 0) applyEvent(pendingQueue.shift());
  }

  // ============================================================
  // 用户上下文存储（供 hover tooltip 展示）
  // ============================================================
  // userContexts: userId → { subject: { R, T, L_trust, D_sec, DT_score, N_status },
  //                          environment: { networkType, ip, platform, timezone, screen, language } }
  // 外部通过 window.CAAC_RUNTIME.setUserContext(userId, ctx) 注入。
  // dashboard.js 完成 evaluate 后会有这两块数据；mock-bench 的 ctx 场景也会推。
  var userContexts = new Map();

  // 上下文变更"特效"窗口：每次 ctx-change 事件到达时把 {field, oldValue,
  // newValue, expiresAt} 推进对应用户的列表。drawCtxFlashes 每帧读它来画
  // 浮动 pill；drawUserTooltip 也读它来把变动字段标红。
  //   userId → Array<{field, oldValue, newValue, expiresAt}>
  var userCtxFlashes = new Map();
  var CTX_FLASH_MS = 2400;

  function setUserContext(userId, ctx) {
    if (!userId || typeof userId !== 'string') return;
    var prev = userContexts.get(userId) || { subject: {}, environment: {} };
    var nextSubj = Object.assign({}, prev.subject, (ctx && ctx.subject)     || {});
    var nextEnv  = Object.assign({}, prev.environment, (ctx && ctx.environment) || {});
    userContexts.set(userId, { subject: nextSubj, environment: nextEnv });
  }

  // 命中检测：世界坐标 → USERS 行节点（user / attacker）
  function userNodeAt(worldX, worldY) {
    var hit = null;
    nodes.forEach(function (n) {
      if (n.type !== 'user' && n.type !== 'attacker') return;
      var dx = worldX - n.pos.x;
      var dy = worldY - n.pos.y;
      if (dx * dx + dy * dy <= 24 * 24) hit = n;     // 容忍半径 24
    });
    return hit;
  }

  // ---- 绘制：3 行横向条带背景（带描边的圆角框，随 zoom 缩放） ----
  // 几何来自 topology.rowBounds()，绘制发生在 applyView() 之后，
  // 因此整个框（含 stroke 宽度、字号、圆角）都跟随 view.scale 一同缩放。
  function drawBackground(p) {
    ctx.save();

    var rowFill   = withAlpha(p.text3,  0.045);
    var rowStroke = withAlpha(p.text3,  0.28);
    var rowTitle  = withAlpha(p.text3,  0.85);
    // SERVICES 行（含 Fabric PDP）单独高亮，强调决策点在链上
    var pdpStroke = withAlpha(p.info,   0.55);
    var pdpFill   = withAlpha(p.info,   0.06);

    var radius = 12;

    ROW_ORDER.forEach(function (row) {
      var b = topology.rowBounds(row);
      var isPdpRow = (row === 'SERVICES');
      ctx.beginPath();
      roundedRect(ctx, b.left, b.top, b.right - b.left, b.bottom - b.top, radius);
      ctx.fillStyle   = isPdpRow ? pdpFill   : rowFill;
      ctx.strokeStyle = isPdpRow ? pdpStroke : rowStroke;
      ctx.lineWidth   = isPdpRow ? 1.6 : 1;
      ctx.setLineDash(isPdpRow ? [] : [4, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // 行标题（左上角内嵌）
      ctx.fillStyle = isPdpRow ? withAlpha(p.info, 0.95) : rowTitle;
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(b.label, b.left + 12, b.top + 8);

      // SERVICES 行右上角追加 “decision point on-chain” 注脚
      if (isPdpRow) {
        ctx.fillStyle = withAlpha(p.info, 0.7);
        ctx.font = '500 10px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('decision point on-chain', b.right - 12, b.top + 8);
      }
    });

    ctx.restore();
  }

  // 圆角矩形 path（不调用 ctx.roundRect 以兼容旧引擎）
  function roundedRect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
  }

  // ---- 绘制：静态架构关系（虚淡线，永远显示） ----
  function drawStructure(p) {
    ctx.save();
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(p.text3, 0.30);

    // 系统级静态依赖
    STRUCTURE_PAIRS.forEach(function (pair) {
      var a = positionFor(pair[0]);
      var b = positionFor(pair[1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // gateway→file 不再 pre-draw：文件改为瓦片网格后，扇形连线会形成视觉
    // 噪声。访问发生时由 edge 动画即时绘制单条线（参见 applyEvent + drawEdge）。

    // user→gateway：仅为当前激活的用户绘制
    var gw = positionFor('gateway');
    nodes.forEach(function (n) {
      if (n.type === 'user' || n.type === 'attacker') {
        var np = positionFor(n.id);
        ctx.beginPath();
        ctx.moveTo(np.x, np.y);
        ctx.lineTo(gw.x, gw.y);
        ctx.stroke();
      }
    });

    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- 绘制：单个节点 ----
  // 返回 true 表示该节点已完全淡出、可被回收
  function drawNode(node, p, now) {
    // 用户/攻击者节点：空闲超时后淡出
    var isUserLike = (node.type === 'user' || node.type === 'attacker');
    var idleMs = now - node.lastSeen;
    var fadingOut = isUserLike && idleMs > USER_IDLE_MS;

    if (fadingOut) {
      node.alpha = Math.max(0, node.alpha - 0.025);
    } else {
      node.alpha = Math.min(1, node.alpha + 0.05);
    }
    if (node.alpha <= 0.02) return true;

    // 文件节点：小方块瓦片（蓝=idle，亮绿=访问中），与系统节点视觉分离
    if (node.type === 'file') {
      drawFileTile(node, p, now);
      return false;
    }

    var x = node.pos.x, y = node.pos.y;
    // 节点半径：策略链码节点 22，普通系统 20，存储/用户/主体 18
    var radius =
      (node.type === 'policy')                                    ? 22 :
      (node.type === 'system')                                    ? 20 :
      (node.type === 'store' ||
       node.type === 'user' || node.type === 'attacker')          ? 18 : 18;
    var color = statusColor(p, node.status);
    var pulseActive = now < node.pulseUntil;

    ctx.save();
    ctx.globalAlpha = node.alpha;

    // 拦截 / 告警时外层光晕扩散动画
    if (pulseActive) {
      var pulseT = ((now / 350) % 1);
      var haloR = radius + 10 + pulseT * 16;
      var haloA = (1 - pulseT) * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = node.alpha * haloA;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = node.alpha;
    }

    // 节点主体
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.16);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = pulseActive ? 2.4 : 1.6;
    ctx.stroke();

    // 类型图标
    ctx.fillStyle = color;
    ctx.font = '700 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var icon =
      node.type === 'user'     ? 'U' :
      node.type === 'attacker' ? '!' :
      node.type === 'system'   ? '◆' :
      node.type === 'policy'   ? 'P' :
      node.type === 'store'    ? 'S' : '?';
    ctx.fillText(icon, x, y);

    // 文本标签
    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillStyle = p.text;
    ctx.textBaseline = 'top';
    ctx.fillText(node.label, x, y + radius + 6);

    ctx.restore();
    return false;
  }

  // ---- 绘制：文件瓦片 ----
  // idle:   8px 蓝色小方块，无文字 —— 容纳大量文件而不挤
  // active: 16px 亮绿圆角方块 + 'F' 图标 —— 访问中突出
  // 文件名通过 hover tooltip 显示（见 drawFileTooltip），瓦片下方不画标签
  function drawFileTile(node, p, now) {
    var x = node.pos.x, y = node.pos.y;
    var isActive = now < (node.activeUntil || 0);
    var color = isActive ? p.ok : p.info;     // 亮绿 / 蓝
    var half  = isActive ? 13 : 7;
    var radiusR = isActive ? 4 : 2;

    ctx.save();
    ctx.globalAlpha = node.alpha;

    // 主体：圆角方块
    ctx.beginPath();
    roundedRect(ctx, x - half, y - half, half * 2, half * 2, radiusR);
    ctx.fillStyle = withAlpha(color, isActive ? 0.22 : 0.55);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.stroke();

    if (isActive) {
      // 'F' 图标
      ctx.fillStyle = color;
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('F', x, y);
    }

    ctx.restore();
  }

  // ---- 绘制：边动画（流动 + 拦截特效） ----
  function drawEdge(edge, p, now) {
    var fromNode = nodes.get(edge.from);
    var toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) return;

    var elapsed = now - edge.startedAt;
    if (elapsed < 0) return; // burst 错位启动，尚未到时间

    var t = Math.min(1, elapsed / edge.ttl);
    edge.progress = t;

    var x1 = fromNode.pos.x, y1 = fromNode.pos.y;
    var x2 = toNode.pos.x,   y2 = toNode.pos.y;
    var color = statusColor(p, edge.status);
    var isBlock = (edge.status === 'blocked' || edge.status === 'denied');

    ctx.save();

    // 底层细线（淡色，描出连接轨迹）
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (isBlock) {
      // 拦截边：红色虚线断裂感
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = withAlpha(color, 0.35);
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = withAlpha(color, 0.18);
    }
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    // 拦截边在 t=0.55 处停下，普通边走到目标
    var headT = isBlock ? Math.min(0.55, t * 1.5) : t;
    var hx = x1 + (x2 - x1) * headT;
    var hy = y1 + (y2 - y1) * headT;

    // 上层高亮渐变线
    var grad = ctx.createLinearGradient(x1, y1, hx, hy);
    grad.addColorStop(0,   withAlpha(color, 0.05));
    grad.addColorStop(0.7, withAlpha(color, 0.55));
    grad.addColorStop(1,   color);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 流动光点（带发光效果）
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 拦截 ✖ 图标：到达停止点后闪烁绘制
    if (isBlock && t > 0.45) {
      var blink = (Math.floor(now / 200) % 2 === 0) ? 1 : 0.35;
      ctx.globalAlpha = blink;
      ctx.strokeStyle = p.denied;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(hx - 7, hy - 7);
      ctx.lineTo(hx + 7, hy + 7);
      ctx.moveTo(hx + 7, hy - 7);
      ctx.lineTo(hx - 7, hy + 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (t >= 1) edge.completed = true;
  }

  // ---- 绘制：右下角缩放 HUD ----
  function drawZoomHUD(p) {
    ctx.save();
    ctx.font = '500 10px ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillStyle = withAlpha(p.text3, 0.75);
    var pct = Math.round(view.scale * 100) + '%';
    var hint = (view.scale !== 1 || view.panX !== 0 || view.panY !== 0)
      ? pct + '  ·  scroll=zoom · drag=pan · dbl-click=reset'
      : pct + '  ·  scroll=zoom · drag=pan';
    ctx.fillText(hint, cw - 10, ch - 8);
    ctx.restore();
  }

  // 鼠标命中：返回当前指针下的文件节点（屏幕坐标 → 世界坐标）
  function fileUnderCursor(now) {
    if (!hoverMouse.inside || dragging) return null;
    var wx = (hoverMouse.x - view.panX) / view.scale;
    var wy = (hoverMouse.y - view.panY) / view.scale;
    var hit = null;
    nodes.forEach(function (n) {
      if (n.type !== 'file') return;
      var isActive = now < (n.activeUntil || 0);
      // 命中框比视觉稍大一点，便于在小瓦片上 hover
      var pad = isActive ? 15 : 10;
      if (Math.abs(wx - n.pos.x) <= pad && Math.abs(wy - n.pos.y) <= pad) {
        hit = n;
      }
    });
    return hit;
  }

  // 鼠标命中：返回当前指针下的 USERS 行节点（user / attacker）
  function userUnderCursor() {
    if (!hoverMouse.inside || dragging) return null;
    var wx = (hoverMouse.x - view.panX) / view.scale;
    var wy = (hoverMouse.y - view.panY) / view.scale;
    return userNodeAt(wx, wy);
  }

  // 把文件字节数压成 "12 B / 3.4 KB / 7.8 MB / 1.2 GB"
  function fmtBytes(n) {
    if (n == null || isNaN(n)) return null;
    var v = Number(n);
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // 后端 ISO 时间 → "YYYY-MM-DD HH:MM"
  function fmtTs(iso) {
    if (!iso) return null;
    var s = String(iso).replace('T', ' ');
    return s.length > 16 ? s.slice(0, 16) : s;
  }

  // S-level → 文案，便于演示时一眼读懂
  var S_LEVEL_LABELS = {
    1: 'public',
    2: 'internal',
    3: 'confidential',
    4: 'secret',
    5: 'top-secret'
  };

  // ---- 绘制：悬浮 tooltip（屏幕坐标，多行完整信息） ----
  // 行内容（依次显示，缺失字段会跳过）：
  //   filename                       ← 完整文件名（不截断，最长会自适应面板宽度）
  //   Sensitivity   S{n} {label}     ← 例如 "S3 confidential"
  //   P_req         0.55             ← 基线门槛（DT_score 必须 ≥ 才能 PERMIT）
  //   Status        APPROVED         ← 注册状态
  //   Owner         admin
  //   Size          1.2 MB
  //   Accesses      968              ← 历史访问次数
  //   Rules         2 extra          ← 自定义策略条数
  //   Created       2026-05-26 11:59
  function drawFileTooltip(node, p) {
    var sx = node.pos.x * view.scale + view.panX;
    var sy = node.pos.y * view.scale + view.panY;
    var meta = fileMetadata.get(node.id);

    // 标题（文件名优先用完整 fileId；mock 节点回退到 label）
    var title = (meta && meta.fileId) || node.label || node.id;

    // 构造内容行：label 列 + value 列
    var rows = [];
    if (meta) {
      if (meta.sLevel != null) {
        rows.push(['Sensitivity', 'S' + meta.sLevel +
          (S_LEVEL_LABELS[meta.sLevel] ? ' ' + S_LEVEL_LABELS[meta.sLevel] : '')]);
      }
      if (meta.pReq != null)        rows.push(['P_req',     Number(meta.pReq).toFixed(2)]);
      if (meta.status)              rows.push(['Status',    String(meta.status)]);
      if (meta.owner)               rows.push(['Owner',     String(meta.owner)]);
      var sz = fmtBytes(meta.fileSize);
      if (sz)                       rows.push(['Size',      sz]);
      if (meta.accessCount != null) rows.push(['Accesses',  String(meta.accessCount)]);
      if (meta.rulesCount)          rows.push(['Rules',     meta.rulesCount + ' extra']);
      var ts = fmtTs(meta.createdAt);
      if (ts)                       rows.push(['Created',   ts]);
    }

    ctx.save();

    // 字体：标题略大，正文小一号——确保用 measureText 之前先 set，宽度计算才准
    var titleFont = '700 12px ui-monospace, monospace';
    var rowFont   = '500 11px ui-monospace, monospace';
    var padX = 12, padY = 10, rowH = 15, gap = 4;
    var labelColW = 76;  // 左列固定宽，右列自适应内容

    // 测量正文最宽行
    ctx.font = titleFont;
    var titleW = ctx.measureText(title).width;
    ctx.font = rowFont;
    var maxValW = 0;
    for (var i = 0; i < rows.length; i++) {
      var w = ctx.measureText(rows[i][1]).width;
      if (w > maxValW) maxValW = w;
    }
    var contentW = Math.max(titleW, labelColW + maxValW);
    var bw = contentW + padX * 2;
    var bh = padY * 2 + 17 + (rows.length > 0 ? (gap + rows.length * rowH) : 0);

    // 放在瓦片上方；若顶部不够则放下方；并钳制在画布内
    var tx = sx - bw / 2;
    var ty = sy - 22 - bh;
    if (ty < 4) ty = sy + 22;
    if (tx < 4) tx = 4;
    if (tx + bw > cw - 4) tx = cw - 4 - bw;

    // 面板背景
    ctx.beginPath();
    roundedRect(ctx, tx, ty, bw, bh, 6);
    ctx.fillStyle = 'rgba(14,18,26,0.96)';
    ctx.fill();
    ctx.strokeStyle = withAlpha(p.info, 0.65);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 标题（完整文件名）
    ctx.font = titleFont;
    ctx.fillStyle = p.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, tx + padX, ty + padY);

    // 标题分隔细线
    if (rows.length > 0) {
      ctx.beginPath();
      ctx.moveTo(tx + padX, ty + padY + 17);
      ctx.lineTo(tx + bw - padX, ty + padY + 17);
      ctx.strokeStyle = withAlpha(p.text3, 0.35);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // 正文 key/value 列
    ctx.font = rowFont;
    for (var r = 0; r < rows.length; r++) {
      var yy = ty + padY + 17 + gap + r * rowH + rowH / 2;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = withAlpha(p.text3, 0.95);
      ctx.fillText(rows[r][0], tx + padX, yy);
      // value 列着色：Status APPROVED 绿、其他文本浅白；高敏文件红字
      var val = rows[r][1];
      var color = p.text;
      if (rows[r][0] === 'Status') {
        color = (val === 'APPROVED') ? p.ok :
                (val === 'REJECTED') ? p.denied : p.pending;
      } else if (rows[r][0] === 'Sensitivity' && meta && meta.sLevel >= 4) {
        color = p.denied;
      } else if (rows[r][0] === 'Sensitivity' && meta && meta.sLevel === 3) {
        color = p.pending;
      }
      ctx.fillStyle = color;
      ctx.fillText(val, tx + padX + labelColW, yy);
    }

    ctx.restore();
  }

  // ---- 上下文冲击特效 ----
  // 1) 浮动 pill：当 ctx-change 事件到达时，在用户节点上方浮出 "<field>: old → new"
  //    红底白字小药丸，沿 24px 缓慢上升并淡出（200ms 入 + 持续 + 500ms 出）。
  // 2) 双环脉冲：节点周围扩张一对红色同心圆，与"被拦截"的单环脉冲视觉区分开，
  //    用来表达"主体上下文发生了不利变化"。
  //
  // 调用时机：在 nodes.forEach 内、drawNode 之后（仍处于 world coords）。
  function drawCtxFlashes(node, p, now) {
    var list = userCtxFlashes.get(node.id);
    if (!list || list.length === 0) return;

    // 惰性清理过期项
    var alive = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].expiresAt > now) alive.push(list[i]);
    }
    if (alive.length === 0) {
      userCtxFlashes.delete(node.id);
      return;
    }
    if (alive.length !== list.length) userCtxFlashes.set(node.id, alive);

    // (a) 节点双环冲击波（仅当还在 shockPulseUntil 窗口内）
    if (now < (node.shockPulseUntil || 0)) {
      var dur = CTX_FLASH_MS;
      var t = 1 - ((node.shockPulseUntil - now) / dur);     // 0 → 1
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var baseR = (node.type === 'attacker' || node.type === 'user') ? 18 : 20;
      var alpha = (1 - t) * 0.75;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.denied;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(node.pos.x, node.pos.y, baseR + 8 + t * 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(node.pos.x, node.pos.y, baseR + 16 + t * 22, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // (b) 浮动 pill（堆叠：最新一项在最下，越早的越往上飘）
    ctx.save();
    ctx.font = '700 11px ui-monospace, monospace';
    var radiusBase = 18;
    for (var k = 0; k < alive.length; k++) {
      var fl = alive[k];
      var elapsed = now - fl.startedAt;
      var lifeT = elapsed / CTX_FLASH_MS;                   // 0 → 1
      if (lifeT < 0) lifeT = 0; else if (lifeT > 1) lifeT = 1;
      // 缓动：[0..0.08] 淡入，[0.08..0.79] 持平，[0.79..1] 淡出
      var a;
      if      (lifeT < 0.08) a = lifeT / 0.08;
      else if (lifeT > 0.79) a = (1 - lifeT) / 0.21;
      else                   a = 1;
      var riseY = lifeT * 24;
      var text = String(fl.field) + ': ' + fmtFlashVal(fl.oldValue) + ' → ' + fmtFlashVal(fl.newValue);
      var w = ctx.measureText(text).width + 14;
      var h = 18;
      var bx = node.pos.x - w / 2;
      var by = node.pos.y - radiusBase - 14 - k * 22 - riseY;
      ctx.globalAlpha = a;
      // 红底药丸
      ctx.beginPath();
      roundedRect(ctx, bx, by, w, h, 9);
      ctx.fillStyle = 'rgba(255,77,77,0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,200,0.8)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // 文字
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + w / 2, by + h / 2);
    }
    ctx.restore();
  }

  function fmtFlashVal(v) {
    if (v == null) return '—';
    if (typeof v === 'number') {
      return Number.isInteger(v) ? String(v) : v.toFixed(2);
    }
    var s = String(v);
    return (s.length > 16) ? (s.slice(0, 15) + '…') : s;
  }

  // 给 drawUserTooltip 使用：该用户的 field 是否正在"变更高亮"窗口内
  function isFieldFlashing(userId, field, now) {
    var list = userCtxFlashes.get(userId);
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].field === field && list[i].expiresAt > now) return true;
    }
    return false;
  }

  // 上下文字段在 tooltip 面板里的完整文本（不截断；数值统一 2 位小数）
  function fmtCtxValueFull(field, value) {
    if (value == null || value === '') return '—';
    switch (field) {
      case 'R':
        return 'R' + value;
      case 'T':
      case 'L_trust':
      case 'D_sec':
      case 'DT_score':
      case 'N_status':
        return Number(value).toFixed(2);
      default:
        return String(value);
    }
  }

  // ---- 绘制：用户悬浮 tooltip（与文件 tooltip 同款多行面板）----
  // 标题：用户 id + label
  // 两段：SUBJECT_CONTEXT（6 行）+ ENVIRONMENT_CONTEXT（6 行）
  // 数据源：userContexts（dashboard/mock 通过 setUserContext 注入）
  function drawUserTooltip(node, p) {
    var sx = node.pos.x * view.scale + view.panX;
    var sy = node.pos.y * view.scale + view.panY;
    var data = userContexts.get(node.id) || { subject: {}, environment: {} };
    var nowFx = performance.now();

    var title = (node.label && node.label !== node.id)
      ? (node.label + '   ' + node.id)
      : node.id;

    // 行列表：每项 { kind, label, value, color?, flash? }
    // kind = 'header' 段落标题；'row' 普通键值；'sep' 分隔线
    // flash = true → 当前 field 处于 ctx-change 高亮窗口，值标红 + ' ★'
    var items = [];
    items.push({ kind: 'header', label: 'SUBJECT_CONTEXT', color: withAlpha(p.info, 0.95) });
    for (var i = 0; i < CONTEXT_FIELDS.subject.length; i++) {
      var f = CONTEXT_FIELDS.subject[i];
      items.push({
        kind: 'row', label: f,
        value: fmtCtxValueFull(f, data.subject[f]),
        flash: isFieldFlashing(node.id, f, nowFx)
      });
    }
    items.push({ kind: 'sep' });
    items.push({ kind: 'header', label: 'ENVIRONMENT_CONTEXT', color: withAlpha(p.ok, 0.95) });
    for (var j = 0; j < CONTEXT_FIELDS.environment.length; j++) {
      var f2 = CONTEXT_FIELDS.environment[j];
      items.push({
        kind: 'row', label: f2,
        value: fmtCtxValueFull(f2, data.environment[f2]),
        flash: isFieldFlashing(node.id, f2, nowFx)
      });
    }

    ctx.save();

    var titleFont  = '700 12px ui-monospace, monospace';
    var headerFont = '700 10px ui-monospace, monospace';
    var rowFont    = '500 11px ui-monospace, monospace';
    var padX = 12, padY = 10;
    var titleH = 17, headerH = 14, rowH = 15, sepH = 6, gap = 4;
    var labelColW = 96;   // 左列：字段名（最长 networkType = 11 字符 ≈ 88px）

    // 测量宽度（标题 + 每行 label/value 都 measure，取 max）
    ctx.font = titleFont;
    var titleW = ctx.measureText(title).width;

    ctx.font = headerFont;
    var maxHeaderW = 0;
    items.forEach(function (it) {
      if (it.kind === 'header') {
        var w = ctx.measureText(it.label).width;
        if (w > maxHeaderW) maxHeaderW = w;
      }
    });

    ctx.font = rowFont;
    var maxValW = 0;
    items.forEach(function (it) {
      if (it.kind === 'row') {
        // 闪烁行渲染时会追加 " ★"，测量也要带上避免面板裁断
        var sample = it.flash ? (it.value + ' ★') : it.value;
        var w = ctx.measureText(sample).width;
        if (w > maxValW) maxValW = w;
      }
    });

    var contentW = Math.max(titleW, maxHeaderW, labelColW + maxValW);
    var bw = contentW + padX * 2;

    var bh = padY * 2 + titleH;
    items.forEach(function (it) {
      if      (it.kind === 'header') bh += gap + headerH;
      else if (it.kind === 'row')    bh += rowH;
      else if (it.kind === 'sep')    bh += sepH;
    });

    // 默认放节点上方；空间不够则放下方；并钳制在画布内
    var tx = sx - bw / 2;
    var ty = sy - 26 - bh;
    if (ty < 4) ty = sy + 26;
    if (tx < 4) tx = 4;
    if (tx + bw > cw - 4) tx = cw - 4 - bw;

    // 面板背景
    ctx.beginPath();
    roundedRect(ctx, tx, ty, bw, bh, 6);
    ctx.fillStyle = 'rgba(14,18,26,0.96)';
    ctx.fill();
    ctx.strokeStyle = withAlpha(p.info, 0.65);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 标题
    ctx.font = titleFont;
    ctx.fillStyle = p.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, tx + padX, ty + padY);

    // 标题与正文之间的分隔细线
    ctx.beginPath();
    ctx.moveTo(tx + padX, ty + padY + titleH);
    ctx.lineTo(tx + bw - padX, ty + padY + titleH);
    ctx.strokeStyle = withAlpha(p.text3, 0.35);
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 正文（header / row / sep）
    var y = ty + padY + titleH;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (it.kind === 'header') {
        y += gap;
        ctx.font = headerFont;
        ctx.fillStyle = it.color;
        ctx.textBaseline = 'top';
        ctx.fillText(it.label, tx + padX, y);
        y += headerH;
      } else if (it.kind === 'sep') {
        ctx.beginPath();
        ctx.moveTo(tx + padX, y + sepH / 2);
        ctx.lineTo(tx + bw - padX, y + sepH / 2);
        ctx.strokeStyle = withAlpha(p.text3, 0.25);
        ctx.lineWidth = 0.5;
        ctx.stroke();
        y += sepH;
      } else {
        ctx.font = rowFont;
        ctx.textBaseline = 'middle';
        var yy = y + rowH / 2;
        ctx.fillStyle = withAlpha(p.text3, 0.95);
        ctx.fillText(it.label, tx + padX, yy);
        // 上下文变更高亮：值标红并追加 " ★"
        ctx.fillStyle = it.flash ? p.denied : p.text;
        var valText = it.flash ? (it.value + ' ★') : it.value;
        ctx.fillText(valText, tx + padX + labelColW, yy);
        y += rowH;
      }
    }

    ctx.restore();
  }

  // 回收过期的边
  function cullEdges(now) {
    for (var i = edges.length - 1; i >= 0; i--) {
      var e = edges[i];
      if (e.completed && now - (e.startedAt + e.ttl) > 400) {
        edges.splice(i, 1);
      }
    }
  }

  // ---- 主循环 ----
  var lastFrame = 0;
  function tick(now) {
    if (now - lastFrame < frameInterval) {
      requestAnimationFrame(tick);
      return;
    }
    lastFrame = now;

    pumpQueue();
    // 1) 用屏幕坐标清空整张画布
    applyScreen();
    ctx.clearRect(0, 0, cw, ch);

    // 2) 切到世界坐标（应用 zoom/pan）
    applyView();

    var p = readPalette();
    drawBackground(p);
    drawStructure(p);

    // 每帧重算节点位置，以便动态新增的用户/文件让同行节点自动重均分
    nodes.forEach(function (n) {
      n.pos = positionFor(n.id);
    });

    for (var i = 0; i < edges.length; i++) drawEdge(edges[i], p, now);
    var toRemove = [];
    nodes.forEach(function (n) {
      if (drawNode(n, p, now)) toRemove.push(n.id);
    });
    // 上下文冲击特效（双环 + 浮动 pill），仍在 world coords 下绘制
    nodes.forEach(function (n) {
      if (n.type === 'user' || n.type === 'attacker') drawCtxFlashes(n, p, now);
    });
    for (var k = 0; k < toRemove.length; k++) nodes.delete(toRemove[k]);
    cullEdges(now);

    // 文件 / 用户 hover tooltip（屏幕坐标，最后绘制以覆盖在最上层）
    var hoveredFile = fileUnderCursor(now);
    var hoveredUser = hoveredFile ? null : userUnderCursor();
    if (!dragging) {
      canvas.style.cursor = (hoveredFile || hoveredUser) ? 'pointer' : 'grab';
    }

    // 3) 切回屏幕坐标绘制 zoom 指示器 (HUD) 与 tooltip
    applyScreen();
    if (hoveredFile) drawFileTooltip(hoveredFile, p);
    else if (hoveredUser) drawUserTooltip(hoveredUser, p);
    drawZoomHUD(p);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- 侧栏日志渲染 ----
  var logEl = host.querySelector('.runtime-log');
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderLog() {
    if (!logEl) return;
    var html = '';
    for (var i = 0; i < recentLog.length; i++) {
      var item = recentLog[i];
      var time = new Date(item.ts).toLocaleTimeString('en-US', { hour12: false });
      html += '<div class="log-row log-' + escHtml(item.status) + '">' +
              '<span class="log-time">' + escHtml(time) + '</span>' +
              '<span class="log-text">' + escHtml(item.text) + '</span>' +
              '</div>';
    }
    logEl.innerHTML = html;
  }

  // ---- 状态徽章 ----
  var statusEl = host.querySelector('.runtime-status');
  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.kind = kind || 'idle';
  }

  // ---- EventSource：订阅 mock SSE 推送 ----
  var es = null;
  var reconnectTimer = null;
  function connect() {
    setStatus('connecting', 'pending');
    try {
      es = new EventSource('/bench/stream');
    } catch (err) {
      console.error('[runtime-monitor] EventSource init failed:', err);
      scheduleReconnect();
      return;
    }
    es.addEventListener('open', function () { setStatus('streaming', 'ok'); });
    es.addEventListener('error', function () {
      setStatus('reconnecting', 'pending');
      try { es && es.close(); } catch (_) {}
      scheduleReconnect();
    });
    es.addEventListener('caac-runtime', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        pendingQueue.push(data);
      } catch (err) {
        console.warn('[runtime-monitor] bad payload:', err);
      }
    });
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }
  connect();

  // ============================================================
  // 真实文件清单：拉取 FileRegistry，注入到 STORAGE 行
  // ============================================================
  //   - 启动时一次性拉取 /api/files/admin/all，过滤 APPROVED
  //   - 之后通过 /api/events/stream 订阅 LiveEvent，跟随文件增删
  //   - 失败静默：dev 环境（mock-bench、未登录）下 fetch 401/网络错都不影响 mock 演示
  //
  // 依赖运行环境里通过 runLegacyStack 注入的全局：
  //   GATEWAY_URL  —— js/common.js 中根据 hostname 选择的网关基址
  //   authHeaders  —— 同上，附带 Bearer JWT
  // ------------------------------------------------------------
  var FILE_LABEL_MAX = 16; // 单文件标签字符上限（含 S-level 后缀）
  function shortLabel(filename, sLevel) {
    var name = String(filename || '');
    var suffix = (sLevel != null) ? (' (S' + sLevel + ')') : '';
    var room = FILE_LABEL_MAX - suffix.length;
    if (room < 4) room = 4;
    if (name.length > room) name = name.slice(0, room - 1) + '…';
    return name + suffix;
  }

  function gatewayBase() {
    return (typeof GATEWAY_URL === 'string') ? GATEWAY_URL : '';
  }

  function adminAuthHeaders() {
    if (typeof authHeaders === 'function') return authHeaders(false);
    return {};
  }

  function registerBackendFile(entry) {
    if (!entry || !entry.fileId) return null;
    if (entry.status && entry.status !== 'APPROVED') return null;
    if (typeof topology.registerFile !== 'function') return null;
    var label = shortLabel(entry.fileId, entry.sLevel);
    var id = topology.registerFile(entry.fileId, label);
    if (id) {
      // 完整元数据存到旁路 map，供悬浮 tooltip 显示（瓦片本身仍是小方块）
      fileMetadata.set(id, {
        fileId:       entry.fileId,
        sLevel:       entry.sLevel,
        pReq:         entry.pReq,
        status:       entry.status,
        owner:        entry.owner,
        fileSize:     entry.fileSize,
        accessCount:  entry.accessCount,
        createdAt:    entry.createdAt,
        rulesCount:   Array.isArray(entry.rules) ? entry.rules.length : (entry.rulesCount || 0)
      });
      // 立刻 touch 一次让节点淡入；状态保持 idle，无脉冲。
      var n = touchNode(id);
      if (n) n.status = 'ok';
    }
    return id;
  }

  function unregisterBackendFile(entry) {
    if (!entry || !entry.fileId) return;
    if (typeof topology.unregisterFile !== 'function') return;
    var id = fileNodeId ? fileNodeId(entry.fileId) : ('file-' + entry.fileId);
    topology.unregisterFile(entry.fileId);
    nodes.delete(id);
    fileMetadata.delete(id);
  }

  function bootstrapFiles() {
    var url = gatewayBase() + '/api/files/admin/all';
    fetch(url, { headers: adminAuthHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        var list = (payload && Array.isArray(payload.files)) ? payload.files : [];
        list.forEach(registerBackendFile);
      })
      .catch(function (err) {
        // 静默：dev 环境没有真实 gateway 时此路径会 404/网络错，留下一条诊断即可
        console.info('[runtime-monitor] file registry bootstrap skipped:', err.message);
      });
  }
  bootstrapFiles();

  // ------------------------------------------------------------
  // LiveEvent SSE：跟随后端 FileRegistry 增删
  // ------------------------------------------------------------
  // 浏览器 EventSource 不支持自定义请求头，无法附带 Bearer，
  // 因此走 token query 兜底；后端目前只看 Authorization，这里
  // 只在 cookie/session 已有 JWT 的部署形态下生效——dev 中静默失败。
  var liveEs = null;
  var liveReconnectTimer = null;
  function connectLive() {
    var url = gatewayBase() + '/api/events/stream';
    try {
      liveEs = new EventSource(url, { withCredentials: true });
    } catch (err) {
      console.info('[runtime-monitor] live events unavailable:', err.message);
      return;
    }
    liveEs.addEventListener('error', function () {
      try { liveEs && liveEs.close(); } catch (_) {}
      clearTimeout(liveReconnectTimer);
      liveReconnectTimer = setTimeout(connectLive, 5000);
    });
    liveEs.addEventListener('caac', function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (!msg || !msg.type) return;
      var data = msg.data || {};
      switch (msg.type) {
        case 'FILE_APPROVED':
        case 'FILE_UPLOADED':
          // 仅 APPROVED 的入图；UPLOADED 后通常紧跟 APPROVED，会触发再注册。
          if (data.status === 'APPROVED') registerBackendFile(data);
          break;
        case 'FILE_REJECTED':
        case 'FILE_DELETED':
          unregisterBackendFile(data);
          break;
      }
    });
  }
  connectLive();

  // ---- 清空按钮 ----
  var clearBtn = host.querySelector('[data-action="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      nodes.clear();
      edges.length = 0;
      recentLog.length = 0;
      renderLog();
      resetView();
    });
  }

  // ---- 重置视图按钮 ----
  var resetBtn = host.querySelector('[data-action="reset-zoom"]');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetView);
  }

  // 暴露调试句柄
  window.__runtimeMonitor = { nodes: nodes, edges: edges, pendingQueue: pendingQueue };

  // ============================================================
  // 公共 API：dashboard.js / context.js / 外部脚本通过 window.CAAC_RUNTIME 推送
  //   - setUserContext(userId, { subject?, environment? })  幂等更新一个用户的上下文
  //     （hover 该用户节点时通过 tooltip 面板展示）
  // ============================================================
  window.CAAC_RUNTIME = {
    setUserContext: setUserContext
  };
})();
