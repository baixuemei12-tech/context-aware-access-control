/* ============================================================
   CAAC System — Admin Panel
   Features: trigram fuzzy search, conversation-based DMs,
   sortable/collapsible tables, analytics charts, user colors
   ============================================================ */

let currentAdminUsername = null;
const TABLE_LIMIT = 5;

// ================================================================
// TRIGRAM FUZZY SEARCH
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
  if (!query || query.length < 2) return true; // Show all if query too short
  const q = query.toLowerCase();
  // Exact substring match first
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q)) return true;
  }
  // Trigram fuzzy match (threshold 0.3 = at least 30% of trigrams match)
  for (const f of fields) {
    if (f && trigramScore(q, f) >= 0.3) return true;
  }
  return false;
}

// ================================================================
// USER COLORS — deterministic color per username
// ================================================================
const USER_COLORS = [
  '#5ea4f8', '#34d399', '#f87171', '#fbbf24', '#a78bfa',
  '#f472b6', '#2dd4bf', '#6ee7b7', '#fb923c', '#818cf8',
  '#e879f9', '#38bdf8', '#facc15', '#4ade80', '#f43f5e'
];

function userColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function safeMessage(err, fallback) {
  if (err && typeof err.message === 'string' && err.message.trim()) return escapeHtml(err.message);
  return fallback;
}

let _adminHealthData = null;
let _anomalyStatsData = null;
let _adminQuickFilter = 'all';
let _adminLiveEvents = null;

function setActiveAdminFilter(filter) {
  document.querySelectorAll('[data-admin-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminFilter === filter);
  });
}

function applyAdminQuickFilter(filter) {
  _adminQuickFilter = filter || 'all';
  setActiveAdminFilter(_adminQuickFilter);
  filterUsers();
  filterFiles();
  loadAudit();
  loadAnomalies();
  const target = {
    'pending-users': 'usersContainer',
    'pending-files': 'filesContainer',
    'high-sensitivity': 'filesContainer',
    'low-trust': 'usersContainer',
    'deny-revoke': 'auditContainer',
    'anomalies': 'anomalyContainer'
  }[_adminQuickFilter];
  if (target) {
    const el = document.getElementById(target);
    if (el) el.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setOpsText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateAdminOpsPanel() {
  const pendingUsers = _usersData.filter(u => u.status === 'PENDING' || u.status === 'UNVERIFIED').length;
  const pending = _filesData.filter(f => f.status === 'PENDING').length;
  const highSensitivity = _filesData.filter(f => Number(f.sLevel) >= 3).length;
  const lowTrust = _usersData.filter(u => Number(u.tSub) < 0.5).length;
  const denied = _auditData.filter(e => e.decision === 'DENY' || e.decision === 'REVOKED').length;
  const anomalies = _anomalyStatsData?.unreviewed ?? 0;
  const sessions = _adminHealthData?.activeSessions ?? '—';

  setOpsText('opsPendingUsers', pendingUsers);
  setOpsText('opsPendingFiles', pending);
  setOpsText('opsHighSensitivity', highSensitivity);
  setOpsText('opsLowTrust', lowTrust);
  setOpsText('opsDenied', denied);
  setOpsText('opsAnomalies', anomalies);
  setOpsText('opsSessions', sessions);

  const timeline = document.getElementById('opsTimeline');
  if (!timeline) return;
  const gateway = _adminHealthData?.status === 'UP' ? ['var(--green)', 'Gateway health', 'UP'] : ['var(--amber)', 'Gateway health', 'checking'];
  const registry = _adminHealthData ? ['var(--accent)', 'Registry', (_adminHealthData.registeredFiles ?? '—') + ' files'] : ['var(--accent)', 'Registry', 'loading'];
  const anomaly = anomalies > 0 ? ['var(--red)', 'Anomaly detector', anomalies + ' new'] : ['var(--green)', 'Anomaly detector', 'clear'];
  const audit = _auditData.length > 0 ? ['var(--purple)', 'Audit stream', _auditData.length + ' loaded'] : ['var(--text3)', 'Audit stream', 'waiting'];
  timeline.innerHTML = [gateway, registry, anomaly, audit].map(item =>
    `<div class="ops-event"><i style="color:${item[0]}"></i><span>${item[1]}</span><small>${item[2]}</small></div>`
  ).join('');
}

// ================================================================
// AUTH
// ================================================================
async function checkAdmin() {
  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return false; }
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/me', { headers: authHeaders(false) });
    if (!res.ok) { clearAuthStorage(); window.location.href = 'login.html'; return false; }
    const data = await res.json();
    if (!data.isAdmin) { alert('Admin access required'); window.location.href = 'index.html'; return false; }
    setAuthSession(token, { ...data.user, _isAdmin: true });
    currentAdminUsername = data.user.username;
    return true;
  } catch { window.location.href = 'login.html'; return false; }
}

function buildSafeProfileLink(username, color) {
  const safeUsername = encodeURIComponent(username || '');
  const safeColor = color || 'var(--accent)';
  return `<a href="profile.html?user=${safeUsername}" style="color:${safeColor};text-decoration:none">${escapeHtml(username || '')}</a>`;
}

