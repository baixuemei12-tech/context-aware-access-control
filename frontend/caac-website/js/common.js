/* ============================================================
   CAAC System — Common JavaScript
   Shared across all pages: auth, utils, constants
   ============================================================ */

const GATEWAY_URL = (() => {
  if (typeof window.CAAC_GATEWAY_URL === 'string') {
    return window.CAAC_GATEWAY_URL.trim().replace(/\/+$/, '');
  }
  const host = (window.location && window.location.hostname) ? window.location.hostname : 'localhost';
  const protocol = (window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:'))
    ? window.location.protocol
    : 'http:';
  if (host.endsWith('.trycloudflare.com')) {
    return `${protocol}//${host}`;
  }
  return '';
})();
const ROLE_LABELS = { 1: 'Junior', 2: 'Staff', 3: 'Senior', 4: 'Manager', 5: 'Administrator' };
const S_LABELS = { 1: 'Public', 2: 'Internal', 3: 'Confidential', 4: 'Restricted', 5: 'Top Secret' };
const CAAC_CSRF_COOKIE = 'caac_csrf';
const CAAC_CSRF_HEADER = 'X-CAAC-CSRF';
const PERF_MODE_KEY = 'caac_perf_mode';
const PERF_MODES = ['smooth', 'lite', 'balanced', 'full'];
const PERF_MODE_LABELS = {
  smooth: 'SMTH',
  lite: 'LITE',
  balanced: 'BAL',
  full: 'FULL'
};

const CAAC_PERF = (() => {
  const mq = query => window.matchMedia && window.matchMedia(query).matches;
  const validModes = new Set(PERF_MODES);
  const params = new URLSearchParams(window.location.search || '');
  const requested = (params.get('perf') || '').toLowerCase();
  let saved = '';
  try { saved = (localStorage.getItem(PERF_MODE_KEY) || '').toLowerCase(); } catch {}

  const reduceMotion = mq('(prefers-reduced-motion: reduce)');
  const coarsePointer = mq('(any-pointer: coarse)');
  const smallScreen = mq('(max-width: 720px)');
  const tinyScreen = mq('(max-width: 420px)');
  const lowMemory = !!(navigator.deviceMemory && navigator.deviceMemory <= 4);
  const lowConcurrency = !!(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const saveData = !!(navigator.connection && navigator.connection.saveData);

  let mode = validModes.has(requested) ? requested : (validModes.has(saved) ? saved : '');
  if (!mode) {
    mode = (reduceMotion || saveData || tinyScreen || (smallScreen && coarsePointer) || (lowMemory && lowConcurrency))
      ? 'lite'
      : 'balanced';
  }
  if (validModes.has(requested)) {
    try { localStorage.setItem(PERF_MODE_KEY, mode); } catch {}
  }

  const perf = {
    mode,
    reduceMotion,
    coarsePointer,
    smallScreen,
    tinyScreen,
    lowMemory,
    lowConcurrency,
    saveData,
    isSmooth: mode === 'smooth',
    isLite: mode === 'lite' || mode === 'smooth',
    isBalanced: mode === 'balanced',
    isFull: mode === 'full'
  };
  perf.targetFps = perf.isSmooth ? 20 : (perf.isLite ? 24 : (perf.isFull ? 60 : 36));
  document.documentElement.setAttribute('data-perf-mode', mode);
  window.CAAC_PERF = perf;
  return perf;
})();

let currentUser = null;

// ================================================================
// THEME MANAGEMENT
// ================================================================
const THEME_KEY = 'caac_theme';
const DEMO_MODE_KEY = 'caac_demo_mode';
const VISUAL_MODE_KEY = 'caac_visual_mode';

function preferredTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  if (saved === 'light' || saved === 'dark' || saved === 'cyber') return saved;
  return 'dark';
}

function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  syncThemeToggleLabels(next);
  window.dispatchEvent(new CustomEvent('caac-theme-change', { detail: { theme: next } }));
}

