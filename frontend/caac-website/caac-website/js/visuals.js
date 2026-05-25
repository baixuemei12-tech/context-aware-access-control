/* ============================================================
   CAAC Visual Layer
   Lightweight animated constellation background for selected pages.
   Adaptively scales work down on small viewports / coarse pointers
   so low-power phones stay responsive without losing the look.
   ============================================================ */

(function () {
  const canvases = Array.from(document.querySelectorAll('[data-caac-stars]'));
  if (canvases.length === 0) return;

  const perf = window.CAAC_PERF || {};
  const reduceMotion = perf.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const coarsePointer = perf.coarsePointer || (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
  const smallScreen = perf.smallScreen || (window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  const tinyScreen = perf.tinyScreen || (window.matchMedia && window.matchMedia('(max-width: 380px)').matches);
  const lowMemory = perf.lowMemory || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const lowConcurrency = perf.lowConcurrency || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const saveData = perf.saveData || (navigator.connection && navigator.connection.saveData);

  // "perf-light" mode = a phone or a constrained device. We keep stars+packets
  // but skip the O(n²) link pass and the moving grid lines, and we throttle
  // the frame rate so battery / thermals stay sane.
  const perfLight = perf.isLite || saveData || (smallScreen && (coarsePointer || lowMemory || lowConcurrency));
  const perfBalanced = perf.isBalanced || (!perf.isFull && !perfLight);
  const perfMicro = tinyScreen || (saveData && coarsePointer);

  const targetFps = perf.targetFps || (perfMicro ? 24 : (perfLight ? 30 : 36));
  const frameInterval = 1000 / targetFps;

  function isCyberVisualMode() {
    return document.documentElement.getAttribute('data-visual-mode') === 'cyber';
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function hexToRgb(hex) {
    const raw = hex.replace('#', '').trim();
    if (raw.length !== 6) return { r: 79, g: 141, b: 247 };
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    };
  }

  function readPalette() {
    const root = getComputedStyle(document.documentElement);
    const read = (name, fallback) => root.getPropertyValue(name).trim() || fallback;
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    return {
      theme,
      accent: hexToRgb(read('--accent', '#4f8df7')),
      teal: hexToRgb(read('--teal', '#20b9ba')),
      text3: hexToRgb(read('--text3', '#687385')),
      alphaBoost: theme === 'light' ? 0.55 : 1
    };
  }

  function initCanvas(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let points = [];
    let routes = [];
    let frame = 0;
    let lastDraw = 0;
    let running = !document.hidden && !isCyberVisualMode();
    let rafId = 0;

    const baseDensity = Number(canvas.dataset.density || 62);
    const baseLink = Number(canvas.dataset.link || 140);
    const baseSpeed = Number(canvas.dataset.speed || 0.18);
    const basePackets = Number(canvas.dataset.packets || 7);

    // Scale heavy parameters down on mobile/low-power devices.
    const density = perfMicro ? Math.min(baseDensity, 16)
                  : perfLight ? Math.min(baseDensity, 24)
                  : perfBalanced ? Math.min(baseDensity, 46)
                  : baseDensity;
    const linkDistance = perfLight ? 0 : (perfBalanced ? Math.min(baseLink, 112) : baseLink); // 0 disables the O(n²) line pass
    const speed = perfLight ? baseSpeed * 0.72 : (perfBalanced ? baseSpeed * 0.84 : baseSpeed);
    const packets = perfMicro ? Math.min(basePackets, 1)
                  : perfLight ? Math.min(basePackets, 2)
                  : perfBalanced ? Math.min(basePackets, 5)
                  : basePackets;
    const drawGrid = !perfLight && !(smallScreen && coarsePointer); // skip the moving grid on phone
    let palette = readPalette();

    function resize() {
      // Cap DPR aggressively on phones — Retina rendering at full scale is
      // by far the easiest way to tank a low-power GPU.
      const dprCap = perfMicro ? 1 : (perfLight ? 1.25 : (perfBalanced ? 1.5 : 2));
      dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const areaScale = perfLight ? 36000 : (perfBalanced ? 26000 : 18000);
      const minPoints = perfMicro ? 10 : (perfLight ? 14 : (perfBalanced ? 22 : 28));
      const count = Math.max(minPoints, Math.round((width * height) / areaScale * (density / 62)));
      points = Array.from({ length: count }, (_, i) => {
        const layer = i % 5;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * speed * (0.65 + layer * 0.12),
          vy: (Math.random() - 0.5) * speed * (0.65 + layer * 0.12),
          r: 0.75 + Math.random() * 1.45,
          a: 0.26 + Math.random() * 0.55,
          layer
        };
      });
      routes = Array.from({ length: packets }, () => ({
        from: Math.floor(Math.random() * points.length),
        to: Math.floor(Math.random() * points.length),
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.004
      }));
      lastDraw = 0;
      scheduleDraw();
    }

    function scheduleDraw() {
      if (!running) return;
      if (rafId) return;
      rafId = requestAnimationFrame(tick);
    }

    function tick(now) {
      rafId = 0;
      if (!running) return;

      // Frame-rate throttle. We always queue the next frame, but only do real
      // work when enough time has passed for the target fps.
      if (now - lastDraw < frameInterval && lastDraw !== 0) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastDraw = now;

      draw();

      if (!reduceMotion) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function draw() {
      const accent = palette.accent;
      const teal = palette.teal;
      const text3 = palette.text3;
      const alphaBoost = palette.alphaBoost;

      ctx.clearRect(0, 0, width, height);

      if (drawGrid) {
        const gridAlpha = palette.theme === 'light' ? 0.045 : 0.07;
        ctx.strokeStyle = `rgba(${text3.r},${text3.g},${text3.b},${gridAlpha})`;
        ctx.lineWidth = 1;
        const grid = 72;
        ctx.beginPath();
        for (let x = (frame * 0.03) % grid; x < width; x += grid) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let y = (frame * 0.02) % grid; y < height; y += grid) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();
      }

      const linkSq = linkDistance * linkDistance;
      const drawLinks = linkDistance > 0;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (!reduceMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
          if (p.y < -20) p.y = height + 20;
          if (p.y > height + 20) p.y = -20;
        }

        if (drawLinks) {
          for (let j = i + 1; j < points.length; j++) {
            const q = points[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < linkSq) {
              const dist = Math.sqrt(distSq);
              const a = (1 - dist / linkDistance) * 0.18 * alphaBoost;
              ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${a})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
          }
        }

        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${p.a * alphaBoost})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Packet glow is cheap (small N) and keeps the "data flowing" feel that
      // makes the design feel alive even on phone.
      if (packets > 0) {
        const tealStr = `rgba(${teal.r},${teal.g},${teal.b},${0.8 * alphaBoost})`;
        ctx.fillStyle = tealStr;
        if (!perfLight) {
          ctx.shadowColor = `rgba(${teal.r},${teal.g},${teal.b},0.55)`;
          ctx.shadowBlur = 12;
        }
        for (let k = 0; k < routes.length; k++) {
          const route = routes[k];
          const a = points[route.from];
          const b = points[route.to];
          if (!a || !b || a === b) continue;
          if (!reduceMotion) route.t = (route.t + route.speed) % 1;
          const x = a.x + (b.x - a.x) * route.t;
          const y = a.y + (b.y - a.y) * route.t;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!perfLight) ctx.shadowBlur = 0;
      }

      frame++;
    }

    // Debounced resize avoids re-allocating the points array mid-orientation-change.
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });
    window.addEventListener('caac-theme-change', () => {
      palette = readPalette();
      draw();
    });
    window.addEventListener('caac-visual-mode-change', () => {
      const cyberActive = isCyberVisualMode();
      running = !document.hidden && !cyberActive;
      if (cyberActive) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        ctx.clearRect(0, 0, width, height);
        return;
      }
      palette = readPalette();
      scheduleDraw();
    });
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden && !isCyberVisualMode();
      if (running) scheduleDraw();
    });
    resize();
  }

  canvases.forEach(initCanvas);
})();
