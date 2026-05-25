/* ============================================================
   CAAC — Profile page logic (v3.1)
   Features: verification badges, about section, collapsible tables,
             2FA setup with QR code, password change,
             admin read-only view of personal info + about me
   ============================================================ */

let viewingUser = null;
let isOwnProfile = true;
const PROFILE_TABLE_LIMIT = 5;

// ================================================================
// INIT
// ================================================================
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const targetUser = params.get('user');

  try {
    const meRes = await fetch(GATEWAY_URL + '/api/auth/me', { headers: authHeaders(false) });
    if (!meRes.ok) { clearAuthStorage(); window.location.href = 'login.html'; return; }
    const meData = await meRes.json();
    setAuthSession(getToken(), { ...meData.user, _isAdmin: !!meData.isAdmin || meData.user.rSub === 5 });
    await ensureCsrfToken();

    if (targetUser && targetUser.toLowerCase() !== meData.user.username.toLowerCase()) {
      if (!meData.isAdmin) { alert('Admin access required'); window.location.href = 'profile.html'; return; }
      isOwnProfile = false;
      viewingUser = targetUser;
      const usersRes = await fetch(GATEWAY_URL + '/api/auth/admin/users', { headers: authHeaders(false) });
      if (!usersRes.ok) { alert('Failed to load user directory'); window.location.href = 'admin.html'; return; }
      const usersData = await usersRes.json();
      const usersList = Array.isArray(usersData?.users) ? usersData.users : [];
      // Fix: case-insensitive match. Usernames are stored in their original case
      // but the URL param may differ (e.g. "Alice" vs "alice"). Without this the
      // click-username-to-profile feature in admin.js silently fails on any
      // case mismatch and redirects to admin.html with "User not found".
      const needle = targetUser.toLowerCase();
      const target = usersList.find(u => u && typeof u.username === 'string'
          && u.username.toLowerCase() === needle);
      if (!target) { alert('User not found'); window.location.href = 'admin.html'; return; }
      // Normalise viewingUser to the canonical case so downstream API calls
      // (by-user, audit filter, about) use the stored casing consistently.
      viewingUser = target.username;
      displayProfile(target);
    } else {
      isOwnProfile = true;
      viewingUser = meData.user.username;
      displayProfile(meData.user);
    }
    loadUserFiles();
    loadAccessHistory();

    if (!isOwnProfile) {
      // Hide editable sections
      const editCard = document.getElementById('editCard');
      const aboutCard = document.getElementById('aboutCard');
      const securityCard = document.getElementById('securityCard');
      if (editCard) editCard.style.display = 'none';
      if (aboutCard) aboutCard.style.display = 'none';
      if (securityCard) securityCard.style.display = 'none';

      // Show read-only personal info
      const viewInfoCard = document.getElementById('viewInfoCard');
      if (viewInfoCard) {
        viewInfoCard.style.display = 'block';
        const target = _viewingUserData;
        document.getElementById('view-name').textContent = target ? (target.displayName || '—') : '—';
        document.getElementById('view-org').textContent = target ? (target.organization || '—') : '—';
      }

      // Load and show read-only about
      loadAboutReadOnly();
    } else {
      loadAbout();
      load2FAStatus();
    }
  } catch (err) {
    // auth check failed, redirect
    window.location.href = 'login.html';
  }
});

let _viewingUserData = null;

function updateProfileCommand(user) {
  const trust = Number(user.tSub);
  const trustPct = Number.isFinite(trust) ? Math.max(0, Math.min(100, trust * 100)) : 0;
  const orb = document.getElementById('profileTrustOrb');
  if (orb) orb.style.setProperty('--trust-angle', (trustPct * 3.6).toFixed(0) + 'deg');
  const trustVal = document.getElementById('profileTrustValue');
  if (trustVal) trustVal.textContent = Number.isFinite(trust) ? trust.toFixed(2) : '—';

  const roleChip = document.getElementById('profileRoleChip');
  if (roleChip) roleChip.textContent = user.roleLabel || (ROLE_LABELS[user.rSub] || '—');

  const verified = [user.emailVerified, user.phoneVerified].filter(Boolean).length;
  const verifyChip = document.getElementById('profileVerifyChip');
  if (verifyChip) verifyChip.textContent = verified === 2 ? 'complete' : verified === 1 ? 'partial' : 'unverified';

  const riskState = document.getElementById('profileRiskState');
  if (riskState) {
    const label = user.status !== 'ACTIVE' ? 'blocked' : trust >= 0.75 ? 'low risk' : trust >= 0.5 ? 'normal' : 'watch';
    riskState.textContent = label;
    riskState.className = 'badge ' + (label === 'low risk' || label === 'normal' ? 'badge-auto' : label === 'watch' ? 'badge-user' : 'badge-blocked');
  }

  const device = document.getElementById('profileDeviceChip');
  const deviceHint = document.getElementById('profileDeviceHint');
  const platform = navigator.platform || navigator.userAgentData?.platform || 'unknown';
  if (device) device.textContent = platform.split(' ')[0] || platform;
  if (deviceHint) deviceHint.textContent = `${screen.width}x${screen.height}, ${screen.colorDepth}-bit`;

  const network = document.getElementById('profileNetworkChip');
  if (network) {
    const conn = navigator.connection;
    const label = conn ? (conn.type && conn.type !== 'unknown' ? conn.type : conn.effectiveType || 'unknown') : 'browser';
    network.textContent = label;
  }
}

