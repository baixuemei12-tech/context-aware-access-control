/* ============================================================
   CAAC System — Dashboard Logic
   Requires: common.js, context.js loaded first
   ============================================================ */

// ====================================================================
// SERVER HEALTH CHECK
// ====================================================================
async function checkHealth() {
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  try {
    const res = await fetch(GATEWAY_URL + '/api/files/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      pill.classList.remove('offline');
      text.textContent = t('dash.gatewayStatus');
      pill.querySelector('.dot').classList.add('live');
      log('ok', 'Gateway connected');
      return true;
    }
  } catch {}
  pill.classList.add('offline');
  text.textContent = t('dash.gatewayOffline');
  pill.querySelector('.dot').classList.remove('live');
  log('err', 'Gateway unreachable');
  return false;
}

// ====================================================================
// LOG
// ====================================================================
function log(type, msg) {
  const area = document.getElementById('logArea');
  if (!area) return;
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  const cls = { info: 'log-info', ok: 'log-ok', err: 'log-err', warn: 'log-warn' }[type] || '';
  area.innerHTML += `<div><span class="log-time">[${time}]</span> <span class="${cls}">${escapeHtml(msg)}</span></div>`;
  area.scrollTop = area.scrollHeight;
}
function clearLog() {
  const area = document.getElementById('logArea');
  if (area) area.innerHTML = '';
}

// ====================================================================
// DISPLAY USER PROFILE ON DASHBOARD
// ====================================================================
function displayDashboardProfile(user, isAdmin) {
  displayUserInHeader(user, isAdmin);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('prof-user', user.username);
  set('prof-rsub', ROLE_LABELS[user.rSub] || '?');
  set('prof-tsub', user.tSub != null ? (user.tSub >= 0.8 ? 'High' : user.tSub >= 0.5 ? 'Medium' : 'Low') : '?');
  set('prof-bfreq', '1.0');
  set('prof-status', user.status || 'ACTIVE');

  // Populate slide panel
  const initial = (user.displayName || user.username || '?')[0].toUpperCase();
  set('panelAvatar', initial);
  set('panelName', user.displayName || user.username);
  set('panelRole', ROLE_LABELS[user.rSub] || '?');

  // Show messages link for non-admins, admin link for admins
  if (!isAdmin) {
    const msgLink = document.getElementById('panelMsgLink');
    if (msgLink) msgLink.style.display = 'flex';
  }

  // Show admin link in panel
  if (isAdmin) {
    const adminLink = document.getElementById('panelAdminLink');
    if (adminLink) adminLink.style.display = 'flex';
  }

  log('ok', 'Authenticated as ' + user.username);
  updateRiskInspectorFromSelection();
}

// ====================================================================
// RISK INSPECTOR
// ====================================================================
function setRiskText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function shortNumber(value, digits) {
  return value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits == null ? 3 : digits);
}

function tierFromMargin(margin) {
  if (margin == null || Number.isNaN(Number(margin))) return { label: 'pending', color: 'var(--text3)', poll: 'no session' };
  if (margin >= 0.3) return { label: 'LOW', color: 'var(--green)', poll: 'poll 4s' };
  if (margin >= 0.1) return { label: 'MED', color: 'var(--amber)', poll: 'poll 3s' };
  return { label: 'HIGH', color: 'var(--red)', poll: 'poll 2s' };
}

function selectedFileEntry() {
  const input = document.getElementById('in-file');
  const fileId = input ? input.value : '';
  return fileRegistry.find(f => f.fileId === fileId) || null;
}

function updateRiskMeter(margin) {
  const fill = document.getElementById('ri-margin-fill');
  const label = document.getElementById('ri-meter-label');
  if (margin == null || Number.isNaN(Number(margin))) {
    if (fill) {
      fill.style.width = '0%';
      fill.style.background = '';
    }
    if (label) label.textContent = t('ri.waiting');
    return;
  }
  const m = Number(margin);
  const pct = Math.max(0, Math.min(100, ((m + 0.1) / 0.6) * 100));
  if (fill) {
    fill.style.width = pct.toFixed(0) + '%';
    // 5.3.7: gradient fill keyed to the margin value itself, not just length.
    // Solid color at the bar's tip; smooth blend along the track.
    let stops;
    if (m < 0)         stops = 'linear-gradient(90deg, #ff5f87 0%, #e76f7c 100%)';   // deny: red
    else if (m < 0.1)  stops = 'linear-gradient(90deg, #ff5f87 0%, #ffa340 60%, #ffc857 100%)'; // high
    else if (m < 0.3)  stops = 'linear-gradient(90deg, #ffc857 0%, #d99a24 60%, #2fbf8f 100%)'; // med
    else               stops = 'linear-gradient(90deg, #2fbf8f 0%, #20b9ba 100%)';   // low: green
    fill.style.background = stops;
  }
  if (label) label.textContent = m >= 0 ? 'admitted' : 'denied';
}

function updateRiskExplainer(message, tone) {
  const el = document.getElementById('ri-explainer');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('ok', tone === 'ok');
  el.classList.toggle('warn', tone === 'warn');
  el.classList.toggle('err', tone === 'err');
}

function updateRiskInspectorFromSelection() {
  const entry = selectedFileEntry();
  if (currentUser) {
    setRiskText('ri-user', currentUser.username || '—');
    setRiskText('ri-role', ROLE_LABELS[currentUser.rSub] || ('role ' + currentUser.rSub));
    setRiskText('ri-trust', currentUser.tSub != null ? shortNumber(currentUser.tSub, 2) : '—');
  }
  if (entry) {
    setRiskText('ri-slevel', 'S' + entry.sLevel);
    setRiskText('ri-preq', entry.pReq != null ? shortNumber(entry.pReq, 2) : '—');
    const ruleCount = Array.isArray(entry.rules) ? entry.rules.length : 0;
    updateRiskExplainer(`Selected ${entry.fileId}. Sensitivity S${entry.sLevel}, base threshold ${entry.pReq ?? 'internal'}, ${ruleCount || 'no'} extra rule${ruleCount === 1 ? '' : 's'}. Request access to resolve DT_score and RGCA tier.`, 'warn');
  }
  if (rawContext && Object.keys(rawContext).length > 0) {
    setRiskText('ri-device', rawContext.platform ? rawContext.platform.split(' ')[0] : '—');
    setRiskText('ri-network', rawContext.networkType || '—');
  }
  setRiskText('ri-status', entry ? 'selected' : 'selection');
}

