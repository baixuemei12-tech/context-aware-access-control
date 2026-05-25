/* CAAC scenario demo page */

const CAAC_SCENARIOS = [
  {
    id: 'clean-login',
    title: 'Clean login and file download',
    subtitle: 'Expected permit path',
    decision: 'PERMIT',
    dt: '0.842',
    peff: '0.521',
    tier: 'LOW',
    exposure: 'complete',
    color: 'var(--green)',
    desc: 'A trusted user opens an approved file from a normal network. The gateway resolves a healthy context, Fabric returns PERMIT, RGCA selects a low-risk tier, and CAAR closes the receipt after streaming.',
    steps: [
      ['Context', 'Browser submits platform, time, network, language, screen, and session token.'],
      ['Gateway', 'Rules and object risk are checked before the signed oracle request is built.'],
      ['Fabric', 'evaluateAccess returns PERMIT because DT_score is above P_eff and role is sufficient.'],
      ['Streaming', 'Gateway decrypts the IPFS ciphertext and streams through the RGCA low-risk window.'],
      ['Receipt', 'Session close records delivered bytes and CAAR evidence.']
    ]
  },
  {
    id: 'low-trust-deny',
    title: 'Low-trust user denied',
    subtitle: 'Threshold failure',
    decision: 'DENY',
    dt: '0.384',
    peff: '0.600',
    tier: 'none',
    exposure: '0 KB',
    color: 'var(--red)',
    desc: 'A user requests a confidential object but the resolved trust score does not reach the effective threshold. The gateway fails closed before any stream is opened.',
    steps: [
      ['Context', 'Network and device signals are resolved but trust remains below policy need.'],
      ['Rules', 'S_level and P_req create a stricter admission threshold.'],
      ['Fabric', 'evaluateAccess returns DENY.'],
      ['Gateway', 'No session ID is issued and no IPFS plaintext is delivered.']
    ]
  },
  {
    id: 'revoked-session',
    title: 'Revoked session during stream',
    subtitle: 'Continuous authorization',
    decision: 'REVOKED',
    dt: '0.477',
    peff: '0.540',
    tier: 'HIGH',
    exposure: 'bounded',
    color: 'var(--amber)',
    desc: 'A context shift happens after access is granted. Algorithm 2 detects that the refreshed context no longer supports the decision and terminates the stream.',
    steps: [
      ['Admission', 'Initial request is permitted with a narrow positive risk margin.'],
      ['Shift', 'The client context degrades during delivery, such as network change or device signal loss.'],
      ['Scheduler', 'RevocationScheduler re-evaluates the active session at the high-risk tick.'],
      ['Terminate', 'The gateway closes the response stream and records a revocation receipt.']
    ]
  },
  {
    id: 'budget-exhausted',
    title: 'Risk budget exhausted',
    subtitle: 'Repeated attempts',
    decision: 'DENY',
    dt: '0.731',
    peff: '0.510',
    tier: 'HIGH',
    exposure: 'hard cap',
    color: 'var(--red)',
    desc: 'Repeated access to the same object consumes the daily user-file risk budget. After the soft region, the gateway forces HIGH-RISK delivery; after the hard cap, new access is denied.',
    steps: [
      ['Attempt 1-3', 'RiskBudgetService accumulates delivered bytes for the user-file-day key.'],
      ['Soft cap', 'Delivery is forced into the high-risk tier even if the DT margin is good.'],
      ['Guard band', 'Only the bounded grace region remains available.'],
      ['Hard cap', 'The next request is denied before oracle/Fabric evaluation can open a stream.']
    ]
  },
  {
    id: 'admin-totp',
    title: 'TOTP-protected admin login',
    subtitle: 'Identity hardening',
    decision: 'PERMIT',
    dt: 'admin',
    peff: '2FA',
    tier: 'control',
    exposure: 'n/a',
    color: 'var(--green)',
    desc: 'Administrator access requires password verification plus a time-based one-time password. The UI should make the second factor visible without exposing secrets.',
    steps: [
      ['Password', 'BCrypt validates the primary credential.'],
      ['TOTP', 'The server verifies the 6-digit authenticator code within the accepted time window.'],
      ['Session', 'Admin token receives access to registry, users, anomaly, and audit tools.'],
      ['Audit', 'Administrative actions remain visible in the operations console.']
    ]
  },
  {
    id: 'vpn-switch',
    title: 'VPN or WiFi switch anomaly',
    subtitle: 'Mobility edge case',
    decision: 'REVIEW',
    dt: 'variable',
    peff: 'adaptive',
    tier: 'MED/HIGH',
    exposure: 'measured',
    color: 'var(--purple)',
    desc: 'Benign movement between university WiFi and VPN can still look like an IP/context shift. The production design should show a clear reason and keep the stream bounded while the policy reacts.',
    steps: [
      ['Change', 'The client IP or network class changes while the session is active.'],
      ['Detect', 'Gateway compares the new context against the session baseline.'],
      ['Escalate', 'RGCA tier is raised or the session is revoked depending on margin and rules.'],
      ['Explain', 'The UI shows the user why throughput changed or why the session was closed.']
    ]
  }
];

let activeScenarioId = CAAC_SCENARIOS[0].id;
let walkthroughTimers = [];

function renderScenarioButtons(activeId) {
  const wrap = document.getElementById('scenarioButtons');
  if (!wrap) return;
  wrap.innerHTML = CAAC_SCENARIOS.map(s => `
    <button type="button" class="scenario-button ${s.id === activeId ? 'active' : ''}" data-scenario="${s.id}">
      <b>${escapeHtml(s.title)}</b>
      <span>${escapeHtml(s.subtitle)}</span>
    </button>
  `).join('');
  wrap.querySelectorAll('[data-scenario]').forEach(btn => {
    btn.addEventListener('click', () => selectScenario(btn.dataset.scenario));
  });
}