function syncThemeToggleLabels(theme) {
  const activeTheme = theme || document.documentElement.getAttribute('data-theme') || preferredTheme();
  const cyberActive = document.documentElement.getAttribute('data-visual-mode') === 'cyber';
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    if (cyberActive) {
      btn.textContent = 'LIGHT';
      btn.setAttribute('aria-label', 'Exit cyberpunk mode and switch to light theme');
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.add('exits-cyber');
      return;
    }
    btn.textContent = activeTheme === 'light' ? 'Dark' : 'Light';
    btn.setAttribute('aria-label', 'Switch to ' + (activeTheme === 'light' ? 'dark' : 'light') + ' theme');
    btn.setAttribute('aria-pressed', activeTheme === 'light' ? 'true' : 'false');
    btn.classList.remove('exits-cyber');
  });
}

function toggleTheme() {
  if (currentVisualMode() === 'cyber') {
    setVisualMode('standard');
    setTheme('light');
    return;
  }
  const current = document.documentElement.getAttribute('data-theme') || preferredTheme();
  setTheme(current === 'light' ? 'dark' : 'light');
}

function installThemeToggle() {
  if (document.querySelector('[data-theme-toggle]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';
  btn.setAttribute('data-theme-toggle', '');
  btn.onclick = toggleTheme;
  document.body.appendChild(btn);
  setTheme(document.documentElement.getAttribute('data-theme') || preferredTheme());
}

document.documentElement.setAttribute('data-theme', preferredTheme());
window.addEventListener('DOMContentLoaded', installThemeToggle);

function currentVisualMode() {
  try { return localStorage.getItem(VISUAL_MODE_KEY) === 'cyber' ? 'cyber' : 'standard'; } catch { return 'standard'; }
}

function setVisualMode(mode) {
  const prev = document.documentElement.getAttribute('data-visual-mode') || 'standard';
  const next = mode === 'cyber' ? 'cyber' : 'standard';
  if (next === 'cyber') {
    document.documentElement.setAttribute('data-visual-mode', 'cyber');
  } else {
    document.documentElement.removeAttribute('data-visual-mode');
  }
  try { localStorage.setItem(VISUAL_MODE_KEY, next); } catch {}
  document.querySelectorAll('[data-cyber-toggle]').forEach(btn => {
    const active = next === 'cyber';
    btn.textContent = active ? 'NIGHT' : 'CYBR';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.setAttribute('aria-label', active ? 'Disable cyberpunk mode' : 'Enable cyberpunk mode');
  });
  syncThemeToggleLabels();
  // JACK_IN flash on actual mode change (cosmetic; ignored under reduced motion)
  if (prev !== next && document.body) {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      document.body.classList.add('cb-jack-flash');
      setTimeout(() => document.body.classList.remove('cb-jack-flash'), 750);
    }
  }
  window.dispatchEvent(new CustomEvent('caac-visual-mode-change', { detail: { mode: next } }));
  // Tell visuals.js to re-sample CSS vars so the constellation picks up
  // cyan/yellow when entering cyber and reverts cleanly when leaving.
  window.dispatchEvent(new CustomEvent('caac-theme-change', {
    detail: { theme: document.documentElement.getAttribute('data-theme') || 'dark', visualMode: next }
  }));
}

function toggleCyberMode() {
  setVisualMode(currentVisualMode() === 'cyber' ? 'standard' : 'cyber');
}

function installCyberModeToggle() {
  if (document.querySelector('[data-cyber-toggle]')) {
    setVisualMode(currentVisualMode());
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cyber-toggle';
  btn.setAttribute('data-cyber-toggle', '');
  btn.onclick = toggleCyberMode;
  document.body.appendChild(btn);
  setVisualMode(currentVisualMode());
}

setVisualMode(currentVisualMode());
window.addEventListener('DOMContentLoaded', installCyberModeToggle);

// ================================================================
// DEMO MODE AND PAGE TRANSITIONS
// ================================================================
function isDemoMode() {
  try { return localStorage.getItem(DEMO_MODE_KEY) === 'true'; } catch { return false; }
}

function setDemoMode(enabled) {
  const next = !!enabled;
  try { localStorage.setItem(DEMO_MODE_KEY, next ? 'true' : 'false'); } catch {}
  document.body.classList.toggle('demo-mode', next);
  document.documentElement.classList.toggle('demo-mode', next);
  document.querySelectorAll('[data-demo-toggle]').forEach(btn => {
    btn.textContent = next ? 'Demo on' : 'Demo off';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
  });
  window.dispatchEvent(new CustomEvent('caac-demo-mode-change', { detail: { enabled: next } }));
}

function toggleDemoMode() {
  setDemoMode(!isDemoMode());
}

function installDemoModeToggle() {
  if (document.querySelector('[data-demo-toggle]')) {
    setDemoMode(isDemoMode());
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'demo-toggle';
  btn.setAttribute('data-demo-toggle', '');
  btn.onclick = toggleDemoMode;
  document.body.appendChild(btn);
  setDemoMode(isDemoMode());
}

function normalizePerfMode(mode) {
  return PERF_MODES.includes(mode) ? mode : 'balanced';
}

function perfTargetFps(mode) {
  if (mode === 'smooth') return 20;
  if (mode === 'lite') return 24;
  if (mode === 'full') return 60;
  return 36;
}

function syncPerfModeButtons(mode) {
  const current = normalizePerfMode(mode || document.documentElement.getAttribute('data-perf-mode') || CAAC_PERF.mode);
  document.querySelectorAll('[data-perf-toggle]').forEach(btn => {
    btn.textContent = 'Perf ' + PERF_MODE_LABELS[current];
    btn.setAttribute('aria-label', 'Performance mode: ' + current + '. Click to switch.');
    btn.setAttribute('title', 'Performance mode: ' + current + '. Click to switch to the next mode.');
  });
}

function setPerfMode(mode, options = {}) {
  const next = normalizePerfMode(mode);
  try { localStorage.setItem(PERF_MODE_KEY, next); } catch {}
  document.documentElement.setAttribute('data-perf-mode', next);
  if (window.CAAC_PERF) {
    window.CAAC_PERF.mode = next;
    window.CAAC_PERF.isSmooth = next === 'smooth';
    window.CAAC_PERF.isLite = next === 'lite' || next === 'smooth';
    window.CAAC_PERF.isBalanced = next === 'balanced';
    window.CAAC_PERF.isFull = next === 'full';
    window.CAAC_PERF.targetFps = perfTargetFps(next);
  }
  syncPerfModeButtons(next);
  window.dispatchEvent(new CustomEvent('caac-perf-mode-change', { detail: { mode: next } }));
  if (options.reload) {
    document.querySelectorAll('[data-perf-toggle]').forEach(btn => {
      btn.disabled = true;
      btn.textContent = 'Perf ' + PERF_MODE_LABELS[next];
    });
    setTimeout(() => window.location.reload(), 120);
  }
}

function togglePerfMode() {
  const current = normalizePerfMode(document.documentElement.getAttribute('data-perf-mode') || CAAC_PERF.mode);
  const next = PERF_MODES[(PERF_MODES.indexOf(current) + 1) % PERF_MODES.length];
  setPerfMode(next, { reload: true });
}

function installPerfModeToggle() {
  if (document.querySelector('[data-perf-toggle]')) {
    syncPerfModeButtons();
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'perf-toggle';
  btn.setAttribute('data-perf-toggle', '');
  btn.onclick = togglePerfMode;
  document.body.appendChild(btn);
  syncPerfModeButtons();
}

function installPageTransitions() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.body.classList.add('caac-page-ready');
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.hash) return;
    event.preventDefault();
    document.body.classList.add('caac-page-leaving');
    setTimeout(() => { window.location.href = url.href; }, 140);
  });
}

