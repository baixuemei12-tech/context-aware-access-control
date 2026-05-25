/* ============================================================
   CAAC System — Login / Signup / Verification Logic
   Handles: CAPTCHA, mandatory email verification, optional phone OTP (toggle), TOTP 2FA

   2FA (v3.0):
   When server returns {requires2FA: true}, the login form hides
   and a TOTP code input appears. The stored username/password
   are resent with the TOTP code on submission.
   ============================================================ */

let pendingUsername = null;
let loginCaptchaRequired = false;
let hcaptchaLoaded = false;
let captchaSitekey = null;
let captchaEnabled = false;         // set from backend captcha-config
let captchaType = 'math';           // 'math' or 'hcaptcha'
let phoneVerificationEnabled = false;
let emailVerificationEnabled = true;

// 2FA state — stores credentials while waiting for TOTP code
let pending2FA = null; // { username, password, captchaToken, captchaAnswer }

/**
 * Load hCaptcha script and render widget dynamically.
 * Only called when the backend actually requires CAPTCHA.
 */
function loadCaptchaWidget(containerId) {
  if (!captchaSitekey) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.style.display = 'flex';
  container.innerHTML = '';

  if (!hcaptchaLoaded) {
    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?onload=onHCaptchaLoad&render=explicit';
    script.async = true;
    script.onerror = () => {
      container.style.display = 'flex';
      container.innerHTML = '<div style="font-size:11px;color:#ff6b6b;font-family:monospace">CAPTCHA failed to load. Check network/CSP and reload.</div>';
      hcaptchaLoaded = false;
    };
    window._pendingCaptchaContainer = containerId;
    document.head.appendChild(script);
    hcaptchaLoaded = true;
  } else {
    renderCaptchaIn(containerId);
  }
}

async function loadMathCaptcha(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.style.display = 'flex';
  container.dataset.rendered = 'true';
  container.dataset.captchaToken = '';
  container.innerHTML = '<div style="font-size:11px;color:var(--text3);font-family:var(--mono)">Loading CAPTCHA…</div>';

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/captcha-challenge');
    const data = await res.json();
    if (!res.ok || !data.enabled || !data.token) throw new Error('challenge unavailable');

    container.dataset.captchaToken = data.token;
    const answerId = containerId + '-captcha-answer';
    container.innerHTML = `
      <div style="width:100%;max-width:360px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${escapeHtml(data.question || 'Solve CAPTCHA')}</div>
        <input id="${answerId}" type="text" inputmode="numeric" autocomplete="off"
          placeholder="Enter answer"
          style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text1);font-family:var(--mono);font-size:13px">
      </div>`;
  } catch {
    container.innerHTML = '<div style="font-size:11px;color:var(--red);font-family:var(--mono)">CAPTCHA unavailable. Reload page.</div>';
  }
}

function loadCaptchaByType(containerId) {
  if (!captchaEnabled) return;
  if (captchaType === 'math') {
    loadMathCaptcha(containerId);
    return;
  }
  loadCaptchaWidget(containerId);
}

function getCaptchaToken(containerId) {
  if (captchaType === 'math') {
    const container = document.getElementById(containerId);
    return container ? (container.dataset.captchaToken || '') : '';
  }
  return getCaptchaResponse(containerId);
}

function getCaptchaAnswer(containerId) {
  if (captchaType !== 'math') return '';
  const input = document.getElementById(containerId + '-captcha-answer');
  return input ? input.value.trim() : '';
}

function renderCaptchaIn(containerId) {
  if (typeof hcaptcha === 'undefined' || !captchaSitekey) return;
  const container = document.getElementById(containerId);
  if (!container || container.dataset.rendered) return;
  const div = document.createElement('div');
  container.appendChild(div);
  hcaptcha.render(div, { sitekey: captchaSitekey, theme: 'dark' });
  container.dataset.rendered = 'true';
}

window.onHCaptchaLoad = function() {
  if (window._pendingCaptchaContainer) {
    renderCaptchaIn(window._pendingCaptchaContainer);
  }
};

function getCaptchaResponse(containerId) {
  try {
    const container = document.getElementById(containerId);
    if (!container) return '';
    const textarea = container.querySelector('textarea[name="h-captcha-response"]');
    return textarea ? textarea.value : '';
  } catch { return ''; }
}


