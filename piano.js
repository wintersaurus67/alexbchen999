/* ===================================================================
     PIANO — full Pathétique sonata, robot vs rubato, scrubber, 88 keys
     Powered by Tone.js Sampler (Salamander Grand) + 3 MIDI files
  =================================================================== */
  (function(){
    const kb       = document.getElementById('pianoKb');
    if (!kb) return;
    const btnRobot = document.getElementById('pianoModeRobot');
    const btnRubato= document.getElementById('pianoModeRubato');
    const mvtBtns  = document.querySelectorAll('.piano-mvts button');
    const playBtn  = document.getElementById('pianoPlay');
    const playIcon = document.getElementById('pianoPlayIcon');
    const curTimeEl= document.getElementById('pianoCurTime');
    const totTimeEl= document.getElementById('pianoTotalTime');
    const scrub    = document.getElementById('pianoScrub');
    const scrubPlayed = document.getElementById('pianoScrubPlayed');
    const scrubHover  = document.getElementById('pianoScrubHover');
    const scrubHandle = document.getElementById('pianoScrubHandle');
    const scrubTip    = document.getElementById('pianoScrubTip');
    const volEl    = document.getElementById('pianoVol');
    const npEl     = document.getElementById('pianoNowPlaying');
    const dynEl    = document.getElementById('pianoDyn');
    const dynMark  = document.getElementById('pianoDynMark');
    const dynFill  = document.getElementById('pianoDynFill');
    const dynLabel = document.getElementById('pianoDynLabel');

    /* ----- Config: MIDI file URLs (relative to beyond.html) ----- */
    const MIDI_URLS = {
      1: 'path1.mid',
      2: 'path2.mid',
      3: 'path3.mid',
    };
    const MVT_NAMES = {
      1: 'I. Grave — Allegro di molto e con brio',
      2: 'II. Adagio cantabile',
      3: 'III. Rondo: Allegro',
    };

    /* ----- Keyboard build (unchanged) ----- */
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function midiToName(midi){
      const pc = ((midi%12)+12)%12; const oct = Math.floor(midi/12)-1;
      return NOTE_NAMES[pc]+oct;
    }
    function isBlackKey(midi){return [1,3,6,8,10].includes(((midi%12)+12)%12)}

    const MIN_MIDI = 21, MAX_MIDI = 108;
    const keyMap = {};
    const whiteMidis = [];
    for (let m=MIN_MIDI; m<=MAX_MIDI; m++) if (!isBlackKey(m)) whiteMidis.push(m);
    const whiteCount = whiteMidis.length;
    kb.style.gridTemplateColumns = `repeat(${whiteCount}, 1fr)`;
    whiteMidis.forEach((m)=>{
      const k = document.createElement('div');
      k.className = 'piano-key';
      const name = midiToName(m);
      if (name.startsWith('C')) k.classList.add('c-marker');
      k.dataset.midi = m;
      if (name.startsWith('C') || m === MIN_MIDI){
        k.innerHTML = `<span class="label">${name}</span>`;
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

    /* ----- Loading UI helpers ----- */
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
      npEl.textContent = text;
      npEl.style.color = isError ? '#c87a7a' : '';
    }

    /* ----- Tone.js sampler ----- */
    let sampler = null;
    let samplerReady = false;
    let samplerLoadPromise = null;

    function volumeToDb(v){
      if (v <= 0.001) return -60;
      return 20 * Math.log10(v);
    }
    function loadSampler(){
      if (samplerLoadPromise) return samplerLoadPromise;
      if (typeof Tone === 'undefined'){
        return Promise.reject(new Error('Tone.js not loaded'));
      }
      samplerLoadPromise = new Promise((resolve, reject)=>{
        const baseUrl = 'https://nbrosowsky.github.io/tonejs-instruments/samples/piano/';
        sampler = new Tone.Sampler({
          urls: {
            'A0':'A0.mp3','C1':'C1.mp3','D#1':'Ds1.mp3','F#1':'Fs1.mp3',
            'A1':'A1.mp3','C2':'C2.mp3','D#2':'Ds2.mp3','F#2':'Fs2.mp3',
            'A2':'A2.mp3','C3':'C3.mp3','D#3':'Ds3.mp3','F#3':'Fs3.mp3',
            'A3':'A3.mp3','C4':'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3',
            'A4':'A4.mp3','C5':'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3',
            'A5':'A5.mp3','C6':'C6.mp3','D#6':'Ds6.mp3','F#6':'Fs6.mp3',
            'A6':'A6.mp3','C7':'C7.mp3','D#7':'Ds7.mp3','F#7':'Fs7.mp3',
            'A7':'A7.mp3','C8':'C8.mp3',
          },
          release: 1.2,
          baseUrl,
          onload: ()=>{ samplerReady = true; resolve(); },
          onerror: (e)=>{ reject(e); }
        }).toDestination();
        sampler.volume.value = volumeToDb(parseFloat(volEl.value)/100);
      });
      return samplerLoadPromise;
    }
    volEl.addEventListener('input', ()=>{
      if (sampler) sampler.volume.value = volumeToDb(parseFloat(volEl.value)/100);
    });

    /* ----- MIDI loading ----- */
    const midiCache = {};
    async function loadMidi(mvtId){
      if (midiCache[mvtId]) return midiCache[mvtId];
      const MidiCtor = (typeof Midi !== 'undefined') ? Midi : (window['@tonejs/midi'] && window['@tonejs/midi'].Midi);
      if (!MidiCtor) throw new Error('@tonejs/midi not loaded');
      const url = MIDI_URLS[mvtId];
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const buf = await res.arrayBuffer();
      const midi = new MidiCtor(buf);
      midiCache[mvtId] = midi;
      return midi;
    }

    /* ----- Convert MIDI to event list -----
       robot:  flatten velocity to 0.55, quantize start time to 32nd grid,
               no pedal, clip durations to written length
       rubato: original timing/velocity from MIDI (these are real performance MIDIs,
               so the human timing is already there), CC64 sustain honored,
               melody emphasis (+12% velocity on top-voice notes)
    */
    function midiToEvents(midi, mode, mvtId, tOffset){
      // Pedal intervals
      const pedalIntervals = [];
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
      function isPedaledAt(t){
        for (let i=0;i<pedalIntervals.length;i++){
          const p = pedalIntervals[i];
          if (t >= p.start && t <= p.end) return true;
        }
        return false;
      }

      const allNotes = [];
      midi.tracks.forEach(track=>{
        track.notes.forEach(n=>{
          allNotes.push({ time: n.time, midi: n.midi, dur: n.duration, vel: n.velocity });
        });
      });
      allNotes.sort((a,b)=> a.time - b.time);

      // Melody emphasis: is this note the highest pitch within ±50ms?
      function isMelodyAt(idx){
        const n = allNotes[idx];
        let top = n.midi;
        for (let j=idx-1; j>=0; j--){
          if (allNotes[j].time < n.time - 0.05) break;
          if (allNotes[j].midi > top) top = allNotes[j].midi;
        }
        for (let j=idx+1; j<allNotes.length; j++){
          if (allNotes[j].time > n.time + 0.05) break;
          if (allNotes[j].midi > top) top = allNotes[j].midi;
        }
        return n.midi === top;
      }

      const events = [];
      allNotes.forEach((n, idx)=>{
        let t = n.time, dur = n.dur, vel = n.vel, pedal = false;

        if (mode === 'robot'){
          // Aggressive quantize: snap to 32nd-note at 120 BPM = 0.0625s
          t = Math.round(t / 0.0625) * 0.0625;
          vel = 0.55;        // FLAT
          pedal = false;     // NO PEDAL
          dur = Math.min(dur, 0.5);  // Cut durations — kills natural sustain feel
        } else {
          // Rubato: trust the source MIDI's human timing
          if (isMelodyAt(idx)) vel = Math.min(1.0, vel * 1.12);
          pedal = isPedaledAt(n.time);
        }

        events.push({
          t: t + tOffset,
          midi: n.midi,
          dur: Math.max(0.05, dur),
          vel: Math.max(0.05, Math.min(1.0, vel)),
          pedal,
          mvtId,
        });
      });

      let mvtDur = 0;
      events.forEach(e=>{ const end = e.t - tOffset + e.dur; if (end > mvtDur) mvtDur = end; });
      return { events, duration: mvtDur };
    }

    /* ----- Build complete timeline (all 3 movements) ----- */
    function buildTimeline(mode){
      const out = { events: [], boundaries: [], duration: 0 };
      let tOffset = 0;
      for (const mvtId of [1,2,3]){
        const midi = midiCache[mvtId];
        if (!midi) continue;
        out.boundaries.push({ t: tOffset, mvtId, name: MVT_NAMES[mvtId], short: 'Mvt ' + ['I','II','III'][mvtId-1] });
        const r = midiToEvents(midi, mode, mvtId, tOffset);
        out.events.push(...r.events);
        tOffset += r.duration + 2.5; // 2.5s pause between movements
      }
      out.duration = Math.max(0, tOffset - 2.5);
      out.events.sort((a,b)=> a.t === b.t ? a.midi - b.midi : a.t - b.t);
      return out;
    }

    const TIMELINES = { robot: null, rubato: null };
    let allLoaded = false;
    async function ensureAllLoaded(){
      if (allLoaded) return;
      setStatus('loading sound + score…');
      setPlayBtnState('loading');
      try {
        await Promise.all([
          loadSampler(),
          Promise.all([1,2,3].map(loadMidi)),
        ]);
        TIMELINES.robot  = buildTimeline('robot');
        TIMELINES.rubato = buildTimeline('rubato');
        allLoaded = true;
        setPlayBtnState('idle');
        drawScrubMarkers();
        updateTimeUI();
        const tl = currentTimeline();
        if (tl && tl.boundaries[0]) setStatus(tl.boundaries[0].name);
      } catch (err){
        console.error(err);
        setStatus('could not load — check path1/2/3.mid', true);
        setPlayBtnState('idle');
        throw err;
      }
    }

    /* ----- Click any key ----- */
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

    /* ----- Playback engine ----- */
    let mode = 'rubato';  // default to the good version
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

    // Set initial mode UI
    btnRobot.classList.toggle('active', mode==='robot');
    btnRubato.classList.toggle('active', mode==='rubato');
    dynEl.classList.toggle('shown', mode==='rubato');

    function currentTimeline(){ return TIMELINES[mode]; }
    function totalDuration(){ const tl = currentTimeline(); return tl ? tl.duration : 0; }
    function fmtTime(s){
      s = Math.max(0, Math.floor(s));
      return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    }
    function updateTimeUI(){
      curTimeEl.textContent = fmtTime(curTimeSec);
      totTimeEl.textContent = fmtTime(totalDuration());
      const p = totalDuration() ? curTimeSec/totalDuration() : 0;
      scrubPlayed.style.width = (p*100)+'%';
      scrubHandle.style.left = (p*100)+'%';
      const tl = currentTimeline();
      if (!tl) return;
      let inMvt = tl.boundaries[0];
      for (let i=0;i<tl.boundaries.length;i++){
        if (curTimeSec >= tl.boundaries[i].t) inMvt = tl.boundaries[i];
      }
      if (inMvt){
        npEl.textContent = inMvt.name;
        mvtBtns.forEach(b=>b.classList.toggle('active', parseInt(b.dataset.mvt,10)===inMvt.mvtId));
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
        lbl.textContent = ['I','II','III'][idx];
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
      if (!allLoaded){
        try { await ensureAllLoaded(); } catch(e){ return; }
      }
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
            const noteDur = ev2.pedal ? Math.min(5.0, ev2.dur * 1.5) : ev2.dur;
            sampler.triggerAttackRelease(midiToName(ev2.midi), noteDur, undefined, ev2.vel);
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
        let inMvt = tl.boundaries[0];
        for (let i=0;i<tl.boundaries.length;i++){ if (t >= tl.boundaries[i].t) inMvt = tl.boundaries[i]; }
        if (inMvt){
          npEl.textContent = inMvt.name;
          mvtBtns.forEach(b=>b.classList.toggle('active', parseInt(b.dataset.mvt,10)===inMvt.mvtId));
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
      if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
      const wasPlaying = playing;
      if (playing) pause();
      const oldTl = currentTimeline();
      let mvtIdx = 0;
      for (let i=0;i<oldTl.boundaries.length;i++){
        if (curTimeSec >= oldTl.boundaries[i].t) mvtIdx = i;
      }
      const oldB = oldTl.boundaries[mvtIdx];
      const oldNext = oldTl.boundaries[mvtIdx+1] ? oldTl.boundaries[mvtIdx+1].t : oldTl.duration;
      const localP = (curTimeSec - oldB.t) / Math.max(0.001, oldNext - oldB.t);
      mode = newMode;
      btnRobot.classList.toggle('active', mode==='robot');
      btnRubato.classList.toggle('active', mode==='rubato');
      const newTl = currentTimeline();
      const newB = newTl.boundaries[mvtIdx];
      const newNext = newTl.boundaries[mvtIdx+1] ? newTl.boundaries[mvtIdx+1].t : newTl.duration;
      curTimeSec = newB.t + localP*(newNext - newB.t);
      dynEl.classList.toggle('shown', mode==='rubato');
      drawScrubMarkers();
      updateTimeUI();
      updateScrubMarkerStates();
      if (wasPlaying) play();
    }

    async function jumpToMvt(mvtId){
      if (!allLoaded){ try { await ensureAllLoaded(); } catch(e){ return; } }
      const tl = currentTimeline();
      const b = tl.boundaries.find(x=>x.mvtId===mvtId);
      if (b) seek(b.t);
    }

    function updateDynIndicator(vel){
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

    /* ----- Controls ----- */
    btnRobot.addEventListener('click', ()=>setMode('robot'));
    btnRubato.addEventListener('click', ()=>setMode('rubato'));
    mvtBtns.forEach(b=>b.addEventListener('click', ()=>jumpToMvt(parseInt(b.dataset.mvt,10))));
    playBtn.addEventListener('click', async ()=>{
      if (playing) pause();
      else await play();
    });

    /* ----- Scrubber ----- */
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

    /* ----- Init ----- */
    setStatus('click play to load · ' + MVT_NAMES[1]);
    updateTimeUI();
  })();