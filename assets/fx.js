/* Shared helpers for every page: DOM utils, local storage, Sleeper API client, canvas sprites
   (football, basketball, confetti) and small motion effects. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = (prefix) => ({
    get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(prefix + k); } catch (e) {} }
  });

  /* ---------- Sleeper API (public, read-only, CORS-enabled) ---------- */
  const memo = new Map();
  const cache = store('fhub_cache_');
  async function sleeper(path, { ttl = 0, base = 'https://api.sleeper.app' } = {}) {
    const url = base + path;
    if (memo.has(url)) return memo.get(url);
    if (ttl) { const c = cache.get(path); if (c && Date.now() - c.t < ttl) { const p = Promise.resolve(c.v); memo.set(url, p); return p; } }
    const p = fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('Sleeper ' + r.status); return r.json(); })
      .then(v => { if (ttl) { try { cache.set(path, { t: Date.now(), v }); } catch (e) {} } return v; });
    memo.set(url, p);
    p.catch(() => memo.delete(url));
    return p;
  }

  /* ---------- toast + reveal + tilt + count-up ---------- */
  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }
  function reveal(root = document) {
    const els = $$('.reveal:not(.in)', root);
    if (!('IntersectionObserver' in window) || reduced) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    els.forEach((e, i) => { e.style.transitionDelay = (e.dataset.d || (i % 6) * 70) + 'ms'; io.observe(e); });
  }
  function tilt(el, max = 10) {
    if (reduced || matchMedia('(pointer:coarse)').matches) return;
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.transform = `perspective(900px) rotateY(${x * max}deg) rotateX(${-y * max}deg) translateZ(0)`;
      el.style.setProperty('--mx', (x + .5) * 100 + '%'); el.style.setProperty('--my', (y + .5) * 100 + '%');
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }
  function countUp(el, to, { dur = 1100, dec = 0, prefix = '', suffix = '' } = {}) {
    if (reduced) { el.textContent = prefix + Number(to).toFixed(dec) + suffix; return; }
    const t0 = performance.now(), from = 0;
    const step = t => { const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = prefix + (from + (to - from) * e).toFixed(dec) + suffix; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function countdownParts(target) {
    let ms = Math.max(0, target - Date.now());
    const d = Math.floor(ms / 864e5); ms -= d * 864e5; const h = Math.floor(ms / 36e5); ms -= h * 36e5; const m = Math.floor(ms / 6e4); const s = Math.floor((ms - m * 6e4) / 1000);
    return { d, h, m, s, done: target <= Date.now() };
  }
  const fmtCountdown = t => { const c = countdownParts(t); if (c.done) return 'NOW'; return c.d > 0 ? `${c.d}D ${String(c.h).padStart(2, '0')}H ${String(c.m).padStart(2, '0')}M` : `${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}:${String(c.s).padStart(2, '0')}`; };

  /* ---------- canvas sprites ---------- */
  function drawFootball(ctx, x, y, len, ang, spin = 0, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(ang);
    const w = len / 2, h = len * .3 * (0.82 + 0.18 * Math.abs(Math.cos(spin)));
    const g = ctx.createRadialGradient(-w * .3, -h * .5, 1, 0, 0, w * 1.1);
    g.addColorStop(0, '#b8693a'); g.addColorStop(.6, '#7a3a19'); g.addColorStop(1, '#4a200c');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w * .6, -h * 1.3, w * .6, -h * 1.3, w, 0); ctx.bezierCurveTo(w * .6, h * 1.3, -w * .6, h * 1.3, -w, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, len * .03);
    ctx.beginPath(); ctx.arc(-w * .78, 0, h * .9, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(w * .78, 0, h * .9, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    const ly = -h * .32 * Math.cos(spin);
    ctx.beginPath(); ctx.moveTo(-w * .32, ly); ctx.lineTo(w * .32, ly); ctx.stroke();
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * w * .09, ly - h * .17); ctx.lineTo(i * w * .09, ly + h * .17); ctx.stroke(); }
    ctx.restore();
  }
  function drawBasketball(ctx, x, y, r, rot = 0, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * .35, -r * .35, r * .1, 0, 0, r);
    g.addColorStop(0, '#ffa45c'); g.addColorStop(.7, '#e8590c'); g.addColorStop(1, '#9a3412');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(30,10,0,.85)'; ctx.lineWidth = Math.max(1, r * .08);
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    ctx.beginPath(); ctx.arc(-r * 1.25, 0, r * .95, -0.85, 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 1.25, 0, r * .95, Math.PI - 0.85, Math.PI + 0.85); ctx.stroke();
    ctx.restore();
  }

  function drawBaseball(ctx, x, y, r, rot = 0, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * .35, -r * .35, r * .1, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(.75, '#ece7dc'); g.addColorStop(1, '#a8a196');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d62828'; ctx.lineWidth = Math.max(1, r * .09);
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(s * r * 1.35, 0, r * .95, Math.PI / 2 + s * Math.PI / 2 - .8, Math.PI / 2 + s * Math.PI / 2 + .8); ctx.stroke();
      for (let k = -3; k <= 3; k++) { const a = Math.PI / 2 + s * Math.PI / 2 + k * .22, cx = s * r * 1.35 + Math.cos(a) * r * .95, cy = Math.sin(a) * r * .95; ctx.beginPath(); ctx.moveTo(cx - r * .1, cy - r * .06); ctx.lineTo(cx + r * .1, cy + r * .06); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawSoccer(ctx, x, y, r, rot = 0, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * .35, -r * .35, r * .1, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(.8, '#e5e7eb'); g.addColorStop(1, '#9ca3af');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.save(); ctx.clip();
    const pent = (cx, cy, rr, a0) => { ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = a0 + k * Math.PI * 2 / 5; ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = '#111827'; pent(0, 0, r * .36, -Math.PI / 2);
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; pent(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, r * .3, a + Math.PI / 5); }
    ctx.strokeStyle = 'rgba(17,24,39,.6)'; ctx.lineWidth = Math.max(1, r * .05);
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .36, Math.sin(a) * r * .36); ctx.lineTo(Math.cos(a) * r * .75, Math.sin(a) * r * .75); ctx.stroke(); }
    ctx.restore(); ctx.restore();
  }

  /* ---------- confetti / burst layer shared by any page ---------- */
  let layer, lctx, parts = [], texts = [], running = false;
  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('canvas'); layer.id = 'fxlayer'; document.body.appendChild(layer); lctx = layer.getContext('2d');
    const fit = () => { const d = devicePixelRatio || 1; layer.width = innerWidth * d; layer.height = innerHeight * d; lctx.setTransform(d, 0, 0, d, 0, 0); };
    fit(); addEventListener('resize', fit);
  }
  const CONF = ['#facc15', '#a3e635', '#f1f8ee', '#4ade80', '#38bdf8', '#ff7a2e', '#f43f5e'];
  function confetti(x, y, n = 70, power = 1) {
    if (reduced) return; ensureLayer();
    for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), s = rand(3, 11) * power; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(2, 6), r: rand(3, 7), c: CONF[i % CONF.length], rot: rand(0, 6), vr: rand(-.3, .3), life: rand(60, 110), shape: Math.random() < .5 }); }
    loop();
  }
  function popText(x, y, text, color = '#facc15', size = 44) {
    if (reduced) return; ensureLayer(); texts.push({ x, y, text, color, size, life: 70, max: 70 }); loop();
  }
  function loop() {
    if (running) return; running = true;
    const step = () => {
      lctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.life > 0);
      for (const p of parts) {
        p.vy += .22; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
        lctx.save(); lctx.globalAlpha = Math.min(1, p.life / 30); lctx.translate(p.x, p.y); lctx.rotate(p.rot); lctx.fillStyle = p.c;
        if (p.shape) lctx.fillRect(-p.r, -p.r * .45, p.r * 2, p.r * .9); else { lctx.beginPath(); lctx.arc(0, 0, p.r * .6, 0, 7); lctx.fill(); }
        lctx.restore();
      }
      texts = texts.filter(t => t.life > 0);
      for (const t of texts) {
        const k = 1 - t.life / t.max, sc = k < .15 ? k / .15 * 1.15 : 1.15 - Math.min(.15, (k - .15));
        lctx.save(); lctx.globalAlpha = Math.min(1, t.life / 20); lctx.translate(t.x, t.y - k * 40); lctx.scale(sc, sc);
        lctx.font = `900 ${t.size}px "Big Shoulders Display", sans-serif`; lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
        lctx.lineWidth = 6; lctx.strokeStyle = 'rgba(3,17,10,.85)'; lctx.strokeText(t.text, 0, 0); lctx.fillStyle = t.color; lctx.shadowColor = t.color; lctx.shadowBlur = 18; lctx.fillText(t.text, 0, 0);
        lctx.restore(); t.life--;
      }
      if (parts.length || texts.length) requestAnimationFrame(step); else { running = false; lctx.clearRect(0, 0, innerWidth, innerHeight); }
    };
    requestAnimationFrame(step);
  }

  /* ---------- ambient hero canvas for sub-pages: drifting balls + chalk X's and O's ---------- */
  function ambient(canvas, { kind = 'football', count = 9 } = {}) {
    const ctx = canvas.getContext('2d'); let W = 0, H = 0, items = [], marks = [];
    const fit = () => { const d = devicePixelRatio || 1, r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    fit(); addEventListener('resize', fit);
    for (let i = 0; i < count; i++) items.push({ x: rand(0, 1), y: rand(0, 1), s: rand(14, 34), vx: rand(.0004, .0012) * (Math.random() < .5 ? -1 : 1), vy: rand(-.0004, .0004), a: rand(0, 6), va: rand(-.02, .02), sp: rand(0, 6), al: rand(.12, .34), k: kind === 'mix' ? (i % 2 ? 'b' : 'f') : kind[0] });
    for (let i = 0; i < 14; i++) marks.push({ x: rand(.45, .98), y: rand(.1, .9), o: Math.random() < .5, s: rand(8, 14), ph: rand(0, 6) });
    let t = 0;
    const step = () => {
      t += .016; ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(241,248,238,.18)'; ctx.lineWidth = 2.2;
      for (const m of marks) {
        const a = .35 + .35 * Math.sin(t * 1.3 + m.ph); ctx.globalAlpha = a; const x = m.x * W, y = m.y * H;
        if (m.o) { ctx.beginPath(); ctx.arc(x, y, m.s * .7, 0, 7); ctx.stroke(); } else { ctx.beginPath(); ctx.moveTo(x - m.s * .6, y - m.s * .6); ctx.lineTo(x + m.s * .6, y + m.s * .6); ctx.moveTo(x + m.s * .6, y - m.s * .6); ctx.lineTo(x - m.s * .6, y + m.s * .6); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      for (const b of items) {
        b.x += b.vx; b.y += b.vy + Math.sin(t + b.sp) * .0003; b.a += b.va; b.sp += .12;
        if (b.x < -.1) b.x = 1.1; if (b.x > 1.1) b.x = -.1; if (b.y < -.1) b.y = 1.1; if (b.y > 1.1) b.y = -.1;
        if (b.k === 'b') drawBasketball(ctx, b.x * W, b.y * H, b.s * .5, b.a, b.al); else drawFootball(ctx, b.x * W, b.y * H, b.s * 1.6, b.a, b.sp, b.al);
      }
      if (!reduced) requestAnimationFrame(step);
    };
    step();
  }

  window.FX = { $, $$, esc, clamp, rand, reduced, store, sleeper, toast, reveal, tilt, countUp, countdownParts, fmtCountdown, drawFootball, drawBasketball, drawBaseball, drawSoccer, confetti, popText, ambient };
})();