// ====================================================================
// RUNTIME TOPOLOGY BRIDGE
// Push subject_context + environment_context to the runtime canvas so
// hovering the user's node on the topology map shows live context values.
// No-op if runtime-monitor isn't on this page.
// ====================================================================
function publishContextToRuntime(data) {
  if (!window.CAAC_RUNTIME || typeof window.CAAC_RUNTIME.setUserContext !== 'function') return;
  const u = currentUser || {};
  const username = u.username || u.id || (data && data.username);
  if (!username) return;
  const userId = String(username).indexOf('subj-') === 0 ? username : ('subj-' + username);
  const scores = (data && data.resolvedScores) || {};
  const raw    = (data && data.rawContext)     || (typeof rawContext === 'object' ? rawContext : {});
  const screenStr = (raw.screenWidth && raw.screenHeight)
    ? raw.screenWidth + 'x' + raw.screenHeight
    : null;
  try {
    window.CAAC_RUNTIME.setUserContext(userId, {
      subject: {
        R:        u.rSub != null ? u.rSub : (u.role || u.R),
        T:        data && data.tSub != null ? data.tSub : u.tSub,
        L_trust:  scores.L_trust,
        D_sec:    scores.D_sec,
        DT_score: data && data.dtScore,
        N_status: scores.N_status
      },
      environment: {
        networkType: raw.networkType,
        ip:          raw.ip || raw.clientIp,
        platform:    raw.platform,
        timezone:    raw.timezone,
        screen:      screenStr,
        language:    raw.language
      }
    });
  } catch (_) { /* ignore — runtime canvas not loaded */ }
}

function updateRiskInspectorFromResult(data) {
  const scores = data.resolvedScores || {};
  const tier = tierFromMargin(data.riskMargin);
  setRiskText('ri-status', data.decision || 'evaluated');
  setRiskText('ri-trust', data.tSub != null ? shortNumber(data.tSub, 3) : (currentUser?.tSub != null ? shortNumber(currentUser.tSub, 2) : '—'));
  setRiskText('ri-device', scores.D_sec != null ? shortNumber(scores.D_sec, 3) : '—');
  setRiskText('ri-network', scores.N_status != null ? shortNumber(scores.N_status, 3) : '—');
  setRiskText('ri-preq', data.pReqEffective != null ? shortNumber(data.pReqEffective, 3) : (data.pReq != null ? shortNumber(data.pReq, 3) : '—'));
  setRiskText('ri-tier', tier.label);
  setRiskText('ri-delay', (tier.poll || 'poll ?') + (data.chunkDelay != null ? ' | delay ' + data.chunkDelay + 'ms' : ''));
  setRiskText('ri-margin', data.riskMargin != null ? (data.riskMargin >= 0 ? '+' : '') + shortNumber(data.riskMargin, 4) : '—');
  const tierEl = document.getElementById('ri-tier');
  if (tierEl) tierEl.style.color = tier.color;
  updateRiskMeter(data.riskMargin);
  if (data.decision === 'PERMIT') {
    const deliveryLabel = data.chunkDelay != null ? data.chunkDelay + 'ms chunk delay' : 'adaptive RGCA delivery';
    updateRiskExplainer(`PERMIT: DT_score ${shortNumber(data.dtScore, 3)} cleared P_eff ${shortNumber(data.pReqEffective, 3)}. Gateway may stream under ${tier.label} RGCA with ${deliveryLabel}.`, 'ok');
  } else if (data.decision === 'DENY') {
    updateRiskExplainer(`DENY: the margin is ${data.riskMargin != null ? shortNumber(data.riskMargin, 4) : 'unknown'}. No session is opened and no plaintext bytes are delivered.`, 'err');
  } else {
    updateRiskExplainer('The gateway returned a non-standard decision. Treat the flow as fail-closed for the demo.', 'warn');
  }
}

// ====================================================================
// FILE REGISTRY
// ====================================================================
let fileRegistry = [];
let _fileRegistryLoading = false;
let _fileRegistryLoadedOnce = false;
const FILE_REGISTRY_FALLBACK_REFRESH_MS = 30000;
let _dashboardLiveEvents = null;

const extIcons = {
  pdf: ['pdf', 'PDF'],
  doc: ['doc', 'DOC'], docx: ['doc', 'DOC'], odt: ['doc', 'ODT'],
  xls: ['xls', 'XLS'], xlsx: ['xls', 'XLS'], ods: ['xls', 'ODS'], csv: ['xls', 'CSV'],
  ppt: ['ppt', 'PPT'], pptx: ['ppt', 'PPT'],
  txt: ['text', 'TXT'], md: ['text', 'MD'], log: ['text', 'LOG'],
  png: ['image', 'PNG'], jpg: ['image', 'JPG'], jpeg: ['image', 'JPG'], gif: ['image', 'GIF'],
  svg: ['image', 'SVG'], webp: ['image', 'WEB'], bmp: ['image', 'BMP'], ico: ['image', 'ICO'], tiff: ['image', 'TIF'],
  json: ['data', 'JSON'], xml: ['data', 'XML'], yaml: ['data', 'YML'], yml: ['data', 'YML'], sql: ['data', 'SQL'],
  html: ['code', 'HTML'], htm: ['code', 'HTML'], css: ['code', 'CSS'], js: ['code', 'JS'], ts: ['code', 'TS'],
  py: ['code', 'PY'], java: ['code', 'JAVA'], c: ['code', 'C'], cpp: ['code', 'C++'], sh: ['code', 'SH'], bash: ['code', 'SH'],
  zip: ['archive', 'ZIP'], tar: ['archive', 'TAR'], gz: ['archive', 'GZ'], bz2: ['archive', 'BZ'], '7z': ['archive', '7Z'], rar: ['archive', 'RAR'],
  mp3: ['audio', 'MP3'], wav: ['audio', 'WAV'], ogg: ['audio', 'OGG'], flac: ['audio', 'FLAC'], aac: ['audio', 'AAC'], m4a: ['audio', 'M4A'],
  mp4: ['video', 'MP4'], webm: ['video', 'WEBM'], avi: ['video', 'AVI'], mov: ['video', 'MOV'], mkv: ['video', 'MKV'],
  ttf: ['file', 'TTF'], otf: ['file', 'OTF'], woff: ['file', 'FONT'], woff2: ['file', 'FONT']
};

