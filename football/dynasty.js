/* Football HQ — dynasty side: board (value model), trade lab, mock startup, dynasty plan. */
(() => {
const { $, $$, esc, clamp, rand, reduced, sleeper, toast, reveal, tilt, countUp, confetti, popText, fmtCountdown } = FX;
const { P, G, ST, pl, ph, posTag, injTag, ageOf, POS_COL, CURVE, curveVal, f1, openPlayer, openModal, closeModal, playerPicker, renderers } = HQ;

/* ---------- settings ---------- */
const DS = Object.assign({ fmt: 'sf', hz: 0, tep: false, teams: 12 }, ST.get('dyn', {}));
const saveDS = () => ST.set('dyn', DS);
let FLAGS = ST.get('flags', {});               // id -> 'T' (target) | 'A' (avoid)
let liveLoaded = false, liveMsg = '';

async function loadLiveAdp() {
  if (liveLoaded) return;
  const q = ['QB', 'RB', 'WR', 'TE'].map(p => 'position%5B%5D=' + p).join('&');
  try {
    const arr = await sleeper(`/projections/nfl/${G.season}?season_type=regular&${q}`);
    for (const x of arr) {
      const s = x.stats || {}, pp = x.player; let p = P[x.player_id];
      if (!p && pp && (s.adp_dynasty_2qb < 999 || s.adp_dynasty_ppr < 999)) p = P[x.player_id] = { id: x.player_id, name: `${pp.first_name} ${pp.last_name}`, pos: pp.position, team: x.team, dob: null, exp: pp.years_exp };
      if (!p) continue;
      p.sfAdp = s.adp_dynasty_2qb < 999 ? s.adp_dynasty_2qb : null;
      p.oneAdp = s.adp_dynasty_ppr < 999 ? s.adp_dynasty_ppr : null;
      if (s.pts_ppr != null) p.proj = s.pts_ppr;
      if (x.team) p.team = x.team;
      if (pp && pp.years_exp != null) p.exp = pp.years_exp;
    }
    liveMsg = 'Live Sleeper dynasty ADP';
  } catch (e) { liveMsg = `Offline: using the ${window.NFL_SNAP ? NFL_SNAP.asOf : ''} snapshot`; }
  liveLoaded = true;
}

/* ---------- value model ----------
   Market value: Sleeper dynasty ADP mapped onto a 0–10,000 curve (pick 1 ≈ 10,000; pick 100 ≈ 1,150).
   Window: the slider tilts value by age relative to each position's pivot age (rebuild favors youth, win-now favors vets),
   and win-now also blends in this season's projected points. TE premium adds 15% to tight ends. */
const mkt = adp => Math.round(10000 * Math.exp(-.0218 * (adp - 1)));
const PIVOT = { QB: 29, RB: 25, WR: 26.5, TE: 27 }, SLOPE = { QB: .045, RB: .11, WR: .075, TE: .065 };
let BOARD = [], BI = {};
function buildBoard() {
  const key = DS.fmt === 'sf' ? 'sfAdp' : 'oneAdp', h = DS.hz / 100;
  const pool = Object.values(P).filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.pos) && p[key]);
  const byProj = pool.filter(p => p.proj).sort((a, b) => b.proj - a.proj); const projRank = {}; byProj.forEach((p, i) => projRank[p.id] = i + 1);
  for (const p of pool) {
    const age = ageOf(p) ?? (p.exp != null ? 22 + p.exp : 25);
    let v = mkt(p[key]);
    v *= clamp(Math.exp(h * SLOPE[p.pos] * (PIVOT[p.pos] - age)), .5, 1.7);
    if (h < 0 && projRank[p.id]) { const pv = mkt(projRank[p.id] * (DS.fmt === 'sf' || p.pos !== 'QB' ? 1 : 1.6)); v = v * (1 + h * .35) + pv * (-h * .35); }
    if (DS.tep && p.pos === 'TE') v *= 1.15;
    p._age = age; p._v = Math.round(v); p._adp = p[key];
  }
  BOARD = pool.sort((a, b) => b._v - a._v);
  const byAdp = [...BOARD].sort((a, b) => a._adp - b._adp); const adpRank = {}; byAdp.forEach((p, i) => adpRank[p.id] = i + 1);
  BI = {}; let tier = 1, tsize = 0;
  BOARD.forEach((p, i) => {
    if (i > 0 && tsize >= 3 && (p._v < BOARD[i - 1]._v * .935 || tsize >= 14)) { tier++; tsize = 0; }
    tsize++; p._tier = tier; p._rank = i + 1; p._mrank = adpRank[p.id];
    const c = CURVE[p.pos]; p._peak = Math.max(0, c.fall - p._age);
    BI[p.id] = { rank: i + 1, value: p._v, tier };
  });
}
HQ.boardInfo = id => { if (!BOARD.length) return null; return BI[id] || null; };
HQ.boardValue = id => (BI[id] ? BI[id].value : 0);
const hzLabel = h => h <= -60 ? 'All-in win now' : h <= -20 ? 'Lean win now' : h < 20 ? 'Balanced' : h < 60 ? 'Lean rebuild' : 'Full youth movement';
function ageChip(p) {
  const a = p._age, c = CURVE[p.pos]; if (a == null) return '';
  const col = a < c.rise ? 'rgba(56,189,248,.2);color:#bae6fd' : a <= c.fall - 1 ? 'rgba(163,230,53,.2);color:#d9f99d' : a <= c.fall + 1 ? 'rgba(251,191,36,.2);color:#fde68a' : 'rgba(244,63,94,.2);color:#fda4af';
  return `<span class="agechip" style="background:${col}">${a.toFixed(1)}</span>`;
}

