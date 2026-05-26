/* ============================================================
   ALEXANDER B. CHEN — shared JS
   Pure vanilla. No CDN dependencies. Loads on every page.
============================================================ */
(function(){
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover:none),(pointer:coarse)').matches;

  function ready(fn){
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* ---- BACKGROUND DRIFTING MATH SYMBOLS -------------------- */
  function spawnBackground(){
    if (reduce) return;
    const box = document.querySelector('.bg-symbols');
    if (!box) return;
    const glyphs = [
      '\u222B','\u2211','\u220F','\u2207','\u2202','\u221E',
      'd\u03B8','d\u03BB','\u03B6(s)','\u03B1','\u03B2','\u03B3',
      'a/(b+c)','\u2200\u03B5>0','\u2203\u03B4','mod 52',
      '\u03C8(x)','H\u03C8=E\u03C8','ab+1',
      'sin(\u03B8)','log\u2082(3/2)','\u2192','\u2261'
    ];
    const count = 14;
    for (let i=0;i<count;i++){
      const s = document.createElement('span');
      s.textContent = glyphs[Math.floor(Math.random()*glyphs.length)];
      s.style.left = (Math.random()*120 + 10) + 'vw';
      s.style.top = (Math.random()*100 + 10) + 'vh';
      s.style.fontSize = (Math.random()*3 + 1.2) + 'rem';
      const dur = 40 + Math.random()*60;
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = (-Math.random()*dur) + 's';
      if (Math.random() < 0.5) s.classList.add('rev');
      box.appendChild(s);
    }
  }

  /* ---- CUSTOM CURSOR --------------------------------------- */
  function initCursor(){
    if (isTouch) return;
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;
    let mx=window.innerWidth/2, my=window.innerHeight/2;
    let rx=mx, ry=my;
    window.addEventListener('mousemove', e=>{mx=e.clientX; my=e.clientY;});
    function tick(){
      rx += (mx-rx)*0.2;
      ry += (my-ry)*0.2;
      dot.style.transform = `translate3d(${mx-3}px, ${my-3}px, 0)`;
      ring.style.transform = `translate3d(${rx-17}px, ${ry-17}px, 0)`;
      requestAnimationFrame(tick);
    }
    tick();
    document.querySelectorAll('a, button, [data-cursor="hover"], input, textarea, select, .slot, .gcard, .reel-card, .project-card').forEach(el=>{
      el.addEventListener('mouseenter', ()=>document.body.classList.add('cursor-hover'));
      el.addEventListener('mouseleave', ()=>document.body.classList.remove('cursor-hover'));
    });
  }

  /* ---- MARGIN TRACE — scroll progress ---------------------- */
  function initMargin(){
    const trace = document.querySelector('.margin-trace');
    if (!trace) return;
    const fill = trace.querySelector('.fill');
    if (!fill) return;
    function update(){
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (h <= 0){ fill.style.height = '0'; return; }
      const sc = Math.max(0, Math.min(1, window.scrollY / h));
      fill.style.height = (sc * 100) + 'vh';
    }
    update();
    window.addEventListener('scroll', update, {passive:true});
    window.addEventListener('resize', update);
  }

  /* ---- REVEAL ON SCROLL ------------------------------------ */
  function initReveal(){
    if (reduce){
      document.querySelectorAll('[data-reveal]').forEach(el=>el.classList.add('in'));
      return;
    }
    if (!('IntersectionObserver' in window)){
      document.querySelectorAll('[data-reveal]').forEach(el=>el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if (e.isIntersecting){
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },{threshold:0.15, rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('[data-reveal]').forEach(el=>io.observe(el));
  }

  /* ---- INIT ---------------------------------------------- */
  ready(function(){
    spawnBackground();
    initCursor();
    initMargin();
    initReveal();
  });
})();
