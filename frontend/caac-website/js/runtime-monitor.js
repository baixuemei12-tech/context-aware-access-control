(function () {
  'use strict';

  const NODE_POSITIONS = {
    user: [8, 46],
    attacker: [8, 72],
    gateway: [26, 46],
    context: [44, 30],
    anomaly: [44, 64],
    oracle: [62, 30],
    fabric: [80, 30],
    ipfs: [80, 54],
    file: [62, 54],
    permit: [94, 46],
    deny: [94, 66],
    blocked: [94, 82],
    revoked: [94, 18]
  };

  const NODES = [
    { id: 'user', label: 'User', kind: 'subject' },
    { id: 'attacker', label: 'Attacker', kind: 'threat' },
    { id: 'gateway', label: 'Gateway', kind: 'pep' },
    { id: 'context', label: 'Context Resolver', kind: 'score' },
    { id: 'anomaly', label: 'Anomaly Detector', kind: 'guard' },
    { id: 'oracle', label: 'Oracle', kind: 'bridge' },
    { id: 'fabric', label: 'Fabric PDP', kind: 'chain' },
    { id: 'ipfs', label: 'IPFS Ciphertext', kind: 'storage' },
    { id: 'file', label: 'File Registry', kind: 'resource' },
    { id: 'permit', label: 'Permit', kind: 'ok' },
    { id: 'deny', label: 'Deny', kind: 'deny' },
    { id: 'blocked', label: 'Blocked', kind: 'block' },
    { id: 'revoked', label: 'Revoked', kind: 'revoke' }
  ].map(node => ({
    ...node,
    x: NODE_POSITIONS[node.id][0],
    y: NODE_POSITIONS[node.id][1]
  }));

  const EDGES = {
    'user-file': ['user', 'file'],
    'user-gateway': ['user', 'gateway'],
    'attacker-gateway': ['attacker', 'gateway'],
    'gateway-context': ['gateway', 'context'],
    'gateway-anomaly': ['gateway', 'anomaly'],
    'context-oracle': ['context', 'oracle'],
    'oracle-fabric': ['oracle', 'fabric'],
    'fabric-permit': ['fabric', 'permit'],
    'fabric-deny': ['fabric', 'deny'],
    'fabric-revoked': ['fabric', 'revoked'],
    'gateway-ipfs': ['gateway', 'ipfs'],
    'gateway-permit': ['gateway', 'permit'],
    'anomaly-blocked': ['anomaly', 'blocked'],
    'blocked-ipfs': ['blocked', 'ipfs']
  };

  const SCENARIOS = [
    {
      id: 'normal-permit',
      title: 'Normal file access',
      outcome: 'PERMIT',
      summary: 'Trusted user accesses an approved file and receives a risk-budgeted stream.',
      steps: [
        { label: 'User requests file', nodes: ['user', 'file'], edge: 'user-file', tone: 'info' },
        { label: 'Gateway authenticates token', nodes: ['user', 'gateway'], edge: 'user-gateway', tone: 'ok' },
        { label: 'Context scores resolved', nodes: ['gateway', 'context'], edge: 'gateway-context', tone: 'info' },
        { label: 'Oracle relays evaluateAccess', nodes: ['context', 'oracle', 'fabric'], edge: 'context-oracle', tone: 'info' },
        { label: 'Fabric returns PERMIT', nodes: ['fabric', 'permit'], edge: 'fabric-permit', tone: 'ok' },
        { label: 'Gateway streams from IPFS', nodes: ['gateway', 'ipfs', 'permit'], edge: 'gateway-ipfs', tone: 'ok' }
      ]
    },
    {
      id: 'role-denied',
      title: 'Sensitivity mismatch',
      outcome: 'DENIED',
      summary: 'A low-role user requests a high-sensitivity object and is denied by the PDP.',
      steps: [
        { label: 'User requests S5 file', nodes: ['user', 'file'], edge: 'user-file', tone: 'info' },
        { label: 'Gateway builds access request', nodes: ['user', 'gateway', 'file'], edge: 'user-gateway', tone: 'info' },
        { label: 'Fabric checks R_sub < S_level', nodes: ['gateway', 'oracle', 'fabric'], edge: 'oracle-fabric', tone: 'warn' },
        { label: 'Decision DENY returned', nodes: ['fabric', 'deny'], edge: 'fabric-deny', tone: 'deny' }
      ]
    },
    {
      id: 'attack-blocked',
      title: 'Attack path blocked',
      outcome: 'BLOCKED',
      summary: 'Burst access and suspicious context trigger anomaly blocking before data delivery.',
      steps: [
        { label: 'Suspicious client connects', nodes: ['attacker'], edge: null, tone: 'warn' },
        { label: 'Burst begins', nodes: ['attacker'], edge: null, tone: 'warn' },
        { label: 'Gateway receives burst', nodes: ['attacker', 'gateway'], edge: 'attacker-gateway', tone: 'warn' },
        { label: 'Anomaly detector scores behavior', nodes: ['gateway', 'anomaly'], edge: 'gateway-anomaly', tone: 'warn' },
        { label: 'Runtime monitor marks path', nodes: ['anomaly', 'blocked'], edge: 'anomaly-blocked', tone: 'block' },
        { label: 'Access blocked before IPFS', nodes: ['blocked', 'ipfs'], edge: 'blocked-ipfs', tone: 'block' }
      ]
    },
    {
      id: 'midstream-revoked',
      title: 'Mid-stream revocation',
      outcome: 'REVOKED',
      summary: 'A permitted session degrades during streaming and Algorithm 2 revokes it.',
      steps: [
        { label: 'Session starts as PERMIT', nodes: ['user', 'gateway', 'permit'], edge: 'gateway-permit', tone: 'ok' },
        { label: 'Windowed stream begins', nodes: ['gateway', 'ipfs'], edge: 'gateway-ipfs', tone: 'ok' },
        { label: 'Context degrades', nodes: ['gateway', 'context'], edge: 'gateway-context', tone: 'warn' },
        { label: 'Scheduler re-evaluates', nodes: ['context', 'oracle', 'fabric'], edge: 'context-oracle', tone: 'warn' },
        { label: 'Session revoked', nodes: ['fabric', 'revoked'], edge: 'fabric-revoked', tone: 'revoke' }
      ]
    }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeClassToken(value) {
    const token = String(value == null ? '' : value);
    return /^[a-z0-9_-]+$/i.test(token) ? token : '';
  }

  function getScenarios() {
    return SCENARIOS.map(clone);
  }

  function getScenario(id) {
    const scenario = SCENARIOS.find(item => item.id === id) || SCENARIOS[0];
    return clone(scenario);
  }

  function clampStepIndex(stepIndex, lastIndex) {
    const numericIndex = typeof stepIndex === 'number' && Number.isFinite(stepIndex)
      ? Math.floor(stepIndex)
      : 0;
    return Math.max(0, Math.min(numericIndex, lastIndex));
  }

  function buildPlaybackFrame(scenario, stepIndex) {
    const activeScenario = scenario || getScenario();
    const lastIndex = activeScenario.steps.length - 1;
    const currentIndex = clampStepIndex(stepIndex, lastIndex);
    const visibleSteps = activeScenario.steps.slice(0, currentIndex + 1);
    const activeNodeIds = Array.from(new Set(visibleSteps.flatMap(step => step.nodes || [])));
    const activeEdgeIds = visibleSteps.map(step => step.edge).filter(Boolean);

    return {
      scenarioId: activeScenario.id,
      outcome: activeScenario.outcome,
      currentStep: clone(activeScenario.steps[currentIndex]),
      activeNodeIds,
      activeEdgeIds,
      completedStepCount: visibleSteps.length,
      totalStepCount: activeScenario.steps.length
    };
  }

  let playbackTimer = null;
  let activeScenarioId = 'normal-permit';
  const DEFAULT_VIEWPORT = { scale: 1, x: 0, y: 0 };
  const MIN_VIEWPORT_SCALE = 0.65;
  const MAX_VIEWPORT_SCALE = 2.5;
  let viewport = resetViewport();

  function createViewportRecord(source, scale, x, y) {
    const prototypeSource = source || (typeof window === 'object' ? window : null);
    const prototype = prototypeSource ? Object.getPrototypeOf(prototypeSource) : Object.prototype;
    return Object.assign(Object.create(prototype), { scale, x, y });
  }

  function clampScale(value) {
    const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : 1;
    return Math.max(MIN_VIEWPORT_SCALE, Math.min(numericValue, MAX_VIEWPORT_SCALE));
  }

  function resetViewport() {
    return createViewportRecord(null, DEFAULT_VIEWPORT.scale, DEFAULT_VIEWPORT.x, DEFAULT_VIEWPORT.y);
  }

  function createViewport(value) {
    if (!value) return resetViewport();
    return createViewportRecord(
      value,
      clampScale(value.scale),
      typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0,
      typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0
    );
  }

  function zoomViewportAt(currentViewport, factor, point) {
    const current = createViewport(currentViewport);
    const zoomFactor = typeof factor === 'number' && Number.isFinite(factor) ? factor : 1;
    const nextScale = clampScale(current.scale * zoomFactor);
    const ratio = nextScale / current.scale;
    const anchor = point || { x: 0, y: 0 };
    return createViewportRecord(
      currentViewport,
      nextScale,
      anchor.x - (anchor.x - current.x) * ratio,
      anchor.y - (anchor.y - current.y) * ratio
    );
  }

  function panViewport(currentViewport, dx, dy) {
    const current = createViewport(currentViewport);
    return createViewportRecord(currentViewport, current.scale, current.x + dx, current.y + dy);
  }

  function edgeTone(edgeId, scenario, frame) {
    const step = scenario.steps.find(item => item.edge === edgeId && frame.activeEdgeIds.includes(edgeId));
    return step ? step.tone : '';
  }

  function nodeTone(nodeId, scenario, frame) {
    const steps = scenario.steps.slice().reverse();
    const step = steps.find(item => (item.nodes || []).includes(nodeId) && frame.activeNodeIds.includes(nodeId));
    if (nodeId === 'attacker') return 'threat';
    return step ? step.tone : '';
  }

  function renderCanvas(canvas, scenario, frame) {
    const edgeMarkup = Object.keys(EDGES).map(id => {
      const pair = EDGES[id];
      const from = NODES.find(node => node.id === pair[0]);
      const to = NODES.find(node => node.id === pair[1]);
      const active = frame.activeEdgeIds.includes(id);
      const tone = active ? sanitizeClassToken(edgeTone(id, scenario, frame)) : '';
      return '<line class="runtime-edge ' + (active ? 'active' : '') + ' ' + tone + '" x1="' +
        (from.x * 10) + '" y1="' + (from.y * 5.6) + '" x2="' + (to.x * 10) + '" y2="' +
        (to.y * 5.6) + '"></line>';
    }).join('');

    const nodeMarkup = NODES.map(node => {
      const active = frame.activeNodeIds.includes(node.id);
      const tone = sanitizeClassToken(active ? nodeTone(node.id, scenario, frame) : node.kind);
      return '<g class="runtime-node ' + (active ? 'active' : '') + ' ' + tone +
        '" transform="translate(' + (node.x * 10) + ',' + (node.y * 5.6) + ')">' +
        '<rect x="-58" y="-20" width="116" height="40"></rect>' +
        '<text>' + escapeText(node.label) + '</text>' +
        '</g>';
    }).join('');

    canvas.innerHTML = '<defs>' +
      '<filter id="runtimeGlow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/>' +
      '<feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' + edgeMarkup + nodeMarkup;
  }

  function renderButtons(root, monitor) {
    root.innerHTML = getScenarios().map(scenario =>
      '<button type="button" class="runtime-scenario-btn ' +
      (scenario.id === activeScenarioId ? 'active' : '') +
      '" data-runtime-scenario="' + escapeText(scenario.id) + '">' + escapeText(scenario.title) + '</button>'
    ).join('');
    root.querySelectorAll('[data-runtime-scenario]').forEach(button => {
      button.addEventListener('click', () => monitor.play(button.dataset.runtimeScenario));
    });
  }

  function renderFrame(monitor, scenario, frame) {
    renderCanvas(monitor.canvas, scenario, frame);
    monitor.title.textContent = scenario.title + ' - ' + scenario.outcome;
    monitor.summary.textContent = scenario.summary;
    monitor.progressText.textContent = frame.completedStepCount + '/' + frame.totalStepCount;
    monitor.progressBar.style.width = Math.round((frame.completedStepCount / frame.totalStepCount) * 100) + '%';
    monitor.log.innerHTML = scenario.steps.slice(0, frame.completedStepCount).map((step, index) =>
      '<div class="runtime-log-entry ' + sanitizeClassToken(step.tone) + '">T+' +
      String(index + 1).padStart(2, '0') + ' ' + escapeText(step.label) + '</div>'
    ).join('');
    monitor.log.scrollTop = monitor.log.scrollHeight;
  }

  function createMonitor() {
    const monitor = {
      canvas: document.getElementById('runtimeMonitorCanvas'),
      buttons: document.getElementById('runtimeScenarioButtons'),
      title: document.getElementById('runtimeScenarioTitle'),
      summary: document.getElementById('runtimeScenarioSummary'),
      progressBar: document.getElementById('runtimeProgressBar'),
      progressText: document.getElementById('runtimeProgressText'),
      log: document.getElementById('runtimeMonitorLog')
    };
    if (!monitor.canvas || !monitor.buttons || !monitor.title || !monitor.summary ||
        !monitor.progressBar || !monitor.progressText || !monitor.log) {
      return null;
    }
    return monitor;
  }

  function playScenario(id, delayMs) {
    const monitor = createMonitor();
    if (!monitor) return;
    const scenario = getScenario(id);
    activeScenarioId = scenario.id;
    renderButtons(monitor.buttons, api);
    if (playbackTimer) clearTimeout(playbackTimer);

    let stepIndex = 0;
    const playbackDelay = delayMs == null ? 1150 : delayMs;
    const tick = () => {
      const frame = buildPlaybackFrame(scenario, stepIndex);
      renderFrame(monitor, scenario, frame);
      stepIndex += 1;
      if (stepIndex < scenario.steps.length) {
        playbackTimer = setTimeout(tick, playbackDelay);
      } else {
        playbackTimer = null;
      }
    };
    tick();
  }

  function init() {
    const monitor = createMonitor();
    if (!monitor) return;
    playScenario(activeScenarioId, 1150);
  }

  function ingestLiveEvent(type) {
    if (type === 'FILE_UPLOADED') playScenario('normal-permit', 900);
    if (type === 'USER_STATUS_CHANGED') playScenario('role-denied', 900);
    if (type && type.indexOf('ANOMALY') >= 0) playScenario('attack-blocked', 900);
  }

  const api = {
    getScenarios,
    getScenario,
    buildPlaybackFrame,
    createViewport,
    zoomViewportAt,
    panViewport,
    resetViewport,
    init,
    play: playScenario,
    ingestLiveEvent
  };

  window.CaacRuntimeMonitor = api;
}());
