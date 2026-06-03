/* ===================================================================
   DON JUAN — full-viewport sticky module with 3 visual layers
   Loaded after piano.js. Uses shared Tone.js sampler + @tonejs/midi.
   - Top: abstract notation visualizer (treble + bass staves, scrolling)
   - Middle: falling-bars piano roll
   - Bottom: 88-key keyboard with hit glow + particle effects
   - 200vh container, position:sticky inner — auto-plays when entering view
=================================================================== */
(function(){
  const root = document.getElementById('donjuanModule');
  if (!root) return;
  if (typeof Tone === 'undefined') { console.error('Tone.js missing'); return; }

  const MIDI_URL = 'liz_donjuan.mid';

  // Section boundaries derived from MIDI analysis + PDF score markings.
  // Times in seconds, scaled to the same 1.0x speed the player uses.
  // These are approximate but informed by both tempo map and the score's tempo indications.
  const SECTIONS = [
    { t:   0,  name: 'Grave',                 short: 'GRAVE' },
    { t:  90,  name: 'Andante',               short: 'ANDANTE' },
    { t: 115,  name: 'Cadenza · presto',      short: 'PRESTO' },
    { t: 195,  name: 'Andantino · Là ci darem la mano', short: 'ANDANTINO' },
    { t: 290,  name: 'Duetto Andantino',      short: 'DUETTO' },
    { t: 380,  name: 'Allegretto',            short: 'ALLEGRETTO' },
    { t: 470,  name: 'Var. I',                short: 'VAR. I' },
    { t: 590,  name: 'Var. II · Tempo giusto', short: 'VAR. II' },
    { t: 700,  name: 'Presto',                short: 'PRESTO' },
    { t: 830,  name: 'Fin ch\u2019han dal vino', short: 'CHAMPAGNE' },
    { t: 950,  name: 'Prestissimo · finale',  short: 'PRESTISSIMO' },
  ];

  // Section-specific shaping (sustainMult, pedalFill) — matches the score:
  // Slow lyrical sections get more pedal; bravura sections get less smear.
  function shapeAt(t){
    if (t < 90)  return { sustainMult: 2.0, pedalFill: 1.0 };  // Grave
    if (t < 195) return { sustainMult: 1.2, pedalFill: 0.2 };  // Cadenza / presto
    if (t < 380) return { sustainMult: 2.4, pedalFill: 1.4 };  // Andantino lyrical
    if (t < 470) return { sustainMult: 1.6, pedalFill: 0.5 };  // Allegretto theme
    if (t < 830) return { sustainMult: 1.3, pedalFill: 0.3 };  // Variations
    return { sustainMult: 1.1, pedalFill: 0.15 };              // Finale bravura
  }

  /* ============ DOM REFS ============ */
  const sticky    = root.querySelector('.dj-sticky');
  const statusEl  = root.querySelector('.dj-status');
  const sectionEl = root.querySelector('.dj-section-label');
  const bgEl      = root.querySelector('.dj-bg');
  const startBtn  = root.querySelector('.dj-start-btn');
  const startOverlay = root.querySelector('.dj-start-overlay');
  const progressBar  = root.querySelector('.dj-progress-fill');
  const timeNow  = root.querySelector('.dj-time-now');
  const timeTotal = root.querySelector('.dj-time-total');

  const notationCanvas = root.querySelector('.dj-notation');
  const fallingCanvas  = root.querySelector('.dj-falling');
  const keyboardEl     = root.querySelector('.dj-keyboard');
  const particlesCanvas = root.querySelector('.dj-particles');

  /* ============ KEYBOARD BUILD (88 keys) ============ */
  const MIN_MIDI = 21, MAX_MIDI = 108;
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function midiToName(m){ return NOTE_NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1); }
  function isBlack(m){ return [1,3,6,8,10].includes(((m%12)+12)%12); }

  const keyEls = {};
  const whiteMidis = [];
  for (let m=MIN_MIDI; m<=MAX_MIDI; m++) if (!isBlack(m)) whiteMidis.push(m);
  keyboardEl.style.gridTemplateColumns = `repeat(${whiteMidis.length}, 1fr)`;
  whiteMidis.forEach((m)=>{
    const k = document.createElement('div');
    k.className = 'dj-key';
    k.dataset.midi = m;
    keyboardEl.appendChild(k);
    keyEls[m] = k;
  });
  const whiteUnit = 100/whiteMidis.length;
  const blackW = whiteUnit * 0.62;
  whiteMidis.forEach((wm, i)=>{
    const next = whiteMidis[i+1];
    if (!next || next - wm !== 2) return;
    const bm = wm + 1;
    const k = document.createElement('div');
    k.className = 'dj-key dj-key-black';
    k.dataset.midi = bm;
    k.style.left = ((i+1)*whiteUnit - blackW/2) + '%';
    k.style.width = blackW + '%';
    keyboardEl.appendChild(k);
    keyEls[bm] = k;
  });

  /* Compute pixel x-positions for each MIDI key — used by falling-bars + particles */
  function keyXPosition(midi){
    if (!keyEls[midi]) return null;
    const rect = keyEls[midi].getBoundingClientRect();
    const parentRect = keyboardEl.getBoundingClientRect();
    return {
      x: rect.left - parentRect.left + rect.width/2,
      w: rect.width,
      isBlack: isBlack(midi),
    };
  }

  /* ============ SHARED SAMPLER (reuse if piano.js already loaded one) ============ */
  let sampler = null, samplerReady = false, samplerPromise = null;
  function loadSampler(){
    if (samplerPromise) return samplerPromise;
    samplerPromise = new Promise((resolve, reject)=>{
      const eq = new Tone.EQ3({ low: 1, mid: -0.5, high: -1, lowFrequency: 250, highFrequency: 2500 });
      const reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 0.18 });
      const gain = new Tone.Gain(0.75);
      reverb.generate();
      sampler = new Tone.Sampler({
        urls: {
          'C1':'C1.mp3','D#1':'Ds1.mp3','F#1':'Fs1.mp3',
          'A1':'A1.mp3','C2':'C2.mp3','D#2':'Ds2.mp3','F#2':'Fs2.mp3',
          'A2':'A2.mp3','C3':'C3.mp3','D#3':'Ds3.mp3','F#3':'Fs3.mp3',
          'A3':'A3.mp3','C4':'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3',
          'A4':'A4.mp3','C5':'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3',
          'A5':'A5.mp3','C6':'C6.mp3','D#6':'Ds6.mp3','F#6':'Fs6.mp3',
          'A6':'A6.mp3','C7':'C7.mp3','D#7':'Ds7.mp3','F#7':'Fs7.mp3',
          'A7':'A7.mp3','C8':'C8.mp3',
        },
        release: 2.8, attack: 0.003, baseUrl: 'samples/piano/',
        onload: ()=>{ samplerReady = true; resolve(); },
        onerror: e=>reject(e),
      }).chain(eq, reverb, gain, Tone.Destination);
    });
    return samplerPromise;
  }

  /* ============ MIDI LOAD + EVENT BUILD ============ */
  let events = []; // {t, midi, dur, vel, pedal}
  let totalDur = 0;
  async function loadAndBuild(){
    const MidiCtor = (typeof Midi !== 'undefined') ? Midi : (window['@tonejs/midi'] && window['@tonejs/midi'].Midi);
    const res = await fetch(MIDI_URL);
    if (!res.ok) throw new Error('failed to fetch ' + MIDI_URL);
    const buf = await res.arrayBuffer();
    const midi = new MidiCtor(buf);
    // Build pedal intervals from CC64 across all tracks
    let pedals = [];
    midi.tracks.forEach(track=>{
      const cc = (track.controlChanges && track.controlChanges[64]) || [];
      let down=false, start=0;
      cc.forEach(c=>{
        const isDown = c.value >= 0.5;
        if (isDown && !down){ down=true; start=c.time; }
        else if (!isDown && down){ down=false; pedals.push({start, end: c.time}); }
      });
      if (down) pedals.push({start, end: midi.duration});
    });
    pedals.sort((a,b)=>a.start - b.start);
    function isPedaled(t){
      for (const p of pedals){ if (t>=p.start && t<=p.end) return true; if (p.start>t) break; }
      return false;
    }
    function pedalReleaseAfter(t){
      for (const p of pedals){ if (t>=p.start && t<=p.end) return p.end; if (p.start>t) break; }
      return t;
    }
    // Collect notes, compute melody emphasis, apply per-section shaping
    const all = [];
    midi.tracks.forEach(track=>{
      track.notes.forEach(n=>all.push({ time:n.time, midi:n.midi, dur:n.duration, vel:n.velocity }));
    });
    all.sort((a,b)=>a.time - b.time);
    function isMelody(idx){
      const n = all[idx]; let top = n.midi;
      for (let j=idx-1; j>=0; j--){ if (all[j].time < n.time-0.06) break; if (all[j].midi>top) top=all[j].midi; }
      for (let j=idx+1; j<all.length; j++){ if (all[j].time > n.time+0.06) break; if (all[j].midi>top) top=all[j].midi; }
      return n.midi === top;
    }
    events = all.map((n, idx)=>{
      const shape = shapeAt(n.time);
      let dur = n.dur * shape.sustainMult;
      const pedal = isPedaled(n.time);
      if (pedal){
        const pedalEnd = pedalReleaseAfter(n.time);
        const cap = pedalEnd - n.time;
        dur = Math.min(6.0, Math.max(dur, cap));
      }
      let vel = 0.32 + 0.55 * Math.pow(n.vel, 0.8);
      vel = isMelody(idx) ? Math.min(1.0, vel*1.28) : vel*0.58;
      return {
        t: n.time, midi: n.midi, dur: Math.max(0.05, dur),
        vel: Math.max(0.05, Math.min(1.0, vel)), pedal,
      };
    });
    totalDur = events.length ? events[events.length-1].t + events[events.length-1].dur : 0;
  }

  /* ============ PLAYBACK STATE ============ */
  let playing = false;
  let curTime = 0;
  let playStartReal = 0;     // performance.now()/1000 when current play started
  let playStartLogical = 0;  // curTime when current play started
  let scheduledTimers = [];
  let nextEvent = 0;
  let rafId = null;
  const SCHEDULE_AHEAD = 0.30;
  const SCHEDULE_TICK_MS = 80;
  const activeNotes = new Map(); // midi -> { vel, endsAt, el }

  function clearScheduled(){ scheduledTimers.forEach(id=>clearTimeout(id)); scheduledTimers = []; }
  function stopAllVisuals(){
    activeNotes.forEach((info, midi)=>{
      const el = keyEls[midi]; if (el) el.classList.remove('hit');
    });
    activeNotes.clear();
  }

  function fmtTime(s){
    s = Math.max(0, Math.floor(s));
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  }
  function updateUI(){
    timeNow.textContent = fmtTime(curTime);
    timeTotal.textContent = fmtTime(totalDur);
    progressBar.style.width = (totalDur ? (curTime/totalDur*100) : 0) + '%';
    // Update section label
    let cur = SECTIONS[0];
    for (const s of SECTIONS){ if (curTime >= s.t) cur = s; else break; }
    if (sectionEl.textContent !== cur.name){
      sectionEl.textContent = cur.name;
      sectionEl.classList.remove('flash');
      void sectionEl.offsetWidth; // restart animation
      sectionEl.classList.add('flash');
    }
  }

  async function play(){
    if (playing) return;
    if (Tone.context.state !== 'running') await Tone.context.resume();
    if (curTime >= totalDur) curTime = 0;
    playing = true;
    playStartReal = performance.now()/1000;
    playStartLogical = curTime;
    nextEvent = 0;
    while (nextEvent < events.length && events[nextEvent].t < curTime) nextEvent++;
    tickScheduler();
    rafLoop();
    statusEl.textContent = 'playing';
  }
  function pause(){
    if (!playing) return;
    const now = performance.now()/1000;
    curTime = playStartLogical + (now - playStartReal);
    playing = false;
    clearScheduled();
    if (sampler) sampler.releaseAll();
    stopAllVisuals();
    cancelAnimationFrame(rafId);
    statusEl.textContent = 'paused';
  }

  function tickScheduler(){
    if (!playing) return;
    const now = performance.now()/1000;
    const elapsed = now - playStartReal;
    const playhead = curTime + elapsed;
    const horizon = playhead + SCHEDULE_AHEAD;
    while (nextEvent < events.length){
      const ev = events[nextEvent];
      if (ev.t > horizon) break;
      const delaySec = Math.max(0, ev.t - playhead);
      const e = ev;
      const id = setTimeout(()=>{
        if (!playing) return;
        try { sampler.triggerAttackRelease(midiToName(e.midi), e.dur, undefined, e.vel); } catch(err){}
        triggerKeyHit(e.midi, e.vel, e.dur);
      }, delaySec*1000);
      scheduledTimers.push(id);
      nextEvent++;
    }
    if (playing) setTimeout(tickScheduler, SCHEDULE_TICK_MS);
    if (playhead >= totalDur){
      setTimeout(()=>{ if (playing){ pause(); curTime = 0; updateUI(); } }, 500);
    }
  }
  function rafLoop(){
    if (!playing) return;
    const now = performance.now()/1000;
    const elapsed = now - playStartReal;
    curTime = Math.min(playStartLogical + elapsed, totalDur);
    updateUI();
    drawFallingBars(curTime);
    drawNotation(curTime);
    drawParticles();
    rafId = requestAnimationFrame(rafLoop);
  }

  /* ============ VISUAL: KEYBOARD HIT + PARTICLES ============ */
  // Particles are managed in a separate canvas overlay above the keyboard
  const particles = []; // {x, y, vx, vy, life, maxLife, color, size}
  function triggerKeyHit(midi, vel, dur){
    const el = keyEls[midi];
    if (!el) return;
    el.classList.add('hit');
    // Set CSS variable for glow intensity based on velocity
    el.style.setProperty('--hit-intensity', vel);
    const flashMs = Math.max(200, Math.min(700, dur*1000*0.7));
    setTimeout(()=>{
      if (el) { el.classList.remove('hit'); el.style.removeProperty('--hit-intensity'); }
    }, flashMs);
    // Spawn particles from this key
    const pos = keyXPosition(midi);
    if (!pos) return;
    const pcRect = particlesCanvas.getBoundingClientRect();
    const kbRect = keyboardEl.getBoundingClientRect();
    const yAtTop = kbRect.top - pcRect.top;
    const xRel = pos.x + (kbRect.left - pcRect.left);
    const count = Math.floor(6 + vel*14);
    for (let i=0; i<count; i++){
      const angle = -Math.PI/2 + (Math.random()-0.5)*Math.PI*0.8;
      const speed = 40 + vel*180 * (0.6 + Math.random()*0.8);
      particles.push({
        x: xRel + (Math.random()-0.5)*pos.w*0.6,
        y: yAtTop + Math.random()*3,
        vx: Math.cos(angle)*speed,
        vy: Math.sin(angle)*speed,
        life: 1.0, maxLife: 0.6 + Math.random()*0.6,
        size: 1.4 + Math.random()*2.4*vel,
      });
    }
  }
  let particleLastT = 0;
  function drawParticles(){
    const ctx = particlesCanvas.getContext('2d');
    const w = particlesCanvas.width = particlesCanvas.clientWidth * (window.devicePixelRatio||1);
    const h = particlesCanvas.height = particlesCanvas.clientHeight * (window.devicePixelRatio||1);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w/dpr,h/dpr);
    const now = performance.now()/1000;
    const dt = particleLastT ? Math.min(0.05, now - particleLastT) : 1/60;
    particleLastT = now;
    for (let i=particles.length-1; i>=0; i--){
      const p = particles[i];
      p.life -= dt / p.maxLife;
      if (p.life <= 0){ particles.splice(i,1); continue; }
      p.vy += 80 * dt;             // gravity
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const alpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.fillStyle = `rgba(232, 197, 74, ${alpha})`;
      ctx.shadowColor = `rgba(212, 175, 55, ${alpha*0.6})`;
      ctx.shadowBlur = 6;
      ctx.arc(p.x, p.y, p.size * (0.4 + p.life*0.6), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  /* ============ VISUAL: FALLING BARS ============ */
  // Bars start at "lookAhead" seconds before their hit time, falling from the top of the falling-area
  // to the top of the keyboard. They reach the keyboard at exactly t = event.t.
  const FALL_LOOKAHEAD = 4.0; // seconds visible before hit
  function drawFallingBars(now){
    const ctx = fallingCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = fallingCanvas.clientWidth, ch = fallingCanvas.clientHeight;
    fallingCanvas.width = cw * dpr;
    fallingCanvas.height = ch * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cw,ch);
    // Get keyboard positions in coords relative to fallingCanvas
    const fRect = fallingCanvas.getBoundingClientRect();
    const kbRect = keyboardEl.getBoundingClientRect();
    const kbLeftRel = kbRect.left - fRect.left;
    // Range of events to draw: those whose [t, t+dur] overlaps [now, now+lookAhead]
    // and those just-hit (t close to now)
    const tMin = now - 0.2;
    const tMax = now + FALL_LOOKAHEAD;
    // Linear scan; events are sorted by t
    for (let i = 0; i < events.length; i++){
      const e = events[i];
      if (e.t + e.dur < tMin) continue;
      if (e.t > tMax) break;
      const pos = keyXPosition(e.midi);
      if (!pos) continue;
      const xCenter = kbLeftRel + pos.x;
      // y at hit (= top of keyboard) is ch (bottom of falling canvas)
      // y at t = now + FALL_LOOKAHEAD is 0 (top of falling canvas)
      const timeUntilHit = e.t - now;
      const yHit = ch;
      const yNow = ch * (1 - timeUntilHit / FALL_LOOKAHEAD);
      const heightInTime = e.dur / FALL_LOOKAHEAD * ch;
      // Bar top
      const yTop = yNow - heightInTime;
      const w = Math.max(4, pos.w * (pos.isBlack ? 0.85 : 0.78));
      const isPlaying = (e.t <= now && e.t + e.dur > now);
      // Color: gold gradient, brightness from velocity, dim if not yet hit, bright if active
      const baseA = isPlaying ? 1.0 : 0.55 + 0.35*e.vel;
      const fillColor = pos.isBlack
        ? `rgba(212, 175, 55, ${baseA})`
        : `rgba(232, 197, 74, ${baseA})`;
      // Glow when actively playing
      ctx.shadowBlur = isPlaying ? 14 : 0;
      ctx.shadowColor = `rgba(232, 197, 74, ${isPlaying ? 0.8 : 0})`;
      const radius = Math.min(3, w/3);
      drawRoundRect(ctx, xCenter - w/2, yTop, w, Math.max(2, yNow - yTop), radius, fillColor);
    }
    ctx.shadowBlur = 0;
    // Horizontal line at the keyboard (hit zone)
    ctx.strokeStyle = 'rgba(232, 197, 74, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ch - 0.5); ctx.lineTo(cw, ch - 0.5);
    ctx.stroke();
  }
  function drawRoundRect(ctx, x, y, w, h, r, fill){
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    ctx.fill();
  }

  /* ============ VISUAL: NOTATION ============ */
  // Real treble and bass staves. Notes appear on the right edge as they're played,
  // then scroll leftward off the screen. Each note is placed at the correct staff line/space
  // by pitch, with accidentals when needed (shown as ♯/♭/♮ glyphs).
  // Key signature is fixed per section (best-effort from the score).
  //
  // Notation visible window: NOTATION_WIN seconds wide.
  const NOTATION_WIN = 8.0; // seconds shown across the notation panel
  const TREBLE_BOTTOM_MIDI = 64; // E4, bottom line of treble staff
  const BASS_TOP_MIDI = 57;      // A3, top line of bass staff (we'll center bass on F3/D3 area)
  // Standard staff: 5 lines, gap = 1 semitone-step on the staff (diatonic step), each step ~ a third of staff-line spacing in MIDI terms.
  // We'll use a diatonic step mapping: y-coordinate by note's letter (C,D,E,F,G,A,B) with octave.
  function letterStep(midi){
    // Returns a number representing diatonic position: each whole step = 1, white-key only,
    // so we can render staff position. We use C-major spelling.
    const pc = ((midi%12)+12)%12;
    const oct = Math.floor(midi/12) - 1;
    // semitone -> diatonic step index (0..6 within octave)
    const STEP_IN_OCT = [0,0,1,1,2,3,3,4,4,5,5,6]; // C,C#,D,D#,E,F,F#,G,G#,A,A#,B
    const HAS_ACC = [0,1,0,1,0,0,1,0,1,0,1,0];     // 1 if sharp/flat (black key in C major)
    return { step: oct*7 + STEP_IN_OCT[pc], acc: HAS_ACC[pc] };
  }

  // Key signatures by time region (from score):
  // 0-90 (Grave): no sharps/flats but with many accidentals
  // 90-195 (cadenza into Andantino prep): mostly Bb area then transitions
  // 195-700 (Là ci darem, Duetto, Allegretto, Vars): A major (3 sharps: F#, C#, G#)
  // 700-830 (Presto): B-flat major (2 flats)
  // 830-end: B-flat major / mixed
  function keySigAt(t){
    if (t < 90)  return { sharps:[], flats:[] };
    if (t < 195) return { sharps:[], flats:['B','E'] };  // Bb major area
    if (t < 700) return { sharps:['F','C','G'], flats:[] };  // A major
    return { sharps:[], flats:['B','E'] };  // Bb major
  }

  function drawNotation(now){
    const ctx = notationCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = notationCanvas.clientWidth, ch = notationCanvas.clientHeight;
    notationCanvas.width = cw * dpr;
    notationCanvas.height = ch * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cw,ch);

    // Layout: two staves stacked.
    // Treble staff occupies upper half; bass lower half.
    const trebleCenterY = ch * 0.30;
    const bassCenterY   = ch * 0.72;
    const staffLineGap = Math.min(8, ch / 28); // pixels between adjacent staff lines
    const noteRadius = staffLineGap * 0.55;

    // Reference: treble staff bottom line = E4 (step 23: 4*7-(7-2) = 23 in our letterStep system; let's compute)
    const E4 = letterStep(64).step;  // E4
    const F4 = letterStep(65).step;
    const B4 = letterStep(71).step;
    // Treble lines are E4, G4, B4, D5, F5 (every other step starting at E4 going up)
    // So center of treble staff = B4
    const trebleCenterStep = letterStep(71).step; // B4
    // Bass staff lines: G2, B2, D3, F3, A3
    const bassCenterStep = letterStep(currentBassCenter()).step; // D3
    function currentBassCenter(){ return 50; } // D3

    // Draw 5 staff lines for treble and bass
    function staffLineY(centerY, lineOffset){
      // lineOffset: -2,-1,0,1,2 from center, in diatonic steps
      return centerY - lineOffset * staffLineGap;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 1;
    for (let off=-2; off<=2; off++){
      ctx.beginPath();
      ctx.moveTo(40, staffLineY(trebleCenterY, off));
      ctx.lineTo(cw - 8, staffLineY(trebleCenterY, off));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(40, staffLineY(bassCenterY, off));
      ctx.lineTo(cw - 8, staffLineY(bassCenterY, off));
      ctx.stroke();
    }
    // Left brace connecting them
    ctx.beginPath();
    ctx.moveTo(40, staffLineY(trebleCenterY, 2) - 2);
    ctx.lineTo(40, staffLineY(bassCenterY, -2) + 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();

    // Clef symbols (simplified as text glyphs)
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `${staffLineGap*5.5}px serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('𝄞', 8, trebleCenterY + staffLineGap*0.6);
    ctx.font = `${staffLineGap*4.5}px serif`;
    ctx.fillText('𝄢', 12, bassCenterY - staffLineGap*0.5);

    // Key signature display (small ♯ or ♭ next to clef)
    const ks = keySigAt(now);
    const keySigX0 = 50 + staffLineGap*2;
    ctx.font = `${staffLineGap*2.4}px serif`;
    ks.sharps.forEach((letter,i)=>{
      const y = sharpYForLetter(letter, trebleCenterY, staffLineGap);
      ctx.fillText('♯', keySigX0 + i*staffLineGap*1.2, y);
      const yb = sharpYForLetter(letter, bassCenterY, staffLineGap, true);
      ctx.fillText('♯', keySigX0 + i*staffLineGap*1.2, yb);
    });
    ks.flats.forEach((letter,i)=>{
      const y = flatYForLetter(letter, trebleCenterY, staffLineGap);
      ctx.fillText('♭', keySigX0 + i*staffLineGap*1.2, y);
      const yb = flatYForLetter(letter, bassCenterY, staffLineGap, true);
      ctx.fillText('♭', keySigX0 + i*staffLineGap*1.2, yb);
    });

    // Now draw notes
    // Window: notes whose t is in [now - 0.5, now + NOTATION_WIN]
    // x = mapped from time. Right side (cw) = now + NOTATION_WIN/2 ... actually let's flow right-to-left:
    // notes appear at right edge at t = now + (NOTATION_WIN/2), travel left,
    // hit the playhead (vertical line) at x = leftMargin + staffWidth*0.25, then continue and fade out left.
    const leftMargin = 75 + ks.sharps.length*staffLineGap*1.2 + ks.flats.length*staffLineGap*1.2;
    const rightMargin = 8;
    const playheadX = leftMargin + (cw - leftMargin - rightMargin) * 0.30;

    // Time at right edge:
    const tRight = now + NOTATION_WIN * 0.7;
    const tLeft  = now - NOTATION_WIN * 0.3;
    function tToX(t){
      return leftMargin + (cw - leftMargin - rightMargin) * ((t - tLeft) / (tRight - tLeft));
    }
    // Playhead (vertical glow line)
    ctx.strokeStyle = 'rgba(232, 197, 74, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(playheadX, staffLineY(trebleCenterY, 4));
    ctx.lineTo(playheadX, staffLineY(bassCenterY, -4));
    ctx.stroke();

    // Apply key signature accidentals when displaying notes:
    // A note's "natural accidental" is suppressed if the key signature already covers it.
    function isInKeySignature(midi){
      const acc = letterStep(midi).acc;
      if (!acc) return null; // white key
      const pc = ((midi%12)+12)%12;
      // black-key pitch classes: C# Db, D# Eb, F# Gb, G# Ab, A# Bb
      const PC_TO_LETTER_SHARP = {1:'C',3:'D',6:'F',8:'G',10:'A'};
      const PC_TO_LETTER_FLAT = {1:'D',3:'E',6:'G',8:'A',10:'B'};
      if (ks.sharps.includes(PC_TO_LETTER_SHARP[pc])) return 'sharp_implicit';
      if (ks.flats.includes(PC_TO_LETTER_FLAT[pc])) return 'flat_implicit';
      return null;
    }

    // Iterate visible events
    for (let i=0; i<events.length; i++){
      const e = events[i];
      if (e.t + e.dur < tLeft) continue;
      if (e.t > tRight) break;
      const x = tToX(e.t);
      if (x < leftMargin - 20 || x > cw + 20) continue;
      // Choose staff: pitch >= middle C (60) → treble; else bass
      const useTreble = e.midi >= 60;
      const centerY = useTreble ? trebleCenterY : bassCenterY;
      const centerStep = useTreble ? trebleCenterStep : bassCenterStep;
      const ls = letterStep(e.midi);
      // Each diatonic step = staffLineGap/2 (since 2 steps span a line + space)
      const y = centerY - (ls.step - centerStep) * (staffLineGap / 2);
      // Note head
      const isActive = (e.t <= now && e.t + e.dur > now);
      const distFromPlayhead = Math.abs(x - playheadX);
      const proximity = Math.max(0, 1 - distFromPlayhead/(cw*0.3));
      const alpha = isActive ? 1.0 : Math.max(0.25, proximity * 0.85 + 0.15);
      ctx.fillStyle = isActive
        ? `rgba(232, 197, 74, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      if (isActive){
        ctx.shadowColor = 'rgba(232, 197, 74, 0.8)';
        ctx.shadowBlur = 10;
      }
      // Filled note head (quarter-note style for simplicity; we don't render rhythm exactly)
      ctx.beginPath();
      ctx.ellipse(x, y, noteRadius*1.05, noteRadius*0.78, -0.3, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Accidental: only if the note is a black key AND not covered by the key signature
      if (ls.acc && !isInKeySignature(e.midi)){
        ctx.fillStyle = `rgba(255,255,255,${alpha*0.85})`;
        ctx.font = `${staffLineGap*2.0}px serif`;
        // Decide sharp vs flat based on key signature convention
        const useFlat = ks.flats.length > 0;
        ctx.fillText(useFlat ? '♭' : '♯', x - staffLineGap*1.7, y + staffLineGap*0.3);
      }
      // Ledger lines (when outside staff)
      drawLedgerLines(ctx, x, y, centerY, staffLineGap, noteRadius, alpha);
    }
  }
  function sharpYForLetter(letter, centerY, gap, isBass){
    // Approximate positions of sharps on staff (Western convention order: F, C, G, D, A, E, B)
    const TREBLE_Y = {F: -2, C: 1, G: -1, D: 2, A: 0, E: 3, B: 1};
    const BASS_Y   = {F: -1, C: 2, G: 0, D: 3, A: 1, E: 4, B: 2};
    const map = isBass ? BASS_Y : TREBLE_Y;
    const off = map[letter] || 0;
    return centerY - off * (gap/2);
  }
  function flatYForLetter(letter, centerY, gap, isBass){
    const TREBLE_Y = {B: 0, E: 2, A: 1, D: 3, G: 1, C: 3, F: 2};
    const BASS_Y   = {B: 1, E: 3, A: 2, D: 4, G: 2, C: 4, F: 3};
    const map = isBass ? BASS_Y : TREBLE_Y;
    const off = map[letter] || 0;
    return centerY - off * (gap/2);
  }
  function drawLedgerLines(ctx, x, y, centerY, gap, noteRadius, alpha){
    // Staff lines are at centerY + n*gap for n in [-2..2]
    const topLine = centerY - 2*gap;
    const botLine = centerY + 2*gap;
    if (y < topLine - gap/2){
      // Notes above staff: draw ledger lines from top of staff down to note's position
      let lineY = topLine - gap;
      while (lineY > y - gap/2){
        ctx.strokeStyle = `rgba(255,255,255,${alpha*0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - noteRadius*1.5, lineY);
        ctx.lineTo(x + noteRadius*1.5, lineY);
        ctx.stroke();
        lineY -= gap;
      }
    } else if (y > botLine + gap/2){
      let lineY = botLine + gap;
      while (lineY < y + gap/2){
        ctx.strokeStyle = `rgba(255,255,255,${alpha*0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - noteRadius*1.5, lineY);
        ctx.lineTo(x + noteRadius*1.5, lineY);
        ctx.stroke();
        lineY += gap;
      }
    }
  }

  /* ============ SCROLL/STICKY/AUTOPLAY ============ */
  let started = false;
  let visible = false;
  let userInteracted = false;

  async function startPlayback(){
    if (started) return;
    started = true;
    statusEl.textContent = 'loading sound + score…';
    try {
      await Promise.all([loadSampler(), loadAndBuild()]);
      statusEl.textContent = 'ready · playing';
      startOverlay.classList.add('hidden');
      await play();
    } catch (err){
      console.error(err);
      statusEl.textContent = 'could not load — check liz_donjuan.mid';
      started = false;
    }
  }

  // The start button is the user gesture that unlocks audio.
  startBtn.addEventListener('click', async ()=>{
    userInteracted = true;
    if (Tone.context.state !== 'running') await Tone.context.resume();
    startPlayback();
  });

  // When the sticky module leaves view fully (scrolled past), pause.
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      visible = e.isIntersecting;
      if (!visible && playing) pause();
      else if (visible && started && !playing && userInteracted) play();
    });
  }, { threshold: 0.15 });
  io.observe(sticky);

  // Initial status
  statusEl.textContent = 'scroll into view, then click the title';
})();