function encodeForInlineDecode(value) {
  return encodeURIComponent(value || '').replace(/'/g, '%27');
}

// ================================================================
// COLLAPSIBLE TABLE
// ================================================================
function makeCollapsible(containerId, rows, renderFn, columns) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (rows.length === 0) { container.innerHTML = '<div class="empty">No data</div>'; return; }
  const expanded = container.dataset.expanded === 'true';
  const visible = expanded ? rows : rows.slice(0, TABLE_LIMIT);
  let html = `<table class="data-table"><thead><tr>${columns.map(c => '<th>' + c + '</th>').join('')}</tr></thead><tbody>`;
  visible.forEach(row => { html += renderFn(row); });
  html += '</tbody></table>';
  if (rows.length > TABLE_LIMIT) {
    const rem = rows.length - TABLE_LIMIT;
    html += expanded
      ? `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('${containerId}',false)">Show less</button></div>`
      : `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('${containerId}',true)">Show ${rem} more (${rows.length} total)</button></div>`;
  }
  container.innerHTML = html;
}

function toggleExpand(id, expand) {
  const c = document.getElementById(id);
  if (c) c.dataset.expanded = expand ? 'true' : 'false';
  if (id === 'usersContainer') filterUsers();
  else if (id === 'filesContainer') filterFiles();
  else if (id === 'auditContainer') loadAudit();
  else if (id === 'anomalyContainer') loadAnomalies();
}

// ================================================================
// USERS
// ================================================================
let _usersData = [];

async function loadUsers() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/users', { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    document.getElementById('statUsers').textContent = data.totalUsers;
    document.getElementById('statOnline').textContent = data.onlineCount || 0;
    _usersData = data.users || [];
    updateAdminOpsPanel();
    filterUsers();
  } catch (err) {
    document.getElementById('usersContainer').innerHTML = '<div class="empty" style="color:var(--red)">Failed: ' + safeMessage(err, 'Unknown error') + '</div>';
  }
}

function filterUsers() {
  const q = (document.getElementById('searchUsers').value || '').trim();
  let filtered = q.length >= 2
    ? _usersData.filter(u => fuzzyMatch(q, u.username, u.displayName || '', u.email || ''))
    : [..._usersData];
  if (_adminQuickFilter === 'low-trust') {
    filtered = filtered.filter(u => Number(u.tSub) < 0.5);
  } else if (_adminQuickFilter === 'pending-users') {
    filtered = filtered.filter(u => u.status === 'PENDING' || u.status === 'UNVERIFIED');
  }

  const sortVal = document.getElementById('sortUsers') ? document.getElementById('sortUsers').value : 'username-asc';
  const [sortBy, sortDir] = sortVal.split('-');
  const dir = sortDir === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    if (sortBy === 'username') return dir * (a.username || '').localeCompare(b.username || '');
    if (sortBy === 'rSub') return dir * (a.rSub - b.rSub);
    if (sortBy === 'tSub') return dir * (a.tSub - b.tSub);
    if (sortBy === 'status') {
      const order = { PENDING: 0, UNVERIFIED: 1, ACTIVE: 2, BLOCKED: 3 };
      return dir * ((order[a.status] ?? 9) - (order[b.status] ?? 9));
    }
    if (sortBy === 'registeredAt') return dir * (a.registeredAt || '').localeCompare(b.registeredAt || '');
    return 0;
  });

  makeCollapsible('usersContainer', filtered, renderUserRow,
    ['User', 'Name', 'Status', 'Role', 'Trust', 'Registered', 'Actions']);
}

function userStatusBadge(status) {
  if (status === 'ACTIVE') return '<span class="badge badge-active">Active</span>';
  if (status === 'PENDING') return '<span class="badge badge-pending">Pending approval</span>';
  if (status === 'UNVERIFIED') return '<span class="badge badge-pending">Unverified</span>';
  return '<span class="badge badge-blocked">Blocked</span>';
}

function renderUserRow(u) {
  const username = String(u.username || '');
  const displayName = String(u.displayName || '');
  const isSelf = u.username === currentAdminUsername;
  const isProtected = u.rSub === 5 && currentAdminUsername !== 'admin' && !isSelf;
  const locked = isSelf || isProtected;
  const color = userColor(u.username);
  const dot = u.online
    ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:5px"></span>'
    : '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--text3);opacity:.4;margin-right:5px"></span>';
  const badge = userStatusBadge(u.status);
  const reg = u.registeredAt ? u.registeredAt.substring(0, 10) : '—';
  const userEnc = encodeForInlineDecode(username);
  let actionButtons = '';
  if (!isSelf && !isProtected) {
    if (u.status === 'ACTIVE') {
      actionButtons += `<button class="btn-sm btn-block" onclick="changeStatus(decodeURIComponent('${userEnc}'),'BLOCKED')">Block</button>`;
    } else {
      const label = u.status === 'PENDING' ? 'Approve' : 'Activate';
      actionButtons += `<button class="btn-sm btn-activate" onclick="changeStatus(decodeURIComponent('${userEnc}'),'ACTIVE')">${label}</button>`;
      actionButtons += `<button class="btn-sm btn-block" onclick="changeStatus(decodeURIComponent('${userEnc}'),'BLOCKED')">Block</button>`;
      actionButtons += `<button class="btn-sm btn-block" onclick="deleteUser(decodeURIComponent('${userEnc}'))">Delete</button>`;
    }
    actionButtons += `<button class="btn-sm" style="color:var(--amber)" onclick="requestReset(decodeURIComponent('${userEnc}'))">Reset PW</button>`;
  }

  return `<tr>
    <td style="font-family:var(--mono);font-weight:500">${dot}${buildSafeProfileLink(username, color)}</td>
    <td style="font-size:12px">${escapeHtml(displayName || '—')}</td>
    <td>${badge}</td>
    <td><select class="role-select" onchange="changeRole(decodeURIComponent('${userEnc}'),this.value)" ${locked ? 'disabled' : ''}>${[1,2,3,4,5].map(r => `<option value="${r}" ${u.rSub===r?'selected':''}>${r} — ${ROLE_LABELS[r]}</option>`).join('')}</select></td>
    <td><input type="number" class="trust-input" value="${u.tSub}" min="0" max="1" step="0.1" onchange="changeTrust(decodeURIComponent('${userEnc}'),this.value)" ${locked?'disabled':''}></td>
    <td style="font-size:11px;color:var(--text3);font-family:var(--mono)">${reg}</td>
    <td>${isSelf ? '<span style="font-size:11px;color:var(--text3)">you</span>' :
      isProtected ? '<span style="font-size:11px;color:var(--amber)">protected</span>' :
      `<div style="display:flex;gap:4px;flex-wrap:wrap">${actionButtons}</div>`}</td>
  </tr>`;
}