const DEFENSE_STEPS = [
  {
    page: 'overview.html',
    stage: 'Architecture',
    title: '1. System entry point',
    summary: 'Start with the browser console, gateway, oracle, Fabric PDP, and encrypted IPFS storage.',
    detail: 'Use this step to explain the overall CAAC request path before showing any access request.'
  },
  {
    page: 'index.html',
    stage: 'Context',
    title: '2. Context collection',
    summary: 'Show C_S, C_E, C_R, and C_O before requesting access.',
    detail: 'Point at the Risk inspector: it connects subject trust, device/network scores, sensitivity, threshold, and RGCA tier.'
  },
  {
    page: 'index.html',
    stage: 'Decision',
    title: '3. Access decision',
    summary: 'Run a request and explain DT_score, P_eff, risk margin, and PERMIT/DENY.',
    detail: 'If Fabric is offline, turn Demo Mode on and use Scenario Demo for the visual path.'
  },
  {
    page: 'scenarios.html',
    stage: 'Walkthrough',
    title: '4. Scenario walkthrough',
    summary: 'Animate clean permit, deny, revocation, budget exhaustion, TOTP, and VPN/WiFi-switch cases.',
    detail: 'This is the safest defense page because it stays presentation-ready without chaincode.'
  },
  {
    page: 'admin.html',
    stage: 'Operations',
    title: '5. Admin evidence',
    summary: 'Show users, registry, anomalies, audit trail, and security operations summary.',
    detail: 'Use quick filters to jump directly to pending files, high sensitivity, low trust, deny/revoke, or anomalies.'
  },
  {
    page: 'profile.html',
    stage: 'Account',
    title: '6. User security posture',
    summary: 'Close with trust, role, verification, 2FA, device, network, uploaded files, and access history.',
    detail: 'This connects the algorithm to a human account view.'
  }
];

