/* ============================================================
   CAAC System — Automatic Context Collection
   Gathers: network, device, screen, timezone, language, touch
   ============================================================ */

let rawContext = {};

function collectContext() {
  const now = new Date();

  let netType = 'unknown';
  if (navigator.connection) {
    const physicalType = navigator.connection.type;
    const effectiveType = navigator.connection.effectiveType;
    if (physicalType && physicalType !== 'unknown') {
      netType = physicalType;
    } else if (effectiveType) {
      const isDesktop = !('ontouchstart' in window) && navigator.maxTouchPoints === 0;
      const downlink = navigator.connection.downlink || 0;
      if (isDesktop && effectiveType === '4g' && downlink >= 50) {
        netType = 'ethernet';
      } else if (isDesktop && effectiveType === '4g') {
        netType = 'wifi';
      } else {
        netType = effectiveType;
      }
    }
  }

  rawContext = {
    userAgent:    navigator.userAgent,
    timestamp:    now.toISOString(),
    timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
    networkType:  netType,
    screenWidth:  Math.round(screen.width * (window.devicePixelRatio || 1)),
    screenHeight: Math.round(screen.height * (window.devicePixelRatio || 1)),
    platform:     navigator.platform || navigator.userAgentData?.platform || 'unknown',
    language:     navigator.language,
    colorDepth:   screen.colorDepth,
    touchSupport: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  };

  // Update UI elements if they exist
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ctx-time', now.toLocaleString());
  set('ctx-tz', rawContext.timezone);
  const dl = navigator.connection ? (navigator.connection.downlink || '?') : '?';
  set('ctx-net', rawContext.networkType + ' (' + dl + ' Mbps)');
  set('ctx-plat', rawContext.platform);
  const uaEl = document.getElementById('ctx-ua');
  if (uaEl) { uaEl.textContent = rawContext.userAgent.substring(0, 60) + '...'; uaEl.title = rawContext.userAgent; }
  set('ctx-screen', rawContext.screenWidth + ' x ' + rawContext.screenHeight
    + (window.devicePixelRatio !== 1 ? ' (' + Math.round(window.devicePixelRatio * 100) + '% DPI)' : ''));
  set('ctx-lang', rawContext.language);
  set('ctx-color', rawContext.colorDepth + '-bit');
  set('ctx-touch', rawContext.touchSupport ? 'yes (mobile)' : 'no (desktop)');

  if (typeof log === 'function') {
    log('info', 'Context refreshed: ' + rawContext.networkType + ', '
      + rawContext.platform + ', ' + rawContext.screenWidth + 'x' + rawContext.screenHeight);
  }
}

async function detectIp() {
  const el = document.getElementById('ctx-ip');
  if (!el) return;
  el.textContent = 'detecting...';
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(1200) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && data.ip) {
      el.textContent = data.ip;
      return;
    }
  } catch {}

  try {
    const res = await fetch(GATEWAY_URL + '/api/files/context/client-ip', { headers: authHeaders(false), signal: AbortSignal.timeout(1200) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const ip = data && data.ip ? data.ip : 'unknown';
    el.textContent = ip;
  } catch {
    el.textContent = 'unavailable';
  }
}