function fileIconHtml(fileId) {
  const ext = (fileId || '').split('.').pop().toLowerCase();
  const [icon, label] = extIcons[ext] || ['file', (ext || 'FILE').slice(0, 4).toUpperCase()];
  return `<span class="file-icon" aria-hidden="true">
    <svg class="file-type-icon"><use href="assets/file-icons.svg#icon-${icon}"></use></svg>
    <span class="file-ext-badge">${escapeHtml(label)}</span>
  </span>`;
}

function renderFileList(files) {
  const listEl = document.getElementById('file-list');
  const countEl = document.getElementById('file-count');

  if (files.length === 0) {
    listEl.innerHTML = '<div class="file-list-empty">No matching files</div>';
    if (countEl) countEl.textContent = '0 / ' + fileRegistry.length;
    return;
  }

  if (countEl) {
    countEl.textContent = files.length === fileRegistry.length
      ? files.length + ' files'
      : files.length + ' / ' + fileRegistry.length;
  }

  listEl.innerHTML = files.map(f => {
    const sLabel = S_LABELS[f.sLevel] || 'S' + f.sLevel;
    const selected = f.fileId === document.getElementById('in-file').value ? ' selected' : '';
    return `<div class="file-list-item${selected}" data-file-id="${escapeHtml(f.fileId)}" onclick='selectFile(this, ${JSON.stringify(f.fileId || "")})'>
      ${fileIconHtml(f.fileId)}
      <div class="file-info">
        <div class="file-name">${escapeHtml(f.fileId)}</div>
        <div class="file-desc">${escapeHtml(f.description || '')}</div>
      </div>
      <span class="file-slevel">S${f.sLevel} ${sLabel}</span>
    </div>`;
  }).join('');
}

let _searchTimer = null;
function onFileSearch(query) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    renderVisibleFileRegistry(query);
  }, 150);
}

function getVisibleFileRegistry(query) {
  const q = (query || '').trim();
  if (!q) return fileRegistry;
  return fileRegistry.filter(f =>
    fuzzyMatch(q, f.fileId, f.description || '')
  );
}

function renderVisibleFileRegistry(query) {
  renderFileList(getVisibleFileRegistry(query));
}