function currentDefensePage() {
  const page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  return page || 'index.html';
}

function defenseStepIndexForPage() {
  const page = currentDefensePage();
  const idx = DEFENSE_STEPS.findIndex(step => step.page === page);
  return idx >= 0 ? idx : 0;
}

function buildDefenseStepHtml(step, idx, activeIdx) {
  const state = idx < activeIdx ? 'done' : idx === activeIdx ? 'active' : '';
  return `<button type="button" class="defense-step ${state}" data-defense-step="${idx}">
    <span>${idx + 1}</span>
    <strong>${escapeHtml(step.stage)}</strong>
    <small>${escapeHtml(step.page)}</small>
  </button>`;
}

function setDefenseStep(index) {
  const safeIndex = Math.max(0, Math.min(DEFENSE_STEPS.length - 1, Number(index) || 0));
  const step = DEFENSE_STEPS[safeIndex];
  const shell = document.getElementById('defensePresenter');
  if (!shell) return;
  shell.dataset.step = String(safeIndex);
  shell.querySelector('[data-defense-title]').textContent = step.title;
  shell.querySelector('[data-defense-summary]').textContent = step.summary;
  shell.querySelector('[data-defense-detail]').textContent = step.detail;
  shell.querySelector('[data-defense-progress]').style.width = (((safeIndex + 1) / DEFENSE_STEPS.length) * 100).toFixed(0) + '%';
  shell.querySelector('[data-defense-count]').textContent = `${safeIndex + 1} / ${DEFENSE_STEPS.length}`;
  shell.querySelector('[data-defense-steps]').innerHTML = DEFENSE_STEPS.map((s, i) => buildDefenseStepHtml(s, i, safeIndex)).join('');
  shell.querySelectorAll('[data-defense-step]').forEach(btn => btn.addEventListener('click', () => setDefenseStep(btn.dataset.defenseStep)));
  const nav = shell.querySelector('[data-defense-open-page]');
  nav.textContent = currentDefensePage() === step.page ? 'Current page' : `Open ${step.page}`;
  nav.disabled = currentDefensePage() === step.page;
  nav.onclick = () => { window.location.href = step.page; };
  const prev = shell.querySelector('[data-defense-prev]');
  const next = shell.querySelector('[data-defense-next]');
  prev.disabled = safeIndex === 0;
  next.disabled = safeIndex === DEFENSE_STEPS.length - 1;
}

function openDefensePresenter() {
  const shell = document.getElementById('defensePresenter');
  if (!shell) return;
  shell.classList.add('open');
  shell.setAttribute('aria-hidden', 'false');
  setDefenseStep(defenseStepIndexForPage());
}

function closeDefensePresenter() {
  const shell = document.getElementById('defensePresenter');
  if (!shell) return;
  shell.classList.remove('open');
  shell.setAttribute('aria-hidden', 'true');
}

