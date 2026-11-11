// Heartland TV smooth timer v1 (2026-11-11).
// Pure timing layer: the existing OCR, confidence, crop and stable() checks are untouched.
// A confirmed falling gym-clock reading starts a one-second-per-second local countdown.
// Confirmed static readings stop it; occasional sustained drift readings re-anchor it.
(function () {
  'use strict';

  const STOP_HOLD_MS = 1700;
  const LOST_READ_MS = 6500;
  const RESYNC_HOLD_MS = 1100;
  const RESYNC_COOLDOWN_MS = 3500;

  let previousValue = null, previousSampleAt = 0;
  let sameSince = 0, sameCount = 0;
  let driftSign = 0, driftSince = 0, lastResyncAt = 0;
  let readingActive = false, lastClearReadAt = 0;

  function projected(state, now) {
    const base = Math.max(0, Number(state.seconds) || 0);
    const age = Math.max(0, now - (Number(state.stamp) || now));
    return state.running ? Math.max(0, base - Math.floor(age / 1000)) : base;
  }

  function setClock(state, value, running, stamp) {
    const v = Math.max(0, Math.round(value));
    const t = Number(stamp) || Date.now();
    const changed = state.seconds !== v || state.running !== running ||
      (running && state.stamp !== t);
    if (changed) {
      state.seconds = v;
      state.running = running;
      state.stamp = t;
    }
    return changed;
  }

  function resetSamples() {
    previousValue = null;
    previousSampleAt = 0;
    sameSince = 0;
    sameCount = 0;
    driftSign = 0;
    driftSince = 0;
  }

  function observe(state, value, sampledAt, now, automatic) {
    if (!Number.isInteger(value) || value < 0 || value > 5999) return false;
    const t = Math.min(now, Number.isFinite(sampledAt) ? sampledAt : now);
    if (!automatic) {
      resetSamples();
      lastClearReadAt = now;
      return setClock(state, value, false, now);
    }
    if (previousSampleAt && t <= previousSampleAt) return false;

    const old = previousValue;
    const gap = previousSampleAt ? Math.max(0, t - previousSampleAt) : 0;
    const falling = old !== null && value < old &&
      (old - value) <= Math.max(2, Math.ceil(gap / 1000) + 1);
    const rising = old !== null && value > old;

    if (old !== null && old === value) sameCount++;
    else { sameSince = t; sameCount = 1; }
    previousValue = value;
    previousSampleAt = t;
    lastClearReadAt = now;

    // Manual adjustments and new-period resets must be reflected on the overlay.
    if (rising) {
      driftSign = 0;
      return setClock(state, value, false, t);
    }
    if (value === 0) {
      driftSign = 0;
      return setClock(state, 0, false, t);
    }

    if (!state.running) {
      // Initial stationary clock stays stationary; movement starts the live timer.
      if (falling) {
        driftSign = 0;
        return setClock(state, value, true, t);
      }
      return setClock(state, value, false, t);
    }

    // Multiple confirmed identical camera readings across an entire clock tick
    // are evidence of a stopped gym clock, not merely two adjacent video frames.
    if (sameCount >= 3 && t - sameSince >= STOP_HOLD_MS) {
      driftSign = 0;
      return setClock(state, value, false, t);
    }

    // The overlay counts locally between OCR reads. Do NOT reset the second
    // boundary for each new frame, which caused uneven or skipped seconds.
    const predicted = projected(state, t);
    const difference = predicted - value;
    if (Math.abs(difference) <= 1) {
      driftSign = 0;
      driftSince = 0;
      return false;
    }
    const sign = Math.sign(difference);
    if (driftSign !== sign) {
      driftSign = sign;
      driftSince = t;
      return false;
    }
    if (t - driftSince >= RESYNC_HOLD_MS && now - lastResyncAt >= RESYNC_COOLDOWN_MS) {
      lastResyncAt = now;
      driftSign = 0;
      driftSince = 0;
      // A verified discrepancy of 2+ seconds is a genuine clock correction.
      return setClock(state, value, true, t);
    }
    return false;
  }

  function publishState(state) {
    localStorage.setItem('htv-score', JSON.stringify(state));
    window.htvSync?.publishScore();
  }

  function stopReader() {
    readingActive = false;
    resetSamples();
    let state;
    try { state = JSON.parse(localStorage.getItem('htv-score') || '{}'); } catch (_) { return; }
    if (!state.running) return;
    const now = Date.now();
    setClock(state, projected(state, now), false, now);
    publishState(state);
  }

  function startReader() {
    resetSamples();
    readingActive = true;
    lastClearReadAt = Date.now();
  }

  function noteClearRead() {
    if (readingActive) {
      lastClearReadAt = Date.now();
      const notice = document.getElementById('clock-status');
      if (notice && notice.textContent.includes('paused because')) notice.textContent = 'Smooth clock: clear camera readings restored; monitoring the gym clock.';
    }
  }

  function watchdog() {
    if (!readingActive || !lastClearReadAt || Date.now() - lastClearReadAt < LOST_READ_MS) return;
    let state;
    try { state = JSON.parse(localStorage.getItem('htv-score') || '{}'); } catch (_) { return; }
    if (!state.running) return;
    const now = Date.now();
    setClock(state, projected(state, now), false, now);
    publishState(state);
    resetSamples();
    lastClearReadAt = now;
    const notice = document.getElementById('clock-status');
    if (notice) notice.textContent = 'Smooth clock: paused because no clear clock reading arrived for 6.5 seconds.';
  }

  window.htvSmoothClock = { observe, projected, startReader, stopReader, noteClearRead, watchdog };
  setInterval(watchdog, 500);
})();