function updateProfile2FAChip(label, good) {
  const chip = document.getElementById('profile2faChip');
  if (!chip) return;
  chip.textContent = label;
  chip.style.color = good ? 'var(--green)' : label === 'pending' ? 'var(--amber)' : 'var(--red)';
}

function updateProfileHistorySummary(entries) {
  const chip = document.getElementById('profileAccessChip');
  if (!chip) return;
  if (!entries || entries.length === 0) {
    chip.textContent = 'none';
    chip.style.color = 'var(--text3)';
    return;
  }
  const permit = entries.filter(e => e.decision === 'PERMIT').length;
  const denied = entries.filter(e => e.decision === 'DENY' || e.decision === 'REVOKED').length;
  chip.textContent = `${permit}/${denied}`;
  chip.style.color = denied > 0 ? 'var(--amber)' : 'var(--green)';
}

// ================================================================
// DISPLAY PROFILE
// ================================================================
function displayProfile(user) {
  _viewingUserData = user;
  document.getElementById('profileTitle').textContent = user.displayName || user.username;
  document.getElementById('profileSubtitle').textContent = user.roleLabel;
  document.getElementById('avatarMark').textContent = (user.displayName || user.username || '?')[0].toUpperCase();

  document.getElementById('info-user').textContent = user.username;
  document.getElementById('info-id').textContent = '—';
  document.getElementById('info-role').textContent = user.roleLabel;
  document.getElementById('info-trust').textContent = user.tSub;
  document.getElementById('info-status').textContent = user.status;
  document.getElementById('info-regdate').textContent = user.registeredAt ? user.registeredAt.substring(0, 10) : '\u2014';
  document.getElementById('info-lastlogin').textContent = user.lastLoginAt ? user.lastLoginAt.substring(0, 16).replace('T', ' ') : '\u2014';
  document.getElementById('badgeRole').textContent = user.roleLabel;

  document.getElementById('info-email').textContent = user.email || 'Not set';
  document.getElementById('info-phone').textContent = user.phone || 'Not set';

  const emailBadge = document.getElementById('emailBadge');
  if (user.email) {
    emailBadge.style.display = 'inline';
    if (user.emailVerified) {
      emailBadge.textContent = '\u2713 verified';
      emailBadge.style.color = 'var(--green)'; emailBadge.style.background = 'rgba(52,211,153,0.1)';
    } else {
      emailBadge.textContent = '\u2717 unverified';
      emailBadge.style.color = 'var(--red)'; emailBadge.style.background = 'rgba(248,113,113,0.1)';
    }
  }

  const phoneBadge = document.getElementById('phoneBadge');
  if (user.phone) {
    phoneBadge.style.display = 'inline';
    if (user.phoneVerified) {
      phoneBadge.textContent = '\u2713 verified';
      phoneBadge.style.color = 'var(--green)'; phoneBadge.style.background = 'rgba(52,211,153,0.1)';
    } else {
      phoneBadge.textContent = '\u2717 unverified';
      phoneBadge.style.color = 'var(--red)'; phoneBadge.style.background = 'rgba(248,113,113,0.1)';
    }
  }

  if (isOwnProfile) {
    document.getElementById('pf-name').value = user.displayName || '';
    document.getElementById('pf-org').value = user.organization || '';
  }
  updateProfileCommand(user);
}

// ================================================================
// SAVE PROFILE
// ================================================================
async function saveProfile() {
  const btn = document.getElementById('btnSave');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/profile', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({
        displayName: document.getElementById('pf-name').value,
        organization: document.getElementById('pf-org').value
      })
    });
    if (res.ok) toast('Profile saved', 'ok');
    else toast('Save failed', 'err');
  } catch (e) { toast('Save failed', 'err'); }
  btn.disabled = false; btn.textContent = 'Save changes';
}

