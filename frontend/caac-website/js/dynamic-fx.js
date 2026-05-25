/* ============================================================
   CAAC dynamic-fx — bold dynamic interactions for the demo
   Single bundle. Auto-detects which page it's on and wires up
   the relevant effects. No new dependencies.
   ============================================================ */
(function () {
  'use strict';

  var PERF = window.CAAC_PERF || {};
  var mq = function (query) { return window.matchMedia && window.matchMedia(query).matches; };
  var REDUCE = PERF.reduceMotion || mq('(prefers-reduced-motion: reduce)');
  var DESKTOP = mq('(hover: hover) and (min-width: 720px)');
  var PHONE = PERF.tinyScreen || mq('(max-width: 520px)');
  var FX_LITE = PERF.isLite;
  var FX_FULL = PERF.isFull;
  var FX_BALANCED = PERF.isBalanced || (!FX_FULL && !FX_LITE);

  // Polyfill setProperty on a missing element
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return [].slice.call((root || document).querySelectorAll(s)); }

  /* ============================================================
     1. MAGNETIC NEON CURSOR + WAKE TRAIL  (desktop only)
     ============================================================ */
  function initCursor() {
    if (!DESKTOP || REDUCE) return;
    var trailCap = FX_FULL ? 16 : (FX_BALANCED ? 9 : (PERF.isSmooth ? 3 : 5));
    var trailLife = FX_FULL ? 560 : (FX_BALANCED ? 420 : 260);
    var fps = PERF.targetFps || (FX_FULL ? 60 : (FX_BALANCED ? 36 : 20));
    var frameMs = Math.max(16, 1000 / fps);
    var lastDraw = 0;
    var dot = document.createElement('div');
    dot.className = 'fx-cursor';
    document.body.appendChild(dot);
    var canvas = document.createElement('canvas');
    canvas.className = 'fx-trail-canvas';
    canvas.width = innerWidth; canvas.height = innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var pts = [];
    var rafQ = false;

    function cursorEnabled() {
      var root = document.documentElement;
      return root.getAttribute('data-visual-mode') === 'cyber' ||
             root.getAttribute('data-theme') === 'dark';
    }

    function hideCursor() {
      dot.classList.remove('active', 'hot');
      canvas.classList.remove('active');
      pts = [];
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    addEventListener('resize', function () {
      canvas.width = innerWidth; canvas.height = innerHeight;
    });

    addEventListener('mousemove', function (e) {
      if (!cursorEnabled()) {
        hideCursor();
        return;
      }
      dot.classList.add('active');
      canvas.classList.add('active');
      dot.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0) translate(-50%,-50%)';
      var hot = !!e.target.closest('button, a, .scenario-node, .auth-flow-row, .card, [onclick]');
      dot.classList.toggle('hot', hot);
      pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      while (pts.length > trailCap) pts.shift();
      if (!rafQ) { rafQ = true; requestAnimationFrame(drawTrail); }
    }, { passive: true });

    addEventListener('mouseleave', function () {
      hideCursor();
    });

    window.addEventListener('caac-theme-change', function () {
      if (!cursorEnabled()) hideCursor();
    });
    window.addEventListener('caac-visual-mode-change', function () {
      if (!cursorEnabled()) hideCursor();
    });

    function drawTrail() {
      rafQ = false;
      if (!ctx || !canvas || !cursorEnabled()) {
        hideCursor();
        return;
      }
      var now = performance.now();
      if (now - lastDraw < frameMs) {
        if (pts.length) { rafQ = true; requestAnimationFrame(drawTrail); }
        return;
      }
      lastDraw = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        var age = (now - b.t) / trailLife;
        if (age >= 1) continue;
        var alpha = (1 - age) * (FX_FULL ? 0.50 : FX_BALANCED ? 0.34 : 0.22);
        ctx.strokeStyle = 'rgba(56,244,223,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.8, (1 - age) * (FX_FULL ? 2.2 : 1.35));
        ctx.lineCap = 'round';
        ctx.shadowBlur = FX_FULL ? 8 * (1 - age) : 0;
        ctx.shadowColor = 'rgba(56,244,223,' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // prune
      pts = pts.filter(function (p) { return now - p.t < trailLife; });
      if (pts.length) { rafQ = true; requestAnimationFrame(drawTrail); }
    }
  }

  /* ============================================================
     2. AUTH-FLOW RAIL — follow focus + grid warp
     ============================================================ */
  function initAuthRail() {
    var rail = $('.auth-rail');
    var rows = $$('.auth-flow-row');
    if (!rail || !rows.length) return;

    function setStage(s) {
      rows.forEach(function (r, i) {
        r.classList.toggle('fx-active', i === s);
        r.classList.toggle('fx-done', i < s);
      });
    }

    // Stage 0 = credentials, 1 = totp, 2 = success/verify
    var loginInputs = $$('#loginForm input, #signupForm input');
    loginInputs.forEach(function (inp) {
      inp.addEventListener('focus', function () { setStage(0); warpToward(inp); });
      inp.addEventListener('blur', function () { rail.classList.remove('fx-warp'); });
    });

    // Watch for the totp step becoming visible
    var totpStep = $('#totpStep');
    if (totpStep) {
      var mo = new MutationObserver(function () {
        if (totpStep.classList.contains('active') ||
            getComputedStyle(totpStep).display !== 'none') {
          setStage(1);
        }
      });
      mo.observe(totpStep, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    // verifyStep / verifyApproval = stage 2
    var vstep = $('#verifyStep, #verifyApproval');
    if (vstep) {
      var mo2 = new MutationObserver(function () {
        if (getComputedStyle(vstep).display !== 'none') setStage(2);
      });
      mo2.observe(vstep, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    function warpToward(el) {
      if (REDUCE) return;
      var rRect = rail.getBoundingClientRect();
      var eRect = el.getBoundingClientRect();
      // Project the focused field's center onto the rail's local coords.
      var x = ((eRect.left + eRect.width / 2) - rRect.left) / rRect.width * 100;
      var y = ((eRect.top + eRect.height / 2) - rRect.top) / rRect.height * 100;
      // The field is in the panel to the right — warp toward that side.
      x = Math.max(60, Math.min(120, x));
      y = Math.max(20, Math.min(80, y));
      rail.style.setProperty('--warp-x', x + '%');
      rail.style.setProperty('--warp-y', y + '%');
      rail.classList.add('fx-warp');
    }

    setStage(0);
  }

  /* ============================================================
     3. TRUST ORB — decorative pulse only
     ============================================================ */
  function initTrustOrb() {
    var orb = $('#profileTrustOrb');
    if (!orb) return;

    if (REDUCE || PHONE || FX_LITE) return;

    // Keep the profile value authoritative. The actual trust value and
    // --trust-angle are owned by profile.js after /api/auth/me loads.
    orb.classList.add('fx-live');
  }

  /* ============================================================
     4. SCENARIO TERMINAL + PACKET TRAILS
     ============================================================ */
  function initScenarios() {
    var stage = $('.scenario-stage');
    if (!stage) return;

    // Inject SVG trail layer
    if (!stage.querySelector('.scenario-trails')) {
      stage.insertAdjacentHTML('beforeend',
        '<svg class="scenario-trails" aria-hidden="true">' +
          '<line class="trail" x1="0" y1="0" x2="0" y2="0"/>' +
        '</svg>');
    }
    var trail = $('.scenario-trails .trail');

    // Inject terminal under the existing scenario-detail
    var detail = $('.scenario-detail');
    if (detail && !detail.querySelector('.scenario-terminal')) {
      var t = document.createElement('div');
      t.className = 'scenario-terminal';
      t.id = 'scenarioTerminal';
      detail.appendChild(t);
    }
    var term = $('#scenarioTerminal');

    function termPush(layer, msg, kind) {
      if (!term) return;
      kind = kind || 'ok';
      $$('.fresh', term).forEach(function (n) { n.classList.remove('fresh'); });
      var ts = new Date().toISOString().slice(11, 23);
      var ln = document.createElement('div');
      ln.className = 'ln fresh';
      ln.innerHTML =
        '<span style="color:var(--text3)">' + ts + '</span>  ' +
        '<span class="layer">' + (layer + '        ').slice(0, 8) + '</span>  ' +
        '<span class="' + kind + '">' + msg + '</span>';
      term.appendChild(ln);
      while (term.children.length > 9) term.removeChild(term.firstChild);
    }

    function drawHop(fromKey, toKey) {
      if (!trail || REDUCE) return;
      var sRect = stage.getBoundingClientRect();
      var aEl = $('[data-flow-node="' + fromKey + '"]');
      var bEl = $('[data-flow-node="' + toKey + '"]');
      if (!aEl || !bEl) return;
      var a = aEl.getBoundingClientRect();
      var b = bEl.getBoundingClientRect();
      trail.setAttribute('x1', (a.left + a.width / 2 - sRect.left));
      trail.setAttribute('y1', (a.top + a.height / 2 - sRect.top));
      trail.setAttribute('x2', (b.left + b.width / 2 - sRect.left));
      trail.setAttribute('y2', (b.top + b.height / 2 - sRect.top));
      trail.classList.remove('fade');
      trail.style.strokeDashoffset = 0;
      bEl.classList.remove('fx-firing'); void bEl.offsetWidth; bEl.classList.add('fx-firing');
      setTimeout(function () { trail.classList.add('fade'); }, 700);
    }

    // Expose to scenarios.js
    window.fxScenarioLog = termPush;
    window.fxScenarioHop = drawHop;

    // If the page hasn't been wired (no real scenarios.js handlers), run a self-demo loop.
    var btn = $('#scenarioRunBtn');
    if (btn) {
      btn.addEventListener('click', function () { setTimeout(runDemo, 50); });
    }
    function runDemo() {
      // If real scenarios.js fired the walkthrough we still narrate alongside it.
      var seq = [
        ['browser',  'gateway', 'GATEWAY', 'C_E resolved · L_trust=0.82 N_status=0.91', 'ok'],
        ['gateway',  'oracle',  'ORACLE',  'HMAC-SHA256 signed · nonce=7f3a2e', 'ok'],
        ['oracle',   'fabric',  'FABRIC',  'DT_score=0.71  >=  P_eff=0.55  → PERMIT', 'ok'],
        ['fabric',   'ipfs',    'IPFS',    'CID resolved · streaming AES-256-GCM', 'ok'],
        ['ipfs',    'browser',  'GATEWAY', 'budget α=10% · 28 KB delivered', 'warn']
      ];
      var i = 0;
      (function next() {
        if (i >= seq.length) { termPush('SESSION', 'walkthrough complete.', 'ok'); return; }
        var step = seq[i++];
        drawHop(step[0], step[1]);
        termPush(step[2], step[3], step[4]);
        setTimeout(next, 950);
      })();
    }
    // First-load welcome
    termPush('SESSION', 'audit stream attached. waiting for trigger…', 'ok');
  }

  /* ============================================================
     5. OVERVIEW BOOT-UP — typed pre-line + scanline wipe
     ============================================================ */
  function initOverview() {
    var stitles = $$('.stitle');
    if (!stitles.length) return;
    var bootStrings = [
      'mounting layer 01 / gateway',
      'mounting layer 02 / oracle',
      'loading data flow graph',
      'compiling RGCA tier table',
      'priming context model C = (C_S, C_E, C_R, C_O)',
      'evaluating threat model',
      'patching algorithmic improvements (v2)',
      'verifying security hardening (v3.0)',
      'attaching performance telemetry',
      'finalizing handoff'
    ];
    stitles.forEach(function (el, i) {
      el.setAttribute('data-fx-boot', bootStrings[i % bootStrings.length]);
    });
    // Add a one-shot scanline wipe to every .reveal as it becomes visible.
    if (REDUCE) return;
    var reveals = $$('.reveal');
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (ent) {
        if (!ent.isIntersecting) return;
        ent.target.classList.add('fx-wipe');
        setTimeout(function () { ent.target.classList.remove('fx-wipe'); }, 1100);
        io.unobserve(ent.target);
      });
    }, { threshold: 0.18 });
    reveals.forEach(function (r) { io.observe(r); });
  }

  /* ============================================================
     6. AUDIT-TAPE TICKER — scroll-driven, no timer
     ============================================================ */
  function initAuditTape() {
    if (PHONE || FX_LITE) return;
    if ($('.fx-audit-tape')) return;
    var entries = [
      { t: '12:14:01.337', u: '0x9c2f', d: 'PERMIT', s: 'S=0.4', dt: 'DT=0.71', extra: 'IPFS bafy…3a' },
      { t: '12:14:03.102', u: '0xab44', d: 'DENY',   s: 'S=0.9', dt: 'DT=0.31', extra: 'oracle: budget exhausted' },
      { t: '12:14:04.880', u: '0x44b1', d: 'PERMIT', s: 'S=0.2', dt: 'DT=0.88', extra: 'tier A · α=10%' },
      { t: '12:14:05.412', u: '0x71fa', d: 'WARN',   s: 'S=0.6', dt: 'DT=0.52', extra: 'context jump · re-eval' },
      { t: '12:14:08.005', u: '0xd0e2', d: 'PERMIT', s: 'S=0.3', dt: 'DT=0.79', extra: 'fabric committed' },
      { t: '12:14:11.722', u: '0x12ac', d: 'DENY',   s: 'S=0.95', dt: 'DT=0.18', extra: 'L_trust=0.12 anomaly' },
      { t: '12:14:14.044', u: '0x6b09', d: 'PERMIT', s: 'S=0.5', dt: 'DT=0.66', extra: 'session 7m · 4 files' },
      { t: '12:14:16.301', u: '0xfe88', d: 'PERMIT', s: 'S=0.1', dt: 'DT=0.92', extra: 'admin · approved' },
      { t: '12:14:19.119', u: '0x33df', d: 'WARN',   s: 'S=0.7', dt: 'DT=0.49', extra: 'D_sec=0.4 · device unknown' }
    ];
    function cell(e) {
      var cls = e.d === 'PERMIT' ? 'ok' : e.d === 'DENY' ? 'deny' : 'warn';
      return '<span class="tape-cell"><b>' + e.t + '</b>· u/' + e.u + ' · <span class="' + cls + '">' + e.d +
             '</span> · ' + e.s + ' · ' + e.dt + ' · ' + e.extra + '</span>';
    }
    var html = entries.map(cell).join('') + entries.map(cell).join('');
    var bar = document.createElement('div');
    bar.className = 'fx-audit-tape';
    bar.innerHTML = '<div class="fx-tape-track">' + html + '</div>';
    document.body.appendChild(bar);

    var track = bar.querySelector('.fx-tape-track');
    // Wait a tick for scrollWidth to settle.
    requestAnimationFrame(function () {
      var half = track.scrollWidth / 2;
      var ticking = false;
      addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var y = (scrollY * 0.7) % half;
          track.style.setProperty('--tape-x', '-' + y + 'px');
          ticking = false;
        });
      }, { passive: true });
      // Slow drift even when idle in full mode. Balanced mode stays scroll-driven.
      if (!REDUCE && FX_FULL) {
        var drift = 0;
        setInterval(function () {
          if (document.hidden) return;
          drift = (drift + 0.5) % half;
          // Don't fight scroll; only drift if user is at rest near top.
          if (Math.abs(scrollY) < 4) {
            track.style.setProperty('--tape-x', '-' + drift + 'px');
          }
        }, 50);
      }
    });
  }

  /* ============================================================
     7. SUBMIT "SYSTEM THINKING" overlay on .btn-primary
     ============================================================ */
  function initThinking() {
    $$('.btn-primary').forEach(function (b) {
      b.addEventListener('click', function () {
        // Don't fire if the page wires its own loading state
        if (b.disabled || b.classList.contains('fx-thinking')) return;
        var label = (b.textContent || '').trim().toLowerCase();
        var txt = label.indexOf('login') >= 0 ? 'evaluating context'
                : label.indexOf('verify') >= 0 ? 'verifying'
                : label.indexOf('save')   >= 0 ? 'committing'
                : label.indexOf('walkthrough') >= 0 ? 'streaming decision'
                : label.indexOf('change') >= 0 ? 're-keying'
                : 'processing';
        b.dataset.fxThink = txt;
        b.classList.add('fx-thinking');
        setTimeout(function () { b.classList.remove('fx-thinking'); }, 1800);
      });
    });
  }

  /* ============================================================
     8. HOVER-MAGNETIC CARDS — tilt + glow
     ============================================================ */
  function initMagnetCards() {
    if (!DESKTOP || REDUCE || FX_LITE) return;
    var sel = '.card, .stat-card, .scenario-list, .scenario-detail, .trust-orb-card, .identity-strip-card';
    $$(sel).forEach(function (el) {
      el.classList.add('fx-magnet');
      var rect = null;
      var lastEvent = null;
      var rafPending = false;
      el.addEventListener('mouseenter', function () {
        rect = el.getBoundingClientRect();
        el.classList.add('hot');
      });
      el.addEventListener('mousemove', function (e) {
        lastEvent = e;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          if (!lastEvent) return;
          if (!rect) rect = el.getBoundingClientRect();
          var x = (lastEvent.clientX - rect.left) / rect.width;
          var y = (lastEvent.clientY - rect.top) / rect.height;
          var tiltScale = FX_BALANCED ? 0.55 : 1;
          var rotY = (x - 0.5) * 5 * tiltScale;
          var rotX = (0.5 - y) * 4 * tiltScale;
          el.style.setProperty('--fx-tilt-x', rotX.toFixed(2) + 'deg');
          el.style.setProperty('--fx-tilt-y', rotY.toFixed(2) + 'deg');
          el.style.setProperty('--fx-glow-x', (x * 100).toFixed(1) + '%');
          el.style.setProperty('--fx-glow-y', (y * 100).toFixed(1) + '%');
        });
      });
      el.addEventListener('mouseleave', function () {
        rect = null;
        lastEvent = null;
        el.classList.remove('hot');
        el.style.setProperty('--fx-tilt-x', '0deg');
        el.style.setProperty('--fx-tilt-y', '0deg');
      });
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    initCursor();
    if (!FX_FULL) return;
    initAuthRail();
    initTrustOrb();
    initScenarios();
    initOverview();
    initAuditTape();
    initThinking();
    initMagnetCards();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