/* =================== BOARD VIEW =================== */
let BPOS = 'ALL', BSHOW = 'all', BQ = '';
async function renderDynasty() {
  if (!liveLoaded) { $('#boardBody').innerHTML = '<tr><td colspan="9"><div class="spinner"></div></td></tr>'; await loadLiveAdp(); }
  buildBoard();
  $$('#dynFmt button').forEach(b => b.classList.toggle('on', b.dataset.f === DS.fmt));
  $('#dynHz').value = DS.hz; $('#hzLabel').textContent = hzLabel(DS.hz); $('#dynTep').checked = DS.tep;
  $('#dynSub').textContent = `${liveMsg}. ${BOARD.length} players turned into trade values, then re-ranked for age and your window. ★ marks targets, ⛔ marks players to avoid.`;
  drawKpis(); drawBoardTable(); drawScatter();
}
function drawKpis() {
  const top24 = BOARD.slice(0, 24), avgAge = top24.reduce((s, p) => s + p._age, 0) / (top24.length || 1);
  const qbs = BOARD.slice(0, 24).filter(p => p.pos === 'QB').length, tg = BOARD.filter(p => FLAGS[p.id] === 'T').length;
  let riser = [...BOARD.slice(0, 120)].sort((a, b) => (b._mrank - b._rank) - (a._mrank - a._rank))[0]; if (riser && riser._mrank - riser._rank <= 0) riser = null;
  $('#dynKpis').innerHTML = `
    <div class="kpi"><div class="l">Format</div><div class="v">${DS.fmt === 'sf' ? 'SUPERFLEX' : '1QB'}${DS.tep ? ' · TE+' : ''}</div><div class="s">${qbs} QBs in your top 24</div></div>
    <div class="kpi"><div class="l">Top-24 average age</div><div class="v" id="kAge">0</div><div class="s">${hzLabel(DS.hz)}</div></div>
    <div class="kpi"><div class="l">Biggest climber vs ADP</div><div class="v" style="font-size:20px">${riser ? esc(riser.name) : '–'}</div><div class="s">${riser ? `ADP #${riser._mrank} → your #${riser._rank}` : 'Move the window slider to re-rank'}</div></div>
    <div class="kpi"><div class="l">Your targets</div><div class="v" id="kTg">0</div><div class="s">${tg ? 'Star more players to build your list' : 'Tap ★ on any row'}</div></div>`;
  countUp($('#kAge'), avgAge, { dec: 1 }); countUp($('#kTg'), tg);
}
function drawBoardTable() {
  const q = BQ.trim().toLowerCase();
  let rows = BOARD.filter(p => (BPOS === 'ALL' || p.pos === BPOS) && (!q || p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase() === q)
    && (BSHOW === 'all' || (BSHOW === 'T' && FLAGS[p.id] === 'T') || (BSHOW === 'R' && p.exp === 0) || (BSHOW === 'Y' && p._age < 25)));
  $('#dynCount').textContent = `${rows.length} players`;
  rows = rows.slice(0, 300);
  const maxV = BOARD.length ? BOARD[0]._v : 1; let lastTier = 0, html = '';
  for (const p of rows) {
    if (BPOS === 'ALL' && !q && BSHOW === 'all' && p._tier !== lastTier) { html += `<tr class="tier"><td colspan="9">Tier ${p._tier}</td></tr>`; lastTier = p._tier; }
    const d = p._mrank - p._rank, f = FLAGS[p.id];
    html += `<tr data-pid="${esc(p.id)}" style="${f === 'A' ? 'opacity:.45' : ''}"><td class="num" style="font:700 13px var(--font-mono);color:var(--muted)">${p._rank}</td>
      <td style="white-space:nowrap"><button class="star ${f === 'T' ? 'on' : ''}" data-flag="T" data-id="${esc(p.id)}" aria-label="Target ${esc(p.name)}">★</button><button class="star av ${f === 'A' ? 'on' : ''}" data-flag="A" data-id="${esc(p.id)}" aria-label="Avoid ${esc(p.name)}">⛔</button></td>
      <td>${HQ.pcell(p, '', p.exp === 0 ? ' <span class="tag rk">R</span>' : '')}</td><td class="r">${ageChip(p)}</td><td class="r num">${f1(p._adp)}</td>
      <td class="r num ${d > 0 ? 'delta-up' : d < 0 ? 'delta-dn' : ''}">${d > 0 ? '▲' + d : d < 0 ? '▼' + -d : '–'}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:8px"><div class="valbar" style="flex:1"><i style="width:${(p._v / maxV * 100).toFixed(1)}%"></i></div><span class="num" style="font:700 12px var(--font-mono);min-width:44px;text-align:right">${p._v.toLocaleString()}</span></div></td>
      <td class="r num">${p._peak >= 1 ? Math.round(p._peak) : '<span class="tag inj">past</span>'}</td><td class="r num">${p.proj ? Math.round(p.proj) : '–'}</td></tr>`;
  }
  $('#boardBody').innerHTML = html || '<tr><td colspan="9"><div class="empty">No players match.</div></td></tr>';
}
$('#boardBody').addEventListener('click', e => {
  const b = e.target.closest('button[data-flag]'); if (!b) return;
  e.stopPropagation(); const id = b.dataset.id, f = b.dataset.flag;
  FLAGS[id] = FLAGS[id] === f ? undefined : f; if (!FLAGS[id]) delete FLAGS[id]; ST.set('flags', FLAGS);
  if (FLAGS[id] === 'T') { const r = b.getBoundingClientRect(); confetti(r.left + 8, r.top + 8, 18, .5); }
  drawBoardTable(); drawKpis();
});
$('#dynFmt').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; DS.fmt = b.dataset.f; saveDS(); renderDynasty(); };
let hzT; $('#dynHz').oninput = e => { DS.hz = +e.target.value; $('#hzLabel').textContent = hzLabel(DS.hz); clearTimeout(hzT); hzT = setTimeout(() => { saveDS(); buildBoard(); drawKpis(); drawBoardTable(); drawScatter(); }, 120); };
$('#dynTep').onchange = e => { DS.tep = e.target.checked; saveDS(); renderDynasty(); };
$('#dynPos').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; BPOS = b.dataset.p; $$('#dynPos button').forEach(x => x.classList.toggle('on', x === b)); drawBoardTable(); };
$('#dynShow').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; BSHOW = b.dataset.s; $$('#dynShow button').forEach(x => x.classList.toggle('on', x === b)); drawBoardTable(); };
$('#dynSearch').oninput = e => { BQ = e.target.value; drawBoardTable(); };
$('#dynCsv').onclick = () => {
  const rows = [['rank', 'tier', 'player', 'pos', 'team', 'age', 'adp', 'value', 'flag'], ...BOARD.map(p => [p._rank, p._tier, p.name, p.pos, p.team, p._age.toFixed(1), p._adp, p._v, FLAGS[p.id] || ''])];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `dynasty-board-${DS.fmt}.csv`; a.click(); toast('Board exported');
};

/* ---------- value vs age scatter (canvas, dots fly in) ---------- */
let scatterPts = [], scatterAnim = 0;
function drawScatter() {
  const cv = $('#scatter'); if (!cv.offsetParent) return;
  const ctx = cv.getContext('2d'), d = devicePixelRatio || 1, r = cv.getBoundingClientRect(), W = r.width, H = r.height;
  cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  const pts = BOARD.slice(0, 150), maxV = pts.length ? pts[0]._v : 1, pad = { l: 52, r: 16, t: 14, b: 34 };
  const X = a => pad.l + (a - 20) / 17 * (W - pad.l - pad.r), Y = v => H - pad.b - v / maxV * (H - pad.t - pad.b);
  scatterPts = pts.map((p, i) => ({ p, x: X(clamp(p._age, 20, 37)), y: Y(p._v), sx: rand(0, W), sy: H + 40, delay: i * 4 }));
  const t0 = performance.now(), id = ++scatterAnim;
  const frame = now => {
    if (id !== scatterAnim) return;
    const t = now - t0; ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(225,255,230,.10)'; ctx.fillStyle = '#86ab92'; ctx.font = '600 11px Barlow'; ctx.lineWidth = 1;
    for (let a = 21; a <= 37; a += 2) { ctx.beginPath(); ctx.moveTo(X(a), pad.t); ctx.lineTo(X(a), H - pad.b); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(a, X(a), H - pad.b + 16); }
    for (let v = 0; v <= maxV; v += 2000) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(v.toLocaleString(), pad.l - 8, Y(v) + 4); }
    ctx.textAlign = 'center'; ctx.fillText('AGE', (W + pad.l) / 2, H - 4);
    let done = true;
    for (const s of scatterPts) {
      const k = reduced ? 1 : clamp((t - s.delay) / 700, 0, 1), e = 1 - Math.pow(1 - k, 3); if (k < 1) done = false;
      const x = s.sx + (s.x - s.sx) * e, y = s.sy + (s.y - s.sy) * e, rad = FLAGS[s.p.id] === 'T' ? 7 : 5;
      ctx.globalAlpha = .9 * e; ctx.fillStyle = POS_COL[s.p.pos]; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (FLAGS[s.p.id] === 'T') { ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2; ctx.stroke(); }
      if (k >= 1 && s.p._rank <= 12) { ctx.globalAlpha = 1; ctx.fillStyle = '#f1f8ee'; ctx.font = '700 11px Barlow'; ctx.textAlign = 'left'; ctx.fillText(s.p.name.split(' ').slice(-1)[0], x + 8, y + 4); }
    }
    ctx.globalAlpha = 1;
    if (!done) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
$('#scatter').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = 144; for (const s of scatterPts) { const dd = (s.x - x) ** 2 + (s.y - y) ** 2; if (dd < bd) { bd = dd; best = s; } }
  if (best) openPlayer(best.p.id);
});
$('#scatter').addEventListener('mousemove', e => {
  const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = scatterPts.find(s => (s.x - x) ** 2 + (s.y - y) ** 2 < 100); e.currentTarget.style.cursor = hit ? 'pointer' : 'default';
  e.currentTarget.title = hit ? `${hit.p.name} · ${hit.p._age.toFixed(1)} yrs · ${hit.p._v.toLocaleString()}` : '';
});
addEventListener('resize', () => { if (G.view === 'dynasty') drawScatter(); });

/* =================== TRADE LAB =================== */
const PICKS = [
  { id: 'pk27e1', name: "2027 1st (early)", adp: 18 }, { id: 'pk27m1', name: "2027 1st (mid)", adp: 30 }, { id: 'pk27l1', name: "2027 1st (late)", adp: 44 },
  { id: 'pk27e2', name: "2027 2nd (early)", adp: 66 }, { id: 'pk27m2', name: "2027 2nd (mid)", adp: 80 }, { id: 'pk27l2', name: "2027 2nd (late)", adp: 96 },
  { id: 'pk273', name: "2027 3rd", adp: 135 }, { id: 'pk281', name: "2028 1st", adp: 34 }, { id: 'pk282', name: "2028 2nd", adp: 92 }, { id: 'pk283', name: "2028 3rd", adp: 150 }];
const pickVal = pk => Math.round(mkt(pk.adp) * (DS.hz > 0 ? 1 + DS.hz / 400 : 1 + DS.hz / 300));
let TR = ST.get('trade', { a: [], b: [] });
const itemOf = id => { const pk = PICKS.find(x => x.id === id); if (pk) return { id, name: pk.name, pick: true, v: pickVal(pk) }; const p = pl(id); return { id, name: p.name, p, v: BI[id] ? BI[id].value : 0 }; };
function tradeSource(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const used = new Set([...TR.a, ...TR.b]);
  const picks = PICKS.filter(pk => !used.has(pk.id) && (pk.name.toLowerCase().includes(q) || ['pick', 'picks', 'rookie'].some(w => w.startsWith(q) || q.startsWith(w))));
  const players = BOARD.filter(p => !used.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 10);
  return [...picks.map(pk => ({ kind: 'pick', pk })), ...players.map(p => ({ kind: 'p', p }))].slice(0, 12);
}
const tradeItem = it => it.kind === 'pick' ? `<span class="ph" data-i="PK" style="--pc:var(--gold)"></span><span><b>${esc(it.pk.name)}</b> <span class="sub">${pickVal(it.pk).toLocaleString()}</span></span>` : `${ph(it.p)}<span style="min-width:0"><b>${esc(it.p.name)}</b> ${posTag(it.p.pos)} <span class="sub">${(BI[it.p.id] ? BI[it.p.id].value : 0).toLocaleString()}</span></span>`;
async function ensureBoard() { if (!liveLoaded) await loadLiveAdp(); buildBoard(); }
function initTradePickers() {
  for (const side of ['a', 'b']) {
    const inp = $('#tr' + side.toUpperCase());
    playerPicker(inp, inp.nextElementSibling, it => { TR[side].push(it.kind === 'pick' ? it.pk.id : it.p.id); ST.set('trade', TR); drawTrade(true); }, { source: tradeSource, renderItem: tradeItem });
  }
}
const adjTotal = vals => vals.length ? Math.round(Math.pow(vals.reduce((s, v) => s + Math.pow(v, 1.25), 0), 1 / 1.25)) : 0;
function drawTrade(fresh) {
  const A = TR.a.map(itemOf), B = TR.b.map(itemOf);
  const list = (arr, side) => arr.length ? arr.map(it => `<div class="titem">${it.pick ? `<span class="ph" data-i="PK" style="--pc:var(--gold)"></span>` : ph(it.p)}<div style="min-width:0">${it.pick ? `<b>${esc(it.name)}</b><div class="sub" style="font-size:12px">Rookie pick</div>` : `<b data-pid="${esc(it.id)}" style="cursor:pointer">${esc(it.name)}</b><div class="sub" style="font-size:12px">${posTag(it.p.pos)} ${it.p._age ? 'Age ' + it.p._age.toFixed(1) : ''}</div>`}</div><span class="v">${it.v.toLocaleString()}</span><button class="btn small ghost" data-rm="${side}:${esc(it.id)}" aria-label="Remove ${esc(it.name)}">✕</button></div>`).join('') : '<div class="sub" style="padding:10px 0">Nothing added yet.</div>';
  $('#trListA').innerHTML = list(A, 'a'); $('#trListB').innerHTML = list(B, 'b');
  const ra = A.reduce((s, x) => s + x.v, 0), rb = B.reduce((s, x) => s + x.v, 0), aa = adjTotal(A.map(x => x.v)), ab = adjTotal(B.map(x => x.v));
  $('#trTotA').textContent = ra.toLocaleString(); $('#trTotB').textContent = rb.toLocaleString();
  $('#trAdjA').textContent = A.length > 1 ? `stud-adjusted ${aa.toLocaleString()}` : ''; $('#trAdjB').textContent = B.length > 1 ? `stud-adjusted ${ab.toLocaleString()}` : '';
  const ball = $('#trBall'), v = $('#trVerdict'), hint = $('#trHint');
  if (!A.length || !B.length) { ball.style.left = '50%'; v.textContent = A.length || B.length ? 'Add the other side' : 'Add players to start'; v.style.color = ''; hint.textContent = 'Search players or type "pick" for rookie picks. Values follow your Dynasty Board format and window.'; $('#trSend').disabled = true; return; }
  const diff = ab - aa, pct = diff / Math.max(aa, ab);
  ball.style.left = (50 + clamp(pct, -1, 1) * 41) + '%';
  $('#trSend').disabled = false;
  if (Math.abs(pct) < .05) { v.textContent = 'Fair deal'; v.style.color = 'var(--gold)'; hint.textContent = 'Within 5% after the stud adjustment. Good luck getting it accepted.'; }
  else {
    const win = diff > 0; v.textContent = win ? `You win by ${Math.round(Math.abs(pct) * 100)}%` : `You overpay by ${Math.round(Math.abs(pct) * 100)}%`; v.style.color = win ? 'var(--lime)' : '#fda4af';
    const gap = Math.abs(ab - aa), used = new Set([...TR.a, ...TR.b]);
    const sug = BOARD.filter(p => !used.has(p.id)).reduce((best, p) => !best || Math.abs(p._v - gap) < Math.abs(best._v - gap) ? p : best, null);
    const pk = PICKS.filter(x => !used.has(x.id)).reduce((best, x) => !best || Math.abs(pickVal(x) - gap) < Math.abs(pickVal(best) - gap) ? x : best, null);
    hint.innerHTML = `To even it out, ${win ? 'you could add' : 'ask them to add'} something worth about <b>${gap.toLocaleString()}</b>, like ${sug ? `<b>${esc(sug.name)}</b> (${sug._v.toLocaleString()})` : ''}${sug && pk ? ' or ' : ''}${pk ? `a <b>${esc(pk.name)}</b> (${pickVal(pk).toLocaleString()})` : ''}.`;
  }
}
$('#v-trade').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; const [s, id] = b.dataset.rm.split(':'); TR[s] = TR[s].filter(x => x !== id); ST.set('trade', TR); drawTrade(); });
$('#trClear').onclick = () => { TR = { a: [], b: [] }; ST.set('trade', TR); drawTrade(); };
$('#trSend').onclick = e => { const r = e.target.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 110, 1.2); popText(r.left + r.width / 2, r.top - 30, 'TRADE ACCEPTED', '#facc15', 52); };
HQ.addToTrade = id => { if (!TR.a.includes(id) && !TR.b.includes(id)) TR.b.push(id); ST.set('trade', TR); location.hash = 'trade'; };
let tradeInit = false;
async function renderTrade() { await ensureBoard(); if (!tradeInit) { initTradePickers(); tradeInit = true; } drawTrade(); }

/* =================== MOCK STARTUP =================== */
let MK = null;
function fillSlots() { const n = +$('#mkTeams').value, cur = +$('#mkSlot').value || Math.ceil(n / 2); $('#mkSlot').innerHTML = Array.from({ length: n }, (_, i) => `<option ${i + 1 === Math.min(cur, n) ? 'selected' : ''}>${i + 1}</option>`).join(''); }
$('#mkTeams').onchange = fillSlots; fillSlots(); $('#mkFmt').value = DS.fmt;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function teamAt(pick) { const n = MK.teams, r = Math.floor(pick / n), i = pick % n; const rev = MK.rev ? (r === 1 || r === 2 ? true : r > 2 ? r % 2 === 0 : false) : r % 2 === 1; return rev ? n - 1 - i : i; }
function mkStart() {
  const fmt = $('#mkFmt').value; const key = fmt === 'sf' ? 'sfAdp' : 'oneAdp';
  const pool = Object.values(P).filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.pos) && p[key]).sort((a, b) => a[key] - b[key]).slice(0, 420);
  MK = { teams: +$('#mkTeams').value, rounds: +$('#mkRounds').value, slot: +$('#mkSlot').value - 1, fmt, key, rev: $('#mkRev').checked, pool, taken: new Set(), picks: [], rosters: Array.from({ length: +$('#mkTeams').value }, () => []), done: false, auto: false };
  if (DS.fmt !== fmt) { DS.fmt = fmt; saveDS(); }
  buildBoard(); drawMock(); runCpu();
}
const caps = fmt => fmt === 'sf' ? { QB: 4, RB: 8, WR: 9, TE: 3 } : { QB: 2, RB: 8, WR: 9, TE: 3 };
function cpuPick(t) {
  const cnt = { QB: 0, RB: 0, WR: 0, TE: 0 }; for (const p of MK.rosters[t]) cnt[p.pos]++;
  const cap = caps(MK.fmt), n = MK.picks.length;
  let best = null, bk = Infinity;
  for (const p of MK.pool) {
    if (MK.taken.has(p.id) || cnt[p.pos] >= cap[p.pos]) continue;
    if (p[MK.key] > n + 60) break;
    let k = p[MK.key] + gauss() * (1.5 + p[MK.key] * .1);
    if (MK.fmt === 'sf' && p.pos === 'QB' && cnt.QB < 2 && n > MK.teams * 3) k -= 6;
    if (k < bk) { bk = k; best = p; }
  }
  return best || MK.pool.find(p => !MK.taken.has(p.id));
}
function recsFor() {
  const mine = MK.rosters[MK.slot], cnt = { QB: 0, RB: 0, WR: 0, TE: 0 }; for (const p of mine) cnt[p.pos]++;
  const need = MK.fmt === 'sf' ? { QB: 2, RB: 3, WR: 4, TE: 1 } : { QB: 1, RB: 3, WR: 4, TE: 1 };
  const avail = BOARD.filter(p => !MK.taken.has(p.id) && p[MK.key]).slice(0, 60);
  return avail.map(p => { let s = p._v; const why = []; if (cnt[p.pos] < need[p.pos]) { s *= 1.08; why.push('fills a need'); } const steal = MK.picks.length + 1 - p[MK.key]; if (steal > 6) why.push(`ADP ${Math.round(p[MK.key])}, falling`); if (FLAGS[p.id] === 'T') { s *= 1.06; why.push('your target'); } if (FLAGS[p.id] === 'A') s *= .5; return { p, s, why }; }).sort((a, b) => b.s - a.s);
}
function makePick(p, fromEl) {
  const n = MK.picks.length, t = teamAt(n);
  MK.taken.add(p.id); MK.picks.push({ p, t }); MK.rosters[t].push(p);
  if (fromEl && !reduced) {
    const cell = $(`#mkCell${n}`), a = fromEl.getBoundingClientRect(), b = cell && cell.getBoundingClientRect();
    if (b) { const g = document.createElement('div'); g.textContent = p.name; Object.assign(g.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', zIndex: 260, padding: '6px 10px', borderRadius: '10px', background: 'var(--gold)', color: 'var(--gold-ink)', fontWeight: 800, fontSize: '13px', transition: 'all .6s cubic-bezier(.5,0,.2,1)', pointerEvents: 'none', boxShadow: '0 10px 30px -8px #000' }); document.body.appendChild(g); requestAnimationFrame(() => { g.style.left = b.left + 'px'; g.style.top = b.top + 'px'; g.style.transform = 'scale(.8)'; g.style.opacity = '.3'; }); setTimeout(() => g.remove(), 650); }
  }
  if (MK.picks.length >= MK.teams * MK.rounds) { MK.done = true; }
}
async function runCpu() {
  while (MK && !MK.done && (teamAt(MK.picks.length) !== MK.slot || MK.auto)) {
    const t = teamAt(MK.picks.length);
    const p = t === MK.slot ? recsFor()[0].p : cpuPick(t);
    makePick(p); drawMock(true);
    await new Promise(r => setTimeout(r, reduced ? 0 : MK.auto ? 60 : 170));
  }
  drawMock();
  if (MK && MK.done) finishMock();
  else if (MK && teamAt(MK.picks.length) === MK.slot) { const el = $('#mkOtc'); if (el) { const r = el.getBoundingClientRect(); popText(r.left + r.width / 2, r.top + 30, "YOU'RE UP!", '#facc15', 40); } }
}
function drawMock(light) {
  const body = $('#mockBody'); if (!MK) { body.innerHTML = `<div class="card empty"><div style="font-size:44px">🎯</div><h3 style="margin:8px 0">Set it up and hit start</h3><p class="sub">Practice a startup before your dynasty league drafts next year. The draft board fills live as the computer teams pick.</p></div>`; return; }
  const n = MK.picks.length, t = teamAt(n), mine = !MK.done && t === MK.slot;
  const round = Math.floor(n / MK.teams) + 1, inR = n % MK.teams + 1;
  let grid = `<table><thead><tr><th></th>${Array.from({ length: MK.teams }, (_, i) => `<th class="${i === MK.slot ? 'me' : ''}">${i === MK.slot ? 'YOU' : 'Team ' + (i + 1)}</th>`).join('')}</tr></thead><tbody>`;
  for (let r = 0; r < MK.rounds; r++) {
    const cells = new Array(MK.teams);
    for (let i = 0; i < MK.teams; i++) { const k = r * MK.teams + i; cells[teamAt(k)] = k; }
    grid += `<tr><th>${r + 1}</th>${cells.map(k => { const pk = MK.picks[k]; return `<td>${pk ? `<div class="dcell ${k === n - 1 ? 'fresh' : ''}" id="mkCell${k}" style="--pc:${POS_COL[pk.p.pos]}" data-pid="${esc(pk.p.id)}"><b>${esc(pk.p.name)}</b><small>${pk.p.pos} · ${r + 1}.${String(k % MK.teams + 1).padStart(2, '0')}</small></div>` : `<div class="dcell ${k === n ? 'now' : ''}" id="mkCell${k}"><small>${r + 1}.${String(k % MK.teams + 1).padStart(2, '0')}</small></div>`}</td>`; }).join('')}</tr>`;
  }
  grid += '</tbody></table>';
  const recs = MK.done ? [] : recsFor();
  const myR = MK.rosters[MK.slot];
  const left = MK.done ? `<div class="card" id="mkGrade"></div>` : `<div class="otc ${mine ? 'mine' : ''}" id="mkOtc"><div class="eyebrow">Round ${round} · pick ${inR} · #${n + 1} overall</div><div class="big">${mine ? "You're on the clock" : `Team ${t + 1} is picking…`}</div>
      <div class="row" style="margin-top:6px"><button class="btn small" id="mkAuto">${MK.auto ? 'Stop auto' : 'Auto-draft the rest'}</button><button class="btn small ghost" id="mkReset">Restart</button></div></div>
    <div class="card hash" style="margin-top:12px"><div class="head"><h3>Best for you</h3><span class="sp"></span><span class="sub">sorted by your board</span></div>
      <div class="avail">${recs.slice(0, 40).map((x, i) => `<div class="it" data-mk="${esc(x.p.id)}">${i < 3 && mine ? '<span class="rk" style="color:var(--gold)">★</span>' : `<span class="rk">${x.p._rank}</span>`}${HQ.pcell(x.p, x.why.length ? `<span class="sub" style="color:var(--lime)">${esc(x.why.join(' · '))}</span>` : '')}<span class="v">ADP ${Math.round(x.p[MK.key])}<br>${x.p._v.toLocaleString()}</span></div>`).join('')}</div></div>`;
  body.innerHTML = `<div class="mockgrid"><div>${left}<div class="card" style="margin-top:12px"><div class="head"><h3>Your team</h3><span class="sp"></span><span class="sub">${['QB', 'RB', 'WR', 'TE'].map(ps => `${ps} ${myR.filter(p => p.pos === ps).length}`).join(' · ')}</span></div>${myR.length ? myR.map((p, i) => `<div class="row" style="padding:5px 0;border-bottom:1px dashed var(--line);flex-wrap:nowrap"><span class="team">${i + 1}</span><div style="flex:1;min-width:0">${HQ.pcell(p)}</div></div>`).join('') : '<div class="sub">No picks yet.</div>'}</div></div>
    <div class="dboard">${grid}</div></div>`;
  if (!MK.done) {
    $('#mkAuto').onclick = () => { MK.auto = !MK.auto; if (MK.auto) runCpu(); else drawMock(); };
    $('#mkReset').onclick = () => { MK = null; drawMock(); };
    $$('[data-mk]', body).forEach(el => el.addEventListener('click', e => { if (!mine || e.target.closest('.ph')) return; const p = P[el.dataset.mk]; makePick(p, el); drawMock(); setTimeout(runCpu, 250); }));
  }
  { const cur = $(`#mkCell${n}`), box = $('.dboard'); if (cur && box) { const cr = cur.getBoundingClientRect(), br = box.getBoundingClientRect(); box.scrollTop += cr.top - br.top - br.height / 2; box.scrollLeft += cr.left - br.left - br.width / 2; } }
}
function finishMock() {
  // grade: each team's best lineup-ish value (top QB/RB/WR/TE weighted) + bench depth
  const need = MK.fmt === 'sf' ? { QB: 2, RB: 3, WR: 4, TE: 1 } : { QB: 1, RB: 3, WR: 4, TE: 1 };
  const score = ros => { let s = 0; const by = { QB: [], RB: [], WR: [], TE: [] }; for (const p of ros) by[p.pos].push(HQ.boardValue(p.id)); for (const k in by) { by[k].sort((a, b) => b - a); by[k].forEach((v, i) => s += v * (i < need[k] ? 1 : .35)); } return s; };
  const sc = MK.rosters.map((r, i) => ({ i, s: score(r) })).sort((a, b) => b.s - a.s);
  const myRank = sc.findIndex(x => x.i === MK.slot) + 1, pct = 1 - (myRank - 1) / (MK.teams - 1);
  const grade = pct >= .9 ? 'A+' : pct >= .75 ? 'A' : pct >= .6 ? 'B+' : pct >= .45 ? 'B' : pct >= .3 ? 'C+' : pct >= .15 ? 'C' : 'D';
  $('#mkGrade').innerHTML = `<div class="eyebrow">Draft complete</div><div class="row" style="align-items:flex-end;gap:18px"><div class="gradebig">${grade}</div><div><div style="font:800 22px/1.1 var(--font-display);text-transform:uppercase">#${myRank} of ${MK.teams}</div><div class="sub">by your board's values, starters weighted</div></div></div>
    <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>Team</th><th class="r">Roster value</th></tr></thead><tbody>${sc.map((x, k) => `<tr class="${x.i === MK.slot ? 'me' : ''}"><td>${k + 1}</td><td>${x.i === MK.slot ? 'You' : 'Team ' + (x.i + 1)}</td><td class="r num">${Math.round(x.s).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn gold" id="mkAgain">Run it back</button></div>`;
  $('#mkAgain').onclick = mkStart;
  const r = $('#mkGrade').getBoundingClientRect(); if (pct >= .6) { confetti(r.left + 80, r.top + 60, 140, 1.3); }
  const hist = ST.get('mockHist', []); hist.unshift({ d: new Date().toISOString().slice(0, 10), grade, rank: myRank, teams: MK.teams, fmt: MK.fmt }); ST.set('mockHist', hist.slice(0, 20));
  if (!ST.get('checks', {}).mock3 && hist.length >= 3) { const c = ST.get('checks', {}); c.mock3 = true; ST.set('checks', c); }
}
$('#mkStart').onclick = async () => { await ensureBoard(); mkStart(); };
async function renderMock() { await ensureBoard(); if (!MK) drawMock(); }

/* =================== DYNASTY PLAN =================== */
const NFL_DRAFT_27 = Date.UTC(2027, 3, 23, 0), KICK_27 = Date.UTC(2027, 8, 10, 0, 20);
let cdTimer;
const WATCH_SEED = [
  { name: 'Arch Manning', pos: 'QB', school: 'Texas', tier: 1 }, { name: 'Jeremiah Smith', pos: 'WR', school: 'Ohio State', tier: 1 },
  { name: 'Ryan Williams', pos: 'WR', school: 'Alabama', tier: 1 }, { name: 'Cam Coleman', pos: 'WR', school: 'Auburn', tier: 2 },
  { name: 'Ahmad Hardy', pos: 'RB', school: 'Missouri', tier: 2 }, { name: 'Isaac Brown', pos: 'RB', school: 'Louisville', tier: 2 },
  { name: 'LaNorris Sellers', pos: 'QB', school: 'South Carolina', tier: 2 }, { name: 'Dante Moore', pos: 'QB', school: 'Oregon', tier: 2 }];
const CHECKS = [
  ['fmt', 'Decide the format: Superflex or 1QB, TE premium, PPR'], ['size', 'Lock in league size, roster spots and taxi squad'], ['date', 'Pick the startup draft date'],
  ['targets', 'Star 15+ targets on the Dynasty Board'], ['mock3', 'Run three mock startups'], ['strategy', 'Choose a startup strategy and stick to it'],
  ['rookies', 'Track the 2027 rookie class through bowl season'], ['picks', 'Decide how much you value 2027 vs 2028 picks'], ['rules', 'Write the league rules (copy what works from the basketball rulebook)']];
function renderPlan() {
  ensureBoard().then(() => { drawStrats(); });
  const sd = ST.get('startupDate', '');
  $('#planCds').innerHTML = `
    <div class="card hash reveal"><div class="eyebrow">2027 NFL Draft · est. Apr 22–24</div><div class="cd" id="cd1">–</div><div class="sub">The rookie class lands. Rookie ADP goes crazy right after.</div></div>
    <div class="card hash reveal"><div class="eyebrow">Your dynasty startup</div><div class="cd" id="cd2">${sd ? '–' : 'SET A DATE'}</div><div class="row" style="margin-top:8px"><label class="vh" for="sdDate">Startup draft date</label><input type="date" id="sdDate" value="${esc(sd)}"><span class="sub">Saved in this browser.</span></div></div>
    <div class="card hash reveal"><div class="eyebrow">2027 NFL kickoff · est. Sep 9</div><div class="cd" id="cd3">–</div><div class="sub">Year one of the dynasty. Contend or rebuild from day one.</div></div>`;
  $('#sdDate').onchange = e => { ST.set('startupDate', e.target.value); if (e.target.value) { const c = ST.get('checks', {}); c.date = true; ST.set('checks', c); drawChecks(); } tickCd(); };
  clearInterval(cdTimer); cdTimer = setInterval(tickCd, 1000); tickCd();
  drawBlueprint(); drawAgeSvg(); drawWatch(); drawChecks(); reveal($('#v-plan'));
}
function tickCd() {
  if (G.view !== 'plan') return clearInterval(cdTimer);
  $('#cd1').textContent = fmtCountdown(NFL_DRAFT_27); $('#cd3').textContent = fmtCountdown(KICK_27);
  const sd = ST.get('startupDate', ''); if (sd) { const [y, m, d] = sd.split('-').map(Number); $('#cd2').textContent = fmtCountdown(new Date(y, m - 1, d, 19).getTime()); }
}
function drawBlueprint() {
  const bp = Object.assign({ teams: 12, qb: DS.fmt, tep: DS.tep, ppr: 1, taxi: 4, rr: 4 }, ST.get('blueprint', {}));
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
  $('#blueprint').innerHTML = `<div class="head"><h3>League blueprint</h3><span class="sp"></span><span class="tag rk">syncs to your board</span></div>
    <div class="sub">Set up the league you're joining next year. Format and TE premium flow straight into the Dynasty Board, Trade Lab and mocks.</div>
    <div class="grid g3" style="margin-top:12px;gap:10px">
      <label class="f">Teams${sel('bpTeams', [[8, '8'], [10, '10'], [12, '12'], [14, '14']], bp.teams)}</label>
      <label class="f">QB format${sel('bpQb', [['sf', 'Superflex'], ['1qb', '1QB']], bp.qb)}</label>
      <label class="f">Scoring${sel('bpPpr', [[1, 'PPR'], [.5, 'Half PPR'], [0, 'Standard']], bp.ppr)}</label>
      <label class="f">TE premium${sel('bpTep', [['true', 'Yes (+0.5/rec)'], ['false', 'No']], bp.tep)}</label>
      <label class="f">Taxi spots${sel('bpTaxi', [[0, 'None'], [3, '3'], [4, '4'], [5, '5']], bp.taxi)}</label>
      <label class="f">Rookie rounds${sel('bpRr', [[3, '3'], [4, '4'], [5, '5']], bp.rr)}</label>
    </div><div id="bpOut" style="margin-top:14px"></div>`;
  const out = () => {
    const b = { teams: +$('#bpTeams').value, qb: $('#bpQb').value, ppr: +$('#bpPpr').value, tep: $('#bpTep').value === 'true', taxi: +$('#bpTaxi').value, rr: +$('#bpRr').value };
    ST.set('blueprint', b); const changed = DS.fmt !== b.qb || DS.tep !== b.tep; DS.fmt = b.qb; DS.tep = b.tep; DS.teams = b.teams; saveDS(); if (changed) buildBoard();
    const qbs = BOARD.slice(0, 24).filter(p => p.pos === 'QB').length, rbs = BOARD.slice(0, 24).filter(p => p.pos === 'RB').length;
    const pts = [
      b.qb === 'sf' ? `<b>Superflex:</b> ${qbs} of the top 24 on your board are QBs. Plan on two starters by the end of round 3 or you'll pay a premium later.` : `<b>1QB:</b> only ${qbs} QBs crack the top 24. Wait on the position and hammer RB/WR early.`,
      b.tep ? '<b>TE premium:</b> tight end values are boosted 15%. An elite TE becomes a real edge.' : '<b>No TE premium:</b> tight ends beyond the elite tier are replaceable.',
      `<b>${b.teams} teams:</b> about ${b.teams * (b.qb === 'sf' ? 2 : 1)} starting QBs and ${b.teams * 2 + Math.round(b.teams * .8)} startable RBs will be rostered, so ${b.teams >= 12 ? 'depth matters. Bench stashes become trade chips' : 'the wire stays playable. Prioritize stars'}.`,
      `<b>Rookie drafts:</b> ${b.rr} rounds × ${b.teams} = ${b.rr * b.teams} rookies a year${b.taxi ? `, with ${b.taxi} taxi spots to stash them` : ''}.`,
      `<b>Running backs:</b> ${rbs} RBs in your top 24. They peak by 26, so buy young or rent veterans cheap.`];
    $('#bpOut').innerHTML = pts.map(x => `<div class="alert up"><span class="k">TIP</span><div>${x}</div></div>`).join('');
    if (G.view === 'plan') drawStrats();
  };
  $$('#blueprint select').forEach(s => s.onchange = () => { out(); const c = ST.get('checks', {}); c.fmt = true; c.size = true; ST.set('checks', c); drawChecks(); });
  ensureBoard().then(out);
}
function drawAgeSvg() {
  const svg = $('#ageSvg'), X = a => 40 + (a - 20) / 20 * 500, Y = v => 260 - v * 220;
  let h = `<g stroke="rgba(225,255,230,.1)">${[22, 24, 26, 28, 30, 32, 34, 36, 38].map(a => `<line x1="${X(a)}" x2="${X(a)}" y1="30" y2="260"/>`).join('')}</g>`;
  h += [22, 26, 30, 34, 38].map(a => `<text x="${X(a)}" y="282" fill="#86ab92" font-size="12" text-anchor="middle" font-family="Barlow">${a}</text>`).join('');
  h += `<text x="12" y="40" fill="#86ab92" font-size="11" font-family="Barlow">peak</text><text x="12" y="262" fill="#86ab92" font-size="11" font-family="Barlow">low</text>`;
  for (const pos of ['QB', 'RB', 'WR', 'TE']) { let d = ''; for (let a = 20; a <= 40; a += .25) d += (d ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(curveVal(pos, a)).toFixed(1); h += `<path class="c" d="${d}" stroke="${POS_COL[pos]}"/>`; }
  svg.innerHTML = h;
  svg.classList.remove('in'); new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { svg.classList.add('in'); o.disconnect(); } }), { threshold: .3 }).observe(svg);
}
const STRATS = [
  { k: 'bal', name: 'Balanced', emoji: '⚖️', hz: 0, d: 'Take the best value every pick. Compete year one while keeping young upside.' },
  { k: 'youth', name: 'Youth movement', emoji: '🌱', hz: 80, d: 'Load up on 21–24 year olds and future picks, then dominate years 2 to 5.' },
  { k: 'win', name: 'Win now', emoji: '🏆', hz: -80, d: 'Buy discounted vets for a title push now. Sell aging RBs before they fall off.' },
  { k: 'qb', name: 'QB-first', emoji: '🎯', hz: 20, fmt: 'sf', d: 'In Superflex, lock up two young franchise QBs. They hold value for a decade.' }];