async function changeRole(u, r) {
  try {
    const res = await fetch(GATEWAY_URL+'/api/auth/admin/users/'+encodeURIComponent(u)+'/role',{method:'POST',headers:authHeaders(true),body:JSON.stringify({rSub:parseInt(r)})});
    if(!res.ok){const d=await res.json();throw new Error(d.error||'Failed');}
    toast(u+' → R_sub='+r,'ok'); loadUsers();
  } catch(e){toast('Failed','err');}
}
async function changeTrust(u, t) {
  try { await fetch(GATEWAY_URL+'/api/auth/admin/users/'+encodeURIComponent(u)+'/trust',{method:'POST',headers:authHeaders(true),body:JSON.stringify({tSub:parseFloat(t)})});   toast(u+' trust updated','ok'); } catch(e){toast('Trust update failed','err');}
}
async function changeStatus(u, s) {
  try { await fetch(GATEWAY_URL+'/api/auth/admin/users/'+encodeURIComponent(u)+'/status',{method:'POST',headers:authHeaders(true),body:JSON.stringify({status:s})}); toast(u+' → '+s,'ok'); loadUsers(); } catch(e){toast('Status update failed','err');}
}

async function deleteUser(username) {
  if (!confirm('Permanently delete user "' + username + '"?\n\nThis removes the account, all tokens, and cannot be undone.')) return;
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/users/' + encodeURIComponent(username) + '/delete', {
      method: 'POST', headers: authHeaders(false)
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
    toast(username + ' permanently deleted', 'ok');
    loadUsers();
    loadStats();
  } catch (e) { toast('Delete failed', 'err'); }
}

let _resetCooldowns = {};
async function requestReset(username) {
  if (_resetCooldowns[username] && Date.now() - _resetCooldowns[username] < 120000) {
    toast('Reset already pending for ' + username + '. Wait 2 minutes.', 'err');
    return;
  }
  if (!confirm('Request password reset for "' + username + '"?\n\nThis generates a one-time code. Give it to the user \u2014 they enter it on the login page.')) return;
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/users/' + encodeURIComponent(username) + '/request-reset', {
      method: 'POST', headers: authHeaders(false)
    });
    const data = await res.json();
    if (res.ok) {
      _resetCooldowns[username] = Date.now();
      const modal = document.createElement('div');
modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
modal.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:90%"><div style="font-size:14px;font-weight:600;margin-bottom:12px">Reset code for ' + escapeHtml(username) + '</div><div style="font-family:var(--mono);font-size:18px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;text-align:center;letter-spacing:2px;margin-bottom:12px" id="resetCodeDisplay">' + escapeHtml(data.resetCode) + '</div><div style="font-size:11px;color:var(--text3);margin-bottom:16px">User enters this on the login page. Expires in 30 minutes.</div><div style="display:flex;gap:8px"><button onclick="navigator.clipboard.writeText(document.getElementById(\'resetCodeDisplay\').textContent);this.textContent=\'Copied\'" style="flex:1;padding:8px;border-radius:6px;background:var(--accent);color:var(--bg);border:none;cursor:pointer;font-size:12px">Copy code</button><button onclick="this.closest(\'div[style*=fixed]\').remove()" style="flex:1;padding:8px;border-radius:6px;background:var(--bg);color:var(--text2);border:1px solid var(--border);cursor:pointer;font-size:12px">Close</button></div></div>';
document.body.appendChild(modal);
      toast('Reset code generated', 'ok');
    } else { toast(data.error || 'Reset failed', 'err'); }
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ================================================================
// FILES (sortable)
// ================================================================
let _filesData = [];
let _cidMap = new Map();

async function loadFiles() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/files/admin/all', { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const sortBy = document.getElementById('sortFiles') ? document.getElementById('sortFiles').value : 'status';
    const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
    _filesData = (data.files || []).sort((a, b) => {
      if (sortBy==='status') return (order[a.status]||0)-(order[b.status]||0);
      if (sortBy==='sLevel') return b.sLevel-a.sLevel;
      if (sortBy==='pReq') return b.pReq-a.pReq;
      if (sortBy==='fileId') return a.fileId.localeCompare(b.fileId);
      if (sortBy==='uploadedBy') return (a.uploadedBy||'').localeCompare(b.uploadedBy||'');
      return 0;
    });
    updateAdminOpsPanel();
    filterFiles();
  } catch (err) {
    document.getElementById('filesContainer').innerHTML = '<div class="empty" style="color:var(--red)">Failed: ' + safeMessage(err, 'Unknown error') + '</div>';
  }
}

function filterFiles() {
  const q = (document.getElementById('searchFiles').value || '').trim();
  let filtered = q.length >= 2
    ? _filesData.filter(f => fuzzyMatch(q, f.fileId, f.description||'', f.uploadedBy||''))
    : _filesData;
  if (_adminQuickFilter === 'pending-files') {
    filtered = filtered.filter(f => f.status === 'PENDING');
  } else if (_adminQuickFilter === 'high-sensitivity') {
    filtered = filtered.filter(f => Number(f.sLevel) >= 3);
  }
  _cidMap = new Map();
  filtered.forEach(f => _cidMap.set(f.fileId, String(f.cid || '')));
  makeCollapsible('filesContainer', filtered, renderFileRow,
    ['File', 'Status', 'S_level', 'P_req', 'Uploader', 'Description', 'Actions']);
}

