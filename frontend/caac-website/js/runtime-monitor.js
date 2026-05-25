(function () {
  'use strict';

  const scenarios = [
    {
      id: 'normal-permit',
      title: 'Normal file access',
      outcome: 'PERMIT',
      nodes: [
        { id: 'analyst', type: 'user', label: 'Analyst' },
        { id: 'gateway', type: 'control', label: 'Gateway' },
        { id: 'oracle', type: 'decision', label: 'Oracle / Fabric' },
        { id: 'ipfs', type: 'storage', label: 'IPFS' },
        { id: 'file-public', type: 'file', label: 'Approved file' }
      ],
      edges: [
        { id: 'analyst-gateway', from: 'analyst', to: 'gateway' },
        { id: 'gateway-oracle', from: 'gateway', to: 'oracle' },
        { id: 'gateway-ipfs', from: 'gateway', to: 'ipfs' },
        { id: 'ipfs-file-public', from: 'ipfs', to: 'file-public' }
      ],
      steps: [
        { label: 'User requests file', nodeIds: ['analyst'], edgeIds: [] },
        { label: 'Gateway validates context', nodeIds: ['gateway'], edgeIds: ['analyst-gateway'] },
        { label: 'Policy permits access', nodeIds: ['oracle'], edgeIds: ['gateway-oracle'] },
        { label: 'Encrypted content streams', nodeIds: ['ipfs', 'file-public'], edgeIds: ['gateway-ipfs', 'ipfs-file-public'] }
      ]
    },
    {
      id: 'role-denied',
      title: 'Role denied',
      outcome: 'DENIED',
      nodes: [
        { id: 'guest', type: 'user', label: 'Guest' },
        { id: 'gateway', type: 'control', label: 'Gateway' },
        { id: 'oracle', type: 'decision', label: 'Oracle / Fabric' },
        { id: 'deny', type: 'result', label: 'Deny' },
        { id: 'file-secret', type: 'file', label: 'Secret file' }
      ],
      edges: [
        { id: 'guest-gateway', from: 'guest', to: 'gateway' },
        { id: 'gateway-oracle', from: 'gateway', to: 'oracle' },
        { id: 'oracle-deny', from: 'oracle', to: 'deny' },
        { id: 'guest-file-secret', from: 'guest', to: 'file-secret' }
      ],
      steps: [
        { label: 'Guest requests secret file', nodeIds: ['guest', 'file-secret'], edgeIds: ['guest-file-secret'] },
        { label: 'Gateway sends policy context', nodeIds: ['gateway'], edgeIds: ['guest-gateway'] },
        { label: 'Role is below sensitivity', nodeIds: ['oracle'], edgeIds: ['gateway-oracle'] },
        { label: 'Access denied', nodeIds: ['deny'], edgeIds: ['oracle-deny'] }
      ]
    },
    {
      id: 'attack-blocked',
      title: 'Attack burst blocked',
      outcome: 'BLOCKED',
      nodes: [
        { id: 'attacker', type: 'user', label: 'Attacker' },
        { id: 'gateway', type: 'control', label: 'Gateway' },
        { id: 'detector', type: 'detector', label: 'Anomaly detector' },
        { id: 'block', type: 'result', label: 'Block' },
        { id: 'file-vault', type: 'file', label: 'Vault file' }
      ],
      edges: [
        { id: 'attacker-file-vault', from: 'attacker', to: 'file-vault' },
        { id: 'attacker-gateway', from: 'attacker', to: 'gateway' },
        { id: 'gateway-detector', from: 'gateway', to: 'detector' },
        { id: 'detector-block', from: 'detector', to: 'block' }
      ],
      steps: [
        { label: 'Suspicious actor targets file', nodeIds: ['attacker', 'file-vault'], edgeIds: ['attacker-file-vault'] },
        { label: 'Burst begins', nodeIds: ['attacker'], edgeIds: [] },
        { label: 'Gateway receives burst', nodeIds: ['attacker', 'gateway'], edgeIds: ['attacker-gateway'] },
        { label: 'Detector flags anomaly', nodeIds: ['detector'], edgeIds: ['gateway-detector'] },
        { label: 'Access path blocked', nodeIds: ['block'], edgeIds: ['detector-block'] }
      ]
    },
    {
      id: 'midstream-revoked',
      title: 'Midstream revocation',
      outcome: 'REVOKED',
      nodes: [
        { id: 'engineer', type: 'user', label: 'Engineer' },
        { id: 'gateway', type: 'control', label: 'Gateway' },
        { id: 'oracle', type: 'decision', label: 'Oracle / Fabric' },
        { id: 'revoker', type: 'detector', label: 'Revocation scheduler' },
        { id: 'revoke', type: 'result', label: 'Revoke' },
        { id: 'file-design', type: 'file', label: 'Design file' }
      ],
      edges: [
        { id: 'engineer-gateway', from: 'engineer', to: 'gateway' },
        { id: 'gateway-oracle', from: 'gateway', to: 'oracle' },
        { id: 'gateway-file-design', from: 'gateway', to: 'file-design' },
        { id: 'revoker-oracle', from: 'revoker', to: 'oracle' },
        { id: 'oracle-revoke', from: 'oracle', to: 'revoke' }
      ],
      steps: [
        { label: 'Engineer starts session', nodeIds: ['engineer'], edgeIds: [] },
        { label: 'Initial policy permits', nodeIds: ['gateway', 'oracle'], edgeIds: ['engineer-gateway', 'gateway-oracle'] },
        { label: 'File stream is active', nodeIds: ['file-design'], edgeIds: ['gateway-file-design'] },
        { label: 'Context is rechecked', nodeIds: ['revoker', 'oracle'], edgeIds: ['revoker-oracle'] },
        { label: 'Session revoked midstream', nodeIds: ['revoke'], edgeIds: ['oracle-revoke'] }
      ]
    }
  ];

  const HostArray = !window.document && window.constructor && window.constructor.constructor
    ? window.constructor.constructor('return Array')()
    : Array;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function hostArray(values) {
    const result = new HostArray();
    values.forEach(value => result.push(value));
    return result;
  }

  function getScenarios() {
    return hostArray(scenarios.map(clone));
  }

  function getScenario(id) {
    const scenario = scenarios.find(item => item.id === id);
    return scenario ? clone(scenario) : null;
  }

  function buildPlaybackFrame(scenario, stepIndex) {
    const lastIndex = Math.max(0, Math.min(stepIndex, scenario.steps.length - 1));
    const activeNodeIds = new Set();
    const activeEdgeIds = new Set();

    scenario.steps.slice(0, lastIndex + 1).forEach(step => {
      step.nodeIds.forEach(id => activeNodeIds.add(id));
      step.edgeIds.forEach(id => activeEdgeIds.add(id));
    });

    return {
      scenarioId: scenario.id,
      outcome: scenario.outcome,
      currentStep: clone(scenario.steps[lastIndex]),
      activeNodeIds: hostArray(Array.from(activeNodeIds)),
      activeEdgeIds: hostArray(Array.from(activeEdgeIds))
    };
  }

  window.CaacRuntimeMonitor = {
    getScenarios,
    getScenario,
    buildPlaybackFrame
  };
}());
