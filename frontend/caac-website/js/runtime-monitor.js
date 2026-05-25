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

  window.CaacRuntimeMonitor = {
    getScenarios,
    getScenario,
    buildPlaybackFrame
  };
}());