function selectScenario(id) {
  const scenario = CAAC_SCENARIOS.find(s => s.id === id) || CAAC_SCENARIOS[0];
  activeScenarioId = scenario.id;
  resetScenarioWalkthrough();
  renderScenarioButtons(scenario.id);
  document.getElementById('scenarioTitle').textContent = scenario.title;
  document.getElementById('scenarioDesc').textContent = scenario.desc;
  document.getElementById('scenarioDt').textContent = scenario.dt;
  document.getElementById('scenarioPeff').textContent = scenario.peff;
  document.getElementById('scenarioTier').textContent = scenario.tier;
  document.getElementById('scenarioTier').style.color = scenario.color;
  document.getElementById('scenarioExposure').textContent = scenario.exposure;

  const badge = document.getElementById('scenarioDecision');
  badge.textContent = scenario.decision;
  badge.className = 'decision-badge decision-' + (scenario.decision === 'PERMIT' ? 'PERMIT' : scenario.decision === 'DENY' ? 'DENY' : 'ERROR');
  badge.style.color = scenario.color;

  document.getElementById('scenarioSteps').innerHTML = scenario.steps.map((step, index) => `
    <div class="scenario-step" data-scenario-step="${index}">
      <i>${index + 1}</i>
      <div><strong>${escapeHtml(step[0])}</strong><p>${escapeHtml(step[1])}</p></div>
    </div>
  `).join('');
}

function flowNodeForStep(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('context') || text.includes('password') || text.includes('change') || text.includes('attempt')) return 'browser';
  if (text.includes('gateway') || text.includes('rules') || text.includes('detect') || text.includes('soft') || text.includes('guard')) return 'gateway';
  if (text.includes('fabric') || text.includes('totp') || text.includes('scheduler')) return 'fabric';
  if (text.includes('stream') || text.includes('terminate') || text.includes('hard')) return 'ipfs';
  if (text.includes('receipt') || text.includes('audit') || text.includes('explain')) return 'oracle';
  return 'gateway';
}

function clearScenarioTimers() {
  walkthroughTimers.forEach(id => clearTimeout(id));
  walkthroughTimers = [];
}

function resetScenarioWalkthrough() {
  clearScenarioTimers();
  document.querySelectorAll('[data-flow-node]').forEach(node => {
    node.classList.remove('active', 'done', 'blocked');
  });
  document.querySelectorAll('[data-scenario-step]').forEach(step => {
    step.classList.remove('active', 'done', 'blocked');
  });
  const packet = document.getElementById('scenarioPacket');
  if (packet) {
    packet.className = 'scenario-packet';
    packet.style.opacity = '0';
  }
  const progress = document.getElementById('scenarioRunProgress');
  if (progress) progress.style.width = '0%';
  const label = document.getElementById('scenarioRunLabel');
  if (label) label.textContent = 'ready';
  const btn = document.getElementById('scenarioRunBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Run walkthrough';
  }
}

function setScenarioPacket(nodeName, finalState) {
  const packet = document.getElementById('scenarioPacket');
  if (!packet) return;
  packet.className = 'scenario-packet move-' + nodeName + (finalState ? ' ' + finalState : '');
  packet.style.opacity = '1';
}

function runScenarioWalkthrough() {
  const scenario = CAAC_SCENARIOS.find(s => s.id === activeScenarioId) || CAAC_SCENARIOS[0];
  resetScenarioWalkthrough();
  const btn = document.getElementById('scenarioRunBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
  }
  const label = document.getElementById('scenarioRunLabel');
  const progress = document.getElementById('scenarioRunProgress');
  const duration = 820;

  scenario.steps.forEach((step, index) => {
    walkthroughTimers.push(setTimeout(() => {
      const nodeName = flowNodeForStep(step[0]);
      const node = document.querySelector(`[data-flow-node="${nodeName}"]`);
      const stepEl = document.querySelector(`[data-scenario-step="${index}"]`);
      document.querySelectorAll('[data-flow-node]').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('[data-scenario-step]').forEach(s => s.classList.remove('active'));
      if (node) node.classList.add('active');
      if (stepEl) stepEl.classList.add('active');
      setScenarioPacket(nodeName);
      if (label) label.textContent = step[0];
      if (progress) progress.style.width = (((index + 1) / scenario.steps.length) * 100).toFixed(0) + '%';
      if (index > 0) {
        const prev = document.querySelector(`[data-scenario-step="${index - 1}"]`);
        if (prev) prev.classList.add('done');
      }
    }, index * duration));
  });

  walkthroughTimers.push(setTimeout(() => {
    const state = scenario.decision === 'DENY' ? 'blocked' : scenario.decision === 'REVOKED' ? 'blocked' : 'done';
    document.querySelectorAll('[data-flow-node], [data-scenario-step]').forEach(el => {
      el.classList.remove('active');
      el.classList.add(state);
    });
    setScenarioPacket(scenario.decision === 'DENY' ? 'gateway' : 'ipfs', state);
    if (label) label.textContent = scenario.decision === 'PERMIT' ? 'completed' : scenario.decision.toLowerCase();
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Replay walkthrough';
    }
  }, scenario.steps.length * duration + 160));
}

window.addEventListener('DOMContentLoaded', () => selectScenario(CAAC_SCENARIOS[0].id));