async function loadFileRegistry(options = {}) {
  const silent = options.silent === true;
  if (_fileRegistryLoading) return;
  _fileRegistryLoading = true;
  try {
    const previousIds = new Set(fileRegistry.map(f => f.fileId));
    const selectedFileId = document.getElementById('in-file')?.value || '';
    const searchQuery = document.getElementById('file-search')?.value || '';

    const res = await fetch(GATEWAY_URL + '/api/files/registry', {
      headers: authHeaders(false),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const nextRegistry = await res.json();
    if (!Array.isArray(nextRegistry)) throw new Error('Invalid registry response');
    fileRegistry = nextRegistry;

    const listEl = document.getElementById('file-list');
    const hiddenInput = document.getElementById('in-file');

    if (fileRegistry.length === 0) {
      listEl.innerHTML = '<div class="file-list-empty">No files available</div>';
      hiddenInput.value = '';
      const countEl = document.getElementById('file-count');
      if (countEl) countEl.textContent = '0 files';
      updateRiskInspectorFromSelection();
      _fileRegistryLoadedOnce = true;
      return;
    }

    const selectedStillExists = selectedFileId && fileRegistry.some(f => f.fileId === selectedFileId);
    hiddenInput.value = selectedStillExists ? selectedFileId : fileRegistry[0].fileId;

    renderVisibleFileRegistry(searchQuery);
    onFileSelect();

    if (!silent) {
      log('ok', 'File registry loaded: ' + fileRegistry.length + ' files');
    } else if (_fileRegistryLoadedOnce) {
      const newFiles = fileRegistry.filter(f => !previousIds.has(f.fileId));
      if (newFiles.length > 0) {
        log('ok', 'File registry refreshed: ' + newFiles.length + ' new file' + (newFiles.length === 1 ? '' : 's') + ' available');
      }
    }
    _fileRegistryLoadedOnce = true;
  } catch (err) {
    if (!silent) {
      const listEl = document.getElementById('file-list');
      const countEl = document.getElementById('file-count');
      if (listEl) listEl.innerHTML = '<div class="file-list-empty">Sign in again or refresh after the gateway reconnects.</div>';
      if (countEl) countEl.textContent = 'unavailable';
      log('warn', 'Could not load file registry');
    }
  } finally {
    _fileRegistryLoading = false;
  }
}

function handleDashboardLiveEvent(event) {
  const payload = event && event.payload ? event.payload : {};
  const type = payload.type || '';
  const data = payload.data || {};

  if (type === 'FILE_APPROVED' || type === 'FILE_REJECTED' || type === 'FILE_DELETED') {
    loadFileRegistry({ silent: true });
    if (type === 'FILE_APPROVED' && data.fileId) {
      log('ok', 'Live update: ' + data.fileId + ' is now available if your role/trust allows it');
    }
    return;
  }

  if ((type === 'USER_STATUS_CHANGED' || type === 'USER_ROLE_CHANGED' || type === 'USER_TRUST_CHANGED')
      && data.username && currentUser && data.username === currentUser.username) {
    currentUser = { ...currentUser, ...data };
    currentUser._isAdmin = currentUser.rSub === 5;
    setAuthSession(getToken(), currentUser);
    displayDashboardProfile(currentUser, currentUser._isAdmin);
    if (data.status && data.status !== 'ACTIVE') {
      log('warn', 'Account status changed to ' + data.status + '. Please sign in again after admin review.');
      clearAuthStorage();
      setTimeout(() => { window.location.href = 'overview.html'; }, 1200);
    }
  }
}

function installDashboardLiveEvents() {
  if (_dashboardLiveEvents) return;
  _dashboardLiveEvents = connectCaacEvents(handleDashboardLiveEvent);
}

function selectFile(el, fileId) {
  document.querySelectorAll('#file-list .file-list-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('in-file').value = fileId;
  onFileSelect();
}

function onFileSelect() {
  const fileId = document.getElementById('in-file').value;
  const entry = fileRegistry.find(f => f.fileId === fileId);
  if (entry) {
    document.getElementById('display-slevel').textContent = entry.sLevel + ' - ' + (S_LABELS[entry.sLevel] || '?');
    document.getElementById('display-preq').textContent = entry.pReq ?? 'internal';
    const accEl = document.getElementById('display-accesscount');
    const sizeEl = document.getElementById('display-filesize');
    const rulesEl = document.getElementById('display-rules');
    if (accEl) accEl.textContent = entry.accessCount ?? 'internal';
    if (sizeEl) sizeEl.textContent = entry.fileSize ? (entry.fileSize > 1024*1024 ? (entry.fileSize/1024/1024).toFixed(1)+' MB' : Math.round(entry.fileSize/1024)+' KB')
        : '—';
    if (rulesEl) {
        const rr = entry.rules || [];
        rulesEl.textContent = rr.length > 0 ? rr.map(r => r.type.replace(/_/g,' ')).join(', ') : 'internal';
    }
  }
  updateRiskInspectorFromSelection();
}

// ====================================================================
// REQUEST ACCESS
// ====================================================================
async function requestAccess() {
  const btn = document.getElementById('btnAccess');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ' + (typeof t === 'function' ? t('dash.processing') : 'Evaluating...');

  collectContext();
  log('info', 'Auto-collecting environmental context...');

  const fileId = document.getElementById('in-file').value;
  if (!fileId) { log('warn', 'No file selected'); btn.disabled = false; btn.textContent = typeof t === 'function' ? t('dash.requestAccess') : 'Request access'; return; }
  if (!currentUser) { window.location.href = 'overview.html'; return; }

  const payload = {
    ...rawContext,
    bFreq: '1.0'
  };

  log('info', 'Sending access request...');
  log('info', 'Context collected');

  try {
    const startMs = performance.now();
    const res = await fetch(GATEWAY_URL + '/api/files/' + fileId + '/web-access', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(payload)
    });
    const elapsedMs = Math.round(performance.now() - startMs);
    const data = await res.json();

    log(data.decision === 'PERMIT' ? 'ok' : 'err',
      'Phase 1 - Decision: ' + data.decision + ' | DT=' + (data.dtScore || '?')
      + ' | margin=' + (data.riskMargin != null ? data.riskMargin.toFixed(4) : '?')
      + ' (' + elapsedMs + 'ms)');

    renderResult(data, elapsedMs);
    updateRiskInspectorFromResult(data);
    publishContextToRuntime(data);

    if (data.decision === 'PERMIT' && data.sessionId) {
      log('info', 'Phase 2 - Starting file stream');
      log('info', 'Algorithm 2 is ACTIVE - monitoring context every 5s');
      await streamFile(data.sessionId, data.fileType || 'txt', data.fileId || 'file');
    }
  } catch (err) {
    log('err', 'Request failed');
    showError('Request failed');
  }

  btn.disabled = false;
  btn.textContent = typeof t === 'function' ? t('dash.requestAccess') : 'Request access';
}

// ====================================================================
// PHASE 2: STREAM WITH ALGORITHM 2
// ====================================================================
let currentSessionId = null;

async function streamFile(sessionId, fileType, fileName) {
  currentSessionId = sessionId;
  const preview = document.getElementById('filePreview');
  const statusEl = document.getElementById('streamStatus');
  const degradeBtn = document.getElementById('btnDegrade');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const trustBar = document.getElementById('trustBar');
  const trustValue = document.getElementById('trustValue');

  if (!preview) return;

  preview.style.display = 'block';
  if (degradeBtn) degradeBtn.style.display = 'block';
  statusEl.textContent = typeof t === 'function' ? t('dash.processing') : 'Streaming...';
  statusEl.style.color = 'var(--green)';

  const isText = ['txt', 'csv', 'json', 'xml', 'html', 'log', 'md'].includes(fileType);

  log('info', 'Starting secure stream (type: .' + fileType + ')');

  // Helper to update progress UI
  function updateProgress(bytes, estimatedTotal) {
    const pct = estimatedTotal > 0 ? Math.min(100, (bytes / estimatedTotal) * 100) : 0;
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) {
      progressText.textContent = bytes < 1024 ? bytes + ' B' : Math.round(bytes / 1024) + ' KB';
    }
  }

  // Helper to show revocation animation
  function showRevocation(bytes) {
    if (statusEl) { statusEl.textContent = typeof t === 'function' ? t('status.revoked') : 'REVOKED'; statusEl.style.color = 'var(--red)'; }
    if (trustBar) { trustBar.style.width = '0%'; trustBar.style.background = 'var(--red)'; }
    if (trustValue) { trustValue.textContent = typeof t === 'function' ? t('status.revoked') : 'REVOKED'; trustValue.style.color = 'var(--red)'; }
    if (progressBar) progressBar.style.background = 'var(--red)';
    if (degradeBtn) degradeBtn.style.display = 'none';
    log('err', 'Algorithm 2 REVOKED stream at ' + bytes + ' bytes');
    
    // BV-GCA: Log CAAR revocation receipt
    log('warn', '[CAAR] Revocation receipt: ' + bytes + ' bytes delivered before termination');
    log('warn', '[CSRP] Cluster risk updated - co-located sessions may be escalated');
  }

  function showComplete(bytes) {
    if (statusEl) { statusEl.textContent = typeof t === 'function' ? t('status.approved') : 'Complete'; statusEl.style.color = 'var(--teal)'; }
    if (progressBar) { progressBar.style.width = '100%'; progressBar.style.background = 'var(--teal)'; }
    if (degradeBtn) degradeBtn.style.display = 'none';
    log('ok', 'Stream completed: ' + bytes + ' bytes');
    const rgcaBadge = document.getElementById('rgcaTierBadge');
    const tier = rgcaBadge ? rgcaBadge.textContent : 'UNKNOWN';
    const leakageBound = tier === 'LOW-RISK' ? 40960 : tier === 'MEDIUM-RISK' ? 8192 : 1024;

    const receiptHtml = `
      <div class="caar-receipt">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">CAAR - COMPLIANCE RECEIPT</span>
          <span style="font-size:9px;font-family:var(--mono);font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(52,211,153,0.15);color:var(--green)">COMPLIANT</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:10px;font-family:var(--mono);color:var(--text3)">
          <span>Bytes: <span style="color:var(--text2)">${bytes < 1024 ? bytes + ' B' : Math.round(bytes/1024) + ' KB'}</span></span>
          <span>Bound: <span style="color:var(--text2)">${leakageBound < 1024 ? leakageBound + ' B' : Math.round(leakageBound/1024) + ' KB'}/window</span></span>
          <span>Tier: <span style="color:var(--accent)">${tier}</span></span>
          <span>On-chain: <span style="color:var(--green)">submitted</span></span>
        </div>
      </div>`;
    const monitorDiv = document.querySelector('#resultArea .result-body > div:last-of-type');
    if (monitorDiv) monitorDiv.insertAdjacentHTML('afterend', receiptHtml);

    log('info', '[CAAR] Receipt: ' + bytes + ' bytes, bound=' + leakageBound + '/window, tier=' + tier + ', compliant=true (session completed normally)');
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/files/sessions/' + sessionId + '/stream', { headers: authHeaders(false) });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      if (res.status === 500) detail += ' - Internal server error';
      else if (res.status === 404) detail += ' - Session not found';
      else if (res.status === 403) detail += ' - Access denied';
      statusEl.textContent = typeof t === 'function' ? t('status.error') : 'Error';
      statusEl.style.color = 'var(--red)';
      if (degradeBtn) degradeBtn.style.display = 'none';
      currentSessionId = null;
      log('err', 'Stream failed: ' + detail);
      return;
    }

    // Estimate total from content-length if available
    const contentLength = parseInt(res.headers.get('content-length') || '0');
    const estimatedTotal = contentLength > 0 ? contentLength : 10000; // fallback estimate

    if (isText) {
      const preEl = document.getElementById('filePreviewText');
      if (preEl) preEl.textContent = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0, revoked = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        totalBytes += value.length;
        if (preEl) preEl.textContent += chunk;
        if (preview) preview.scrollTop = preview.scrollHeight;
        updateProgress(totalBytes, estimatedTotal);
        statusEl.textContent = 'Streaming... ' + totalBytes + ' bytes';

        if (chunk.includes('STREAM TERMINATED')) {
          revoked = true;
          showRevocation(totalBytes);
          break;
        }
      }
      if (!revoked) showComplete(totalBytes);

    } else {
      statusEl.textContent = 'Downloading...';
      const reader = res.body.getReader();
      const chunks = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
        updateProgress(totalBytes, estimatedTotal);
        statusEl.textContent = 'Downloading... ' + Math.round(totalBytes / 1024) + ' KB';
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }

      const tail = new TextDecoder().decode(combined.slice(Math.max(0, totalBytes - 200)));
      if (tail.includes('STREAM TERMINATED')) {
        showRevocation(totalBytes);
        currentSessionId = null;
        return;
      }

      const mimeMap = {
        pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
        gif:'image/gif', svg:'image/svg+xml',
        docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
      const blob = new Blob([combined], { type: mimeMap[fileType] || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);

      if (fileType === 'pdf') {
        const iframe = document.getElementById('pdfViewer');
        if (iframe) iframe.src = blobUrl;
      } else if (['png','jpg','jpeg','gif','svg'].includes(fileType)) {
        const img = document.getElementById('imgViewer');
        if (img) img.src = blobUrl;
      } else {
        const link = document.getElementById('downloadLink');
        if (link) { link.href = blobUrl; link.download = fileName; link.textContent = 'Download ' + fileName + ' (' + Math.round(totalBytes/1024) + ' KB)'; }
      }
      showComplete(totalBytes);
    }
  } catch (err) {
    log('err', 'Stream error');
    if (statusEl) { statusEl.textContent = 'Connection lost'; statusEl.style.color = 'var(--red)'; }
    if (degradeBtn) degradeBtn.style.display = 'none';
    currentSessionId = null;
  }
  currentSessionId = null;
}