function renderFileRow(f) {
  const fileId = String(f.fileId || '');
  const description = String(f.description || '');
  const uploadedBy = String(f.uploadedBy || '—');
  const badge = f.status==='APPROVED'?'<span class="badge badge-approved">Approved</span>':f.status==='PENDING'?'<span class="badge badge-pending">Pending</span>':'<span class="badge badge-rejected">Rejected</span>';
  const fileIdEnc = encodeForInlineDecode(fileId);
  const approveSelectId = 'approve-slevel-' + fileIdEnc;
  let actions;
  if (f.status==='PENDING') {
    actions = `<button class="btn-sm" style="color:var(--accent);margin-right:4px" onclick="previewFileById('${fileIdEnc}')">Preview</button>
      <select class="role-select" id="${approveSelectId}" style="width:auto;margin-right:4px">${[1,2,3,4,5].map(r=>`<option value="${r}" ${f.sLevel===r?'selected':''}>${r}</option>`).join('')}</select>
      <button class="btn-sm btn-activate" onclick="approveFile(decodeURIComponent('${fileIdEnc}'))" style="margin-right:4px">Approve</button>
      <button class="btn-sm btn-block" onclick="rejectFile(decodeURIComponent('${fileIdEnc}'))">Reject</button>`;
  } else {
    actions = `<button class="btn-sm" style="color:var(--accent);margin-right:4px" onclick="previewFileById('${fileIdEnc}')">Preview</button><button class="btn-sm btn-block" onclick="deleteFile(decodeURIComponent('${fileIdEnc}'))">Delete</button>`;
  }
  return `<tr>
    <td style="font-family:var(--mono);font-weight:500">${escapeHtml(fileId)}</td><td>${badge}</td>
    <td>${f.sLevel} — ${S_LABELS[f.sLevel]||'?'}</td><td style="font-family:var(--mono)">${f.pReq}</td>
    <td style="font-size:12px;color:${userColor(uploadedBy||'system')}">${escapeHtml(uploadedBy)}</td>
    <td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(description||'—')}</td>
    <td style="white-space:nowrap">${actions}</td></tr>`;
}

function previewFile(cid,name){
  fetch(GATEWAY_URL+'/api/files/preview/'+encodeURIComponent(name)+'?cid='+encodeURIComponent(cid), { headers: authHeaders(false) })
    .then(async res => {
      if (!res.ok) {
        throw new Error('Preview unavailable');
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('application/json')) {
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch {}
        if (parsed && (parsed.error || parsed.status || parsed.path)) {
          throw new Error('Preview unavailable');
        }
      }
      const shouldInline = contentType.startsWith('text/plain') ||
        contentType.startsWith('text/csv') ||
        contentType.startsWith('application/pdf') ||
        contentType.startsWith('image/');
      return { blob: await res.blob(), shouldInline, contentType };
    })
    .then(({ blob, shouldInline }) => {
      const url = URL.createObjectURL(blob);
      if (shouldInline) {
        const newTab = window.open(url, '_blank', 'noopener,noreferrer');
        if (!newTab) {
          const dl = document.createElement('a');
          dl.href = url;
          dl.download = name;
          dl.rel = 'noopener noreferrer';
          dl.click();
        }
      } else {
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = name;
        dl.rel = 'noopener noreferrer';
        dl.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      toast('Preview loaded for ' + name, 'ok');
    })
    .catch(err => {
      toast('Preview failed', 'err');
    });
}

async function previewFileById(fileId) {
  const cid = _cidMap.get(decodeURIComponent(fileId));
  if (!cid) { toast('Preview unavailable', 'err'); return; }
  previewFile(cid, decodeURIComponent(fileId));
}

async function approveFile(id){const s=document.getElementById('approve-slevel-'+encodeURIComponent(id));const l=s?parseInt(s.value):1;try{const r=await fetch(GATEWAY_URL+'/api/files/admin/'+encodeURIComponent(id)+'/approve',{method:'POST',headers:authHeaders(true),body:JSON.stringify({sLevel:l})});if(!r.ok)throw new Error('Failed');toast('File approved','ok');loadFiles();loadStats();}catch(e){toast('Approve failed','err');}}
async function rejectFile(id){try{await fetch(GATEWAY_URL+'/api/files/admin/'+encodeURIComponent(id)+'/reject',{method:'POST',headers:authHeaders(false)});toast('File rejected','ok');loadFiles();loadStats();}catch(e){toast('Reject failed','err');}}
async function deleteFile(id){if(!confirm('Delete this file?'))return;try{await fetch(GATEWAY_URL+'/api/files/admin/'+encodeURIComponent(id)+'/delete',{method:'POST',headers:authHeaders(false)});toast('File deleted','ok');loadFiles();loadStats();}catch(e){toast('Delete failed','err');}}

// ================================================================
// CONVERSATION-BASED MESSAGING (Telegram-style)
// ================================================================
let activeConversation = null;

function showNewConvDialog() {
  const dialog = document.getElementById('newConvDialog');
  const select = document.getElementById('newConvUser');
  dialog.style.display = dialog.style.display === 'none' ? 'block' : 'none';
  // Populate with all users
  select.innerHTML = '<option value="">Select user...</option>';
  _usersData.forEach(u => {
    if (u.username === currentAdminUsername) return;
    const opt = document.createElement('option');
    opt.value = u.username;
    opt.textContent = u.username + ' (' + u.displayName + ')';
    select.appendChild(opt);
  });
}

function startNewConv() {
  const user = document.getElementById('newConvUser').value;
  if (!user) { toast('Select a user', 'err'); return; }
  document.getElementById('newConvDialog').style.display = 'none';
  openConversation(user);
}

async function loadConversations() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/conversations', { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const convs = data.conversations || [];

    const list = document.getElementById('convList');
    if (convs.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text3)">No conversations</div>';
      return;
    }

  let html = '';
  convs.forEach(c => {
    const partner = String(c.partner || '');
    const color = userColor(c.partner);
    const isActive = activeConversation === c.partner;
      const unread = c.unread > 0 ? `<span style="background:var(--accent);color:#fff;font-size:9px;padding:1px 6px;border-radius:10px;margin-left:auto">${c.unread}</span>` : '';
      const bg = isActive ? 'var(--bg3)' : 'transparent';
    const time = c.lastTimestamp ? c.lastTimestamp.substring(11, 16) : '';
    const partnerEnc = encodeForInlineDecode(partner);
    const safeBg = escapeHtml(bg);
    html += `<div onclick="openConversation(decodeURIComponent('${partnerEnc}'))" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);background:${safeBg};transition:background .15s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='${safeBg}'">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="font-family:var(--mono);font-size:12px;font-weight:500;color:${color}">${escapeHtml(partner)}</span>
        ${unread}
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHtml(c.lastMessage)}
        </div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px;font-family:var(--mono)">${time}</div>
      </div>`;
    });
    list.innerHTML = html;
  } catch {}
}

