/* CAAC overview visual status layer */

function setFlowStatus(id, label, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = label;
  el.classList.toggle('warn', state === 'warn');
  el.classList.toggle('off', state === 'off');
}

async function refreshOverviewFlow() {
  const demo = typeof isDemoMode === 'function' && isDemoMode();
  try {
    const res = await fetch(GATEWAY_URL + '/api/files/health', { signal: AbortSignal.timeout(2200) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setFlowStatus('flowGatewayStatus', 'up', '');
    setFlowStatus('flowOracleStatus', demo ? 'visual' : 'standby', 'warn');
    setFlowStatus('flowFabricStatus', demo ? 'demo' : 'chain optional', 'warn');
    setFlowStatus('flowIpfsStatus', (data.registeredFiles || 0) + ' files', '');
  } catch {
    setFlowStatus('flowGatewayStatus', demo ? 'demo' : 'offline', demo ? 'warn' : 'off');
    setFlowStatus('flowOracleStatus', demo ? 'visual' : 'offline', demo ? 'warn' : 'off');
    setFlowStatus('flowFabricStatus', demo ? 'demo' : 'offline', demo ? 'warn' : 'off');
    setFlowStatus('flowIpfsStatus', demo ? 'cached' : 'unknown', demo ? 'warn' : 'off');
  }
}

window.addEventListener('DOMContentLoaded', refreshOverviewFlow);
window.addEventListener('caac-demo-mode-change', refreshOverviewFlow);
