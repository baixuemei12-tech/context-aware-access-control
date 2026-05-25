/* ============================================================
   CAAC — Messages page logic
   Loads conversation with admin, sends messages, marks as read
   ============================================================ */

let myUsername = null;

async function init() {
  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return; }

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/me', { headers: authHeaders(false) });
    if (!res.ok) { clearAuthStorage(); window.location.href = 'login.html'; return; }
    const data = await res.json();
    setAuthSession(token, { ...data.user, _isAdmin: !!data.isAdmin || data.user.rSub === 5 });
    myUsername = data.user.username;

    // Admins should use admin panel for messages
    if (data.isAdmin) {
      window.location.href = 'admin.html';
      return;
    }

    await markAllRead();
    await loadMessages();
    checkAdminStatus();
    caacVisibleInterval(loadMessages, 3000);
    caacVisibleInterval(checkAdminStatus, 15000);
  } catch {
    window.location.href = 'login.html';
  }
}

async function markAllRead() {
  try {
    await fetch(GATEWAY_URL + '/api/auth/messages/read-all', {
      method: 'POST', headers: authHeaders(false)
    });
  } catch {}
}

async function loadMessages() {
  const area = document.getElementById('msgArea');
  if (!area) return;

  try {
    // This endpoint marks messages from admin as read
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/with/admin', { headers: authHeaders(false) });
    if (!res.ok) return;
    const data = await res.json();
    const msgs = data.messages || [];

    if (msgs.length === 0) {
      area.innerHTML = '<div class="msg-empty">No messages yet. Say hello to the admin!</div>';
      return;
    }

    const wasAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 40;

    let html = '';
    msgs.forEach(m => {
      const isMe = m.from === myUsername;
      const cls = isMe ? 'bubble-mine' : 'bubble-theirs';
      const time = m.timestamp ? m.timestamp.substring(11, 16) : '';
      const sender = isMe ? '' : `<div class="bubble-sender">${escapeHtml(m.from)}</div>`;

      html += `<div class="bubble ${cls}">
        ${sender}
        <div class="bubble-content">${escapeHtml(m.content)}</div>
        <div class="bubble-meta">${time}</div>
      </div>`;
    });

    area.innerHTML = html;

    // Auto-scroll to bottom if user was already at bottom
    if (wasAtBottom) {
      area.scrollTop = area.scrollHeight;
    }
  } catch {}
}

async function sendMsg() {
  const input = document.getElementById('msgInput');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.focus();

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/messages/send', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ to: 'admin', message: msg })
    });
    if (res.ok) {
      await loadMessages();
      // Scroll to bottom after sending
      const area = document.getElementById('msgArea');
      if (area) area.scrollTop = area.scrollHeight;
    }
  } catch {}
}

async function checkAdminStatus() {
  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/admin-status', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = await res.json();
    const dot = document.getElementById('adminDot');
    const txt = document.getElementById('adminStatusText');
    if (dot && txt) {
      if (data.adminOnline) {
        dot.style.background = 'var(--green)';
        dot.style.opacity = '1';
        txt.textContent = 'Online';
        txt.style.color = 'var(--green)';
      } else {
        dot.style.background = 'var(--text3)';
        dot.style.opacity = '0.4';
        txt.textContent = 'Offline';
        txt.style.color = 'var(--text3)';
      }
    }
  } catch {}
}

window.addEventListener('DOMContentLoaded', init);