async function openConversation(partner) {
  activeConversation = partner;
  const color = userColor(partner);
  const encodedPartner = encodeURIComponent(partner || '');
  document.getElementById('chatHeader').innerHTML =
    `<a href="profile.html?user=${encodedPartner}" style="color:${color};font-weight:600;text-decoration:none" title="View profile">${escapeHtml(partner)}</a>
     <span style="font-size:11px;color:var(--text3);margin-left:8px">Direct message</span>`;
  document.getElementById('chatInput').style.display = 'flex';
  loadConversations(); // refresh sidebar to highlight active
  loadConversationMessages();
}

async function loadConversationMessages() {
  if (!activeConversation) return;
  const area = document.getElementById('chatArea');

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/with/' + encodeURIComponent(activeConversation), { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const msgs = data.messages || [];

    if (msgs.length === 0) {
      area.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-size:12px">No messages yet</div>';
      return;
    }

    let html = '<div style="display:grid;gap:4px;padding:4px">';
    msgs.forEach(m => {
      const isMe = m.from === currentAdminUsername;
      const senderColor = userColor(m.from);
      const align = isMe ? 'flex-end' : 'flex-start';
      const bg = isMe ? 'rgba(45,212,191,0.1)' : 'var(--bg3)';
      const border = isMe ? 'rgba(45,212,191,0.2)' : 'var(--border)';
      const time = m.timestamp ? m.timestamp.substring(11, 16) : '';

      html += `<div style="display:flex;justify-content:${align}">
        <div style="max-width:80%;padding:8px 12px;background:${bg};border:1px solid ${border};border-radius:10px">
          <div style="font-size:10px;font-family:var(--mono);color:${senderColor};margin-bottom:2px;font-weight:500">${escapeHtml(m.from || '')}</div>
          <div style="font-size:12px;color:var(--text);line-height:1.4">${escapeHtml(m.content)}</div>
          <div style="font-size:9px;font-family:var(--mono);color:var(--text3);margin-top:2px;text-align:right">${time}</div>
        </div>
      </div>`;
    });
    html += '</div>';
    area.innerHTML = html;
    area.scrollTop = area.scrollHeight;
  } catch {
    area.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);font-size:12px">Failed to load</div>';
  }
}

async function sendAdminChat() {
  if (!activeConversation) return;
  const input = document.getElementById('adminChatMsg');
  const msg = input.value.trim();
  if (!msg) return;

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/send', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ to: activeConversation, message: msg })
    });
    if (!res.ok) throw new Error('Failed');
    input.value = '';
    loadConversationMessages();
    loadConversations();
  } catch (err) { toast('Send failed', 'err'); }
}

// ================================================================
// AUDIT LOG
// ================================================================
let _auditData = [];

