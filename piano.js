/* ===================================================================
   PIANO PLAYER — generic, multi-block
   Each block on the page is initialized via initPianoBlock(config).
   Shared singletons: Tone.js sampler chain, MIDI cache.
=================================================================== */
(function(){
  if (typeof Tone === 'undefined') {
    console.error('Tone.js not loaded — piano disabled');
    return;
  }

  /* ======================== SHARED SAMPLER ======================== */
  let sampler = null;
  let masterGain = null;
  let masterReverb = null;
  let masterEq = null;
  let samplerReady = false;
  let samplerLoadPromise = null;
  let globalVolume = 0.65; // 0..1, set by the first volume slider that touches it

  function loadSampler(){
    if (samplerLoadPromise) return samplerLoadPromise;
    samplerLoadPromise = new Promise((resolve, reject)=>{
      const baseUrl = 'samples/piano/';
      masterEq = new Tone.EQ3({ low: 1, mid: -0.5, high: -1, lowFrequency: 250, highFrequency: 2500 });
      masterReverb = new Tone.Reverb({ decay: 2.2, preDelay: 0.02, wet: 0.14 });
      masterGain = new Tone.Gain(globalVolume * 0.85);
      masterReverb.generate();
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
        release: 2.8,
        attack: 0.003,
        baseUrl,
        onload: ()=>{ samplerReady = true; resolve(); },
        onerror: (e)=>{ reject(e); },
      });
      sampler.chain(masterEq, masterReverb, masterGain, Tone.Destination);
    });
    return samplerLoadPromise;
  }
  function setGlobalVolume(v){
    globalVolume = v;
    if (masterGain) masterGain.gain.value = v * 0.85;
  }

  /* ======================== SHARED MIDI CACHE ======================== */
  const midiCache = {};
  async function loadMidi(url){
    if (midiCache[url]) return midiCache[url];
    const MidiCtor = (typeof Midi !== 'undefined') ? Midi : (window['@tonejs/midi'] && window['@tonejs/midi'].Midi);
    if (!MidiCtor) throw new Error('@tonejs/midi not loaded');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch '+url+': '+res.status);
    const buf = await res.arrayBuffer();
    const m = new MidiCtor(buf);
    midiCache[url] = m;
    return m;
  }

  /* ======================== NOTE HELPERS ======================== */
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function midiToName(midi){
    const pc = ((midi%12)+12)%12; const oct = Math.floor(midi/12)-1;
    return NOTE_NAMES[pc]+oct;
  }
  function isBlackKey(midi){return [1,3,6,8,10].includes(((midi%12)+12)%12)}

  /* ======================== MIDI → EVENTS ========================
     mode='robot':  flat velocity, quantized to 32nd grid, no pedal, clipped duration
     mode='rubato': honors source timing/velocity/pedal with shaping per section
  */
  function midiToEvents(midi, mode, sectionId, tOffset, shape){
    // ---- Pedal intervals (gap-merged for rubato) ----
    let pedalIntervals = [];
    midi.tracks.forEach(track=>{
      const cc = (track.controlChanges && track.controlChanges[64]) || [];
      let down = false, start = 0;
      cc.forEach(c=>{
        const isDown = c.value >= 0.5;
        if (isDown && !down){ down = true; start = c.time; }
        else if (!isDown && down){ down = false; pedalIntervals.push({start, end: c.time}); }
      });
      if (down) pedalIntervals.push({start, end: midi.duration});
    });
    pedalIntervals.sort((a,b)=>a.start - b.start);
    if (mode === 'rubato' && pedalIntervals.length > 1 && shape.pedalFill > 0){
      const merged = [pedalIntervals[0]];
      for (let i=1;i<pedalIntervals.length;i++){
        const last = merged[merged.length-1];
        const cur = pedalIntervals[i];
        if (cur.start - last.end < shape.pedalFill){
          last.end = Math.max(last.end, cur.end);
        } else {
          merged.push(cur);
        }
      }
      pedalIntervals = merged;
    }
    function isPedaledAt(t){
      for (let i=0;i<pedalIntervals.length;i++){
        const p = pedalIntervals[i];
        if (t >= p.start && t <= p.end) return true;
        if (p.start > t) break;
      }
      return false;
    }
    function pedalReleaseAfter(t){
      for (let i=0;i<pedalIntervals.length;i++){
        const p = pedalIntervals[i];
        if (t >= p.start && t <= p.end) return p.end;
        if (p.start > t) break;
      }
      return t;
    }

    // ---- Collect notes ----
    const allNotes = [];
    midi.tracks.forEach(track=>{
      track.notes.forEach(n=>{
        allNotes.push({ time: n.time, midi: n.midi, dur: n.duration, vel: n.velocity });
      });
    });
    allNotes.sort((a,b)=> a.time - b.time);

    function isMelodyAt(idx){
      const n = allNotes[idx];
      let top = n.midi;
      for (let j=idx-1; j>=0; j--){
        if (allNotes[j].time < n.time - 0.06) break;
        if (allNotes[j].midi > top) top = allNotes[j].midi;
      }
      for (let j=idx+1; j<allNotes.length; j++){
        if (allNotes[j].time > n.time + 0.06) break;
        if (allNotes[j].midi > top) top = allNotes[j].midi;
      }
      return n.midi === top;
    }

    const events = [];
    const speed = (mode === 'rubato') ? shape.speed : 1.0;

    allNotes.forEach((n, idx)=>{
      let t = n.time, dur = n.dur, vel = n.vel, pedal = false;

      if (mode === 'robot'){
        t = Math.round(t / 0.0625) * 0.0625;
        vel = 0.55;
        pedal = false;
        dur = Math.min(dur, 0.5);
      } else {
        t = t / speed;
        dur = dur / speed;
        pedal = isPedaledAt(n.time);
        let targetDur = dur * shape.sustainMult;
        if (pedal){
          const pedalEnd = pedalReleaseAfter(n.time) / speed;
          const pedalTarget = pedalEnd - (n.time / speed);
          targetDur = Math.min(6.0, Math.max(targetDur, pedalTarget));
        }
        dur = targetDur;
        // Velocity compression
        vel = 0.32 + 0.55 * Math.pow(vel, 0.8);
        // Melody/harmony contrast
        if (isMelodyAt(idx)){
          vel = Math.min(1.0, vel * 1.30);
        } else {
          vel = vel * 0.55;
        }
      }

      events.push({
        t: t + tOffset,
        midi: n.midi,
        dur: Math.max(0.05, dur),
        vel: Math.max(0.05, Math.min(1.0, vel)),
        pedal,
        sectionId,
      });
    });

    let secDur = 0;
    events.forEach(e=>{ const end = e.t - tOffset + e.dur; if (end > secDur) secDur = end; });
    return { events, duration: secDur };
  }

  /* ======================== BLOCK INITIALIZER ========================
     config: {
       root: HTMLElement (the .piano-block element),
       sections: [{ id, name, short, url, shape }],
       showRobotToggle: bool,
       defaultMode: 'rubato' (always for now),
       errorMsg: string for the "could not load" message,
     }
  */
  function initBlock(config){
    const root = config.root;
    function $(suffix){ return root.querySelector('[data-el="'+suffix+'"]'); }
    function $$(suffix){ return root.querySelectorAll('[data-el="'+suffix+'"]'); }

    const kb       = $('kb');
    if (!kb) return;
    const btnRobot = $('modeRobot');
    const btnRubato= $('modeRubato');
    const secBtns  = $$('secBtn');
    const playBtn  = $('play');
    const playIcon = $('playIcon');
    const curTimeEl= $('curTime');
    const totTimeEl= $('totalTime');
    const scrub    = $('scrub');
    const scrubPlayed = $('scrubPlayed');
    const scrubHover  = $('scrubHover');
    const scrubHandle = $('scrubHandle');
    const scrubTip    = $('scrubTip');
    const volEl    = $('vol');
    const npEl     = $('nowPlaying');
    const dynEl    = $('dyn');
    const dynMark  = $('dynMark');
    const dynFill  = $('dynFill');
    const dynLabel = $('dynLabel');

    /* -------- Keyboard build -------- */
    const MIN_MIDI = 21, MAX_MIDI = 108;
    const keyMap = {};
    const whiteMidis = [];
    for (let m=MIN_MIDI; m<=MAX_MIDI; m++) if (!isBlackKey(m)) whiteMidis.push(m);
    const whiteCount = whiteMidis.length;
    kb.style.gridTemplateColumns = 'repeat('+whiteCount+', 1fr)';
    whiteMidis.forEach((m)=>{
      const k = document.createElement('div');
      k.className = 'piano-key';
      const name = midiToName(m);
      if (name.startsWith('C')) k.classList.add('c-marker');
      k.dataset.midi = m;
      if (name.startsWith('C') || m === MIN_MIDI){
        k.innerHTML = '<span class="label">'+name+'</span>';
      }
      kb.appendChild(k);
      keyMap[m] = k;
    });
    const whiteUnit = 100/whiteCount;
    const blackWidthPct = whiteUnit * 0.62;
    whiteMidis.forEach((wm, i)=>{
      const nextWhite = whiteMidis[i+1];
      if (!nextWhite || nextWhite - wm !== 2) return;
      const blackMidi = wm + 1;
      const k = document.createElement('div');
      k.className = 'piano-key black';
      k.dataset.midi = blackMidi;
      k.style.left = ((i+1)*whiteUnit - blackWidthPct/2) + '%';
      k.style.width = blackWidthPct + '%';
      kb.appendChild(k);
      keyMap[blackMidi] = k;
    });

    function attachKeyHandler(el){
      const m = parseInt(el.dataset.midi,10);
      const fire = async e=>{
        e.preventDefault();
        try {
          if (!samplerReady) await loadSampler();
          if (Tone.context.state !== 'running') await Tone.context.resume();
          sampler.triggerAttackRelease(midiToName(m), 0.8, undefined, 0.75);
        } catch(err){ return; }
        el.classList.add('active');
        setTimeout(()=>el.classList.remove('active'), 280);
      };
      el.addEventListener('mousedown', fire);
      el.addEventListener('touchstart', fire, {passive:false});
    }
    kb.querySelectorAll('.piano-key').forEach(attachKeyHandler);

    /* -------- UI helpers -------- */
    function setPlayBtnState(state){
      if (state === 'loading'){
        playIcon.innerHTML = '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="6 4"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></circle>';
        playBtn.disabled = true;
      } else if (state === 'playing'){
        playIcon.innerHTML = '<path d="M3 2 L6 2 L6 14 L3 14 Z M10 2 L13 2 L13 14 L10 14 Z"/>';
        playBtn.disabled = false;
      } else {
        playIcon.innerHTML = '<path d="M3 2 L13 8 L3 14 Z"/>';
        playBtn.disabled = false;
      }
    }
    function setStatus(text, isError){
      if (!npEl) return;
      npEl.textContent = text;
      npEl.style.color = isError ? '#c87a7a' : '';
    }
    if (volEl){
      volEl.value = Math.round(globalVolume*100);
      volEl.addEventListener('input', ()=> setGlobalVolume(parseFloat(volEl.value)/100));
    }

    /* -------- Build timeline -------- */
    const TIMELINES = { robot: null, rubato: null };
    let allLoaded = false;

    function buildTimeline(mode){
      const out = { events: [], boundaries: [], duration: 0 };
      let tOffset = 0;
      config.sections.forEach(sec=>{
        const midi = midiCache[sec.url];
        if (!midi) return;
        out.boundaries.push({ t: tOffset, sectionId: sec.id, name: sec.name, short: sec.short });
        const r = midiToEvents(midi, mode, sec.id, tOffset, sec.shape);
        out.events.push.apply(out.events, r.events);
        tOffset += r.duration + 2.0;
      });
      out.duration = Math.max(0, tOffset - 2.0);
      out.events.sort((a,b)=> a.t === b.t ? a.midi - b.midi : a.t - b.t);
      return out;
    }

    async function ensureAllLoaded(){
      if (allLoaded) return;
      setStatus('loading sound + score…');
      setPlayBtnState('loading');
      try {
        const samplerP = loadSampler();
        const midiP = Promise.all(config.sections.map(s=>loadMidi(s.url)));
        await Promise.all([samplerP, midiP]);
        TIMELINES.rubato = buildTimeline('rubato');
        if (config.showRobotToggle) TIMELINES.robot = buildTimeline('robot');
        allLoaded = true;
        setPlayBtnState('idle');
        drawScrubMarkers();
        updateTimeUI();
        const tl = currentTimeline();
        if (tl && tl.boundaries[0]) setStatus(tl.boundaries[0].name);
      } catch (err){
        console.error(err);
        setStatus(config.errorMsg || 'could not load score', true);
        setPlayBtnState('idle');
        throw err;
      }
    }

    /* -------- Playback engine -------- */
    let mode = config.defaultMode || 'rubato';
    let playing = false;
    let curTimeSec = 0;
    let playStartedAt = 0;
    let playStartedFrom = 0;
    let scheduledTimers = [];
    let scheduledIdx = 0;
    let activeFlashes = new Set();
    let rafId = null;
    const SCHEDULE_AHEAD_SEC = 0.30;
    const SCHEDULE_TICK_MS = 80;

    if (btnRobot && btnRubato){
      btnRobot.classList.toggle('active', mode==='robot');
      btnRubato.classList.toggle('active', mode==='rubato');
    }
    if (dynEl) dynEl.classList.toggle('shown', mode==='rubato');

    function currentTimeline(){ return TIMELINES[mode]; }
    function totalDuration(){ const tl = currentTimeline(); return tl ? tl.duration : 0; }
    function fmtTime(s){
      s = Math.max(0, Math.floor(s));
      return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
    }
    function updateTimeUI(){
      curTimeEl.textContent = fmtTime(curTimeSec);
      totTimeEl.textContent = fmtTime(totalDuration());
      const p = totalDuration() ? curTimeSec/totalDuration() : 0;
      scrubPlayed.style.width = (p*100)+'%';
      scrubHandle.style.left = (p*100)+'%';
      const tl = currentTimeline();
      if (!tl) return;
      let inSec = tl.boundaries[0];
      for (let i=0;i<tl.boundaries.length;i++){
        if (curTimeSec >= tl.boundaries[i].t) inSec = tl.boundaries[i];
      }
      if (inSec){
        setStatus(inSec.name);
        secBtns.forEach(b=>b.classList.toggle('active', b.dataset.section===inSec.sectionId));
      }
    }
    function drawScrubMarkers(){
      scrub.querySelectorAll('.mvt-marker, .mvt-label').forEach(n=>n.remove());
      const tl = currentTimeline(); if (!tl) return;
      const dur = totalDuration(); if (!dur) return;
      tl.boundaries.forEach((b, idx)=>{
        if (idx > 0){
          const m = document.createElement('div');
          m.className = 'mvt-marker';
          m.style.left = (b.t/dur*100)+'%';
          scrub.appendChild(m);
        }
        const lbl = document.createElement('div');
        lbl.className = 'mvt-label';
        lbl.style.left = (b.t/dur*100)+'%';
        lbl.textContent = b.short;
        scrub.appendChild(lbl);
      });
    }
    function updateScrubMarkerStates(){
      const tl = currentTimeline(); if (!tl) return;
      const markers = scrub.querySelectorAll('.mvt-marker');
      const labels  = scrub.querySelectorAll('.mvt-label');
      tl.boundaries.forEach((b, idx)=>{
        const passed = curTimeSec >= b.t;
        if (idx > 0 && markers[idx-1]) markers[idx-1].classList.toggle('passed', passed);
        if (labels[idx]) labels[idx].classList.toggle('passed', passed);
      });
    }
    function clearScheduled(){
      scheduledTimers.forEach(id=>clearTimeout(id));
      scheduledTimers = [];
    }
    function stopAllFlashes(){
      activeFlashes.forEach(m=>{ const el = keyMap[m]; if (el) el.classList.remove('active'); });
      activeFlashes.clear();
    }
    function pause(){
      if (!playing) return;
      const now = performance.now()/1000;
      curTimeSec = playStartedFrom + (now - playStartedAt);
      playing = false;
      clearScheduled();
      if (sampler) sampler.releaseAll();
      stopAllFlashes();
      cancelAnimationFrame(rafId);
      setPlayBtnState('idle');
      updateTimeUI();
    }
    async function play(){
      if (playing) return;
      if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
      if (Tone.context.state !== 'running') await Tone.context.resume();
      if (curTimeSec >= totalDuration()) curTimeSec = 0;
      playing = true;
      playStartedAt = performance.now()/1000;
      playStartedFrom = curTimeSec;
      const tl = currentTimeline();
      scheduledIdx = 0;
      while (scheduledIdx < tl.events.length && tl.events[scheduledIdx].t < curTimeSec) scheduledIdx++;
      setPlayBtnState('playing');
      tickScheduler();
      rafLoop();
    }
    function tickScheduler(){
      if (!playing) return;
      const tl = currentTimeline();
      const now = performance.now()/1000;
      const elapsed = now - playStartedAt;
      const playheadT = curTimeSec + elapsed;
      const horizon = playheadT + SCHEDULE_AHEAD_SEC;
      while (scheduledIdx < tl.events.length){
        const ev = tl.events[scheduledIdx];
        if (ev.t > horizon) break;
        const delaySec = Math.max(0, ev.t - playheadT);
        const ev2 = ev;
        const id = setTimeout(()=>{
          if (!playing) return;
          try {
            sampler.triggerAttackRelease(midiToName(ev2.midi), ev2.dur, undefined, ev2.vel);
          } catch(e){}
          const el = keyMap[ev2.midi];
          if (el){
            el.classList.add('active');
            activeFlashes.add(ev2.midi);
            setTimeout(()=>{
              el.classList.remove('active');
              activeFlashes.delete(ev2.midi);
            }, Math.max(120, Math.min(420, ev2.dur*1000*0.9)));
          }
          if (mode === 'rubato') updateDynIndicator(ev2.vel);
        }, delaySec*1000);
        scheduledTimers.push(id);
        scheduledIdx++;
      }
      if (playing) setTimeout(tickScheduler, SCHEDULE_TICK_MS);
      if (playheadT >= totalDuration()){
        setTimeout(()=>{
          if (playing){
            pause();
            curTimeSec = 0;
            updateTimeUI();
            updateScrubMarkerStates();
          }
        }, 500);
      }
    }
    function rafLoop(){
      if (!playing) return;
      const now = performance.now()/1000;
      const elapsed = now - playStartedAt;
      const t = Math.min(playStartedFrom + elapsed, totalDuration());
      curTimeEl.textContent = fmtTime(t);
      const p = totalDuration() ? t/totalDuration() : 0;
      scrubPlayed.style.width = (p*100)+'%';
      scrubHandle.style.left = (p*100)+'%';
      const tl = currentTimeline();
      if (tl){
        let inSec = tl.boundaries[0];
        for (let i=0;i<tl.boundaries.length;i++){ if (t >= tl.boundaries[i].t) inSec = tl.boundaries[i]; }
        if (inSec){
          setStatus(inSec.name);
          secBtns.forEach(b=>b.classList.toggle('active', b.dataset.section===inSec.sectionId));
        }
      }
      updateScrubMarkerStates();
      rafId = requestAnimationFrame(rafLoop);
    }
    async function seek(toSec){
      if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
      const dur = totalDuration();
      toSec = Math.max(0, Math.min(dur, toSec));
      const wasPlaying = playing;
      if (playing) pause();
      curTimeSec = toSec;
      updateTimeUI();
      updateScrubMarkerStates();
      if (wasPlaying) play();
    }
    async function setMode(newMode){
      if (newMode === mode) return;
      if (!TIMELINES[newMode]){
        if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
        if (!TIMELINES[newMode]) TIMELINES[newMode] = buildTimeline(newMode);
      }
      const wasPlaying = playing;
      if (playing) pause();
      const oldTl = currentTimeline();
      let secIdx = 0;
      for (let i=0;i<oldTl.boundaries.length;i++){
        if (curTimeSec >= oldTl.boundaries[i].t) secIdx = i;
      }
      const oldB = oldTl.boundaries[secIdx];
      const oldNext = oldTl.boundaries[secIdx+1] ? oldTl.boundaries[secIdx+1].t : oldTl.duration;
      const localP = (curTimeSec - oldB.t) / Math.max(0.001, oldNext - oldB.t);
      mode = newMode;
      if (btnRobot && btnRubato){
        btnRobot.classList.toggle('active', mode==='robot');
        btnRubato.classList.toggle('active', mode==='rubato');
      }
      const newTl = currentTimeline();
      const newB = newTl.boundaries[secIdx];
      const newNext = newTl.boundaries[secIdx+1] ? newTl.boundaries[secIdx+1].t : newTl.duration;
      curTimeSec = newB.t + localP*(newNext - newB.t);
      if (dynEl) dynEl.classList.toggle('shown', mode==='rubato');
      drawScrubMarkers();
      updateTimeUI();
      updateScrubMarkerStates();
      if (wasPlaying) play();
    }
    async function jumpToSection(sectionId){
      if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
      const tl = currentTimeline();
      const b = tl.boundaries.find(x=>x.sectionId===sectionId);
      if (b) seek(b.t);
    }
    function updateDynIndicator(vel){
      if (!dynFill) return;
      dynFill.style.width = Math.round(vel*100)+'%';
      let mark = 'p', lbl = 'soft';
      if (vel < 0.3){ mark='pp'; lbl='very soft' }
      else if (vel < 0.42){ mark='p'; lbl='soft' }
      else if (vel < 0.55){ mark='mp'; lbl='mezzo piano' }
      else if (vel < 0.68){ mark='mf'; lbl='mezzo forte' }
      else if (vel < 0.85){ mark='f'; lbl='forte' }
      else { mark='ff'; lbl='fortissimo' }
      dynMark.textContent = mark;
      dynLabel.textContent = lbl;
    }

    /* -------- Wire controls -------- */
    if (btnRobot) btnRobot.addEventListener('click', ()=>setMode('robot'));
    if (btnRubato) btnRubato.addEventListener('click', ()=>setMode('rubato'));
    secBtns.forEach(b=>b.addEventListener('click', ()=>jumpToSection(b.dataset.section)));
    playBtn.addEventListener('click', async ()=>{
      if (playing) pause(); else await play();
    });

    /* -------- Scrubber -------- */
    function scrubPosFromEvent(e){
      const rect = scrub.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      return Math.max(0, Math.min(1, x/rect.width));
    }
    let dragging = false;
    function onScrubMove(e){
      const p = scrubPosFromEvent(e);
      const t = p * totalDuration();
      scrubHover.style.width = (p*100)+'%';
      scrubTip.style.left = (p*100)+'%';
      scrubTip.textContent = fmtTime(t);
      if (dragging){
        curTimeSec = t;
        scrubPlayed.style.width = (p*100)+'%';
        scrubHandle.style.left = (p*100)+'%';
        curTimeEl.textContent = fmtTime(t);
        updateScrubMarkerStates();
      }
    }
    function onScrubDown(e){
      e.preventDefault();
      dragging = true;
      scrub.classList.add('dragging');
      onScrubMove(e);
      document.addEventListener('mousemove', onScrubMove);
      document.addEventListener('touchmove', onScrubMove, {passive:false});
      document.addEventListener('mouseup', onScrubUp);
      document.addEventListener('touchend', onScrubUp);
    }
    function onScrubUp(){
      if (!dragging) return;
      dragging = false;
      scrub.classList.remove('dragging');
      document.removeEventListener('mousemove', onScrubMove);
      document.removeEventListener('touchmove', onScrubMove);
      document.removeEventListener('mouseup', onScrubUp);
      document.removeEventListener('touchend', onScrubUp);
      seek(curTimeSec);
    }
    scrub.addEventListener('mousedown', onScrubDown);
    scrub.addEventListener('touchstart', onScrubDown, {passive:false});
    scrub.addEventListener('mousemove', onScrubMove);

    /* -------- Init -------- */
    setStatus('click play to load · ' + (config.sections[0] ? config.sections[0].name : ''));
    updateTimeUI();
  }

  /* ======================== PAGE CONFIGURATION ======================== */
  // Pathétique block
  const pathetiqueRoot = document.querySelector('[data-piano-block="pathetique"]');
  if (pathetiqueRoot){
    initBlock({
      root: pathetiqueRoot,
      showRobotToggle: true,
      defaultMode: 'rubato',
      errorMsg: 'could not load — check path1/2/3.mid',
      sections: [
        { id:'1', short:'I',   name:'I. Grave — Allegro di molto e con brio', url:'path1.mid',
          shape:{ speed:1.08, sustainMult:1.4, pedalFill:0.3 } },
        { id:'2', short:'II',  name:'II. Adagio cantabile',                   url:'path2.mid',
          shape:{ speed:1.10, sustainMult:2.4, pedalFill:1.8 } },
        { id:'3', short:'III', name:'III. Rondo: Allegro',                     url:'path3.mid',
          shape:{ speed:1.00, sustainMult:1.0, pedalFill:0.0 } },
      ],
    });
  }

  // Liszt-Paganini etudes block — rubato only, less pedal across the board
  const lisztRoot = document.querySelector('[data-piano-block="liszt"]');
  if (lisztRoot){
    initBlock({
      root: lisztRoot,
      showRobotToggle: false,
      defaultMode: 'rubato',
      errorMsg: 'could not load — check liszt1.mid through liszt6.mid',
      sections: [
        // User-requested per-etude speedups; less pedal across the board (showpieces, not lyrical)
        { id:'1', short:'I',   name:'I. Tremolo (G minor)',          url:'liszt1.mid',
          shape:{ speed:1.25, sustainMult:1.1, pedalFill:0.15 } },
        { id:'2', short:'II',  name:'II. Octaves (E♭ major)',         url:'liszt2.mid',
          shape:{ speed:1.25, sustainMult:1.1, pedalFill:0.15 } },
        { id:'3', short:'III', name:'III. La Campanella (G♯ minor)',  url:'liszt3.mid',
          shape:{ speed:1.05, sustainMult:1.2, pedalFill:0.2  } },
        { id:'4', short:'IV',  name:'IV. Arpeggio (E major)',         url:'liszt4.mid',
          shape:{ speed:1.25, sustainMult:1.1, pedalFill:0.15 } },
        { id:'5', short:'V',   name:'V. La Chasse (E major)',         url:'liszt5.mid',
          shape:{ speed:1.20, sustainMult:1.1, pedalFill:0.15 } },
        { id:'6', short:'VI',  name:'VI. Theme & Variations (A minor)', url:'liszt6.mid',
          shape:{ speed:1.15, sustainMult:1.2, pedalFill:0.2  } },
      ],
    });
  }
})();