function resetCaptcha() {
  if (typeof hcaptcha !== 'undefined') {
    try { hcaptcha.reset(); } catch(e) {}
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('successMsg').style.display = 'none';
  document.getElementById('verifyStep').classList.remove('active');
  const approvalStep = document.getElementById('verifyApproval');
  if (approvalStep) approvalStep.style.display = 'none';
  document.getElementById('totpStep').classList.remove('active');
  pending2FA = null;

  if (tab === 'login') {
    document.querySelectorAll('.tab')[0].classList.add('active');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('signupForm').style.display = 'none';
    if (captchaEnabled && captchaType === 'math') {
      loadCaptchaByType('loginCaptchaRow');
    }
  } else if (tab === 'signup') {
    document.querySelectorAll('.tab')[1].classList.add('active');
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';
    if (captchaEnabled && (captchaType === 'math' || captchaSitekey)) {
      loadCaptchaByType('signupCaptchaRow');
    }
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('successMsg').style.display = 'none';
}
function showSuccess(msg) {
  const el = document.getElementById('successMsg');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('errorMsg').style.display = 'none';
}

async function readJsonBody(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function safeSignupError(data) {
  const msg = data && typeof data.error === 'string' ? data.error.trim() : '';
  if (!msg || msg.length > 180) return 'Could not create account. Check the fields and try again.';

  const safeExact = new Set([
    'CAPTCHA verification failed',
    'Username is required',
    'Email is required',
    'Invalid email format',
    'Invalid phone number format'
  ]);
  const safePrefixes = [
    'Too many registration attempts.',
    'Username must be ',
    'Username \'',
    'Password must '
  ];

  if (safeExact.has(msg) || safePrefixes.some(prefix => msg.startsWith(prefix))) {
    return msg;
  }
  return 'Could not create account. Check the fields and try again.';
}

// ================================================================
// LOGIN — with 2FA support
// ================================================================
async function doLogin() {
  const btn = document.getElementById('btnLogin');
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) { showError('Please fill in all fields'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Authenticating...';

  const payload = { username, password };

  // Send CAPTCHA token when available. Enforce it only when required by server policy.
  const loginCaptchaToken = getCaptchaToken('loginCaptchaRow');
  const loginCaptchaAnswer = getCaptchaAnswer('loginCaptchaRow');
  if (loginCaptchaToken) payload.captchaToken = loginCaptchaToken;
  if (loginCaptchaAnswer) payload.captchaAnswer = loginCaptchaAnswer;
  if (loginCaptchaRequired && !payload.captchaToken) {
    showError('Please complete the CAPTCHA');
    btn.disabled = false; btn.textContent = 'Login';
    return;
  }
  if (loginCaptchaRequired && captchaType === 'math' && !payload.captchaAnswer) {
    showError('Please answer the CAPTCHA');
    btn.disabled = false; btn.textContent = 'Login';
    return;
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await readJsonBody(res);

    if (!res.ok) {
      // ============================================================
      // 2FA REQUIRED — password correct, need TOTP code
      // ============================================================
      if (data.requires2FA) {
        pending2FA = {
          username,
          password,
          captchaToken: payload.captchaToken || '',
          captchaAnswer: payload.captchaAnswer || ''
        };
        // Hide login form, show TOTP step
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('totpStep').classList.add('active');
        document.getElementById('errorMsg').style.display = 'none';
        document.getElementById('totp-input').value = '';
        document.getElementById('totp-input').focus();
        btn.disabled = false; btn.textContent = 'Login';
        return;
      }

      if (data.error === 'Account pending administrator approval') {
        pendingUsername = username;
        showApprovalStep(username, data);
        btn.disabled = false; btn.textContent = 'Login';
        return;
      }

      if (data.error === 'Account blocked. Contact administrator.') {
        showError('Account blocked. Contact the administrator.');
        btn.disabled = false; btn.textContent = 'Login';
        return;
      }

      if (data.error === 'Account not verified') {
        pendingUsername = username;
        showVerificationStep(username);
        btn.disabled = false; btn.textContent = 'Login';
        return;
      }

      showError('Invalid credentials');
      btn.disabled = false; btn.textContent = 'Login';

      //refresh CAPTCHA if it was required
      if (loginCaptchaRequired) {
        if (captchaType === 'math') {
          loadMathCaptcha('loginCaptchaRow');
        } else if (typeof hcaptcha !== 'undefined') {
          try { hcaptcha.reset(); } catch(e) {}
        }
      }

      // Show CAPTCHA if server says it's required
      if (data.captchaRequired) {
        loginCaptchaRequired = true;
        loadCaptchaByType('loginCaptchaRow');
      }

      return;
    }

    // ============================================================
    // LOGIN SUCCESS
    // ============================================================
    setAuthSession(data.token, data.user);

    // Show 2FA warning for admins if not set up
    if (data.warning2FA) {
      showSuccess('Welcome back, ' + data.user.displayName + '! Note: ' + data.warning2FA);
      window.location.href = 'index.html';
    } else {
      showSuccess('Welcome back, ' + data.user.displayName + '!');
      window.location.href = 'index.html';
    }
  } catch (err) {
    showError('Service unavailable');
    btn.disabled = false; btn.textContent = 'Login';
  }
}

// ================================================================
// TOTP 2FA SUBMISSION
// ================================================================
async function submitTotp() {
  if (!pending2FA) { showError('No pending login. Please try again.'); cancelTotp(); return; }

  const btn = document.getElementById('btnTotpSubmit');
  const code = document.getElementById('totp-input').value.trim();

  if (!code || code.length !== 6) {
    showError('Please enter the 6-digit code from your authenticator app');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Verifying...';

  const payload = {
    username: pending2FA.username,
    password: pending2FA.password,
    totpCode: code
  };
  if (pending2FA.captchaToken) {
    payload.captchaToken = pending2FA.captchaToken;
  }
  if (pending2FA.captchaAnswer) {
    payload.captchaAnswer = pending2FA.captchaAnswer;
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await readJsonBody(res);

    if (!res.ok) {
      showError('Invalid authenticator code');
      document.getElementById('totp-input').value = '';
      document.getElementById('totp-input').focus();
      btn.disabled = false; btn.textContent = 'Verify';
      return;
    }

    // Login + 2FA success
    pending2FA = null;
    setAuthSession(data.token, data.user);
    showSuccess('Welcome back, ' + data.user.displayName + '! (2FA verified)');
    window.location.href = 'index.html';

  } catch (err) {
    showError('Service unavailable');
    btn.disabled = false; btn.textContent = 'Verify';
  }
}

/** Cancel 2FA — return to login form */
function cancelTotp() {
  pending2FA = null;
  document.getElementById('totpStep').classList.remove('active');
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('totp-input').value = '';
  document.getElementById('errorMsg').style.display = 'none';
}

// ================================================================
// SIGNUP
// ================================================================
async function doSignup() {
  const btn = document.getElementById('btnSignup');
  const displayName = document.getElementById('signup-name').value.trim();
  const username = document.getElementById('signup-user').value.trim();
  const password = document.getElementById('signup-pass').value;
  const password2 = document.getElementById('signup-pass2').value;
  const email = document.getElementById('signup-email').value.trim();
  const phone = document.getElementById('signup-phone').value.trim();

  if (!username || !password || !displayName) { showError('Please fill in all required fields'); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters'); return; }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    showError('Password must include uppercase, lowercase, number, and symbol');
    return;
  }
  if (password !== password2) { showError('Passwords do not match'); return; }
  if (!email) { showError('Email is required'); return; }

  // Only collect and enforce CAPTCHA fields when CAPTCHA is enabled
  const captchaToken = captchaEnabled ? getCaptchaToken('signupCaptchaRow') : '';
  const captchaAnswer = captchaEnabled ? getCaptchaAnswer('signupCaptchaRow') : '';
  if (captchaEnabled && !captchaToken) {
    showError('Please complete the CAPTCHA');
    return;
  }
  if (captchaEnabled && captchaType === 'math' && !captchaAnswer) {
    showError('Please answer the CAPTCHA');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Creating account...';

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName, email, phone, captchaToken, captchaAnswer })
    });
    const data = await readJsonBody(res);

    if (!res.ok) {
      showError(safeSignupError(data));
      btn.disabled = false; btn.textContent = 'Create Account';
      if (captchaType === 'math') {
        loadMathCaptcha('signupCaptchaRow');
      } else if (typeof hcaptcha !== 'undefined') {
        try { hcaptcha.reset(); } catch(e) {}
      }
      return;
    }

    pendingUsername = username;

    if (data.requiresApproval && !data.requiresVerification) {
      showSuccess(data.message || 'Account request submitted. Waiting for admin approval.');
      showApprovalStep(username, data);
    } else if (!data.requiresVerification) {
      // Account was activated immediately (verification toggle is off)
      showSuccess('Account created! You can log in now.');
      setTimeout(() => { switchTab('login'); }, 1800);
    } else {
      showSuccess('Account created! Please verify your email before logging in.');
      showVerificationStep(username, email, phone, data);
    }

  } catch (err) {
    showError('Service unavailable');
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

// ================================================================
// VERIFICATION UI
// ================================================================
function showVerificationStep(username, email, phone, signupData) {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'none';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  const verifyStep = document.getElementById('verifyStep');
  verifyStep.classList.add('active');

  document.getElementById('verifyEmail').style.display = 'block';
  const baseMsg = signupData && signupData.message
    ? signupData.message
    : 'Your account requires email verification. Check your inbox and click the verification link.';
  const offNotice = emailVerificationEnabled
    ? ' (For demo: check the gateway console for the link)'
    : ' (email verification is temporarily turned off)';
  document.getElementById('emailVerifyMsg').textContent = baseMsg + offNotice;

  const verifyPhoneEl = document.getElementById('verifyPhone');
  if (verifyPhoneEl) verifyPhoneEl.style.display = 'none';
  const verifyApprovalEl = document.getElementById('verifyApproval');
  if (verifyApprovalEl) {
    const needsApproval = !!(signupData && signupData.requiresApproval);
    verifyApprovalEl.style.display = needsApproval ? 'block' : 'none';
    const approvalMsgEl = document.getElementById('approvalVerifyMsg');
    if (approvalMsgEl && needsApproval) {
      approvalMsgEl.textContent = 'After verification, an administrator must approve the account before login is allowed.';
    }
  }
  if (phoneVerificationEnabled && verifyPhoneEl) {
    const hasPhone = !!phone;
    if (hasPhone || (signupData && signupData.otpSent)) {
      verifyPhoneEl.style.display = 'block';
      const pMsg = signupData && signupData.phoneMessage
        ? signupData.phoneMessage
        : 'Enter the 6-digit code sent to your phone.';
      const phoneMsgEl = document.getElementById('phoneVerifyMsg');
      if (phoneMsgEl) {
        phoneMsgEl.textContent = pMsg + ' (For demo: check the gateway console for the OTP)';
      }
    }
  }
}

function showApprovalStep(username, signupData) {
  pendingUsername = username;
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'none';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const verifyStep = document.getElementById('verifyStep');
  verifyStep.classList.add('active');
  const emailEl = document.getElementById('verifyEmail');
  const phoneEl = document.getElementById('verifyPhone');
  const approvalEl = document.getElementById('verifyApproval');
  if (emailEl) emailEl.style.display = 'none';
  if (phoneEl) phoneEl.style.display = 'none';
  if (approvalEl) approvalEl.style.display = 'block';
  const msgEl = document.getElementById('approvalVerifyMsg');
  if (msgEl) {
    msgEl.textContent = signupData && signupData.message
      ? signupData.message
      : 'Your account request is waiting for administrator approval. Try logging in after approval.';
  }
}

function updatePasswordRules() {
  const password = document.getElementById('signup-pass')?.value || '';
  const setRule = (name, ok) => {
    const el = document.querySelector('#passwordRules [data-rule="' + name + '"]');
    if (el) el.classList.toggle('ok', ok);
  };
  setRule('length', password.length >= 8);
  setRule('mix', /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password));
}

// ================================================================
// OTP SUBMISSION (kept for backward compatibility, hidden in UI)
// ================================================================
async function submitOtp() {
  const btn = document.getElementById('btnVerifyOtp');
  const otp = document.getElementById('otp-input').value.trim();

  if (!otp || otp.length !== 6) { showError('Please enter the 6-digit code'); return; }
  if (!pendingUsername) { showError('No pending verification'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Verifying...';

  if (typeof hcaptcha !== 'undefined') {
    try { hcaptcha.reset(); } catch(e) {}
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/verify-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pendingUsername, otp })
    });
    const data = await res.json();

    if (res.ok) {
      showSuccess('Phone verified. Email verification is still required for login.');
      document.getElementById('verifyPhone').style.display = 'none';
      setTimeout(() => { switchTab('login'); }, 1500);
    } else {
      showError('Verification failed');
    }

    btn.disabled = false; btn.textContent = 'Verify';
  } catch (err) {
    showError('Verification failed');
    btn.disabled = false; btn.textContent = 'Verify';
  }
}