function installDefensePresenter() {
  if (document.getElementById('defensePresenter')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'defense-toggle';
  btn.textContent = 'Defense';
  btn.setAttribute('aria-label', 'Open defense presentation guide');
  btn.onclick = openDefensePresenter;
  document.body.appendChild(btn);

  const shell = document.createElement('div');
  shell.className = 'defense-presenter';
  shell.id = 'defensePresenter';
  shell.setAttribute('aria-hidden', 'true');
  shell.innerHTML = `
    <div class="defense-backdrop" data-defense-close></div>
    <section class="defense-panel" role="dialog" aria-modal="true" aria-label="Defense presentation guide">
      <div class="defense-panel-head">
        <div>
          <div class="defense-kicker">CAAC defense guide</div>
          <h2 data-defense-title></h2>
        </div>
        <button type="button" class="defense-close" data-defense-close aria-label="Close defense guide">x</button>
      </div>
      <div class="defense-progress"><span data-defense-progress></span></div>
      <div class="defense-body">
        <div class="defense-step-list" data-defense-steps></div>
        <div class="defense-card">
          <div class="defense-count" data-defense-count></div>
          <p class="defense-summary" data-defense-summary></p>
          <p class="defense-detail" data-defense-detail></p>
          <div class="defense-actions">
            <button type="button" class="btn-sm" data-defense-prev>Previous</button>
            <button type="button" class="btn-sm" data-defense-next>Next</button>
            <button type="button" class="btn-sm btn-activate" data-defense-open-page>Open page</button>
          </div>
        </div>
      </div>
    </section>`;
  document.body.appendChild(shell);
  shell.querySelectorAll('[data-defense-close]').forEach(el => el.addEventListener('click', closeDefensePresenter));
  shell.querySelector('[data-defense-prev]').addEventListener('click', () => setDefenseStep(Number(shell.dataset.step || '0') - 1));
  shell.querySelector('[data-defense-next]').addEventListener('click', () => setDefenseStep(Number(shell.dataset.step || '0') + 1));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDefensePresenter();
  });
  setDefenseStep(defenseStepIndexForPage());
}

window.addEventListener('DOMContentLoaded', () => {
  installSharedMenu();
  installDemoModeToggle();
  installDefensePresenter();
  installPerfModeToggle();
  installPageTransitions();
});

// ================================================================
// TOKEN MANAGEMENT
// ================================================================
function clearAuthStorage() {
  sessionStorage.removeItem('caac_token');
  sessionStorage.removeItem('caac_user');
  sessionStorage.removeItem(CAAC_CSRF_COOKIE);
}

function setAuthSession(token, user, csrfToken) {
  // HttpOnly cookie auth is the primary browser path. Keep caac_token out of
  // sessionStorage; getToken() remains only for old sessions/API fallback.
  sessionStorage.removeItem('caac_token');
  if (csrfToken) sessionStorage.setItem(CAAC_CSRF_COOKIE, csrfToken);
  if (user) {
    const sessionUser = { ...user, _isAdmin: !!user._isAdmin || user.rSub === 5 };
    sessionStorage.setItem('caac_user', JSON.stringify(sessionUser));
    syncSharedMenu(sessionUser, sessionUser._isAdmin);
  }
}

function getToken() {
  return sessionStorage.getItem('caac_token');
}

function getCookie(name) {
  const prefix = encodeURIComponent(name) + '=';
  return (document.cookie || '').split(';').map(v => v.trim()).reduce((found, part) => {
    if (found) return found;
    return part.startsWith(prefix) ? decodeURIComponent(part.slice(prefix.length)) : '';
  }, '');
}

function getCsrfToken() {
  return sessionStorage.getItem(CAAC_CSRF_COOKIE) || getCookie(CAAC_CSRF_COOKIE);
}

function hasAuthSession() {
  return !!getToken() || !!getCookie(CAAC_CSRF_COOKIE) || !!sessionStorage.getItem('caac_user');
}

function authHeaders(json) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  const csrf = getCsrfToken();
  if (csrf) h[CAAC_CSRF_HEADER] = csrf;
  return h;
}

function caacTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isCaacApiRequest(input) {
  try {
    const rawUrl = input && typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input || '');
    const url = new URL(rawUrl, window.location.origin);
    const gatewayOrigin = GATEWAY_URL ? new URL(GATEWAY_URL, window.location.origin).origin : window.location.origin;
    return url.origin === gatewayOrigin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

async function ensureCsrfToken() {
  const existing = getCsrfToken();
  if (existing) return existing;
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/csrf', {
      headers: authHeaders(false),
      cache: 'no-store',
      signal: caacTimeoutSignal(3500)
    });
    if (!res.ok) return '';
    const data = await res.json();
    if (data && data.csrfToken) {
      sessionStorage.setItem(CAAC_CSRF_COOKIE, data.csrfToken);
      return data.csrfToken;
    }
  } catch {}
  return '';
}

