/* Basketball HQ — Season tab: Sleeper NBA leagues, calendar, Lock-In helper, lottery drum.
   Lives alongside the Draft HQ code; it only touches #v-season and exposes window.renderSeason for the tab router. */
(() => {
const { esc, clamp, rand, reduced, store, sleeper, confetti, popText, fmtCountdown } = FX;
const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));

/* ---------- countdowns (ET) ---------- */
const OPEN = Date.UTC(2026, 9, 20, 23, 30), TD = Date.UTC(2027, 2, 8, 4, 59), PO = Date.UTC(2027, 2, 15, 4), CH = Date.UTC(2027, 3, 5, 3, 59);
const tick = () => { q('#ssOpen').textContent = fmtCountdown(OPEN); q('#ssTd').textContent = fmtCountdown(TD); q('#ssPo').textContent = fmtCountdown(PO); q('#ssCh').textContent = fmtCountdown(CH); };
tick(); setInterval(tick, 1000);

/* ---------- Sleeper NBA leagues (username shared with Football HQ) ---------- */
const NBA = {}; for (const r of (window.NBA_SNAP || [])) NBA[r[0]] = { id: r[0], name: r[1], pos: r[2], team: r[3], rank: r[4] };
const pn = id => NBA[id] || { id, name: 'Player ' + id, pos: '', team: '' };
let loaded = false;
async function loadLeagues(silent = false) {
  const box = q('#ssLeagues'), ST = store('ffhq_');
  const name = ST.get('username', '');
  if (!name) {
    box.innerHTML = `<div class="card ss-empty"><h3>Connect Sleeper</h3><p class="sub">Enter your Sleeper username to see your NBA leagues here. It's the same one Football HQ uses.</p>
      <form class="row" id="ssCn" style="justify-content:center"><label class="vh" for="ssName">Sleeper username</label><input type="text" id="ssName" placeholder="Sleeper username" required><button class="btn primary" type="submit">Load leagues</button></form></div>`;
    q('#ssCn').onsubmit = e => { e.preventDefault(); const v = q('#ssName').value.trim(); if (v) { ST.set('username', v); loadLeagues(); } };
    return;
  }
  if (!silent) box.innerHTML = '<div class="empty-note">Loading your leagues…</div>';
  const fresh = silent;
  try {
    const st = await sleeper('/v1/state/nba', { ttl: 30 * 60e3, fresh });
    const u = await sleeper(`/v1/user/${encodeURIComponent(name)}`);
    if (!u || !u.user_id) throw new Error('user');
    const ls = await sleeper(`/v1/user/${u.user_id}/leagues/nba/${st.season}`, { fresh });
    if (!ls.length) { box.innerHTML = `<div class="card ss-empty"><h3>No ${st.season} NBA leagues on ${esc(name)} yet</h3><p class="sub">Once the dynasty league is created on Sleeper it shows up here automatically.</p></div>`; return; }
    const regular = st.season_type === 'regular';
    const cards = await Promise.all(ls.map(async lg => {
      const [rosters, users, mu] = await Promise.all([sleeper(`/v1/league/${lg.league_id}/rosters`, { fresh }), sleeper(`/v1/league/${lg.league_id}/users`), regular ? sleeper(`/v1/league/${lg.league_id}/matchups/${st.week}`, { fresh }).catch(() => []) : Promise.resolve([])]);
      const um = {}; for (const x of users) um[x.user_id] = x;
      const tn = r => { const x = um[r && r.owner_id]; return (x && x.metadata && x.metadata.team_name) || (x && x.display_name) || 'Team ' + (r ? r.roster_id : '?'); };
      const mine = rosters.find(r => r.owner_id === u.user_id || (r.co_owners || []).includes(u.user_id));
      const S = rosters.map(r => ({ r, w: (r.settings || {}).wins || 0, pf: ((r.settings || {}).fpts || 0) })).sort((a, b) => b.w - a.w || b.pf - a.pf);
      const rank = mine ? S.findIndex(x => x.r === mine) + 1 : null;
      const me = mine && mu.find(m => m.roster_id === mine.roster_id), opp = me && mu.find(m => m.matchup_id === me.matchup_id && m.roster_id !== me.roster_id);
      const top = mine ? (mine.players || []).map(pn).sort((a, b) => (a.rank || 9e9) - (b.rank || 9e9)).slice(0, 8) : [];
      const status = lg.status === 'pre_draft' ? 'Pre-draft' : lg.status === 'drafting' ? 'Drafting' : (lg.settings && lg.settings.type === 2) ? 'Dynasty' : 'In season';
      return `<div class="card"><div class="row"><h3 style="margin:0">${esc(lg.name)}</h3><span class="spacer"></span><span class="pill">${status}</span></div>
        ${me ? `<div class="ss-vs"><div><div class="sub">${esc(tn(mine))}</div><b class="me">${(me.points || 0).toFixed(1)}</b></div><span class="sub">VS</span><div style="text-align:right"><div class="sub">${esc(opp ? tn(rosters.find(r => r.roster_id === opp.roster_id)) : 'Bye')}</div><b>${opp ? (opp.points || 0).toFixed(1) : '–'}</b></div></div>`
          : `<p class="sub" style="margin:10px 0">${regular ? 'No matchup this week.' : `Season tips off Oct 20 (${fmtCountdown(OPEN)}).`}</p>`}
        <div class="ss-stats"><div><span>Record</span><b>${mine ? `${(mine.settings || {}).wins || 0}-${(mine.settings || {}).losses || 0}` : '–'}</b></div><div><span>Rank</span><b>${rank ? `#${rank}/${rosters.length}` : '–'}</b></div><div><span>Roster</span><b>${mine ? (mine.players || []).length : 0}</b></div><div><span>FAAB left</span><b>${mine && lg.settings && lg.settings.waiver_budget != null ? '$' + (lg.settings.waiver_budget - ((mine.settings || {}).waiver_budget_used || 0)) : '–'}</b></div></div>
        ${top.length ? `<div class="eyebrow" style="margin:14px 0 6px">Your core</div><div class="sub" style="line-height:1.8">${top.map(p => `<b style="color:var(--ink)">${esc(p.name)}</b> <span class="team">${esc(p.team)}</span>`).join(' · ')}</div>` : ''}
        <div class="row" style="margin-top:12px"><a class="btn small" href="https://sleeper.com/leagues/${esc(lg.league_id)}" target="_blank" rel="noopener">Open in Sleeper ↗</a><span class="spacer"></span><button class="btn small ghost" data-ss-switch>Switch user</button></div></div>`;
    }));
    box.innerHTML = `<div class="grid g2">${cards.join('')}</div>`;
    qa('[data-ss-switch]').forEach(b => b.onclick = () => { store('ffhq_').del('username'); loadLeagues(); });
  } catch (e) { box.innerHTML = `<div class="card ss-empty"><h3>Couldn't load leagues</h3><p class="sub">Sleeper didn't answer, or there's no user named "${esc(name)}".</p><button class="btn small" data-ss-switch>Try another username</button></div>`; qa('[data-ss-switch]').forEach(b => b.onclick = () => { store('ffhq_').del('username'); loadLeagues(); }); }
}
q('#ssRefresh').onclick = () => loadLeagues(true);
// Live scores: refresh every minute while the Season tab is open and the page is visible.
setInterval(() => { if (loaded && document.visibilityState === 'visible' && q('#v-season').classList.contains('on') && store('ffhq_').get('username', '')) loadLeagues(true); }, 60e3);

/* ---------- calendar timeline ---------- */
function drawTimeline() {
  const start = Date.UTC(2026, 9, 20), end = Date.UTC(2027, 3, 5);
  const pts = [[Date.UTC(2026, 9, 20), 'Opening night', 'Oct 20'], [Date.UTC(2026, 11, 25), 'Christmas slate', 'Dec 25'], [Date.UTC(2027, 2, 7), 'Trade deadline', 'Mar 7'], [Date.UTC(2027, 2, 15), 'Quarterfinals', 'Mar 15–21'], [Date.UTC(2027, 2, 22), 'Semifinals', 'Mar 22–28'], [Date.UTC(2027, 2, 29), 'Championship', 'Mar 29–Apr 4']];
  const pos = t => clamp((t - start) / (end - start), 0, 1) * 100, now = pos(Date.now());
  q('#ssTimeline').innerHTML = `<div class="track"></div><div class="fill" id="ssFill"></div>${pts.map(([t, b, s], i) => `<div class="mk ${i % 2 ? 'up' : ''}" style="left:${pos(t)}%"><i></i><b>${b}</b><small>${s}</small></div>`).join('')}<div class="now" id="ssNow" style="left:0">TODAY</div>`;
  q('#ssTlPct').textContent = Date.now() < start ? `Starts in ${Math.ceil((start - Date.now()) / 864e5)} days` : `${Math.round(now)}% of the season played`;
  setTimeout(() => { q('#ssFill').style.width = now + '%'; q('#ssNow').style.left = now + '%'; }, 200);
}

/* ---------- Lock or roll: optimal stopping with normally distributed games ---------- */
const nphi = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function ncdf(x) { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
const emax = (mu, sd, c) => { const z = (mu - c) / sd; return mu * ncdf(z) + c * ncdf(-z) + sd * nphi(z); };
function lockCalc() {
  const s = +q('#ssScore').value || 0, mu = Math.max(1, +q('#ssAvg').value || 1), k = +q('#ssLeft').value, sd = mu * .28;
  let W = mu; for (let i = 2; i <= k; i++) W = emax(mu, sd, W);
  const lo = mu * .3, hi = mu * 1.9, P = v => clamp((v - lo) / (hi - lo), 0, 1) * 100;
  q('#ssMark').style.left = P(s) + '%'; q('#ssLine').style.left = (k ? P(W) : 0) + '%'; q('#ssLine').style.opacity = k ? 1 : 0;
  const v = q('#ssVerdict'), why = q('#ssWhy');
  if (k === 0) { v.textContent = 'It counts anyway'; v.style.color = 'var(--ink)'; why.textContent = 'That was his last game this week, so it counts automatically whether you lock it or not.'; return; }
  if (s >= W) { v.textContent = '🔒 Lock it in'; v.style.color = 'var(--good-ink)'; why.innerHTML = `Waiting is worth about <b>${W.toFixed(1)}</b> with ${k} game${k > 1 ? 's' : ''} left. ${s.toFixed(1)} beats that, so bank it.`; }
  else { v.textContent = '🎲 Roll it'; v.style.color = 'var(--accent-text)'; why.innerHTML = `Waiting is worth about <b>${W.toFixed(1)}</b> with ${k} game${k > 1 ? 's' : ''} left. ${s.toFixed(1)} is below that, so let him play again.`; }
}
['ssScore', 'ssAvg', 'ssLeft'].forEach(id => q('#' + id).addEventListener('input', lockCalc));

/* ---------- lottery drum ---------- */
const LS = store('bbhq_');
const TEAMS = [{ k: '10th', odds: 40, c: '#ff7a2e' }, { k: '9th', odds: 30, c: '#facc15' }, { k: '8th', odds: 20, c: '#38bdf8' }, { k: '7th', odds: 10, c: '#a3e635' }];
const names = LS.get('lotNames', TEAMS.map(t => `${t.k} place`));
q('#ssLotTeams').innerHTML = TEAMS.map((t, i) => `<div class="ss-lotteam"><i style="background:${t.c}"></i><label class="vh" for="sslt${i}">Team that finished ${t.k}</label><input type="text" id="sslt${i}" value="${esc(names[i])}"><span>${t.odds}%</span></div>`).join('');
qa('#ssLotTeams input').forEach((inp, i) => inp.oninput = () => { names[i] = inp.value || `${TEAMS[i].k} place`; LS.set('lotNames', names); });
const cv = q('#ssDrum'), ctx = cv.getContext('2d'); let S = 0, balls = [], ang = 0, spin = .01, drawing = false, ejected = null, drumOn = false;
function fitDrum() { const d = devicePixelRatio || 1, r = cv.getBoundingClientRect(); if (!r.width) return; S = r.width; cv.width = S * d; cv.height = S * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
function resetBalls() { balls = []; TEAMS.forEach((t, ti) => { for (let i = 0; i < t.odds / 2.5; i++) balls.push({ ti, x: rand(-.5, .5), y: rand(0, .6), vx: rand(-.01, .01), vy: 0 }); }); }
resetBalls(); addEventListener('resize', fitDrum);
function drumFrame() {
  if (!drumOn) return;
  if (!S) fitDrum();
  const R = S * .42, cx = S / 2, cy = S / 2, br = S * .028;
  ctx.clearRect(0, 0, S, S); ang += spin;
  ctx.save(); ctx.translate(cx, cy);
  const g = ctx.createRadialGradient(-R * .3, -R * .4, R * .1, 0, 0, R); g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,.03)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,220,.55)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,220,.15)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const a = ang + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * .2, Math.sin(a) * R * .2); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
  const rr = (R - br) / R;
  for (const b of balls) {
    b.vy += drawing ? .0025 : .0012; b.vx *= .995; b.vy *= .995;
    if (drawing) { b.vx += Math.cos(ang * 7 + b.ti) * .0018 * rand(.5, 1.5); b.vy -= rand(0, .004); }
    b.x += b.vx; b.y += b.vy;
    const d = Math.hypot(b.x, b.y); if (d > rr) { const nx = b.x / d, ny = b.y / d; b.x = nx * rr; b.y = ny * rr; const dot = b.vx * nx + b.vy * ny; b.vx -= 1.9 * dot * nx; b.vy -= 1.9 * dot * ny; b.vx += -ny * spin * 3; b.vy += nx * spin * 3; }
  }
  for (const b of balls) { const x = b.x * R, y = b.y * R, gg = ctx.createRadialGradient(x - br * .35, y - br * .35, 1, x, y, br); gg.addColorStop(0, '#fff'); gg.addColorStop(.35, TEAMS[b.ti].c); gg.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, br, 0, 7); ctx.fill(); }
  if (ejected) { ejected.t += .03; const k = Math.min(1, ejected.t), y = -R * (.2 + k * 1.05), sc = 1 + k * 1.4; ctx.fillStyle = TEAMS[ejected.ti].c; ctx.shadowColor = TEAMS[ejected.ti].c; ctx.shadowBlur = 24; ctx.beginPath(); ctx.arc(0, y, br * sc, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
  ctx.restore();
  requestAnimationFrame(drumFrame);
}
const sleep = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));
function drawOrder() { const left = TEAMS.map((t, i) => i), out = []; while (left.length) { const tot = left.reduce((s, i) => s + TEAMS[i].odds, 0); let r = Math.random() * tot, j = 0; while (r > TEAMS[left[j]].odds) { r -= TEAMS[left[j]].odds; j++; } out.push(left.splice(j, 1)[0]); } return out; }
q('#ssLotDraw').onclick = async () => {
  const btn = q('#ssLotDraw'); btn.disabled = true; resetBalls(); q('#ssLotRes').innerHTML = ''; spin = .05; drawing = true;
  const order = drawOrder();
  for (let p = 0; p < 4; p++) {
    await sleep(1500);
    const ti = order[p]; ejected = { ti, t: 0 }; await sleep(900);
    balls = balls.filter(b => b.ti !== ti); ejected = null;
    q('#ssLotRes').insertAdjacentHTML('beforeend', `<div class="ss-lotcard"><span class="n">#${p + 1}</span><i style="background:${TEAMS[ti].c}"></i><div><b>${esc(names[ti])}</b><div class="sub" style="font-size:12px">finished ${TEAMS[ti].k} · ${TEAMS[ti].odds}% odds at #1</div></div></div>`);
    if (p === 0) { const r = cv.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height * .2, 90, 1.1); popText(r.left + r.width / 2, r.top + 40, `#1: ${names[ti].toUpperCase()}`, TEAMS[ti].c, 34); }
  }
  spin = .01; drawing = false; resetBalls(); btn.disabled = false;
};
q('#ssLotSim').onclick = () => {
  const N = 10000, cnt = TEAMS.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) drawOrder().forEach((ti, p) => cnt[ti][p]++);
  q('#ssLotSimOut').innerHTML = `<div class="tablewrap" style="margin-top:12px;max-height:none"><table><thead><tr><th>Team</th><th class="r">#1</th><th class="r">#2</th><th class="r">#3</th><th class="r">#4</th></tr></thead><tbody>${TEAMS.map((t, ti) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.c};margin-right:8px"></i>${esc(names[ti])}</td>${cnt[ti].map(c => `<td class="r num">${(c / N * 100).toFixed(1)}%</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="sub" style="margin-top:6px">The worst team lands #1 about 40% of the time and still falls to #4 about ${(cnt[0][3] / N * 100).toFixed(0)}% of the time.</div>`;
};

/* ---------- tab hook ---------- */
window.renderSeason = () => {
  if (!loaded) { loaded = true; loadLeagues(); drawTimeline(); lockCalc(); }
  fitDrum(); if (!drumOn && !reduced) { drumOn = true; requestAnimationFrame(drumFrame); }
};
// Stop the drum animation when another tab is open.
new MutationObserver(() => { const on = q('#v-season').classList.contains('on'); if (!on) drumOn = false; else if (!drumOn) window.renderSeason(); }).observe(q('#v-season'), { attributes: true, attributeFilter: ['class'] });

/* ---------- deep links: #season, #draft, #board … open that tab ---------- */
const openHash = () => { const v = location.hash.slice(1), b = v && document.querySelector(`#tabs button[data-v="${CSS.escape(v)}"]`); if (b) b.click(); };
addEventListener('hashchange', openHash);
openHash();
})();