// ================================================================
// RESEND
// ================================================================
async function resendVerification(type) {
  if (type === 'phone' && !phoneVerificationEnabled) {
    showError('Phone verification is currently disabled.');
    return;
  }
  if (type !== 'email' && type !== 'phone') {
    showError('Unknown verification type');
    return;
  }
  const btnId = type === 'email' ? 'btnResendEmail' : 'btnResendPhone';
  const btn = document.getElementById(btnId);
  if (!pendingUsername || !btn) return;

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pendingUsername, type })
    });
    const data = await res.json();

    if (res.ok) {
      showSuccess(data.message || 'Verification resent');
      let remaining = 60;
      btn.textContent = 'Wait ' + remaining + 's';
      const interval = setInterval(() => {
        remaining--;
        btn.textContent = 'Wait ' + remaining + 's';
        if (remaining <= 0) {
          clearInterval(interval);
          btn.disabled = false;
          btn.textContent = type === 'email' ? 'Resend email' : 'Resend code';
        }
      }, 1000);
    } else {
      showError('Failed to resend');
      btn.disabled = false;
      btn.textContent = type === 'email' ? 'Resend email' : 'Resend code';
    }
  } catch (err) {
    showError('Failed to resend');
    btn.disabled = false;
    btn.textContent = type === 'email' ? 'Resend email' : 'Resend code';
  }
}

