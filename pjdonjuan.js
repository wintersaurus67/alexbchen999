/* ===================================================================
   DON JUAN - full-viewport sticky player
   Loaded after piano.js. Uses Tone.js + @tonejs/midi (both from CDN).

   Plays the MIDI FAITHFULLY - exact times, durations, and velocities
   from the file. No tempo, dynamics, or duration reshaping.

   Layers (back to front):
     - night sky background (canvas): stars, constellations, nebula,
       mood/colour that drifts slowly with playback progress
     - falling note bars (canvas): colour mapped by pitch + the same
       drifting mood palette
     - particle sparks (canvas)
     - 88-key keyboard with hit glow
   Transport: play / pause / stop + draggable YouTube-style scrubber.
=================================================================== */
(function () {
  const root = document.getElementById('donjuanModule');
  if (!root) return;
  if (typeof Tone === 'undefined') { console.error('[donjuan] Tone.js not loaded'); return; }

  const MIDI_URL = 'liz_donjuan.mid';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ============ DOM REFS ============ */
  const statusEl   = root.querySelector('.dj-status');
  const bgCanvas   = root.querySelector('.dj-bg');
  const fallingCv  = root.querySelector('.dj-falling');
  const particleCv = root.querySelector('.dj-particles');
  const keyboardEl = root.querySelector('.dj-keyboard');
  const overlay    = root.querySelector('.dj-start-overlay');
  const startBtn   = root.querySelector('.dj-start-btn');
  const playBtn    = root.querySelector('.dj-play');
  const stopBtn    = root.querySelector('.dj-stop');
  const scrub      = root.querySelector('.dj-scrub');
  const scrubPlayed= scrub && scrub.querySelector('.played');
  const scrubHover = scrub && scrub.querySelector('.hover-fill');
  const scrubHandle= scrub && scrub.querySelector('.handle');
  const scrubTip   = scrub && scrub.querySelector('.tooltip');
  const timeNow    = root.querySelector('.dj-time-now');
  const timeTotal  = root.querySelector('.dj-time-total');

  /* ============ KEYBOARD (88 keys) ============ */
  const MIN_MIDI = 21, MAX_MIDI = 108;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  const midiToName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  const keyEls = {};
  const whiteMidis = [];
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) if (!isBlack(m)) whiteMidis.push(m);
  const numWhite = whiteMidis.length;
  keyboardEl.style.gridTemplateColumns = `repeat(${numWhite}, 1fr)`;

  whiteMidis.forEach(m => {
    const k = document.createElement('div');
    k.className = 'dj-key';
    k.dataset.midi = m;
    keyboardEl.appendChild(k);
    keyEls[m] = k;
  });
  const whiteUnit = 100 / numWhite;
  const blackW = whiteUnit * 0.62;
  whiteMidis.forEach((wm, i) => {
    const next = whiteMidis[i + 1];
    if (!next || next - wm !== 2) return;
    const bm = wm + 1;
    const k = document.createElement('div');
    k.className = 'dj-key dj-key-black';
    k.dataset.midi = bm;
    k.style.left = ((i + 1) * whiteUnit - blackW / 2) + '%';
    k.style.width = blackW + '%';
    keyboardEl.appendChild(k);
    keyEls[bm] = k;
  });

  // Precompute each key's horizontal position as a FRACTION of total width
  // (resolution-independent, computed once - no per-frame getBoundingClientRect).
  const keyFrac = {}; // midi -> { cx, w, black }
  whiteMidis.forEach((m, i) => {
    keyFrac[m] = { cx: (i + 0.5) / numWhite, w: 1 / numWhite, black: false };
  });
  whiteMidis.forEach((wm, i) => {
    const next = whiteMidis[i + 1];
    if (!next || next - wm !== 2) return;
    keyFrac[wm + 1] = { cx: (i + 1) / numWhite, w: (1 / numWhite) * 0.62, black: true };
  });

  /* ============ AUDIO CHAIN ============ */
  // Sampler -> Gain -> Limiter -> Destination.
  // The limiter is a transparent brick wall (~-1 dB) to stop digital clipping
  // on the dense chords; it does not reshape the score's dynamics.
  let sampler = null, samplerPromise = null;
  function loadSampler() {
    if (samplerPromise) return samplerPromise;
    samplerPromise = new Promise((resolve, reject) => {
      const gain = new Tone.Gain(0.9);
      const limiter = new Tone.Limiter(-1);
      sampler = new Tone.Sampler({
        urls: {
          'C1': 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', 'A1': 'A1.mp3',
          'C2': 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', 'A2': 'A2.mp3',
          'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', 'A3': 'A3.mp3',
          'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', 'A4': 'A4.mp3',
          'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', 'A5': 'A5.mp3',
          'C6': 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', 'A6': 'A6.mp3',
          'C7': 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3', 'A7': 'A7.mp3',
          'C8': 'C8.mp3',
        },
        baseUrl: 'samples/piano/',
        release: 1.0,
        attack: 0.002,
        onload: resolve,
        onerror: reject,
      }).chain(gain, limiter, Tone.Destination);
    });
    return samplerPromise;
  }

  /* ============ MIDI LOAD - FAITHFUL ============ */
  let events = [];       // { t, midi, dur, vel } sorted by t
  let totalDur = 0;
  let maxDur = 0;
  async function loadMidi() {
    const MidiCtor = (typeof Midi !== 'undefined')
      ? Midi
      : (window['@tonejs/midi'] && window['@tonejs/midi'].Midi);
    if (!MidiCtor) throw new Error('@tonejs/midi not loaded');
    const res = await fetch(MIDI_URL);
    if (!res.ok) throw new Error('could not fetch ' + MIDI_URL + ' (' + res.status + ')');
    const midi = new MidiCtor(await res.arrayBuffer());

    events = [];
    midi.tracks.forEach(tr => tr.notes.forEach(n => {
      events.push({ t: n.time, midi: n.midi, dur: Math.max(0.03, n.duration), vel: n.velocity });
    }));
    events.sort((a, b) => a.t - b.t || a.midi - b.midi);

    maxDur = 0;
    let end = 0;
    for (const e of events) { if (e.dur > maxDur) maxDur = e.dur; if (e.t + e.dur > end) end = e.t + e.dur; }
    totalDur = Math.max(midi.duration || 0, end);
  }

  function lowerBound(t) {
    let lo = 0, hi = events.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t < t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* ============ PLAYBACK ENGINE (sample-accurate) ============ */
  // Notes are scheduled at exact web-audio times via a small look-ahead loop,
  // not setTimeout(triggerAttackRelease) - that's what kept timing tight.
  let ready = false;
  let playing = false;
  let logicalPos = 0;      // seconds; authoritative when paused
  let posAnchor = 0;       // logicalPos at last (re)start
  let audioAnchor = 0;     // Tone.now() at last (re)start
  let schedIdx = 0;        // next event to hand to the audio clock
  let audioTimer = null;
  const LOOKAHEAD = 0.3;

  function nowSec() {
    return playing ? Math.min(totalDur, posAnchor + (Tone.now() - audioAnchor)) : logicalPos;
  }

  function startAudioLoop() {
    stopAudioLoop();
    audioTimer = setInterval(audioTick, 25);
    audioTick();
  }
  function stopAudioLoop() {
    if (audioTimer) { clearInterval(audioTimer); audioTimer = null; }
  }
  function audioTick() {
    if (!playing) return;
    const horizon = nowSec() + LOOKAHEAD;
    while (schedIdx < events.length && events[schedIdx].t <= horizon) {
      const e = events[schedIdx++];
      let when = audioAnchor + (e.t - posAnchor);
      const floor = Tone.now() + 0.005;
      if (when < floor) when = floor;
      try { sampler.triggerAttackRelease(midiToName(e.midi), e.dur, when, e.vel); } catch (_) {}
    }
  }

  async function play() {
    if (playing || !ready) return;
    if (Tone.context.state !== 'running') await Tone.start();
    if (logicalPos >= totalDur - 0.02) { logicalPos = 0; resetVisualPointers(0); }
    playing = true;
    audioAnchor = Tone.now() + 0.06;
    posAnchor = logicalPos;
    schedIdx = lowerBound(logicalPos);
    startAudioLoop();
    setPlayIcon(true);
    setStatus('playing');
  }

  function pause() {
    if (!playing) return;
    logicalPos = nowSec();
    playing = false;
    stopAudioLoop();
    if (sampler) sampler.releaseAll();
    clearGlows();
    setPlayIcon(false);
    setStatus('paused');
  }

  function stop() {
    playing = false;
    stopAudioLoop();
    if (sampler) sampler.releaseAll();
    logicalPos = 0;
    resetVisualPointers(0);
    clearGlows();
    setPlayIcon(false);
    setStatus('stopped');
    updateTransportUI(0);
  }

  function seek(p) {
    p = Math.max(0, Math.min(totalDur, p));
    const wasPlaying = playing;
    if (playing) { stopAudioLoop(); if (sampler) sampler.releaseAll(); }
    logicalPos = p;
    schedIdx = lowerBound(p);
    resetVisualPointers(p);
    clearGlows();
    if (wasPlaying) { audioAnchor = Tone.now() + 0.04; posAnchor = p; startAudioLoop(); }
    updateTransportUI(p);
  }

  function onEnded() {
    playing = false;
    stopAudioLoop();
    if (sampler) sampler.releaseAll();
    logicalPos = totalDur;
    clearGlows();
    setPlayIcon(false);
    setStatus('finished');
  }

  /* ============ MOOD / COLOUR (drifts slowly with progress) ============ */
  // Each anchor is tied to a point in the piece. Colour is interpolated by
  // progress and then eased frame-to-frame, so it shifts gradually - no flashing.
  const hexRGB = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpRGB = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const lerpHue = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hsla = (h, s, l, a) => `hsla(${h.toFixed(0)},${s}%,${l}%,${a})`;

  const MOODS = [
    { p: 0.00, bgTop: '#070e22', bgBot: '#020610', neb: [212, 48], star: 214, note: 220, spread: 46, accent: '#6f8fd8' }, // midnight blue - the grave
    { p: 0.22, bgTop: '#0a1334', bgBot: '#050a1e', neb: [232, 50], star: 224, note: 206, spread: 60, accent: '#7d9be6' }, // cool indigo
    { p: 0.46, bgTop: '#120f3a', bgBot: '#0a0a24', neb: [266, 52], star: 256, note: 282, spread: 70, accent: '#b08be0' }, // violet - the seduction
    { p: 0.68, bgTop: '#1b0e33', bgBot: '#0e0619', neb: [302, 56], star: 286, note: 326, spread: 58, accent: '#c97fb0' }, // plum/magenta - tension
    { p: 0.86, bgTop: '#200a1a', bgBot: '#10040b', neb: [346, 60], star: 4,   note: 350, spread: 40, accent: '#d4607a' }, // crimson - the statue
    { p: 1.00, bgTop: '#260b07', bgBot: '#120402', neb: [20, 70],  star: 30,  note: 26,  spread: 56, accent: '#e8893a' }, // fire - the finale
  ].map(m => ({ p: m.p, bgTop: hexRGB(m.bgTop), bgBot: hexRGB(m.bgBot), accent: hexRGB(m.accent), neb: m.neb, star: m.star, note: m.note, spread: m.spread }));

  function moodAt(p) {
    p = Math.max(0, Math.min(1, p));
    let i = 0;
    while (i < MOODS.length - 1 && p > MOODS[i + 1].p) i++;
    const a = MOODS[i], b = MOODS[Math.min(i + 1, MOODS.length - 1)];
    const span = (b.p - a.p) || 1;
    const t = Math.max(0, Math.min(1, (p - a.p) / span));
    return {
      bgTop: lerpRGB(a.bgTop, b.bgTop, t),
      bgBot: lerpRGB(a.bgBot, b.bgBot, t),
      accent: lerpRGB(a.accent, b.accent, t),
      nebH: lerpHue(a.neb[0], b.neb[0], t), nebS: lerp(a.neb[1], b.neb[1], t),
      starH: lerpHue(a.star, b.star, t),
      noteH: lerpHue(a.note, b.note, t),
      spread: lerp(a.spread, b.spread, t),
    };
  }
  // smoothed running palette
  const cur = moodAt(0);
  function easeMood(target) {
    const k = 0.045; // slow easing -> gradual transitions even after a seek
    cur.bgTop = lerpRGB(cur.bgTop, target.bgTop, k);
    cur.bgBot = lerpRGB(cur.bgBot, target.bgBot, k);
    cur.accent = lerpRGB(cur.accent, target.accent, k);
    cur.nebH = lerpHue(cur.nebH, target.nebH, k);
    cur.nebS = lerp(cur.nebS, target.nebS, k);
    cur.starH = lerpHue(cur.starH, target.starH, k);
    cur.noteH = lerpHue(cur.noteH, target.noteH, k);
    cur.spread = lerp(cur.spread, target.spread, k);
  }

  /* ============ STARFIELD (generated once, seeded) ============ */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(0x5151ab);
  const STARS = [];
  const STAR_COUNT = reduceMotion ? 90 : 150;
  for (let i = 0; i < STAR_COUNT; i++) {
    STARS.push({
      x: rng(), y: rng(),
      r: 0.4 + rng() * 1.5,
      base: 0.25 + rng() * 0.6,
      phase: rng() * Math.PI * 2,
      speed: 0.3 + rng() * 0.9,
      bright: rng() < 0.16,
    });
  }
  // constellation lines: connect some bright stars to their nearest bright neighbour
  const bright = STARS.map((s, i) => ({ s, i })).filter(o => o.s.bright);
  const LINES = [];
  bright.forEach((o, bi) => {
    let best = -1, bestD = Infinity;
    bright.forEach((p, pj) => {
      if (pj === bi) return;
      const dx = o.s.x - p.s.x, dy = o.s.y - p.s.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = pj; }
    });
    if (best >= 0 && bestD < 0.045) LINES.push([o.i, bright[best].i]);
  });
  // a few slow meteors
  const meteors = [];
  function maybeSpawnMeteor(dt) {
    if (reduceMotion) return;
    if (Math.random() < dt / 16) {
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft ? -0.05 : 1.05,
        y: 0.05 + Math.random() * 0.4,
        vx: (fromLeft ? 1 : -1) * (0.18 + Math.random() * 0.12),
        vy: 0.10 + Math.random() * 0.10,
        life: 1,
      });
    }
  }

  /* ============ CANVAS FIT (resize only on real change) ============ */
  function fit(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas._w !== w || canvas._h !== h || canvas._dpr !== dpr) {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas._w = w; canvas._h = h; canvas._dpr = dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ============ BACKGROUND DRAW ============ */
  function drawBackground(time, dt) {
    const { ctx, w, h } = fit(bgCanvas);
    ctx.clearRect(0, 0, w, h);

    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(cur.bgTop, 1));
    g.addColorStop(1, rgba(cur.bgBot, 1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // nebula blobs (slow drift)
    const blobs = [
      { x: 0.22, y: 0.30, r: 0.55, d: 0 },
      { x: 0.78, y: 0.62, r: 0.50, d: 2.1 },
      { x: 0.50, y: 0.85, r: 0.45, d: 4.3 },
    ];
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach(b => {
      const cx = (b.x + Math.sin(time * 0.02 + b.d) * 0.02) * w;
      const cy = (b.y + Math.cos(time * 0.017 + b.d) * 0.02) * h;
      const rad = b.r * Math.max(w, h);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      rg.addColorStop(0, hsla(cur.nebH, cur.nebS, 24, 0.16));
      rg.addColorStop(0.5, hsla(cur.nebH, cur.nebS, 18, 0.06));
      rg.addColorStop(1, hsla(cur.nebH, cur.nebS, 14, 0));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    });
    ctx.globalCompositeOperation = 'source-over';

    // constellation lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(cur.accent, 0.10);
    LINES.forEach(([a, b]) => {
      const sa = STARS[a], sb = STARS[b];
      ctx.beginPath();
      ctx.moveTo(sa.x * w, sa.y * h);
      ctx.lineTo(sb.x * w, sb.y * h);
      ctx.stroke();
    });

    // stars
    for (const s of STARS) {
      const tw = reduceMotion ? 1 : (0.65 + 0.35 * Math.sin(time * s.speed + s.phase));
      const a = s.base * tw;
      const x = s.x * w, y = s.y * h;
      if (s.bright) {
        ctx.fillStyle = hsla(cur.starH, 40, 92, a * 0.5);
        ctx.beginPath(); ctx.arc(x, y, s.r * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = hsla(cur.starH, 30, 96, a);
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // meteors
    maybeSpawnMeteor(dt);
    ctx.lineCap = 'round';
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt / 1.4;
      if (m.life <= 0 || m.x < -0.1 || m.x > 1.1) { meteors.splice(i, 1); continue; }
      const x = m.x * w, y = m.y * h;
      const tx = x - m.vx * w * 0.5, ty = y - m.vy * h * 0.5;
      const mg = ctx.createLinearGradient(tx, ty, x, y);
      mg.addColorStop(0, hsla(cur.starH, 30, 95, 0));
      mg.addColorStop(1, hsla(cur.starH, 40, 96, m.life * 0.7));
      ctx.strokeStyle = mg; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    }
  }

  /* ============ FALLING NOTES (synesthesia) ============ */
  const FALL_LOOKAHEAD = 3.4; // seconds of notes visible above the keyboard
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawFalling(now) {
    const { ctx, w, h } = fit(fallingCv);
    ctx.clearRect(0, 0, w, h);

    let i = lowerBound(now - maxDur - 0.1);
    if (i < 0) i = 0;
    for (; i < events.length; i++) {
      const e = events[i];
      if (e.t > now + FALL_LOOKAHEAD) break;
      if (e.t + e.dur < now - 0.1) continue;
      const kf = keyFrac[e.midi];
      if (!kf) continue;

      const timeToHit = e.t - now;
      const yNow = h * (1 - timeToHit / FALL_LOOKAHEAD);
      const barH = (e.dur / FALL_LOOKAHEAD) * h;
      const yTop = yNow - barH;
      const bw = Math.max(3, kf.w * w * (kf.black ? 0.82 : 0.86));
      const xc = kf.cx * w;

      const active = (e.t <= now && e.t + e.dur > now);
      const pp = (e.midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI);
      const hue = (cur.noteH + (pp - 0.5) * cur.spread + 360) % 360;
      const sat = 72;
      const light = (active ? 64 : 50) + e.vel * 16;
      const alpha = active ? 0.96 : (0.30 + 0.45 * e.vel);

      if (active) { ctx.shadowColor = hsla(hue, 88, 66, 0.85); ctx.shadowBlur = 16; }
      else { ctx.shadowBlur = 0; }
      ctx.fillStyle = hsla(hue, sat, Math.min(78, light), alpha);
      roundRect(ctx, xc - bw / 2, yTop, bw, Math.max(2, yNow - yTop), Math.min(3, bw / 3));
      ctx.fill();

      if (active) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = hsla(hue, 90, 88, 0.9);
        roundRect(ctx, xc - bw / 2, yNow - 2, bw, 3, 1.5);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    // hit line at the keyboard
    ctx.strokeStyle = rgba(cur.accent, 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
  }

  /* ============ KEY GLOW + PARTICLES ============ */
  let visualIdx = 0;
  const activeKeys = new Map(); // midi -> glowUntil (logical seconds)
  const particles = [];
  const MAX_PARTICLES = 520;

  function resetVisualPointers(p) { visualIdx = lowerBound(p); }
  function clearGlows() {
    activeKeys.forEach((_, m) => { const k = keyEls[m]; if (k) { k.classList.remove('hit'); k.style.removeProperty('--hit-intensity'); } });
    activeKeys.clear();
  }
  function visualHit(e, now) {
    const k = keyEls[e.midi];
    if (k) {
      k.classList.add('hit');
      k.style.setProperty('--hit-intensity', e.vel.toFixed(3));
      activeKeys.set(e.midi, now + Math.max(0.12, Math.min(0.55, e.dur)));
    }
    if (reduceMotion || particles.length > MAX_PARTICLES) return;
    const kf = keyFrac[e.midi];
    if (!kf) return;
    const { w, h } = fit(particleCv);
    const xc = kf.cx * w;
    const count = Math.floor(4 + e.vel * 12);
    const pp = (e.midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI);
    const hue = (cur.noteH + (pp - 0.5) * cur.spread + 360) % 360;
    for (let n = 0; n < count; n++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
      const sp = 40 + e.vel * 170 * (0.6 + Math.random() * 0.8);
      particles.push({
        x: xc + (Math.random() - 0.5) * kf.w * w * 0.5,
        y: h - 1,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 1, max: 0.5 + Math.random() * 0.6,
        size: 1.2 + Math.random() * 2.2 * e.vel,
        hue,
      });
    }
  }
  function drawParticles(dt) {
    const { ctx, w, h } = fit(particleCv);
    ctx.clearRect(0, 0, w, h);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt / p.max;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 90 * dt; p.vx *= 0.985;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.max(0, p.life);
      ctx.fillStyle = hsla(p.hue, 85, 70, a);
      ctx.shadowColor = hsla(p.hue, 85, 60, a * 0.6);
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  /* ============ TRANSPORT UI ============ */
  const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  function setPlayIcon(p) { if (playBtn) { playBtn.innerHTML = p ? ICON_PAUSE : ICON_PLAY; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play'); } }
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }
  function updateTransportUI(pos) {
    if (timeNow) timeNow.textContent = fmt(pos);
    if (timeTotal) timeTotal.textContent = fmt(totalDur);
    const frac = totalDur ? (pos / totalDur) : 0;
    if (scrubPlayed) scrubPlayed.style.width = (frac * 100) + '%';
    if (scrubHandle) scrubHandle.style.left = (frac * 100) + '%';
  }

  let dragging = false, dragWasPlaying = false;
  function posFromClientX(clientX) {
    const r = scrub.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return frac * totalDur;
  }
  function wireTransport() {
    if (playBtn) playBtn.addEventListener('click', () => { playing ? pause() : play(); });
    if (stopBtn) stopBtn.addEventListener('click', stop);
    if (!scrub) return;

    // hover preview
    scrub.addEventListener('mousemove', ev => {
      if (dragging) return;
      const r = scrub.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      if (scrubHover) { scrubHover.style.width = (frac * 100) + '%'; }
      if (scrubTip) { scrubTip.style.left = (frac * 100) + '%'; scrubTip.textContent = fmt(frac * totalDur); }
    });
    scrub.addEventListener('mouseleave', () => { if (scrubHover) scrubHover.style.width = '0%'; });

    // drag / click to seek (audio scrubs on release, visuals preview live)
    scrub.addEventListener('pointerdown', ev => {
      if (!ready) return;
      dragging = true;
      dragWasPlaying = playing;
      scrub.classList.add('dragging');
      scrub.setPointerCapture(ev.pointerId);
      if (playing) { playing = false; stopAudioLoop(); if (sampler) sampler.releaseAll(); clearGlows(); setPlayIcon(false); }
      const p = posFromClientX(ev.clientX);
      logicalPos = p; resetVisualPointers(p); clearGlows(); updateTransportUI(p);
    });
    scrub.addEventListener('pointermove', ev => {
      if (!dragging) return;
      const p = posFromClientX(ev.clientX);
      logicalPos = p; resetVisualPointers(p); clearGlows(); updateTransportUI(p);
      if (scrubTip) { const f = totalDur ? p / totalDur : 0; scrubTip.style.left = (f * 100) + '%'; scrubTip.textContent = fmt(p); }
    });
    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      scrub.classList.remove('dragging');
      try { scrub.releasePointerCapture(ev.pointerId); } catch (_) {}
      if (dragWasPlaying) play();
    }
    scrub.addEventListener('pointerup', endDrag);
    scrub.addEventListener('pointercancel', endDrag);
  }

  function enableTransport() {
    [playBtn, stopBtn].forEach(b => b && (b.disabled = false));
    if (scrub) scrub.classList.remove('disabled');
  }

  /* ============ MASTER RENDER LOOP (always running) ============ */
  let lastT = performance.now() / 1000;
  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.05, t - lastT);
    lastT = t;

    const pos = nowSec();
    easeMood(moodAt(totalDur ? pos / totalDur : 0));

    drawBackground(t, dt);

    if (playing) {
      while (visualIdx < events.length && events[visualIdx].t <= pos) {
        visualHit(events[visualIdx], pos);
        visualIdx++;
      }
    }
    // expire glows
    activeKeys.forEach((until, m) => {
      if (pos > until) { const k = keyEls[m]; if (k) { k.classList.remove('hit'); k.style.removeProperty('--hit-intensity'); } activeKeys.delete(m); }
    });

    if (events.length) drawFalling(pos);
    drawParticles(dt);

    if (!dragging) updateTransportUI(pos);
    if (playing && pos >= totalDur - 0.001) onEnded();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ============ START (audio unlock gesture) ============ */
  wireTransport();
  setPlayIcon(false);
  setStatus('press play to begin');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      setStatus('loading...');
      try {
        await Tone.start();
        await Promise.all([loadSampler(), loadMidi()]);
        ready = true;
        enableTransport();
        updateTransportUI(0);
        if (overlay) overlay.classList.add('hidden');
        await play();
      } catch (err) {
        console.error('[donjuan]', err);
        setStatus('could not load - check liz_donjuan.mid and samples/piano/');
        startBtn.disabled = false;
      }
    });
  }

  // Pause when fully scrolled past (don't auto-resume - you're in control).
  const sticky = root.querySelector('.dj-sticky');
  if ('IntersectionObserver' in window && sticky) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.intersectionRatio <= 0.01 && playing) pause(); });
    }, { threshold: [0, 0.01] });
    io.observe(sticky);
  }
})();