async function loadAudit() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/audit?limit=200', { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _auditData = data.entries || [];
    updateAdminOpsPanel();
    const rows = _adminQuickFilter === 'deny-revoke'
      ? _auditData.filter(e => e.decision === 'DENY' || e.decision === 'REVOKED')
      : _auditData;

    const container = document.getElementById('auditContainer');
    if (rows.length === 0) { container.innerHTML = '<div class="empty">No events</div>'; return; }

    const expanded = container.dataset.expanded === 'true';
    const visible = expanded ? rows : rows.slice(0, TABLE_LIMIT);

    let html = `<div style="font-size:11px;color:var(--text3);margin-bottom:6px;font-family:var(--mono)">Shown: ${rows.length} / ${data.totalEntries}</div>`;
    html += `<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>File</th><th>Decision</th><th>DT_score</th><th>P_req</th><th>Margin</th><th>Network</th><th>Session</th></tr></thead><tbody>`;

    visible.forEach(e => {
      const dc = e.decision==='PERMIT'?'color:var(--green)':e.decision==='REVOKED'?'color:var(--amber)':'color:var(--red)';
      const t = e.timestamp?e.timestamp.substring(11,19):'—';
      const d = e.timestamp?e.timestamp.substring(0,10):'';
      const hasRiskMargin = typeof e.riskMargin === 'number';
      const mg = hasRiskMargin ? (e.riskMargin > 0 ? '+' : '') + e.riskMargin.toFixed(4) : '—';
      const mc = hasRiskMargin ? (e.riskMargin>=0.2?'var(--green)':e.riskMargin>0?'var(--amber)':'var(--text3)') : 'var(--text3)';
      const uc = userColor(e.username||'?');
      const encodedUsername = encodeURIComponent(e.username || '');
      html += `<tr>
        <td style="font-family:var(--mono);font-size:11px" title="${d}">${t}</td>
        <td style="font-family:var(--mono);font-size:12px"><a href="profile.html?user=${encodedUsername}" style="color:${uc};text-decoration:none">${escapeHtml(e.username || '')}</a></td>
        <td style="font-family:var(--mono);font-size:12px">${escapeHtml(e.fileId || '')}</td>
        <td><span style="font-family:var(--mono);font-weight:600;${dc}">${e.decision}</span></td>
        <td style="font-family:var(--mono);font-size:12px">${typeof e.dtScore === 'number' ? e.dtScore.toFixed(4) : '—'}</td>
        <td style="font-family:var(--mono);font-size:12px">${e.pReq||'—'}</td>
        <td style="font-family:var(--mono);font-size:12px;color:${mc}">${mg}</td>
        <td style="font-size:11px;color:var(--text2)">${e.networkType||'—'}</td>
        <td style="font-family:var(--mono);font-size:10px;color:var(--text3)">${e.sessionId||'—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    if (rows.length > TABLE_LIMIT) {
      const rem = rows.length - TABLE_LIMIT;
      html += expanded
        ? `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('auditContainer',false)">Show less</button></div>`
        : `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('auditContainer',true)">Show ${rem} more</button></div>`;
    }
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('auditContainer').innerHTML = '<div class="empty" style="color:var(--red)">Failed: ' + safeMessage(err, 'Unknown error') + '</div>';
  }
}

// ================================================================
// ANALYTICS CHARTS
// ================================================================
const chartInstances = {};
function destroyChart(id) { if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; } }
function setChartFallbacks(message) {
  ['chartDecisions', 'chartFiles', 'chartUsers', 'chartTimeline'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.parentElement) return;
    let fallback = canvas.parentElement.querySelector('[data-chart-fallback]');
    if (message) {
      canvas.style.display = 'none';
      if (!fallback) {
        fallback = document.createElement('div');
        fallback.setAttribute('data-chart-fallback', '');
        fallback.style.cssText = 'height:100%;display:grid;place-items:center;text-align:center;color:var(--text3);font:11px var(--mono);border:1px dashed var(--border);border-radius:8px;padding:12px';
        canvas.parentElement.appendChild(fallback);
      }
      fallback.textContent = message;
    } else {
      canvas.style.display = '';
      if (fallback) fallback.remove();
    }
  });
}

const CC = { blue:'#5ea4f8',green:'#34d399',red:'#f87171',amber:'#fbbf24',teal:'#2dd4bf',purple:'#a78bfa',pink:'#f472b6',
  blueBg:'rgba(94,164,248,0.15)',greenBg:'rgba(52,211,153,0.15)',redBg:'rgba(248,113,113,0.15)',amberBg:'rgba(251,191,36,0.15)' };
const CDef = {responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#4e6080',font:{size:10,family:"'JetBrains Mono'"}},grid:{color:'rgba(100,160,255,0.05)'}},y:{beginAtZero:true,ticks:{color:'#4e6080',font:{size:10,family:"'JetBrains Mono'"}},grid:{color:'rgba(100,160,255,0.05)'}}}};

async function loadAnalytics() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/audit/stats', { headers: authHeaders(false) });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof Chart === 'undefined') {
      setChartFallbacks('Chart renderer loading; operational tables remain active.');
      clearTimeout(loadAnalytics._chartRetry);
      loadAnalytics._chartRetry = setTimeout(() => {
        if (typeof Chart !== 'undefined') loadAnalytics();
      }, 1000);
      return;
    }
    setChartFallbacks('');

    // Decisions doughnut
    destroyChart('chartDecisions');
    const dc = data.decisionCounts||{};
    const dLabels = Object.keys(dc), dVals = Object.values(dc);
    const dColors = dLabels.map(l=>l==='PERMIT'?CC.green:l==='DENY'?CC.red:CC.amber);
    chartInstances['chartDecisions'] = new Chart(document.getElementById('chartDecisions'),{type:'doughnut',data:{labels:dLabels,datasets:[{data:dVals,backgroundColor:dColors,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:'#8899b4',font:{size:10,family:"'JetBrains Mono'"},padding:10}}}}});

    // Files bar
    destroyChart('chartFiles');
    const fileCountsSource = Object.keys(data.filePermitCounts24h || {}).length > 0
      ? (data.filePermitCounts24h || {})
      : (data.filePermitCounts || data.fileAccessCounts || {});
    const fc = Object.entries(fileCountsSource).sort((a,b)=>b[1]-a[1]).slice(0,8);
    chartInstances['chartFiles'] = new Chart(document.getElementById('chartFiles'),{
      type:'bar',
      data:{
        labels:fc.map(s=>s[0]),
        datasets:[{
          label:'PERMIT',
          data:fc.map(s=>s[1]),
          backgroundColor:CC.blue,
          borderRadius:4
        }]
      },
      options:{
        ...CDef,
        indexAxis:'y',
        plugins:{
          ...CDef.plugins,
          legend:{display:false},
          tooltip:{
            callbacks:{
              title:(items)=>items?.[0]?.label || '',
              label:(ctx)=>`PERMIT: ${ctx.raw}`
            }
          }
        }
      }
    });

    // Users bar
    destroyChart('chartUsers');
    const uc = Object.entries(data.userAccessCounts||{}).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const palette = [CC.blue,CC.green,CC.teal,CC.amber,CC.purple,CC.pink,CC.red,'#6ee7b7'];
    chartInstances['chartUsers'] = new Chart(document.getElementById('chartUsers'),{type:'bar',data:{labels:uc.map(s=>s[0]),datasets:[{data:uc.map(s=>s[1]),backgroundColor:uc.map((_,i)=>palette[i%palette.length]),borderRadius:4}]},options:CDef});

    // Timeline
    destroyChart('chartTimeline');
    const buckets = {};
    for (let h=23;h>=0;h--) buckets[String(h).padStart(2,'0')+':00']={PERMIT:0,DENY:0};
    (data.last24h||[]).forEach(e=>{if(!e.timestamp)return;const h=e.timestamp.substring(11,13)+':00';if(buckets[h]){if(e.decision==='PERMIT')buckets[h].PERMIT++;else buckets[h].DENY++;}});
    const tLabels=Object.keys(buckets).reverse();
    chartInstances['chartTimeline']=new Chart(document.getElementById('chartTimeline'),{type:'bar',data:{labels:tLabels,datasets:[{label:'PERMIT',data:tLabels.map(l=>buckets[l].PERMIT),backgroundColor:CC.green,borderRadius:3},{label:'DENY',data:tLabels.map(l=>buckets[l].DENY),backgroundColor:CC.red,borderRadius:3}]},options:{...CDef,plugins:{legend:{display:true,position:'top',labels:{color:'#8899b4',font:{size:10},boxWidth:12,padding:10}}},scales:{...CDef.scales,x:{...CDef.scales.x,stacked:true},y:{...CDef.scales.y,stacked:true}}}});
  } catch {}
}