// ================================================================
// 2FA
// ================================================================
let pending2FASecret = null;

async function load2FAStatus() {
  const badge = document.getElementById('twofaBadge');
  const actions = document.getElementById('twofaActions');
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/2fa/status', { headers: authHeaders(false) });
    if (!res.ok) { badge.textContent = 'unavailable'; badge.className = 'security-badge badge-off'; return; }
    const data = await res.json();
    if (data.enabled) {
      badge.textContent = '\u2713 enabled'; badge.className = 'security-badge badge-on';
      actions.innerHTML = '<button class="btn-primary" style="background:var(--red);font-size:12px;padding:6px 16px" onclick="disable2FA()">Disable 2FA</button>';
      updateProfile2FAChip('enabled', true);
    } else if (data.pending) {
      badge.textContent = 'pending confirmation'; badge.className = 'security-badge badge-pending';
      actions.innerHTML = '<button class="btn-primary" style="font-size:12px;padding:6px 16px" onclick="setup2FA()">Continue setup</button>';
      updateProfile2FAChip('pending', false);
    } else {
      badge.textContent = '\u2717 not enabled'; badge.className = 'security-badge badge-off';
      actions.innerHTML = '<button class="btn-primary" style="font-size:12px;padding:6px 16px" onclick="setup2FA()">Set up 2FA</button>';
      updateProfile2FAChip('off', false);
    }
  } catch { badge.textContent = 'error'; badge.className = 'security-badge badge-off'; updateProfile2FAChip('unknown', false); }
}

async function setup2FA() {
  const setupDiv = document.getElementById('twofaSetup');
  setupDiv.style.display = 'block';
  setupDiv.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span> Generating secret...</div>';
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/2fa/setup', { method: 'POST', headers: authHeaders(false) });
    const data = await res.json();
    if (!res.ok) {
      setupDiv.innerHTML = '<div style="color:var(--red);font-size:12px">' + escapeHtml(data.error || 'Setup failed') + '</div>';
      return;
    }
    pending2FASecret = data.secret;
    const safeSecret = escapeHtml(data.secret || '');
    setupDiv.innerHTML = `
      <div style="text-align:center;padding:10px 0">
        <div style="font-size:13px;font-weight:500;margin-bottom:6px">Step 1: Scan this QR code</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:12px">Open Google Authenticator (or any TOTP app) and scan this code</div>
        <div class="qr-wrap" id="qrContainer"></div>
        <div style="font-size:11px;color:var(--text3);margin:8px 0 4px">Or enter this secret manually:</div>
        <div class="secret-code" id="twofaSecretCode" style="cursor:pointer">Click to reveal secret</div>
        <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:10px">
          <div style="font-size:13px;font-weight:500;margin-bottom:6px">Step 2: Enter the 6-digit code</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:10px">Type the code currently showing in your authenticator app</div>
          <input type="text" id="totp-confirm-code" class="totp-confirm-input" placeholder="000000" maxlength="6" oninput="this.value=this.value.replace(/\\D/g,'')" autocomplete="one-time-code">
          <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
            <button class="btn-primary" style="font-size:12px;padding:8px 20px" onclick="confirm2FA()">Confirm & Enable</button>
            <button class="btn-primary" style="font-size:12px;padding:8px 20px;background:var(--text3)" onclick="cancel2FASetup()">Cancel</button>
          </div>
        </div>
      </div>`;
    const secretCodeEl = document.getElementById('twofaSecretCode');
    if (secretCodeEl) {
      let revealed = false;
      secretCodeEl.addEventListener('click', async () => {
        if (!revealed) {
          secretCodeEl.textContent = pending2FASecret || '';
          revealed = true;
          return;
        }
        try {
          await navigator.clipboard.writeText(pending2FASecret || '');
          toast('Secret copied', 'ok');
        } catch {
          toast('Copy failed', 'err');
        }
      });
    }
    const qrDiv = document.getElementById('qrContainer');
    if (qrDiv && typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, { text: data.provisioningUri, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }
    setTimeout(() => { const input = document.getElementById('totp-confirm-code'); if (input) input.focus(); }, 100);
  } catch (err) { setupDiv.innerHTML = '<div style="color:var(--red);font-size:12px">Setup failed</div>'; }
}