// ================================================================
// ENTER KEY — now handles TOTP step too
// ================================================================
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const totpActive = document.getElementById('totpStep').classList.contains('active');
    const verifyActive = document.getElementById('verifyStep').classList.contains('active');
    const verifyPhoneEl = document.getElementById('verifyPhone');
    const phoneVerifyVisible = !!verifyPhoneEl && verifyPhoneEl.style.display !== 'none';

    if (totpActive) {
      submitTotp();
    } else if (verifyActive) {
      if (phoneVerifyVisible) submitOtp();
      return;
    } else if (document.getElementById('loginForm').style.display !== 'none') {
      doLogin();
    } else {
      doSignup();
    }
  }
});


// ====================================================================
// PASSWORD RESET WITH CODE
// ====================================================================
async function doResetWithCode() {
  const username = document.getElementById('reset-username').value.trim();
  const code = document.getElementById('reset-code').value.trim();
  const newPw = document.getElementById('reset-newpw').value;
  const errEl = document.getElementById('resetError');
  const okEl = document.getElementById('resetSuccess');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  if (!username || !code || !newPw) {
    errEl.textContent = 'All fields are required';
    errEl.style.display = 'block';
    return;
  }
  if (newPw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.style.display = 'block';
    return;
  }
  if (!/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/[0-9]/.test(newPw) || !/[^A-Za-z0-9]/.test(newPw)) {
    errEl.textContent = 'Password must include uppercase, lowercase, number, and symbol';
    errEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(GATEWAY_URL + '/api/auth/reset-with-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, resetCode: code, newPassword: newPw })
    });
    const data = await res.json();
    if (res.ok) {
      okEl.textContent = 'Password reset successfully! You can now log in.';
      okEl.style.display = 'block';
      document.getElementById('reset-username').value = '';
      document.getElementById('reset-code').value = '';
      document.getElementById('reset-newpw').value = '';
    } else {
      errEl.textContent = 'Reset failed';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Connection error';
    errEl.style.display = 'block';
  }
}