(function installCaacFetchHardening() {
  if (!window.fetch || window.__caacFetchHardened) return;
  const nativeFetch = window.fetch.bind(window);
  window.__caacFetchHardened = true;
  window.fetch = function(input, init = {}) {
    if (!isCaacApiRequest(input)) {
      return nativeFetch(input, init);
    }

    const options = { ...init, credentials: 'include' };
    const headers = new Headers(input && typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    if (init && init.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    const csrf = getCsrfToken();
    if (csrf && !headers.has(CAAC_CSRF_HEADER)) {
      headers.set(CAAC_CSRF_HEADER, csrf);
    }

    // Legacy bearer fallback only. New browser sessions use HttpOnly cookies,
    // so no bearer token is stored after login.
    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }

    options.headers = headers;
    return nativeFetch(input, options);
  };
})();

// ================================================================
// LIVE EVENTS
// ================================================================
function connectCaacEvents(handler, options = {}) {
  if (!hasAuthSession() || typeof fetch !== 'function' || typeof ReadableStream === 'undefined') {
    return { close() {} };
  }

  let closed = false;
  let retryMs = 1000;
  let controller = null;
  const maxRetryMs = options.maxRetryMs || 15000;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function dispatchEventBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const dataLines = [];
    lines.forEach(line => {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    });
    if (dataLines.length === 0) return;
    let payload = dataLines.join('\n');
    try { payload = JSON.parse(payload); } catch {}
    try { handler({ event: eventName, payload }); } catch (err) { console.warn('CAAC live event handler failed', err); }
  }

  async function listen() {
    while (!closed) {
      controller = new AbortController();
      try {
        const res = await fetch(GATEWAY_URL + '/api/events/stream', {
          headers: authHeaders(false),
          cache: 'no-store',
          signal: controller.signal
        });
        if (!res.ok || !res.body) throw new Error('live stream HTTP ' + res.status);
        retryMs = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || '';
          blocks.forEach(dispatchEventBlock);
        }
      } catch (err) {
        if (closed) return;
      }
      await sleep(retryMs);
      retryMs = Math.min(maxRetryMs, Math.round(retryMs * 1.8));
    }
  }

  listen();
  return {
    close() {
      closed = true;
      if (controller) controller.abort();
    }
  };
}

// ================================================================
// AUTH CHECK — redirects to login if not authenticated
// ================================================================
async function checkAuth() {
  if (!hasAuthSession()) {
    window.location.replace('overview.html');
    return false;
  }

  try {
    const cached = sessionStorage.getItem('caac_user');
    if (cached && !currentUser) {
      try {
        currentUser = JSON.parse(cached);
        currentUser._isAdmin = currentUser.rSub === 5;
      } catch {}
    }
    const res = await fetch(GATEWAY_URL + '/api/auth/me', {
      headers: authHeaders(false),
      cache: 'no-store',
      signal: caacTimeoutSignal(4500)
    });
    if (!res.ok) {
      clearAuthStorage();
      window.location.replace('overview.html');
      return false;
    }
    const data = await res.json();
    if (!data || !data.user) throw new Error('Invalid auth response');
    currentUser = data.user;
    currentUser._isAdmin = !!data.isAdmin || currentUser.rSub === 5;
    setAuthSession(getToken(), currentUser);
    await ensureCsrfToken();
    syncSharedMenu(currentUser, currentUser._isAdmin);
    return true;
  } catch {
    clearAuthStorage();
    window.location.replace('overview.html');
    return false;
  }
}

// ================================================================
// DISPLAY USER PROFILE IN HEADER
// ================================================================
function displayUserInHeader(user, isAdmin) {
  const bar = document.getElementById('userBar');
  if (!bar) return;
  bar.style.display = 'flex';

  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (nameEl) nameEl.textContent = user.displayName || user.username;
  if (roleEl) roleEl.textContent = (ROLE_LABELS[user.rSub] || 'Role ' + user.rSub);

  if (isAdmin) {
    const adminBtn = document.getElementById('btnAdminPanel');
    if (adminBtn) adminBtn.style.display = 'inline-block';
  }
  syncSharedMenu(user, isAdmin);
}