async function confirm2FA() {
  const code = document.getElementById('totp-confirm-code').value.trim();
  if (!code || code.length !== 6) { toast('Enter the 6-digit code', 'err'); return; }
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/2fa/confirm', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ code }) });
    const data = await res.json();
    if (res.ok) { toast('2FA enabled successfully!', 'ok'); document.getElementById('twofaSetup').style.display = 'none'; pending2FASecret = null; load2FAStatus(); }
    else { toast(data.error || 'Invalid code', 'err'); document.getElementById('totp-confirm-code').value = ''; document.getElementById('totp-confirm-code').focus(); }
  } catch (err) { toast('Confirmation failed', 'err'); }
}

function cancel2FASetup() { document.getElementById('twofaSetup').style.display = 'none'; pending2FASecret = null; }

async function disable2FA() {
  const code = prompt('Enter your current authenticator code to disable 2FA:');
  if (!code || code.length !== 6) { toast('Valid 6-digit code required', 'err'); return; }
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/2fa/disable', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ code }) });
    if (res.ok) { toast('2FA disabled', 'ok'); load2FAStatus(); } else { const d = await res.json(); toast(d.error || 'Invalid code', 'err'); }
  } catch (err) { toast('Disable failed', 'err'); }
}

// ================================================================
// PASSWORD CHANGE
// ================================================================
function checkPwStrength() {
  const pw = document.getElementById('pw-new').value;
  const bar = document.getElementById('pwStrength');
  if (!pw) { bar.style.width = '0%'; return; }
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct = Math.min(score / 4 * 100, 100);
  const color = pct < 40 ? 'var(--red)' : pct < 70 ? 'var(--amber)' : 'var(--green)';
  bar.style.width = pct + '%'; bar.style.background = color;
}

async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  if (!current || !newPw) { toast('Fill in all password fields', 'err'); return; }
  if (newPw.length < 8) { toast('Password must be at least 8 characters', 'err'); return; }
  if (!/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/[0-9]/.test(newPw) || !/[^A-Za-z0-9]/.test(newPw)) {
    toast('Password must include uppercase, lowercase, number, and symbol', 'err');
    return;
  }
  if (newPw !== confirm) { toast('New passwords do not match', 'err'); return; }
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/change-password', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ currentPassword: current, newPassword: newPw }) });
    const data = await res.json();
    if (res.ok) { toast('Password changed', 'ok'); document.getElementById('pw-current').value = ''; document.getElementById('pw-new').value = ''; document.getElementById('pw-confirm').value = ''; document.getElementById('pwStrength').style.width = '0%'; }
    else { toast(data.error || 'Password change failed', 'err'); }
  } catch (err) { toast('Password change failed', 'err'); }
}

// ================================================================
// ABOUT ME — editable (own profile)
// ================================================================
async function loadAbout() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/about/' + encodeURIComponent(viewingUser), { headers: authHeaders(false) });
    if (!res.ok) return;
    const data = await res.json();
    if (isOwnProfile) {
      document.getElementById('pf-fullname').value = data.fullName || '';
      document.getElementById('pf-age').value = data.age || '';
      document.getElementById('pf-location').value = data.location || '';
      document.getElementById('pf-occupation').value = data.occupation || '';
      document.getElementById('pf-interests').value = data.interests || '';
      document.getElementById('pf-bio').value = data.bio || '';
    }
  } catch {}
}

async function saveAbout() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/about', { method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ fullName: document.getElementById('pf-fullname').value, age: document.getElementById('pf-age').value, location: document.getElementById('pf-location').value, occupation: document.getElementById('pf-occupation').value, interests: document.getElementById('pf-interests').value, bio: document.getElementById('pf-bio').value }) });
    if (res.ok) toast('About info saved', 'ok'); else toast('Save failed', 'err');
  } catch (e) { toast('Save failed', 'err'); }
}

// ================================================================
// ABOUT ME — read-only (admin viewing other user)
// ================================================================
async function loadAboutReadOnly() {
  const card = document.getElementById('viewAboutCard');
  const list = document.getElementById('viewAboutList');
  if (!card || !list) return;

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/about/' + encodeURIComponent(viewingUser), { headers: authHeaders(false) });
    if (!res.ok) return;
    const data = await res.json();

    const fields = [
      { key: 'fullName', label: 'full name' },
      { key: 'age', label: 'age' },
      { key: 'location', label: 'location' },
      { key: 'occupation', label: 'occupation' },
      { key: 'interests', label: 'interests' },
      { key: 'bio', label: 'bio' }
    ];

    const hasData = fields.some(f => {
      const raw = data[f.key];
      return String(raw ?? '').trim().length > 0;
    });
    if (!hasData) { list.innerHTML = '<div class="empty">No about info provided</div>'; card.style.display = 'block'; return; }

    let html = '';
    fields.forEach(f => {
      const raw = data[f.key];
      const val = String(raw ?? '').trim() || '\u2014';
      html += `<div class="info-row"><span class="info-k">${f.label}</span><span class="info-v">${escapeHtml(val)}</span></div>`;
    });
    list.innerHTML = html;
    card.style.display = 'block';
  } catch {
    list.innerHTML = '<div class="empty">Could not load about info</div>';
    card.style.display = 'block';
  }
}