// ====================================================================
// ALGORITHM 2 DEMO: DEGRADE
// ====================================================================
async function degradeContext() {
  if (!currentSessionId) { log('warn', 'No active session'); return; }
  const btn = document.getElementById('btnDegrade');
  const trustBar = document.getElementById('trustBar');
  const trustValue = document.getElementById('trustValue');
  const statusEl = document.getElementById('streamStatus');
  const prevStatusText = statusEl ? statusEl.textContent : '';
  const prevStatusColor = statusEl ? statusEl.style.color : '';
  const prevTrustWidth = trustBar ? trustBar.style.width : '';
  const prevTrustColor = trustBar ? trustBar.style.background : '';
  const prevTrustText = trustValue ? trustValue.textContent : '';
  const prevTrustTextColor = trustValue ? trustValue.style.color : '';
  const defaultBtnText = 'Simulate context degradation (Algorithm 2 demo)';

  if (btn) { btn.disabled = true; btn.textContent = 'Degrading context...'; btn.style.opacity = '0.5'; }

  // Animate trust meter dropping
  if (trustBar) { trustBar.style.width = '5%'; trustBar.style.background = 'var(--red)'; }
  if (trustValue) { trustValue.textContent = '0.000'; trustValue.style.color = 'var(--red)'; }
  if (statusEl) { statusEl.textContent = 'Context degraded - waiting for Algorithm 2...'; statusEl.style.color = 'var(--amber)'; }

  log('warn', 'Simulating context degradation - public Wi-Fi + outside hours...');
  log('warn', 'L_trust -> 0.1, N_status -> 0.1, D_sec -> 0.1, T_req -> false');

  // 把降级后的关键字段同步到运行时拓扑图（hover tooltip 即时反映新值）
  if (window.CAAC_RUNTIME && typeof window.CAAC_RUNTIME.setUserContext === 'function') {
    const uname = (currentUser && (currentUser.username || currentUser.id)) || 'user';
    const uid = String(uname).indexOf('subj-') === 0 ? uname : ('subj-' + uname);
    try {
      window.CAAC_RUNTIME.setUserContext(uid, {
        subject: { L_trust: 0.10, N_status: 0.10, D_sec: 0.10 }
      });
    } catch (_) {}
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/files/sessions/' + currentSessionId + '/degrade', {
      method: 'POST',
      headers: authHeaders(false)
    });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      if (res.status === 500) detail += ' - Internal server error';
      else if (res.status === 404) detail += ' - Session not found';
      else if (res.status === 403) detail += ' - Access denied';
      throw new Error(detail);
    }
    log('warn', 'Context degraded. Algorithm 2 will revoke within 5s...');
  } catch (err) {
    log('err', 'Degrade failed: ' + err.message);
    if (statusEl) { statusEl.textContent = prevStatusText || 'Degrade failed'; statusEl.style.color = prevStatusColor; }
    if (trustBar) { trustBar.style.width = prevTrustWidth; trustBar.style.background = prevTrustColor; }
    if (trustValue) { trustValue.textContent = prevTrustText; trustValue.style.color = prevTrustTextColor; }
    if (btn) { btn.disabled = false; btn.textContent = defaultBtnText; btn.style.opacity = '1'; }
    if (/404|410|not found|not active/i.test(String(err.message))) {
      currentSessionId = null;
      if (btn) btn.style.display = 'none';
    }
  }
}