// ================================================================
// LOGOUT
// ================================================================
function doLogout() {
  fetch(GATEWAY_URL + '/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(false)
  }).catch(() => {});
  clearAuthStorage();
  currentUser = null;
  window.location.href = 'overview.html';
}

// ================================================================
// SLIDE MENU
// ================================================================
function readCachedUser() {
  try {
    const cached = sessionStorage.getItem('caac_user');
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function menuIcon(name) {
  const paths = {
    dashboard: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M9 15h6"/>',
    profile: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
    messages: '<path d="M4 6h16v11H7l-3 3z"/><path d="M8 10h8"/><path d="M8 14h5"/>',
    overview: '<path d="M4 5h16v14H4z"/><path d="M8 9h8"/><path d="M8 13h5"/><path d="M8 17h7"/>',
    scenarios: '<path d="M6 17V7h5"/><path d="M13 7h5v10"/><circle cx="6" cy="17" r="2"/><circle cx="11" cy="7" r="2"/><circle cx="18" cy="17" r="2"/>',
    admin: '<path d="M12 3l7 3v5c0 5-3.2 8.1-7 10-3.8-1.9-7-5-7-10V6z"/><path d="M9.5 12l1.7 1.7 3.8-4"/>',
    login: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 4h5v16h-5"/>',
    logout: '<path d="M14 8V5a2 2 0 0 0-2-2H5v18h7a2 2 0 0 0 2-2v-3"/><path d="M9 12h12"/><path d="M17 8l4 4-4 4"/>'
  };
  return '<span class="pl-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + (paths[name] || paths.overview) + '</svg></span>';
}

function navLinkHtml({ href, icon, label, id, hidden, badge }) {
  const idAttr = id ? ' id="' + id + '"' : '';
  const hiddenStyle = hidden ? ' style="display:none"' : '';
  const badgeHtml = badge ? ' <span class="pl-badge" id="' + badge + '" style="display:none">0</span>' : '';
  return '<a href="' + href + '" class="panel-link"' + idAttr + hiddenStyle + '>' + menuIcon(icon) + '<span>' + label + '</span>' + badgeHtml + '</a>';
}

function buttonLinkHtml({ icon, label, danger, onClick }) {
  return '<button type="button" class="panel-link' + (danger ? ' danger' : '') + '" onclick="' + onClick + '">' + menuIcon(icon) + '<span>' + label + '</span></button>';
}

function buildMenuNav(user, isAdmin) {
  const hasToken = hasAuthSession();
  const authed = hasToken && !!user;
  const items = [
    navLinkHtml({ href: 'index.html', icon: 'dashboard', label: 'Dashboard' }),
    authed ? navLinkHtml({ href: 'profile.html', icon: 'profile', label: 'My Profile' }) : '',
    authed && !isAdmin ? navLinkHtml({ href: 'messages.html', icon: 'messages', label: 'Messages', id: 'panelMsgLink', badge: 'panelMsgBadge' }) : '',
    navLinkHtml({ href: 'overview.html', icon: 'overview', label: 'System Overview' }),
    navLinkHtml({ href: 'scenarios.html', icon: 'scenarios', label: 'Scenario Demo' }),
    authed && isAdmin ? navLinkHtml({ href: 'admin.html', icon: 'admin', label: 'Admin Panel', id: 'panelAdminLink' }) : '',
    authed ? buttonLinkHtml({ icon: 'logout', label: 'Logout', danger: true, onClick: 'doLogout()' }) : buttonLinkHtml({ icon: 'login', label: 'Login', onClick: "window.location.href='login.html'" })
  ].filter(Boolean);
  return items.join('');
}

function installSharedMenuButton() {
  if (document.getElementById('menuBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-btn';
  btn.id = 'menuBtn';
  btn.setAttribute('aria-label', 'Open navigation menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'slidePanel');
  btn.innerHTML = '<span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="menu-badge" id="menuBadge"></span>';
  btn.addEventListener('click', toggleMenu);

  const header = document.querySelector('header');
  const target = document.querySelector('.hdr-right') || document.querySelector('.hdr-links') || header;
  if (target) {
    target.appendChild(btn);
    return;
  }

  const mount = document.createElement('div');
  mount.className = 'global-menu-shell';
  mount.appendChild(btn);
  document.body.appendChild(mount);
}

function installSharedMenuPanel() {
  if (document.getElementById('slidePanel')) return;
  const overlay = document.createElement('div');
  overlay.className = 'panel-overlay';
  overlay.id = 'panelOverlay';
  overlay.addEventListener('click', toggleMenu);
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.className = 'slide-panel';
  panel.id = 'slidePanel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-user">
        <div class="panel-avatar" id="panelAvatar" style="background:var(--accent2);color:var(--accent)">CA</div>
        <div>
          <div style="font-size:13px;font-weight:600" id="panelName">CAAC Console</div>
          <div style="font-size:10px;font-family:var(--mono);color:var(--text3)" id="panelRole">navigation</div>
        </div>
      </div>
    </div>
    <div class="panel-nav"></div>`;
  document.body.appendChild(panel);
}

function installSharedMenu() {
  installSharedMenuButton();
  installSharedMenuPanel();
  const cachedUser = currentUser || readCachedUser();
  const isAdmin = !!(cachedUser && (cachedUser._isAdmin || cachedUser.rSub === 5));
  syncSharedMenu(cachedUser, isAdmin);
}

function syncSharedMenu(user, isAdmin) {
  const nav = document.querySelector('#slidePanel .panel-nav');
  if (!nav) return;
  const cachedUser = user || readCachedUser();
  const admin = !!(isAdmin || (cachedUser && (cachedUser._isAdmin || cachedUser.rSub === 5)));
  const hasToken = hasAuthSession();

  nav.innerHTML = buildMenuNav(hasToken ? cachedUser : null, admin);

  const avatar = document.getElementById('panelAvatar');
  const name = document.getElementById('panelName');
  const role = document.getElementById('panelRole');
  if (hasToken && cachedUser) {
    const displayName = cachedUser.displayName || cachedUser.username || 'User';
    if (avatar) avatar.textContent = displayName.slice(0, 1).toUpperCase();
    if (name) name.textContent = displayName;
    if (role) role.textContent = ROLE_LABELS[cachedUser.rSub] || 'Role ' + cachedUser.rSub;
  } else {
    if (avatar) avatar.textContent = 'CA';
    if (name) name.textContent = 'CAAC Console';
    if (role) role.textContent = 'navigation';
  }
}

function toggleMenu() {
  const panel = document.getElementById('slidePanel');
  const overlay = document.getElementById('panelOverlay');
  const btn = document.getElementById('menuBtn');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  panel.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
  if (overlay) overlay.classList.toggle('open', !isOpen);
  if (btn) {
    btn.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  }
}

function updateMenuBadge(count) {
  const badge = document.getElementById('menuBadge');
  if (!badge) return;
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count;
  } else {
    badge.style.display = 'none';
  }
}

// ================================================================
// TOAST NOTIFICATION
// ================================================================
function toast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show toast-' + (type || 'ok');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function caacVisibleInterval(fn, ms) {
  return setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
}

// ================================================================
// UTILS
// ================================================================
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ================================================================
// TRIGRAM FUZZY SEARCH — reusable across all pages
// ================================================================
function trigrams(str) {
  str = str.toLowerCase().trim();
  if (str.length < 3) return new Set([str]);
  const set = new Set();
  for (let i = 0; i <= str.length - 3; i++) set.add(str.substring(i, i + 3));
  return set;
}

function trigramScore(query, target) {
  if (!query || !target) return 0;
  const qTri = trigrams(query);
  const tTri = trigrams(target);
  let matches = 0;
  qTri.forEach(t => { if (tTri.has(t)) matches++; });
  return qTri.size > 0 ? matches / qTri.size : 0;
}

function fuzzyMatch(query, ...fields) {
  if (!query || query.length < 2) return true;
  const q = query.toLowerCase();
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q)) return true;
  }
  for (const f of fields) {
    if (f && trigramScore(q, f) >= 0.3) return true;
  }
  return false;
}
