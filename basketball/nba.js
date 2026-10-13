/* Basketball HQ — in-season tools ported from Football HQ: Gameday (live matchups, alerts, standings, roster),
   Start/Sit (Lock-In lineup optimizer) and Waivers. Everything is live from Sleeper's public API.
   Lives beside the Draft HQ code and only touches #v-gameday, #v-nbass and #v-nbawv. */
(() => {
const { esc, clamp, reduced, store, sleeper, popText, fmtCountdown } = FX;
const q = s => document.querySelector(s), qa = (s, r = document) => Array.from(r.querySelectorAll(s));
const ST = store('ffhq_'), BS = store('bbhq_');
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const POSC = { PG: '#3987e5', SG: '#d95926', SF: '#199e70', PF: '#c98500', C: '#d55181' };
const SLEEPER_SC = { pts: .5, reb: 1, ast: 1, stl: 2, blk: 2, to: -1, tpm: .5, dd: 1, td: 2, bonus_pt_40p: 2, bonus_pt_50p: 2, tf: -2, ff: -2 };
const draftSC = () => { try { return Object.assign({}, SLEEPER_SC, JSON.parse(localStorage.getItem('ddhq3_scoring_v2') || '{}')); } catch (e) { return SLEEPER_SC; } };
const ELIG = { PG: ['PG'], SG: ['SG'], G: ['PG', 'SG'], SF: ['SF'], PF: ['PF'], F: ['SF', 'PF'], C: ['C'], UTIL: ['PG', 'SG', 'SF', 'PF', 'C'] };

/* ---------- state + loaders ---------- */
const N = { st: null, season: '2026', sched: [], week: 1, regular: false, players: null, s25: {}, s26: {}, user: null, leagues: [], sel: BS.get('sel', null), trend: null, last: 0, timer: null, busy: false };
const today = () => new Date().toISOString().slice(0, 10);
async function loadCore(fresh = false) {
  N.st = await sleeper('/v1/state/nba', { ttl: 15 * 60e3, fresh }); N.season = N.st.season;
  try { N.sched = await sleeper(`/schedule/nba/regular/${N.season}`, { ttl: 30 * 60e3, fresh }); } catch (e) { if (!fresh) N.sched = []; }
  N.regular = N.st.season_type === 'regular';
  const open = N.sched.filter(g => g.status !== 'complete').map(g => g.week);
  N.week = N.regular ? (open.length ? Math.min(...open) : N.st.week) : (open.length ? Math.min(...open) : 1);
}
async function loadPlayers() {
  if (N.players) return N.players;
  const raw = await sleeper('/v1/players/nba').catch(() => ({}));
  const m = {};
  for (const [id, p] of Object.entries(raw)) if (p && (p.team || p.active)) m[id] = { id, name: p.full_name || `${p.first_name} ${p.last_name}`, pos: (p.fantasy_positions || [p.position]).filter(Boolean), team: p.team || 'FA', inj: p.injury_status || null, rank: p.search_rank || 9e6 };
  return (N.players = m);
}
async function loadStats() {
  const grab = async (yr, fresh) => { try { const a = await sleeper(`/stats/nba/${yr}?season_type=regular`, { fresh }); const m = {}; for (const x of a) if (x.stats && x.stats.gp) m[x.player_id] = x.stats; return m; } catch (e) { return {}; } };
  if (!Object.keys(N.s25).length) N.s25 = await grab(+N.season - 1);
  N.s26 = await grab(N.season, true);
}
const pl = id => (N.players && N.players[id]) || { id, name: 'Player ' + id, pos: [], team: 'FA', inj: null };
const DATA_BY_SID = {}; try { for (const p of DATA.players) if (p.sid) DATA_BY_SID[p.sid] = p; } catch (e) {}

/* Points per game in a league's scoring: last season's per-game line (or the Draft HQ's rookie line),
   blended toward this season's actual per-game as games pile up. */
function perGame(stats) { const g = stats.gp || 1, o = {}; for (const k in stats) if (typeof stats[k] === 'number') o[k] = stats[k] / g; return o; }
const score = (pg, sc) => { let t = 0; for (const k in sc) if (pg[k]) t += pg[k] * sc[k]; return t; };
// Small samples get pulled toward a bench-level 8 FPPG so a 4-game hot streak does not top the waiver list.
const shrink = (v, gp) => gp >= 25 ? v : (v * gp + 8 * 10) / (gp + 10);
function fppg(id, sc) {
  let base = null;
  const d = DATA_BY_SID[id];
  if (N.s25[id] && N.s25[id].gp >= 10) base = shrink(score(perGame(N.s25[id]), sc), N.s25[id].gp);
  else if (d) base = score(d, sc);
  else if (N.s25[id]) base = shrink(score(perGame(N.s25[id]), sc), N.s25[id].gp);
  const cur = N.s26[id];
  if (cur && cur.gp) { const now = score(perGame(cur), sc); if (base == null) return shrink(now, cur.gp); const w = cur.gp / (cur.gp + 8); return base * (1 - w) + now * w; }
  return base || 0;
}

/* ---------- Lock-In math ---------- */
const nphi = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function ncdf(x) { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
const emax = (mu, sd, c) => { const z = (mu - c) / sd; return mu * ncdf(z) + c * ncdf(-z) + sd * nphi(z); };
// Value of a Lock-In week with n games left: you can lock any game, the last one counts if you never lock.
function lockVal(mu, n) { if (n <= 0 || mu <= 0) return 0; const sd = mu * .28; let W = mu; for (let i = 2; i <= n; i++) W = emax(mu, sd, W); return W; }
function weekGames(team, w) { const gs = N.sched.filter(g => g.week === w && (g.home.team === team || g.away.team === team)); return { total: gs.length, left: gs.filter(g => g.status !== 'complete').length, live: gs.some(g => g.status === 'in_game' || g.status === 'in_progress') }; }
const isOut = s => /^(out|ir|sus|na|inact)/i.test(s || '');
function evalP(id, L, w) {
  const p = pl(id), mu = fppg(id, L.sc), g = weekGames(p.team, w), n = w === N.week ? g.left : g.total;
  let v = lockVal(mu, n), flag = null;
  if (isOut(p.inj)) { v = 0; flag = 'OUT'; } else if (/dtd|quest|gtd|doubt/i.test(p.inj || '')) { v *= .85; flag = 'DTD'; }
  if (!flag && n === 0) flag = 'NO GAMES';
  return { id, p, mu, n, v, flag };
}

/* ---------- leagues ---------- */
async function loadLeagues(fresh = false) {
  const name = ST.get('username', '');
  if (!name) { N.user = null; N.leagues = []; return; }
  const u = await sleeper(`/v1/user/${encodeURIComponent(name)}`); if (!u || !u.user_id) throw new Error('user');
  N.user = u;
  const ls = await sleeper(`/v1/user/${u.user_id}/leagues/nba/${N.season}`, { fresh });
  N.leagues = await Promise.all(ls.map(async lg => {
    const [rosters, users, mu] = await Promise.all([sleeper(`/v1/league/${lg.league_id}/rosters`, { fresh }), sleeper(`/v1/league/${lg.league_id}/users`), N.regular ? sleeper(`/v1/league/${lg.league_id}/matchups/${N.week}`, { fresh }).catch(() => []) : Promise.resolve([])]);
    const um = {}; for (const x of users) um[x.user_id] = x;
    const teamName = r => { const x = um[r && r.owner_id]; return (x && x.metadata && x.metadata.team_name) || (x && x.display_name) || 'Team ' + (r ? r.roster_id : '?'); };
    const mine = rosters.find(r => r.owner_id === u.user_id || (r.co_owners || []).includes(u.user_id));
    const S = rosters.map(r => { const s = r.settings || {}; return { rid: r.roster_id, name: teamName(r), w: s.wins || 0, l: s.losses || 0, pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100, me: !!(mine && r.roster_id === mine.roster_id) }; }).sort((a, b) => b.w - a.w || a.l - b.l || b.pf - a.pf);
    S.forEach((s, i) => s.rank = i + 1);
    const sc = lg.scoring_settings && Object.keys(lg.scoring_settings).length ? lg.scoring_settings : draftSC();
    return { id: lg.league_id, name: lg.name, lg, status: lg.status, sc, slots: (lg.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s)), rosters, teamName, mine, standings: S, matchups: mu || [],
      myIds: mine ? (mine.players || []) : [], starters: mine ? (mine.starters || []) : null, ir: (mine && mine.reserve) || [], taxi: (mine && mine.taxi) || [], me: S.find(s => s.me), playoff: (lg.settings && lg.settings.playoff_teams) || 6 };
  }));
}
const lgSel = () => N.leagues.find(l => l.id === N.sel) || N.leagues[0] || null;
const drafted = L => L.status !== 'pre_draft' && L.status !== 'drafting' && L.myIds.length > 0;
function chipsInto(el, after) {
  if (N.leagues.length < 2) { el.innerHTML = ''; return; }
  const cur = lgSel();
  el.innerHTML = N.leagues.map(L => `<button data-id="${esc(L.id)}" class="${cur && cur.id === L.id ? 'on' : ''}">${esc(L.name)}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; N.sel = b.dataset.id; BS.set('sel', N.sel); after(); };
}
const ph = p => `<span class="ph sm" data-i="${esc(p.name.split(' ').map(s => s[0]).slice(0, 2).join(''))}" style="--pc:${POSC[p.pos[0]] || 'var(--border)'}"><img src="https://sleepercdn.com/content/nba/players/thumb/${esc(p.id)}.jpg" alt="" loading="lazy" onerror="this.remove()"></span>`;
const injTag = s => s ? `<span class="tag ${isOut(s) ? 'inj' : 'est'}">${esc(String(s).toUpperCase())}</span>` : '';
const posChips = p => p.pos.map(x => `<span class="nb-pos" style="--pc:${POSC[x] || '#888'}">${esc(x)}</span>`).join('');
const pcell = (p, extra = '') => `<div class="pcell nb-pc">${ph(p)}<div style="min-width:0"><div class="pname">${esc(p.name)} ${injTag(p.inj)}</div><div class="pmeta">${posChips(p)} <span class="team">${esc(p.team)}</span> ${extra}</div></div></div>`;

/* ---------- optimizer ---------- */
function optimize(L, w) {
  const usable = L.myIds.filter(id => !L.ir.includes(id) && !L.taxi.includes(id)).map(id => evalP(id, L, w));
  const res = new Array(L.slots.length).fill(null), used = new Set();
  const order = L.slots.map((s, i) => ({ s, i, n: (ELIG[s] || []).length || 99 })).sort((a, b) => a.n - b.n);
  for (const o of order) { const el = ELIG[o.s]; if (!el) continue; let best = null; for (const e of usable) { if (used.has(e.id) || !e.p.pos.some(x => el.includes(x))) continue; if (!best || e.v > best.v) best = e; } if (best) { used.add(best.id); res[o.i] = best; } }
  if (L.starters) for (let pass = 0; pass < 2; pass++) for (let i = 0; i < res.length; i++) {
    const c = L.starters[i]; if (!c || c === '0' || !res[i] || res[i].id === c) continue;
    const j = res.findIndex(e => e && e.id === c); if (j < 0) continue;
    const a = res[i], b = res[j], ei = ELIG[L.slots[i]], ej = ELIG[L.slots[j]];
    if (ei && ej && b.p.pos.some(x => ei.includes(x)) && a.p.pos.some(x => ej.includes(x))) { res[i] = b; res[j] = a; }
  }
  const cur = L.starters ? L.slots.map((s, i) => { const id = L.starters[i]; return id && id !== '0' ? evalP(id, L, w) : null; }) : null;
  const sum = a => a.reduce((t, e) => t + (e ? e.v : 0), 0);
  return { lineup: res, cur, bench: usable.filter(e => !used.has(e.id)).sort((a, b) => b.v - a.v), best: sum(res), now: cur ? sum(cur) : null };
}

/* ---------- matchups ---------- */
function liveProj(entry, L) {
  let tot = 0, rem = 0;
  (entry.starters || []).forEach((id, i) => {
    if (!id || id === '0') return;
    const pts = (entry.starters_points || [])[i] || 0, p = pl(id), g = weekGames(p.team, N.week);
    if (!g.left || isOut(p.inj)) tot += pts; else { tot += Math.max(pts, lockVal(fppg(id, L.sc), g.left)); rem++; }
  });
  return { proj: tot, rem };
}
function matchupOf(L) {
  if (!L.mine || !L.matchups.length) return null;
  const me = L.matchups.find(m => m.roster_id === L.mine.roster_id); if (!me) return null;
  const opp = me.matchup_id != null ? L.matchups.find(m => m.matchup_id === me.matchup_id && m.roster_id !== me.roster_id) : null;
  const a = liveProj(me, L), b = opp ? liveProj(opp, L) : { proj: 0, rem: 0 }, sd = Math.sqrt((a.rem + b.rem) * 100 + .0001);
  const wp = opp ? (a.rem + b.rem === 0 ? (me.points > opp.points ? 1 : me.points < opp.points ? 0 : .5) : ncdf((a.proj - b.proj) / sd)) : null;
  return { me, opp, myName: L.teamName(L.mine), oppName: opp ? L.teamName(L.rosters.find(r => r.roster_id === opp.roster_id)) : 'Bye', myPts: me.points || 0, oppPts: opp ? opp.points || 0 : 0, myProj: a.proj, oppProj: b.proj, wp };
}
function alertsFor(L) {
  if (!drafted(L)) return [];
  const out = [], w = N.week;
  if (L.starters) L.slots.forEach((s, i) => {
    const id = L.starters[i];
    if (!id || id === '0') { out.push({ k: 'run', tag: 'EMPTY', L, html: `<b>${esc(s)}</b> slot is empty.` }); return; }
    const e = evalP(id, L, w);
    if (e.flag === 'OUT') out.push({ k: 'run', tag: 'OUT', L, html: `<b>${esc(e.p.name)}</b> is listed ${esc(e.p.inj)} and starting at ${esc(s)}.` });
    else if (e.flag === 'DTD') out.push({ k: 'tier', tag: 'DTD', L, html: `<b>${esc(e.p.name)}</b> is day-to-day. Check news before tip-off.` });
    else if (e.flag === 'NO GAMES' && N.regular) out.push({ k: 'tier', tag: 'NO GAMES', L, html: `<b>${esc(e.p.name)}</b> has no games left this week. Lock him or swap him out.` });
  });
  const o = optimize(L, w);
  if (o.now != null && o.best - o.now > 2) out.push({ k: 'ok', tag: '+' + f1(o.best - o.now), L, html: `A better Lock-In lineup is worth about <b>${f1(o.best - o.now)}</b> more points this week. <a href="#nbass">Start/Sit →</a>` });
  return out;
}

/* =================== GAMEDAY =================== */
function wpBar(p) { const pc = Math.round(clamp(p, .02, .98) * 100); return `<div class="nb-wp"><i style="width:${pc}%"></i><b style="left:${pc}%"></b></div>`; }
function renderConnect() {
  const box = q('#nbConnect'), name = ST.get('username', '');
  if (name && N.user) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card ss-empty" style="margin-top:var(--sp-4)"><h3>Connect Sleeper</h3><p class="sub">Enter your Sleeper username to load your NBA leagues. It's the same one Football HQ uses, read-only, no password.</p>
    <form class="row" id="nbCn" style="justify-content:center"><label class="vh" for="nbName">Sleeper username</label><input type="text" id="nbName" placeholder="Sleeper username" value="${esc(name)}" required><button class="btn primary" type="submit">Load leagues</button></form><div class="sub" id="nbCnMsg"></div></div>`;
  q('#nbCn').onsubmit = async e => { e.preventDefault(); const v = q('#nbName').value.trim(); if (!v) return; ST.set('username', v); q('#nbCnMsg').textContent = 'Loading…'; try { await refresh(true); } catch (x) { q('#nbCnMsg').textContent = `No Sleeper user named "${v}".`; } };
}
function renderGameday(silent) {
  renderConnect();
  const cards = q('#nbCards');
  if (!N.user) { cards.innerHTML = ''; q('#nbAlerts').innerHTML = '<div class="sub">Connect Sleeper to see alerts.</div>'; q('#nbAlertCount').textContent = '–'; q('#nbDetail').innerHTML = ''; q('#nbChipsG').innerHTML = ''; return; }
  if (!N.leagues.length) { cards.innerHTML = `<div class="card ss-empty"><h3>No ${N.season} NBA leagues on ${esc(N.user.display_name || N.user.username)} yet</h3><p class="sub">New leagues show up here automatically.</p></div>`; }
  else cards.innerHTML = N.leagues.map(L => {
    const head = `<div class="row"><b class="nb-lg">${esc(L.name)}</b><span class="spacer"></span><span class="pill">${L.status === 'pre_draft' ? 'Pre-draft' : L.status === 'drafting' ? 'Drafting' : (L.lg.settings && L.lg.settings.type === 2) ? 'Dynasty' : 'Season'}</span></div>`;
    if (L.status === 'pre_draft' || L.status === 'drafting') return `<div class="card nb-card" data-lg="${esc(L.id)}">${head}<div class="nb-big">${L.status === 'drafting' ? 'Draft is live' : 'Startup draft next'}</div><p class="sub">Gameday, Start/Sit and Waivers light up once rosters are set. Until then, the draft tools are where the action is.</p><button class="btn primary small" data-go="draft">Open Draft Room</button></div>`;
    const m = matchupOf(L), rec = L.me ? `${L.me.w}-${L.me.l}` : '–';
    if (!m) return `<div class="card nb-card" data-lg="${esc(L.id)}">${head}<p class="sub" style="margin:12px 0">${N.regular ? 'No matchup this week.' : `Season tips off Oct 20 · ${fmtCountdown(Date.UTC(2026, 9, 20, 23, 30))}`}</p><div class="row"><span class="pill">${rec}</span>${L.me ? `<span class="pill">#${L.me.rank} of ${L.rosters.length}</span>` : ''}</div></div>`;
    return `<div class="card nb-card" data-lg="${esc(L.id)}">${head}
      <div class="nb-vs"><div><div class="sub">${esc(m.myName)}</div><b class="sc me">${f1(m.myPts)}</b><div class="sub">proj ${f1(m.myProj)}</div></div><span class="nb-mid">VS</span><div style="text-align:right"><div class="sub">${esc(m.oppName)}</div><b class="sc">${f1(m.oppPts)}</b><div class="sub">proj ${f1(m.oppProj)}</div></div></div>
      ${m.wp != null ? wpBar(m.wp) : ''}<div class="row" style="margin-top:8px">${m.wp != null ? `<b class="nb-pct" style="color:${m.wp >= .5 ? 'var(--good-ink)' : 'var(--bad)'}">${Math.round(m.wp * 100)}%</b><span class="sub">to win</span>` : ''}<span class="spacer"></span><span class="pill">${rec}</span>${L.me ? `<span class="pill">#${L.me.rank} of ${L.rosters.length}</span>` : ''}</div></div>`;
  }).join('');
  qa('.nb-card', cards).forEach(c => c.addEventListener('click', e => { if (e.target.closest('button,a')) return; N.sel = c.dataset.lg; BS.set('sel', N.sel); renderDetail(); q('#nbDetail').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }));
  const al = N.leagues.flatMap(alertsFor);
  q('#nbAlertCount').textContent = al.length ? al.length + ' to check' : 'All clear';
  q('#nbAlerts').innerHTML = al.length ? al.map(a => `<div class="alert ${a.k}"><b class="k">${esc(a.tag)}</b><div><div class="sub" style="font-size:12px">${esc(a.L.name)}</div>${a.html}</div></div>`).join('')
    : `<div class="alert ok"><b class="k">OK</b><div>${N.leagues.some(drafted) ? 'Every lineup is set: nobody ruled out, no empty slots, no better options on the bench.' : 'Alerts start once your startup draft is done.'}</div></div>`;
  renderDetail();
}
function renderDetail() {
  chipsInto(q('#nbChipsG'), renderDetail);
  const L = lgSel(), box = q('#nbDetail'); if (!L) { box.innerHTML = ''; return; }
  if (!drafted(L)) { box.innerHTML = `<div class="card ss-empty"><h3>${esc(L.name)}: rosters aren't set yet</h3><p class="sub">Standings and your roster appear here after the startup draft.</p></div>`; return; }
  const w = N.week, stand = `<div class="tablewrap" style="max-height:none"><table><thead><tr><th>#</th><th>Team</th><th class="r">W-L</th><th class="r">PF</th></tr></thead><tbody>${L.standings.map((s, i) => `<tr class="${s.me ? 'nb-me' : ''} ${i + 1 === L.playoff ? 'nb-cut' : ''}"><td class="num">${s.rank}</td><td>${esc(s.name)}</td><td class="r num">${s.w}-${s.l}</td><td class="r num">${f1(s.pf)}</td></tr>`).join('')}</tbody></table></div><div class="sub" style="margin-top:6px">Dashed line = playoff cut (top ${L.playoff}).</div>`;
  const rows = ids => ids.map(id => evalP(id, L, w)).map(e => `<tr><td>${pcell(e.p)}</td><td class="r num">${f1(e.mu)}</td><td class="r num">${e.n}</td><td class="r num">${f1(e.v)}</td></tr>`).join('');
  const starters = (L.starters || []).filter(id => id && id !== '0'), bench = L.myIds.filter(id => !starters.includes(id) && !L.ir.includes(id) && !L.taxi.includes(id));
  const st = L.lg.settings || {}, left = st.waiver_budget != null && L.mine ? st.waiver_budget - ((L.mine.settings || {}).waiver_budget_used || 0) : null;
  box.innerHTML = `<div class="grid g2">
    <div class="card"><div class="row"><h3 style="margin:0">Standings</h3><span class="spacer"></span><a class="btn small" href="https://sleeper.com/leagues/${esc(L.id)}" target="_blank" rel="noopener">Open in Sleeper ↗</a></div><div style="margin-top:10px">${stand}</div>${left != null ? `<div class="ss-stats"><div><span>FAAB left</span><b>$${left}</b></div><div><span>Roster</span><b>${L.myIds.length}</b></div><div><span>Taxi</span><b>${L.taxi.length}</b></div><div><span>IR</span><b>${L.ir.length}</b></div></div>` : ''}</div>
    <div class="card"><div class="row"><h3 style="margin:0">Your roster</h3><span class="spacer"></span><button class="btn small" data-go="nbass">Optimize →</button></div>
      <div class="tablewrap" style="max-height:none;margin-top:10px"><table><thead><tr><th>Player</th><th class="r">FPPG</th><th class="r">Gms</th><th class="r">Lock-In wk</th></tr></thead><tbody>
      <tr class="nb-sub"><td colspan="4">Starters</td></tr>${rows(starters)}<tr class="nb-sub"><td colspan="4">Bench</td></tr>${rows(bench)}${L.taxi.length ? `<tr class="nb-sub"><td colspan="4">Taxi</td></tr>${rows(L.taxi)}` : ''}${L.ir.length ? `<tr class="nb-sub"><td colspan="4">IR</td></tr>${rows(L.ir)}` : ''}</tbody></table></div>
      <div class="sub" style="margin-top:6px">FPPG uses this league's scoring. Gms = games ${N.regular ? 'left this week' : 'in week ' + w}. Lock-In wk = expected locked score.</div></div>
  </div>`;
}

/* =================== START / SIT =================== */
function weekOpts() {
  const sel = q('#nbWeek'), cur = +sel.value || N.week, weeks = [...new Set(N.sched.map(g => g.week))].filter(x => x >= N.week).slice(0, 3);
  sel.innerHTML = (weeks.length ? weeks : [N.week]).map(x => `<option value="${x}" ${x === cur ? 'selected' : ''}>Week ${x}${x === N.week ? ' (current)' : ''}</option>`).join('');
}
q('#nbWeek').onchange = () => renderSS();
function renderSS() {
  weekOpts(); chipsInto(q('#nbChipsS'), renderSS);
  const box = q('#nbSS'), L = lgSel(), w = +q('#nbWeek').value || N.week;
  if (!N.user) { box.innerHTML = '<div class="card ss-empty"><h3>Connect Sleeper on the Gameday tab first</h3></div>'; return; }
  if (!L || !drafted(L)) { box.innerHTML = `<div class="card ss-empty"><h3>Start/Sit unlocks after your startup draft</h3><p class="sub">Once you have a roster, this builds your best Lock-In lineup every week.</p></div>`; return; }
  const o = optimize(L, w), hasCur = !!o.cur, curSet = new Set(hasCur ? o.cur.filter(Boolean).map(e => e.id) : []);
  const changes = hasCur ? o.lineup.filter(e => e && !curSet.has(e.id)).length : 0, gain = hasCur ? o.best - o.now : o.best;
  const cell = (e, cls = '') => e ? `<div class="nb-cell ${cls}">${ph(e.p)}<div style="min-width:0"><b>${esc(e.p.name)}</b><div class="pmeta">${e.n} gm · ${f1(e.mu)} ppg ${e.flag ? `<span class="tag ${e.flag === 'OUT' ? 'inj' : 'est'}">${e.flag}</span>` : ''}</div></div><span class="v">${f1(e.v)}</span></div>` : `<div class="nb-cell bad"><span class="sub">Empty</span></div>`;
  const rows = L.slots.map((s, i) => { const b = o.lineup[i], c = hasCur ? o.cur[i] : null, chg = hasCur && b && (!c || c.id !== b.id); return `<div class="nb-slot">${esc(s)}</div>${cell(c, c && c.flag === 'OUT' ? 'bad' : '')}<div class="nb-arr ${chg ? 'go' : ''}">${chg ? '→' : '='}</div>${cell(b, chg ? 'chg' : '')}`; }).join('');
  box.innerHTML = `<div class="grid nb-ssgrid">
    <div class="card"><div class="row"><h3 style="margin:0">${esc(L.name)} · week ${w}</h3></div><div class="nb-lineup"><div class="nb-hd">Slot</div><div class="nb-hd">Current</div><div></div><div class="nb-hd">Best</div>${rows}</div></div>
    <div class="grid" style="align-content:start;gap:var(--sp-4)">
      <div class="card" style="text-align:center"><div class="eyebrow">Projected gain</div><div class="nb-gain">+${f1(Math.max(0, gain))}</div><div class="sub">${changes ? `${changes} change${changes === 1 ? '' : 's'} to make in Sleeper` : 'Your lineup is already the best one 👌'}</div>${changes ? `<a class="btn primary" style="margin-top:12px" href="https://sleeper.com/leagues/${esc(L.id)}" target="_blank" rel="noopener">Make the swaps in Sleeper ↗</a>` : ''}</div>
      <div class="card"><h3>Bench</h3>${o.bench.length ? `<div class="tablewrap" style="max-height:none;margin-top:8px"><table><tbody>${o.bench.map(e => `<tr><td>${pcell(e.p, `${e.n} gm`)}</td><td class="r num">${f1(e.v)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">Nobody on the bench.</div>'}</div>
    </div></div>`;
}

/* =================== WAIVERS =================== */
async function renderWV() {
  chipsInto(q('#nbChipsW'), renderWV);
  const box = q('#nbWV'), L = lgSel();
  if (!N.user) { box.innerHTML = '<div class="card ss-empty"><h3>Connect Sleeper on the Gameday tab first</h3></div>'; return; }
  if (!L || !drafted(L)) { box.innerHTML = `<div class="card ss-empty"><h3>Waivers unlock after your startup draft</h3><p class="sub">Right now every player is available, so there's nothing to radar yet.</p></div>`; return; }
  box.innerHTML = '<div class="empty-note">Scanning the wire…</div>';
  if (!N.trend) N.trend = await sleeper('/v1/players/nba/trending/add?lookback_hours=24&limit=40').catch(() => []);
  const taken = new Set(); for (const r of L.rosters) for (const id of [...(r.players || []), ...(r.taxi || []), ...(r.reserve || [])]) taken.add(id);
  const w = N.week, trend = {}; for (const t of N.trend) trend[t.player_id] = t.count;
  const hot = N.trend.filter(t => !taken.has(t.player_id) && N.players[t.player_id]).slice(0, 10).map(t => evalP(t.player_id, L, w));
  const pool = Object.keys(N.players).filter(id => !taken.has(id) && N.players[id].team !== 'FA' && (N.s25[id] || N.s26[id] || DATA_BY_SID[id])).map(id => evalP(id, L, w)).filter(e => e.mu > 0).sort((a, b) => b.mu - a.mu).slice(0, 40);
  const drops = L.myIds.filter(id => !(L.starters || []).includes(id) && !L.ir.includes(id) && !L.taxi.includes(id)).map(id => evalP(id, L, w)).sort((a, b) => a.mu - b.mu).slice(0, 5);
  const st = L.lg.settings || {}, left = st.waiver_budget != null && L.mine ? st.waiver_budget - ((L.mine.settings || {}).waiver_budget_used || 0) : null;
  box.innerHTML = `<div class="grid g2">
    <div class="card"><div class="row"><h3 style="margin:0">🔥 Hot and available</h3><span class="spacer"></span><span class="sub">Sleeper adds, last 24h</span></div>
      ${hot.length ? `<div class="tablewrap" style="max-height:none;margin-top:10px"><table><tbody>${hot.map(e => `<tr><td>${pcell(e.p, `${f1(e.mu)} ppg`)}</td><td class="r"><span class="tag rk">▲${(trend[e.id] || 0).toLocaleString()}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">Every trending player is already rostered here.</div>'}</div>
    <div class="card"><div class="row"><h3 style="margin:0">Drop candidates</h3><span class="spacer"></span>${left != null ? `<span class="pill">FAAB left $${left}</span>` : ''}</div>
      ${drops.length ? `<div class="tablewrap" style="max-height:none;margin-top:10px"><table><tbody>${drops.map(e => `<tr><td>${pcell(e.p)}</td><td class="r num">${f1(e.mu)} ppg</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">No bench players to judge.</div>'}</div>
  </div>
  <div class="card" style="margin-top:var(--sp-4)"><div class="row"><h3 style="margin:0">Best available</h3><span class="spacer"></span><span class="sub">by points per game in this league's scoring</span></div>
    <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Player</th><th class="r">FPPG</th><th class="r">Gms wk ${w}</th><th class="r">Lock-In wk</th><th class="r">Trend</th></tr></thead><tbody>
    ${pool.map(e => `<tr><td>${pcell(e.p)}</td><td class="r num">${f1(e.mu)}</td><td class="r num">${e.n}</td><td class="r num">${f1(e.v)}</td><td class="r">${trend[e.id] ? `<span class="tag rk">▲${trend[e.id].toLocaleString()}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ---------- countdowns, calendar, lock-or-roll ---------- */
const OPEN = Date.UTC(2026, 9, 20, 23, 30), TD = Date.UTC(2027, 2, 8, 4, 59), PO = Date.UTC(2027, 2, 15, 4), CH = Date.UTC(2027, 3, 5, 3, 59);
setInterval(() => { if (!q('#v-gameday').classList.contains('on')) return; q('#ssOpen').textContent = fmtCountdown(OPEN); q('#ssTd').textContent = fmtCountdown(TD); q('#ssPo').textContent = fmtCountdown(PO); q('#ssCh').textContent = fmtCountdown(CH); }, 1000);
function drawTimeline() {
  const start = Date.UTC(2026, 9, 20), end = Date.UTC(2027, 3, 5);
  const pts = [[Date.UTC(2026, 9, 20), 'Opening night', 'Oct 20'], [Date.UTC(2026, 11, 25), 'Christmas slate', 'Dec 25'], [Date.UTC(2027, 2, 7), 'Trade deadline', 'Mar 7'], [Date.UTC(2027, 2, 15), 'Quarterfinals', 'Mar 15–21'], [Date.UTC(2027, 2, 22), 'Semifinals', 'Mar 22–28'], [Date.UTC(2027, 2, 29), 'Championship', 'Mar 29–Apr 4']];
  const pos = t => clamp((t - start) / (end - start), 0, 1) * 100, now = pos(Date.now());
  q('#ssTimeline').innerHTML = `<div class="track"></div><div class="fill" id="ssFill"></div>${pts.map(([t, b, s], i) => `<div class="mk ${i % 2 ? 'up' : ''}" style="left:${pos(t)}%"><i></i><b>${b}</b><small>${s}</small></div>`).join('')}<div class="now" id="ssNow" style="left:0">TODAY</div>`;
  q('#ssTlPct').textContent = Date.now() < start ? `Starts in ${Math.ceil((start - Date.now()) / 864e5)} days` : `${Math.round(now)}% of the season played`;
  setTimeout(() => { q('#ssFill').style.width = now + '%'; q('#ssNow').style.left = now + '%'; }, 200);
}
function lockCalc() {
  const s = +q('#ssScore').value || 0, mu = Math.max(1, +q('#ssAvg').value || 1), k = +q('#ssLeft').value, W = lockVal(mu, k);
  const lo = mu * .3, hi = mu * 1.9, P = v => clamp((v - lo) / (hi - lo), 0, 1) * 100;
  q('#ssMark').style.left = P(s) + '%'; q('#ssLine').style.left = (k ? P(W) : 0) + '%'; q('#ssLine').style.opacity = k ? 1 : 0;
  const v = q('#ssVerdict'), why = q('#ssWhy');
  if (k === 0) { v.textContent = 'It counts anyway'; v.style.color = 'var(--ink)'; why.textContent = 'That was his last game this week, so it counts automatically whether you lock it or not.'; return; }
  if (s >= W) { v.textContent = '🔒 Lock it in'; v.style.color = 'var(--good-ink)'; why.innerHTML = `Waiting is worth about <b>${W.toFixed(1)}</b> with ${k} game${k > 1 ? 's' : ''} left. ${s.toFixed(1)} beats that, so bank it.`; }
  else { v.textContent = '🎲 Roll it'; v.style.color = 'var(--accent-text)'; why.innerHTML = `Waiting is worth about <b>${W.toFixed(1)}</b> with ${k} game${k > 1 ? 's' : ''} left. ${s.toFixed(1)} is below that, so let him play again.`; }
}
['ssScore', 'ssAvg', 'ssLeft'].forEach(id => q('#' + id).addEventListener('input', lockCalc));

/* ---------- loading + live refresh ---------- */
let booted = false, view = null;
function liveTag() {
  const el = q('#nbLive'); if (!el) return;
  if (!N.user) { el.textContent = '● Not connected'; el.classList.remove('on'); return; }
  const s = N.last ? Math.round((Date.now() - N.last) / 1000) : 0;
  el.classList.add('on'); el.textContent = `● LIVE · ${N.user.display_name || N.user.username} · updated ${s < 60 ? s + 's' : Math.round(s / 60) + ' min'} ago`;
}
setInterval(liveTag, 1000);
async function refresh(fresh) {
  if (N.busy) return; N.busy = true;
  const before = {}; for (const L of N.leagues) { const m = matchupOf(L); if (m) before[L.id] = m.myPts; }
  try {
    await loadCore(fresh); await Promise.all([loadPlayers(), loadStats()]); await loadLeagues(fresh);
    N.last = Date.now();
    if (N.sel == null && N.leagues[0]) N.sel = N.leagues[0].id;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (view === 'gameday' && !typing) renderGameday(true); else if (view === 'nbass' && !typing) renderSS(); else if (view === 'nbawv' && !typing) renderWV();
    for (const L of N.leagues) { const m = matchupOf(L); if (m && before[L.id] != null && m.myPts > before[L.id] + .05) { const el = q(`.nb-card[data-lg="${CSS.escape(L.id)}"] .sc.me`); if (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); const r = el.getBoundingClientRect(); popText(r.left + r.width / 2, r.top, '+' + f1(m.myPts - before[L.id]), '#ff9a57', 30); } } }
  } finally { N.busy = false; liveTag(); }
}
const gamesLive = () => N.sched.some(g => g.status === 'in_game' || g.status === 'in_progress' || (g.date === today() && g.status !== 'complete'));
function schedule() { clearTimeout(N.timer); N.timer = setTimeout(async () => { if (document.visibilityState === 'visible' && view) await refresh(true).catch(() => {}); schedule(); }, gamesLive() ? 30e3 : 120e3); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view && N.user && Date.now() - N.last > 30e3) refresh(true).catch(() => {}); });

window.NBA = {
  async render(v) {
    view = v;
    if (!booted) {
      booted = true; drawTimeline(); lockCalc();
      q('#nbRefresh').onclick = () => refresh(true).catch(() => {});
      q('#nbCards').innerHTML = '<div class="empty-note">Loading your leagues…</div>';
      try { await refresh(false); } catch (e) { q('#nbCards').innerHTML = '<div class="card ss-empty"><h3>Couldn\'t reach Sleeper</h3><p class="sub">Check your connection and hit Refresh.</p></div>'; }
      schedule();
    }
    if (v === 'gameday') renderGameday(); else if (v === 'nbass') renderSS(); else if (v === 'nbawv') renderWV();
  }
};
// Leaving these tabs pauses refreshes.
const mo = new MutationObserver(() => { const on = ['gameday', 'nbass', 'nbawv'].find(v => q('#v-' + v).classList.contains('on')); view = on || null; });
['gameday', 'nbass', 'nbawv'].forEach(v => mo.observe(q('#v-' + v), { attributes: true, attributeFilter: ['class'] }));

/* ---------- deep links: #gameday, #draft, #board … ---------- */
const openHash = () => { const v = location.hash.slice(1) === 'season' ? 'gameday' : location.hash.slice(1), b = v && document.querySelector(`#tabs button[data-v="${CSS.escape(v)}"]`); if (b) b.click(); };
addEventListener('hashchange', openHash);
openHash();
})();