// ====================================================================
// RENDER RESULT
// ====================================================================
function renderResult(data, roundTripMs) {
  const area = document.getElementById('resultArea');
  const decision = data.decision || 'ERROR';
  const scores = data.resolvedScores || {};
  const raw = data.rawContext || {};
  const safeSessionId = data.sessionId ? escapeHtml(data.sessionId.substring(0, 8) + '...') : '';
  const safeFileId = escapeHtml(data.fileId || '?');
  const safeFileType = escapeHtml(data.fileType || 'txt');
  const safeDeliverySpeed = escapeHtml(data.deliverySpeed || '?');
  const chunkSizeKb = Number.isFinite(Number(data.chunkSize)) ? Math.max(1, Math.round(Number(data.chunkSize) / 1024)) : null;
  const chunkDelayText = Number.isFinite(Number(data.chunkDelay)) ? Number(data.chunkDelay) + 'ms' : 'adaptive';
  const deliveryDetail = chunkSizeKb != null ? chunkSizeKb + 'KB chunks, ' + chunkDelayText + ' delay' : 'windowed budget';

  let html = `
    <div class="result-card caac-decision-panel caac-decision-${decision}">
      <div class="result-header">
        <div>
          <div class="result-title">Access decision - ${safeFileId}</div>
          <div class="latency-bar" style="margin-top:4px">
            Blockchain latency: <span class="latency-val">${data.latencyMs || '?'}ms</span>
            &nbsp;|&nbsp; Round-trip: <span class="latency-val">${roundTripMs}ms</span>
            ${data.sessionId ? '&nbsp;|&nbsp; Session: <span style="color:var(--accent)">' + safeSessionId + '</span>' : ''}
          </div>
        </div>
        <span class="decision-badge decision-${decision}">${decision}</span>
      </div>
      <div class="result-body">
        <div class="result-section-label">Resolved scores (raw -> mathematical)</div>
        <div class="scores-grid">
          <div class="score-item"><div class="score-label">L_trust (location)</div><div class="score-row"><span class="score-val">${scores.L_trust || '—'}</span></div></div>
          <div class="score-item"><div class="score-label">N_status (network)</div><div class="score-row"><span class="score-val">${scores.N_status || '—'}</span><span class="score-raw">&lt;- ${raw.networkType || '?'}</span></div></div>
          <div class="score-item"><div class="score-label">D_sec (device)</div><div class="score-row"><span class="score-val">${scores.D_sec || '—'}</span><span class="score-raw">&lt;- ${raw.platform || '?'}</span></div></div>
          <div class="score-item"><div class="score-label">T_req (temporal)</div><div class="score-row"><span class="score-val">${scores.T_req || '—'}</span><span class="score-raw">&lt;- continuous cos^2</span></div></div>
        </div>
        <div class="result-section-label">Algorithm 1 - computed scores</div>
        <div class="scores-grid">
          <div class="score-item"><div class="score-label">DT_score (final trust)</div><div class="score-row"><span class="score-val" style="color:${decision === 'PERMIT' ? 'var(--green)' : 'var(--red)'}">${data.dtScore != null ? data.dtScore : '—'}</span><span class="score-raw">P_base=${data.pReqBase != null ? data.pReqBase.toFixed(2) : '?'} -> P_eff=${data.pReqEffective != null ? data.pReqEffective.toFixed(4) : '?'}</span></div></div>
          <div class="score-item"><div class="score-label">CE_score (environment)</div><div class="score-row"><span class="score-val">${data.ceScore != null ? data.ceScore : '—'}</span><span class="score-raw">with interaction term</span></div></div>
          <div class="score-item"><div class="score-label">T_sub (evolved trust)</div><div class="score-row"><span class="score-val">${data.tSub != null ? data.tSub : '—'}</span><span class="score-raw">EMA feedback</span></div></div>
          <div class="score-item"><div class="score-label">Risk margin</div><div class="score-row"><span class="score-val" style="color:${(data.riskMargin || 0) > 0.2 ? 'var(--green)' : (data.riskMargin || 0) > 0 ? 'var(--amber)' : 'var(--red)'}">${data.riskMargin != null ? (data.riskMargin > 0 ? '+' : '') + data.riskMargin.toFixed(4) : '—'}</span><span class="score-raw">DT - P_req</span></div></div>
          <div class="score-item"><div class="score-label">O_risk (object risk)</div><div class="score-row"><span class="score-val" style="color:var(--teal)">${data.objectRisk != null ? data.objectRisk.toFixed(4) : '—'}</span><span class="score-raw">C_O -> P_eff adjust</span></div></div>
          </div>
        ${data.deliverySpeed ? '<div style="margin-top:8px;font-size:11px;font-family:var(--mono);color:var(--text3)">Delivery: <span style="color:var(--teal)">' + safeDeliverySpeed + '</span> (' + deliveryDetail + ')</div>' : ''}`;

  if (decision === 'DENY') {
    html += `<div style="margin-top:14px;padding:14px;background:var(--red2);border:1px solid rgba(248,113,113,.15);border-radius:6px"><div style="font-size:12px;font-weight:500;color:var(--red)">Access denied</div><div style="font-size:11px;color:var(--text2);margin-top:4px">${data.reason || 'DT_score below threshold or insufficient role.'}</div></div>`;
  }
  if (decision === 'PERMIT') {
    const ft = data.fileType || 'txt';
    const isText = ['txt', 'csv', 'json', 'xml', 'html', 'log', 'md'].includes(ft);
    const marginPct = Math.min(100, Math.max(0, ((data.riskMargin || 0) / 0.5) * 100));
    const marginColor = (data.riskMargin||0) >= 0.2 ? 'var(--green)' : (data.riskMargin||0) >= 0.05 ? 'var(--amber)' : 'var(--red)';

    html += `<div style="margin-top:14px">
      <!-- Algorithm 2 Live Monitor -->
      <div class="caac-session-monitor">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="session-monitor-title">BV-GCA SESSION MONITOR</div>
            <span id="rgcaTierBadge" class="rgca-tier-badge" style="${
              (data.riskMargin||0) >= 0.3 ? 'background:rgba(52,211,153,0.15);color:var(--green)' :
              (data.riskMargin||0) >= 0.1 ? 'background:rgba(251,191,36,0.15);color:var(--amber)' :
              'background:rgba(248,113,113,0.15);color:var(--red)'
            }">${
              (data.riskMargin||0) >= 0.3 ? 'LOW-RISK' :
              (data.riskMargin||0) >= 0.1 ? 'MEDIUM-RISK' : 'HIGH-RISK'
            }</span>
          </div>
          <span id="streamStatus" style="font-size:11px;font-family:var(--mono);color:var(--green)">Initializing...</span>
        </div>
        <!-- Trust meter -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text3);width:70px">DT_score</div>
          <div style="flex:1;height:20px;background:var(--bg2);border-radius:4px;overflow:hidden;position:relative;border:1px solid var(--border)">
            <div id="trustBar" style="height:100%;width:${marginPct}%;background:${marginColor};transition:width 0.5s,background 0.5s;border-radius:3px"></div>
            <div id="thresholdLine" style="position:absolute;top:0;bottom:0;left:${Math.min(95,((data.pReq||0.5)/0.5)*100)}%;width:2px;background:var(--red);opacity:0.7" title="P_req threshold"></div>
          </div>
          <div style="font-size:11px;font-family:var(--mono);width:60px;text-align:right">
            <span id="trustValue" style="color:${marginColor}">${data.dtScore != null ? data.dtScore.toFixed(3) : '?'}</span>
          </div>
        </div>
        <!-- Progress bar -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text3);width:70px">Progress</div>
          <div style="flex:1;height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;border:1px solid var(--border)">
            <div id="progressBar" style="height:100%;width:0%;background:var(--accent);transition:width 0.3s;border-radius:3px"></div>
          </div>
          <div id="progressText" style="font-size:10px;font-family:var(--mono);color:var(--text3);width:60px;text-align:right">0 B</div>
        </div>
        <!-- Session info -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:10px;font-family:var(--mono);color:var(--text3)">
          <span>Session: <span style="color:var(--accent)">${safeSessionId}</span></span>
          <span>File: <span style="color:var(--text2)">${safeFileId}</span></span>
          <span>Speed: <span style="color:var(--teal)">${safeDeliverySpeed}</span></span>
        </div>
        <!-- RGCA leakage info -->
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border-radius:6px;border:1px solid var(--border)">
          <div style="display:flex;gap:16px;font-size:10px;font-family:var(--mono);color:var(--text3)">
            <span>RGCA: <span style="color:var(--accent)">dt=${(data.riskMargin||0)>=0.3?'8s':(data.riskMargin||0)>=0.1?'4s':'2s'}</span></span>
            <span>Delay: <span style="color:var(--teal)">${chunkDelayText}</span></span>
            <span>L_max: <span style="color:${(data.riskMargin||0)>=0.3?'var(--green)':(data.riskMargin||0)>=0.1?'var(--amber)':'var(--red)'}">&lt;=${(data.riskMargin||0)>=0.3?'40KB':(data.riskMargin||0)>=0.1?'8KB':'1KB'}</span></span>
            <span>Algo 2: <span style="color:var(--green)">ACTIVE</span></span>
          </div>
        </div>
      </div>
        <!-- Degrade button -->
        <button id="btnDegrade" class="btn-danger-demo" onclick="degradeContext()" style="display:none">
          Simulate context degradation (Algorithm 2 demo)
        </button>
      </div>`;

    // File preview area
    if (isText) {
      html += `<div id="filePreview" class="file-preview" style="display:none"><pre id="filePreviewText"></pre></div>`;
    } else if (ft === 'pdf') {
      html += `<div id="filePreview" style="display:none;margin-top:8px"><iframe id="pdfViewer" style="width:100%;height:500px;border:1px solid var(--border);border-radius:6px;background:#fff"></iframe></div>`;
    } else if (['png','jpg','jpeg','gif','svg'].includes(ft)) {
      html += `<div id="filePreview" style="display:none;margin-top:8px"><img id="imgViewer" style="max-width:100%;border-radius:6px;border:1px solid var(--border)" /></div>`;
    } else {
      html += `<div id="filePreview" style="display:none;margin-top:8px;text-align:center;padding:20px"><a id="downloadLink" class="btn-primary" style="display:inline-block;width:auto;padding:10px 24px;text-decoration:none" download>Download file</a></div>`;
    }
    html += `</div>`;
  }
  if (decision === 'ERROR') {
    html += `<div style="margin-top:14px;padding:14px;background:var(--amber2);border:1px solid rgba(251,191,36,.15);border-radius:6px"><div style="font-size:12px;font-weight:500;color:var(--amber)">System error</div><div style="font-size:11px;color:var(--text2);margin-top:4px">${data.reason || 'Authorization service unreachable. Access denied by policy.'}</div></div>`;
  }

  html += `</div></div>`;
  area.innerHTML = html;
}