function drawStrats() {
  const saved = { ...DS };
  const html = STRATS.map(s => {
    DS.hz = s.hz; if (s.fmt) DS.fmt = s.fmt; buildBoard();
    const top = (s.k === 'qb' ? BOARD.filter(p => p.pos === 'QB' && p._age < 27) : BOARD).slice(0, 5);
    Object.assign(DS, saved);
    return `<div class="card strat tilt reveal"><div style="font-size:30px">${s.emoji}</div><h3>${esc(s.name)}</h3><div class="sub">${esc(s.d)}</div><div class="top5">${top.map((p, i) => `${i + 1}. <a href="#" data-pid="${esc(p.id)}">${esc(p.name)}</a> <span class="pos ${p.pos}">${p.pos}</span>`).join('<br>')}</div><button class="btn small ${DS.hz === s.hz && (!s.fmt || DS.fmt === s.fmt) ? 'gold' : ''}" data-strat="${s.k}">${DS.hz === s.hz && (!s.fmt || DS.fmt === s.fmt) ? 'Applied ✓' : 'Apply to my board'}</button></div>`;
  }).join('');
  buildBoard();
  $('#strats').innerHTML = html;
  $$('#strats .tilt').forEach(el => tilt(el, 6)); reveal($('#strats'));
  $$('#strats [data-pid]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
  $$('#strats [data-strat]').forEach(b => b.onclick = e => { const s = STRATS.find(x => x.k === b.dataset.strat); DS.hz = s.hz; if (s.fmt) DS.fmt = s.fmt; saveDS(); buildBoard(); const c = ST.get('checks', {}); c.strategy = true; ST.set('checks', c); drawChecks(); drawStrats(); const r = b.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 50, .8); toast(`${s.name} applied to your Dynasty Board`); });
}
function drawWatch() {
  const list = ST.get('watch', null) || WATCH_SEED;
  $('#watchList').innerHTML = list.map((w, i) => `<div class="it"><span class="tier-pill" title="Tier">${w.tier || '–'}</span><div style="min-width:0"><b>${esc(w.name)}</b> <span class="pos ${esc(w.pos)}">${esc(w.pos)}</span><div class="sub" style="font-size:12.5px">${esc(w.school || '')}</div></div><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn small ghost" data-wt="${i}" aria-label="Change tier for ${esc(w.name)}">Tier ↻</button><button class="btn small ghost" data-wx="${i}" aria-label="Remove ${esc(w.name)}">✕</button></div></div>`).join('') || '<div class="sub">Empty list.</div>';
  $('#watchList').onclick = e => {
    const L = ST.get('watch', null) || WATCH_SEED.map(x => ({ ...x }));
    const t = e.target.closest('[data-wt]'), x = e.target.closest('[data-wx]');
    if (t) { const w = L[+t.dataset.wt]; w.tier = (w.tier || 0) % 3 + 1; }
    else if (x) L.splice(+x.dataset.wx, 1); else return;
    ST.set('watch', L); drawWatch();
  };
}
$('#wlForm').onsubmit = e => {
  e.preventDefault(); const L = ST.get('watch', null) || WATCH_SEED.map(x => ({ ...x }));
  L.push({ name: $('#wlName').value.trim(), pos: $('#wlPos').value, school: $('#wlSchool').value.trim(), tier: 2 }); ST.set('watch', L);
  $('#wlName').value = ''; $('#wlSchool').value = ''; drawWatch(); const c = ST.get('checks', {}); c.rookies = true; ST.set('checks', c); drawChecks();
};
function drawChecks() {
  const c = ST.get('checks', {}); if (Object.keys(FLAGS).filter(k => FLAGS[k] === 'T').length >= 15) c.targets = true;
  const done = CHECKS.filter(([k]) => c[k]).length, pct = Math.round(done / CHECKS.length * 100);
  $('#checklist').innerHTML = CHECKS.map(([k, t]) => `<label class="check ${c[k] ? 'done' : ''}"><input type="checkbox" data-ck="${k}" ${c[k] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('');
  $('#ckPct').textContent = pct + '%'; $('#ckBar').style.width = pct + '%'; $('#ckBall').style.left = `calc(${clamp(pct, 4, 96)}% )`;
  $$('#checklist input').forEach(i => i.onchange = () => { const cc = ST.get('checks', {}); cc[i.dataset.ck] = i.checked; ST.set('checks', cc); drawChecks(); if (i.checked) { const r = i.getBoundingClientRect(); confetti(r.left, r.top, 24, .6); if (CHECKS.every(([k]) => cc[k])) popText(innerWidth / 2, innerHeight / 2, 'DYNASTY READY!', '#facc15', 64); } });
}

Object.assign(renderers, { dynasty: renderDynasty, trade: renderTrade, mock: renderMock, plan: renderPlan });
})();
