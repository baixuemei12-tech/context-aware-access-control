/* ============================================================
   bench-bus — shared broadcast bus for CAAC runtime topology
   ============================================================
   - normalizeEvent: validate + fill defaults (id, ts)
   - createBroadcastBus: subscribe / publish / publishMany
   Used by:
     · mock-bench.js scenario loop  (mock traffic)
     · POST /bench/push handler     (real attack pushes from bvgca_attack_sim.py)
   Tested by tests/bench-bus.test.mjs (no DOM, pure Node).
   ============================================================ */

const VALID_KINDS = new Set(['node', 'edge', 'burst', 'meta', 'ctx-snapshot', 'ctx-change']);

let _seq = 0;

export function normalizeEvent(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('event payload must be a non-null object');
  }
  const kind = payload.kind;
  if (!VALID_KINDS.has(kind)) {
    throw new Error(
      `event kind "${kind}" is invalid; expected one of ${[...VALID_KINDS].join(', ')}`
    );
  }

  if (kind === 'edge' || kind === 'burst') {
    if (!payload.sourceNode) throw new Error('event kind=' + kind + ' requires sourceNode');
    if (!payload.targetNode) throw new Error('event kind=' + kind + ' requires targetNode');
  } else if (kind === 'ctx-snapshot' || kind === 'ctx-change') {
    if (!payload.userId) throw new Error('event kind=' + kind + ' requires userId');
    if (kind === 'ctx-change' && !payload.field) {
      throw new Error('event kind=ctx-change requires field');
    }
  } else {
    if (!payload.sourceNode) throw new Error('event kind=' + kind + ' requires sourceNode');
  }

  _seq += 1;
  return {
    id: payload.id || `evt-${Date.now()}-${_seq}`,
    ts: typeof payload.ts === 'number' ? payload.ts : Date.now(),
    severity: payload.severity || 'info',
    ...payload,
    kind, // ensure final kind is the validated one
  };
}

export function createBroadcastBus() {
  const subs = new Set();
  // Live-mode deadline (epoch ms). When `Date.now() < _liveUntil` the
  // bus reports isLiveMode() === true. The mock scenario loop honors
  // this flag and idles so the operator sees ONLY the externally
  // pushed attack events. After the deadline mock resumes
  // automatically — no manual reset required.
  let _liveUntil = 0;
  // Orthogonal hard switch. The attack sim flips this on at startup
  // and off in finally so mock traffic is fully silenced for the
  // entire demo run, not just per-batch grace windows.
  let _forceLive = false;

  function subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('subscribe() requires a function');
    }
    subs.add(fn);
    return function unsubscribe() { subs.delete(fn); };
  }

  function publish(event) {
    for (const fn of subs) {
      try { fn(event); }
      catch (err) {
        // Isolated failure must not break the loop.
        try { console.error('[bench-bus] subscriber threw:', err && err.message); } catch (_) { /* nop */ }
      }
    }
  }

  function publishMany(events) {
    for (const ev of events) publish(ev);
  }

  function subscriberCount() { return subs.size; }

  function markLiveUntil(ts) {
    const n = Number(ts) || 0;
    // Latest-deadline wins — repeated pushes extend the quiet window,
    // never shrink it.
    if (n > _liveUntil) _liveUntil = n;
  }

  function isLiveMode() {
    return _forceLive || Date.now() < _liveUntil;
  }

  function setForceLive(on) {
    _forceLive = !!on;
  }

  return {
    subscribe, publish, publishMany, subscriberCount,
    markLiveUntil, isLiveMode, setForceLive,
  };
}

/* ------------------------------------------------------------
   scheduleBatch — pace a batch of raw events through `publishFn`
   using each event's `delayMs` hint as the gap AFTER it before
   the next one.

   Why: when an attack script POSTs 6 events at once to /bench/push,
   firing them all synchronously makes the frontend cascade collapse
   into a single-frame flash. Honoring each event's `delayMs` makes
   the visualization match the mock-loop pacing.

   Contract:
     - first event is published synchronously (cumulative offset = 0)
     - subsequent events are scheduled via setTimeout at the running
       offset, then `delayMs` is added to that offset
     - normalization errors land in `rejected` without aborting the rest
     - returns { accepted: string[], rejected: {error, payload}[] }
   ------------------------------------------------------------ */
export function scheduleBatch(rawEvents, publishFn, options) {
  if (!Array.isArray(rawEvents)) {
    throw new TypeError('scheduleBatch: rawEvents must be an array');
  }
  if (typeof publishFn !== 'function') {
    throw new TypeError('scheduleBatch: publishFn must be a function');
  }
  const schedule = (options && options.scheduleFn) || setTimeout;
  const accepted = [];
  const rejected = [];

  // Pre-normalize so we can report invalid items synchronously.
  const ready = [];
  for (const raw of rawEvents) {
    try {
      const ev = normalizeEvent(raw);
      ready.push(ev);
      accepted.push(ev.id);
    } catch (err) {
      rejected.push({ payload: raw, error: String(err && err.message || err) });
    }
  }

  let offset = 0;
  for (const ev of ready) {
    const fire = () => {
      try { publishFn(ev); }
      catch (err) {
        try { console.error('[bench-bus] publishFn threw:', err && err.message); } catch (_) { /* nop */ }
      }
    };
    if (offset === 0) {
      fire(); // first event publishes synchronously
    } else {
      schedule(fire, offset);
    }
    const d = (typeof ev.delayMs === 'number' && ev.delayMs > 0) ? ev.delayMs : 0;
    offset += d;
  }

  return { accepted, rejected };
}