// ================================================================
// COLLAPSIBLE TABLE HELPER
// ================================================================
function makeCollapsible(containerId, rows, renderFn, columns) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (rows.length === 0) { container.innerHTML = '<div class="empty">No data</div>'; return; }
  const expanded = container.dataset.expanded === 'true';
  const visible = expanded ? rows : rows.slice(0, PROFILE_TABLE_LIMIT);
  let html = `<table class="data-table"><thead><tr>${columns.map(c => '<th>' + c + '</th>').join('')}</tr></thead><tbody>`;
  visible.forEach(row => { html += renderFn(row); });
  html += '</tbody></table>';
  if (rows.length > PROFILE_TABLE_LIMIT) {
    const rem = rows.length - PROFILE_TABLE_LIMIT;
    html += expanded
      ? `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('${containerId}',false)">Show less</button></div>`
      : `<div style="text-align:center;margin-top:8px"><button class="btn-sm" style="color:var(--accent)" onclick="toggleExpand('${containerId}',true)">Show ${rem} more (${rows.length} total)</button></div>`;
  }
  container.innerHTML = html;
}

function toggleExpand(id, expand) {
  const c = document.getElementById(id);
  if (c) c.dataset.expanded = expand ? 'true' : 'false';
  if (id === 'filesContainer') loadUserFiles();
  else if (id === 'historyContainer') loadAccessHistory();
}

// ================================================================
// USER FILES
// ================================================================
async function loadUserFiles() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/files/by-user/' + encodeURIComponent(viewingUser), { headers: authHeaders(false) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const files = data.files || [];
    makeCollapsible('filesContainer', files, f =>
      `<tr><td>${escapeHtml(f.fileId)}</td><td>${f.sLevel}</td><td>${f.pReq}</td><td><span class="badge badge-${f.status === 'APPROVED' ? 'on' : f.status === 'PENDING' ? 'pending' : 'off'}">${f.status}</span></td></tr>`,
      ['File', 'S_level', 'P_req', 'Status']
    );
  } catch { document.getElementById('filesContainer').innerHTML = '<div class="empty">No files uploaded</div>'; }
}

// ================================================================
// ACCESS HISTORY
// ================================================================
async function loadAccessHistory() {
  try {
    let entries = [];
    if (isOwnProfile) {
      const res = await fetch(GATEWAY_URL + '/api/auth/audit?limit=50', { headers: authHeaders(false) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      entries = data.entries || [];
    } else {
      const res = await fetch(GATEWAY_URL + '/api/auth/admin/audit?limit=500', { headers: authHeaders(false) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      entries = (data.entries || []).filter(e => e.username === viewingUser);
    }
    makeCollapsible('historyContainer', entries, e => {
      const cls = e.decision === 'PERMIT' ? 'ok' : e.decision === 'REVOKED' ? 'warn' : 'err';
      return `<tr><td style="font-size:10px">${e.timestamp}</td><td>${escapeHtml(e.fileId)}</td>
        <td><span class="badge badge-${cls === 'ok' ? 'on' : cls === 'warn' ? 'pending' : 'off'}">${e.decision}</span></td>
        <td>${typeof e.dtScore === 'number' ? e.dtScore.toFixed(3) : '—'}</td>
        <td>${typeof e.riskMargin === 'number' ? e.riskMargin.toFixed(3) : '—'}</td></tr>`;
    }, ['Time', 'File', 'Decision', 'DT_score', 'Margin']);
    updateProfileHistorySummary(entries);
  } catch {
    document.getElementById('historyContainer').innerHTML = '<div class="empty">No access history</div>';
    updateProfileHistorySummary([]);
  }
}

// ================================================================
// TOAST
// ================================================================
function toast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + (type === 'ok' ? 'toast-ok' : 'toast-err');
  setTimeout(() => { t.className = 'toast'; }, 3000);
}