function showError(msg) {
  setRiskText('ri-status', 'error');
  updateRiskExplainer('Gateway or network error. The visual demo can continue in Demo Mode, but live access evaluation is unavailable.', 'err');
  document.getElementById('resultArea').innerHTML = `
    <div class="card"><div style="padding:20px;text-align:center">
      <div style="font-size:24px;opacity:.4;margin-bottom:8px">&#9888;</div>
      <div style="font-size:13px;color:var(--red);font-weight:500">Connection error</div>
      <pre style="font-size:11px;color:var(--text3);margin-top:8px;white-space:pre-wrap;text-align:left;font-family:var(--mono)">${escapeHtml(msg)}</pre>
    </div></div>`;
}

// ====================================================================
// RESET T_SUB
// ====================================================================
async function resetTrust() {
  try {
    await fetch(GATEWAY_URL + '/api/files/reset-trust', {
      method: 'POST',
      headers: authHeaders(false)
    });
    log('warn', 'T_sub trust memory reset');
  } catch (err) { log('err', 'Reset failed'); }
}

// ====================================================================
// FILE UPLOAD
// ====================================================================
async function uploadFile() {
  const btn = document.getElementById('btnUpload');
  const statusEl = document.getElementById('uploadStatus');
  const fileInput = document.getElementById('upload-file');
  const desc = document.getElementById('upload-desc').value.trim();
  const sLevel = document.getElementById('upload-slevel').value;

  if (!fileInput.files || fileInput.files.length === 0) {
    statusEl.style.display = 'block'; statusEl.style.background = 'var(--red2)';
    statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Please select a file'; return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Uploading...';
  statusEl.style.display = 'none';
  const rules = [];
  const orgVal = (document.getElementById('rule-org')?.value || '').trim();
  if (orgVal) rules.push({ type: 'require_org', value: orgVal });
  const maxAcc = document.getElementById('rule-maxaccess')?.value;
  if (maxAcc && parseInt(maxAcc) > 0) rules.push({ type: 'max_daily_access', value: parseInt(maxAcc) });
  const minTr = document.getElementById('rule-mintrust')?.value;
  if (minTr && parseFloat(minTr) > 0) rules.push({ type: 'min_trust', value: parseFloat(minTr) });
  

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('sLevel', document.getElementById('upload-slevel').value);
  formData.append('rules', JSON.stringify(rules));
  formData.append('description', desc || 'Uploaded file');

  try {
    const res = await fetch(GATEWAY_URL + '/api/files/upload', {
      method: 'POST',
      headers: authHeaders(false),
      body: formData
    });
    const data = await res.json();
    statusEl.style.display = 'block';
    if (res.ok) {
      statusEl.style.background = 'var(--green2)'; statusEl.style.color = 'var(--green)';
      statusEl.textContent = 'File uploaded successfully - awaiting admin approval';
      log('ok', 'File uploaded - pending approval');
      fileInput.value = ''; document.getElementById('upload-desc').value = '';
    } else {
      statusEl.style.background = 'var(--red2)'; statusEl.style.color = 'var(--red)';
      statusEl.textContent = 'Upload failed';
    }
  } catch (err) {
    statusEl.style.display = 'block'; statusEl.style.background = 'var(--red2)';
    statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Upload failed';
  }
  btn.disabled = false; btn.textContent = 'Upload file';
}

async function checkUnreadBadge() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/unread', { headers: authHeaders(false) });
    if (!res.ok) return;
    const data = await res.json();
    const count = data.unread || 0;
    updateMenuBadge(count);
    // Also update the panel link badge
    const panelBadge = document.getElementById('panelMsgBadge');
    if (panelBadge) {
      if (count > 0) {
        panelBadge.style.display = 'inline';
        panelBadge.textContent = count;
      } else {
        panelBadge.style.display = 'none';
      }
    }
  } catch {}
}

// ====================================================================
// INIT
// ====================================================================
window.addEventListener('DOMContentLoaded', async () => {
  collectContext();
  updateRiskInspectorFromSelection();
  detectIp();
  checkHealth();

  if (hasAuthSession() && !currentUser) {
    try {
      const cached = JSON.parse(sessionStorage.getItem('caac_user') || 'null');
      if (cached && cached.username) {
        currentUser = cached;
        currentUser._isAdmin = currentUser.rSub === 5;
        displayDashboardProfile(currentUser, currentUser._isAdmin);
      }
    } catch {}
  }

  const authenticated = await checkAuth();
  if (!authenticated) return;

  displayDashboardProfile(currentUser, currentUser._isAdmin);

  // Check unread badge for non-admins
  if (!currentUser._isAdmin) {
    checkUnreadBadge();
    caacVisibleInterval(checkUnreadBadge, 10000);
  }

  updateRiskInspectorFromSelection();
  loadFileRegistry();
  installDashboardLiveEvents();
  caacVisibleInterval(() => loadFileRegistry({ silent: true }), FILE_REGISTRY_FALLBACK_REFRESH_MS);
  caacVisibleInterval(collectContext, 30000);
  caacVisibleInterval(checkHealth, 15000);
});