// ================================================================
// STATS
// ================================================================
async function loadStats() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/files/health');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('statFiles').textContent = data.registeredFiles + (data.pendingFiles > 0 ? ' (+' + data.pendingFiles + ' pending)' : '');
      _adminHealthData = data;
      updateAdminOpsPanel();
    }
  } catch {}
}
async function loadAnomalies() {
  try {
    const showAll = document.getElementById('showAllAnomalies')?.checked ? '?all=true' : '';
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/anomalies' + showAll, { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _anomalyStatsData = data.stats || {};
    updateAdminOpsPanel();

    // Stats badges
    const statsDiv = document.getElementById('anomalyStats');
    if (statsDiv && data.stats) {
      const byType = data.stats.byType || {};
      let html = '';
      const typeColors = {
        'BURST': 'var(--red)',
        'TRUST_JUMP': 'var(--amber)',
        'SENSITIVITY_ESCALATION': 'var(--purple, #a78bfa)'
      };
      const typeLabels = {
        'BURST': 'Burst',
        'TRUST_JUMP': 'Trust jump',
        'SENSITIVITY_ESCALATION': 'Escalation'
      };
      for (const [type, count] of Object.entries(byType)) {
        const color = typeColors[type] || 'var(--text3)';
        const label = typeLabels[type] || type;
        html += `<span style="font-size:10px;font-family:var(--mono);padding:3px 8px;border-radius:4px;background:rgba(0,0,0,0.1);color:${color}">${label}: ${count}</span>`;
      }
      if (data.stats.unreviewed > 0) {
        html += `<span style="font-size:10px;font-family:var(--mono);padding:3px 8px;border-radius:4px;background:rgba(248,113,113,0.15);color:var(--red)">${data.stats.unreviewed} unreviewed</span>`;
      }
      statsDiv.innerHTML = html;
    }

    // Toggle Review all / Delete all buttons
    const hasUnreviewed = (data.stats?.unreviewed || 0) > 0;
    const hasAlerts = (data.stats?.totalAlerts || 0) > 0;
    const btnReviewAll = document.getElementById('btnReviewAllAnomalies');
    const btnDeleteAll = document.getElementById('btnDeleteAllAnomalies');
    if (btnReviewAll) btnReviewAll.style.display = hasUnreviewed ? '' : 'none';
    if (btnDeleteAll) btnDeleteAll.style.display = hasAlerts ? '' : 'none';

    // Count badge
    const countEl = document.getElementById('anomalyCount');
    if (countEl) {
      const unreviewed = data.stats?.unreviewed || 0;
      countEl.textContent = unreviewed > 0 ? (unreviewed + ' new') : '';
    }

    // Alert table
    let alerts = data.alerts || [];
    if (_adminQuickFilter === 'anomalies') {
      alerts = alerts.filter(a => !a.reviewed);
    }
    if (alerts.length === 0) {
      document.getElementById('anomalyContainer').innerHTML = '<div class="empty" style="color:var(--green)">No anomalies detected</div>';
      return;
    }

    const container = document.getElementById('anomalyContainer');
    const expanded = container.dataset.expanded === 'true';
    const visible = expanded ? alerts : alerts.slice(0, TABLE_LIMIT);

    let html = '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Type</th><th>Description</th><th>Severity</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    visible.forEach(a => {
      const sevColor = a.severity >= 0.7 ? 'var(--red)' : a.severity >= 0.4 ? 'var(--amber)' : 'var(--text2)';
      const sevBar = `<div style="width:50px;height:4px;border-radius:2px;background:var(--border)"><div style="width:${Math.round(a.severity*100)}%;height:100%;border-radius:2px;background:${sevColor}"></div></div><span style="font-size:9px;color:${sevColor}">${(a.severity*100).toFixed(0)}%</span>`;
      const typeClass = a.type === 'BURST' ? 'off' : a.type === 'TRUST_JUMP' ? 'pending' : 'on';
      const safeType = escapeHtml(a.type || '');
      const safeTimestamp = escapeHtml(a.timestamp ? a.timestamp.substring(0,16).replace('T',' ') : '?');
      const statusBadge = a.reviewed
        ? '<span style="font-size:9px;color:var(--text3);font-family:var(--mono)">reviewed</span>'
        : '<span style="font-size:9px;color:var(--red);font-family:var(--mono)">new</span>';
      const idx = a.index;
      const reviewBtn = a.reviewed ? '' : `<button class="btn-sm" style="color:var(--accent);font-size:9px" onclick="reviewAnomaly(${idx})">Review</button>`;
      const deleteBtn = `<button class="btn-sm" style="color:var(--red);font-size:9px" onclick="deleteAnomaly(${idx})">Delete</button>`;
      html += `<tr>
        <td style="font-size:10px;white-space:nowrap">${safeTimestamp}</td>
        <td><a href="profile.html?user=${encodeURIComponent(a.username)}" style="color:${userColor(a.username)};text-decoration:none;cursor:pointer">${escapeHtml(a.username)}</a></td>
        <td><span class="badge badge-${typeClass}" style="font-size:9px">${safeType}</span></td>
        <td style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(a.description)}">${escapeHtml(a.description)}</td>
        <td>${sevBar}</td>
        <td>${statusBadge}</td>
        <td style="white-space:nowrap">${reviewBtn} ${deleteBtn}</td>
      </tr>`;
    });
    html += '</tbody></table>';

    if (alerts.length > TABLE_LIMIT) {
      const rem = alerts.length - TABLE_LIMIT;
      html += expanded
        ? '<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand(\'anomalyContainer\',false)">Show less</button></div>'
        : `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('anomalyContainer',true)">Show ${rem} more (${alerts.length} total)</button></div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    document.getElementById('anomalyContainer').innerHTML = '<div class="empty" style="color:var(--red)">Failed to load anomalies</div>';
  }
}

// ================================================================
// ANOMALY REVIEW & DELETE
// ================================================================
async function markAllReviewed() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/anomalies/review-all', {
      method: 'POST',
      headers: authHeaders(false)
    });
    if (res.ok) {
      const data = await res.json();
      toast(data.count + ' alerts reviewed', 'ok');
      loadAnomalies();
    } else {
      toast('Failed to review alerts', 'err');
    }
  } catch {
    toast('Failed to review alerts', 'err');
  }
}

async function reviewAnomaly(index) {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/anomalies/review/' + index, {
      method: 'POST',
      headers: authHeaders(false)
    });
    if (res.ok) {
      toast('Alert reviewed', 'ok');
      loadAnomalies();
    } else {
      toast('Failed to review alert', 'err');
    }
  } catch {
    toast('Failed to review alert', 'err');
  }
}

async function deleteAnomaly(index) {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/anomalies/' + index, {
      method: 'DELETE',
      headers: authHeaders(false)
    });
    if (res.ok) {
      toast('Alert deleted', 'ok');
      loadAnomalies();
    } else {
      toast('Failed to delete alert', 'err');
    }
  } catch {
    toast('Failed to delete alert', 'err');
  }
}

async function deleteAllAnomalies() {
  if (!confirm('Delete all anomaly alerts? This cannot be undone.')) return;
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin/anomalies', {
      method: 'DELETE',
      headers: authHeaders(false)
    });
    if (res.ok) {
      const data = await res.json();
      toast(data.count + ' alerts deleted', 'ok');
      loadAnomalies();
    } else {
      toast('Failed to delete alerts', 'err');
    }
  } catch {
    toast('Failed to delete alerts', 'err');
  }
}

function handleAdminLiveEvent(event) {
  const payload = event && event.payload ? event.payload : {};
  const type = payload.type || '';
  const data = payload.data || {};

  if (type === 'FILE_UPLOADED' || type === 'FILE_APPROVED' || type === 'FILE_REJECTED' || type === 'FILE_DELETED') {
    loadFiles();
    loadStats();
    if (type === 'FILE_UPLOADED' && data.fileId) {
      toast('New file waiting: ' + data.fileId, 'ok');
    }
    return;
  }

  if (type === 'USER_REGISTERED' || type === 'USER_STATUS_CHANGED' || type === 'USER_ROLE_CHANGED'
      || type === 'USER_TRUST_CHANGED' || type === 'USER_DELETED') {
    loadUsers();
    if (type === 'USER_REGISTERED' && data.username) {
      toast('New user waiting: ' + data.username, 'ok');
    }
  }
}

function installAdminLiveEvents() {
  if (_adminLiveEvents) return;
  _adminLiveEvents = connectCaacEvents(handleAdminLiveEvent);
}

// ================================================================
// INIT
// ================================================================
window.addEventListener('DOMContentLoaded', async () => {
  const ok = await checkAdmin();
  if (!ok) return;
  await Promise.all([loadUsers(), loadFiles(), loadConversations(), loadAudit(), loadStats(), loadAnalytics(), loadAnomalies()]);
  installAdminLiveEvents();
  caacVisibleInterval(loadUsers, 10000);
  caacVisibleInterval(loadFiles, 15000);
  caacVisibleInterval(loadConversations, 5000);
  caacVisibleInterval(() => { if (activeConversation) loadConversationMessages(); }, 3000);
  caacVisibleInterval(loadAudit, 10000);
  caacVisibleInterval(loadStats, 10000);
  caacVisibleInterval(loadAnalytics, 30000);
  caacVisibleInterval(loadAnomalies, 15000);
});