// ================================================================
// INIT
// ================================================================
window.addEventListener('DOMContentLoaded', () => {
  const signupPassword = document.getElementById('signup-pass');
  if (signupPassword) {
    signupPassword.addEventListener('input', updatePasswordRules);
    updatePasswordRules();
  }

  // Fetch CAPTCHA config from backend
  fetch(GATEWAY_URL + '/api/auth/captcha-config')
    .then(r => r.json())
    .then(data => {
      captchaEnabled = !!data.enabled;
      captchaType = data.type || (data.sitekey ? 'hcaptcha' : 'math');
      captchaSitekey = data.sitekey || null;
      if (captchaEnabled) {
        loadCaptchaByType('signupCaptchaRow');
        if (captchaType === 'math') {
          loadCaptchaByType('loginCaptchaRow');
        }
      }
      phoneVerificationEnabled = !!data.phoneVerificationEnabled;
      emailVerificationEnabled = data.emailVerificationEnabled !== false;
    })
    .catch(() => {});

  // Auto-redirect if already logged in
  const token = getToken();
  if (token) {
    fetch(GATEWAY_URL + '/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(async r => {
        if (r.ok) {
          const data = await r.json();
          setAuthSession(token, data.user);
          window.location.href = 'index.html';
        } else {
          clearAuthStorage();
        }
      })
      .catch(() => {});
  }
});
