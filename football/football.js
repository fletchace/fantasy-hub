/* Football HQ — weekly side: Sleeper leagues, matchups, start/sit optimizer, waivers, player cards.
   Dynasty tools live in dynasty.js and share the HQ object defined here. */
(() => {
const { $, $$, esc, clamp, reduced, store, sleeper, toast, reveal, tilt, countUp, confetti, popText, ambient, fmtCountdown } = FX;
const ST = store('ffhq_');
const SNAP = window.NFL_SNAP || { rows: [], asOf: '' };

/* ---------- players ---------- */
const P = {};
for (const r of SNAP.rows) P[r[0]] = { id: r[0], name: r[1], pos: r[2], team: r[3], dob: r[4], exp: r[5], college: r[6], ht: r[7], wt: r[8], num: r[9], depth: r[10], rank: r[11], sfAdp: r[12], oneAdp: r[13], proj: r[14], rdAdp: r[15], inj: null };
const POS_COL = { QB: '#ff6b8b', RB: '#2dd4bf', WR: '#60a5fa', TE: '#fb923c', K: '#c084fc', DEF: '#d6a77a' };
const isTeamId = id => /^[A-Z]{2,3}$/.test(id);
const pl = id => P[id] || { id, name: isTeamId(id) ? id + ' D/ST' : 'Player ' + id, pos: isTeamId(id) ? 'DEF' : '?', team: isTeamId(id) ? id : 'FA' };
const ageOf = p => p && p.dob ? (Date.now() - Date.parse(p.dob)) / 31557600000 : null;
const initials = n => String(n).split(/\s+/).map(s => s[0]).slice(0, 2).join('');
const photo = p => p.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(p.team || p.id).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`;
const ph = (p, cls = '') => `<span class="ph ${cls}" data-i="${esc(initials(p.name))}" style="--pc:${POS_COL[p.pos] || 'var(--line-strong)'}"><img src="${photo(p)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
const SLOT_LBL = { SUPER_FLEX: 'SF', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', FLEX: 'FLEX' };
const posTag = pos => `<span class="pos ${esc(pos)}">${esc(SLOT_LBL[pos] || pos)}</span>`;
const isOut = s => /^(out|ir|pup|sus|na|cov|dnr)/i.test(s || '');
function injTag(s) { if (!s) return ''; const k = isOut(s) || /doubt/i.test(s) ? 'inj' : 'q'; return `<span class="tag ${k}">${esc(s === 'Questionable' ? 'Q' : s === 'Doubtful' ? 'DOUBTFUL' : String(s).toUpperCase())}</span>`; }
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
function pcell(p, sub = '', extra = '') {
  return `<div class="pcell" data-pid="${esc(p.id)}" style="cursor:pointer">${ph(p)}<div style="min-width:0"><b>${esc(p.name)} ${injTag(p.inj)}${extra}</b><small>${posTag(p.pos)} <span class="team">${esc(p.team || 'FA')}</span> ${sub}</small></div></div>`;
}

/* ---------- global state ---------- */
const G = { st: null, season: '2026', week: 1, sched: [], wk: {}, stats: null, user: null, sleeperLeagues: [], sel: ST.get('sel', null), gamesMemo: {} };
const PRESETS = {
  ppr: { pass_yd: .04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: .1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: .1, rec_td: 6, rec_2pt: 2, fum_lost: -2, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1, fgmiss: -1, xpmiss: -1 },
};
PRESETS.half = { ...PRESETS.ppr, rec: .5 }; PRESETS.std = { ...PRESETS.ppr, rec: 0 };

async function loadCore(fresh = false) {
  const st = await sleeper('/v1/state/nfl', { ttl: 15 * 60e3, fresh }); G.st = st; G.season = st.season;
  try { G.sched = await sleeper(`/schedule/nfl/regular/${st.season}`, { ttl: 30 * 60e3, fresh }); } catch (e) { if (!fresh) G.sched = []; }
  G.gamesMemo = {};
  const open = G.sched.filter(g => g.status !== 'complete').map(g => g.week);
  G.week = open.length ? Math.min(...open) : st.week;
}
function weekGames(w) {
  if (G.gamesMemo[w]) return G.gamesMemo[w];
  const m = {}; for (const g of G.sched) if (g.week === w) { m[g.home] = { opp: g.away, home: true, date: g.date, status: g.status }; m[g.away] = { opp: g.home, home: false, date: g.date, status: g.status }; }
  return (G.gamesMemo[w] = m);
}
const today = () => new Date().toISOString().slice(0, 10);
const onBye = (team, w) => !!(G.sched.length && team && team !== 'FA' && !weekGames(w)[team]);
function isLocked(team, w) { const g = weekGames(w)[team]; if (!g) return false; return g.status === 'complete' || g.status === 'in_game' || g.status === 'in_progress' || g.date < today(); }
async function loadWeek(w, fresh = false) {
  if (G.wk[w] && !fresh) return G.wk[w];
  const q = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => 'position%5B%5D=' + p).join('&');
  const arr = await sleeper(`/projections/nfl/${G.season}/${w}?season_type=regular&${q}`, { fresh });
  const m = {};
  for (const x of arr) {
    m[x.player_id] = { s: x.stats || {}, opp: x.opponent };
    const pp = x.player;
    if (pp) {
      let p = P[x.player_id];
      if (!p) p = P[x.player_id] = { id: x.player_id, name: `${pp.first_name || ''} ${pp.last_name || ''}`.trim(), pos: pp.position, team: x.team, dob: null };
      if (w === G.week) p.inj = pp.injury_status || null;
      if (x.team) p.team = x.team;
    }
  }
  return (G.wk[w] = m);
}
async function loadStats() {
  if (G.stats) return G.stats;
  const q = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => 'position%5B%5D=' + p).join('&');
  try { const arr = await sleeper(`/stats/nfl/${G.season}?season_type=regular&${q}`); const m = {}; for (const x of arr) m[x.player_id] = x.stats || {}; G.stats = m; }
  catch (e) { G.stats = {}; }
  return G.stats;
}
function ppg(id, L) { const s = G.stats && G.stats[id]; if (!s || !s.gp) return null; return scoreStats(s, L && L.scoring, pl(id).pos) / s.gp; }

/* ---------- scoring ---------- */
function scoreStats(s, sc, pos) {
  if (!s) return 0;
  if (pos === 'DEF') return s.pts_std ?? s.pts_ppr ?? 0;
  if (!sc) return s.pts_ppr ?? 0;
  let t = 0, hit = false;
  for (const k in sc) { const v = s[k]; if (v) { t += v * sc[k]; hit = true; } }
  if (!hit || (t === 0 && (s.pts_ppr || 0) > 0)) { const r = sc.rec ?? 1; return r >= 1 ? s.pts_ppr || 0 : r > 0 ? s.pts_half_ppr || 0 : s.pts_std || 0; }
  return t;
}
function projFor(id, L, w) { const e = G.wk[w] && G.wk[w][id]; return e ? scoreStats(e.s, L ? L.scoring : null, pl(id).pos) : 0; }
function actualPts(id, L, w) {
  if (!L || w !== G.week || L.kind !== 'sleeper' || !L.matchups) return null;
  for (const m of L.matchups) if (m.players_points && id in m.players_points) return m.players_points[id];
  return null;
}
function evalPlayer(id, L, w) {
  const p = pl(id), raw = projFor(id, L, w); let v = raw, flag = null;
  const locked = isLocked(p.team, w), act = locked ? actualPts(id, L, w) : null;
  if (act != null) { const g = weekGames(w)[p.team]; return { id, p, v: act, raw: act, flag: g && g.status === 'complete' ? 'FINAL' : 'LIVE', locked, actual: true, opp: g || {} }; }
  if (onBye(p.team, w)) { v = 0; flag = 'BYE'; }
  else if (isOut(p.inj)) { v = 0; flag = 'OUT'; }
  else if (/doubt/i.test(p.inj || '')) { v *= .3; flag = 'D'; }
  else if (/quest/i.test(p.inj || '')) { v *= .92; flag = 'Q'; }
  return { id, p, v, raw, flag, locked, opp: (weekGames(w)[p.team] || {}) };
}

/* ---------- leagues ---------- */
function buildSleeperLeague(lg, rosters, users, mu) {
  const uid = G.user.user_id, umap = {};
  for (const u of users) umap[u.user_id] = u;
  const teamName = r => { const u = umap[r && r.owner_id]; return (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + (r ? r.roster_id : '?')); };
  const mine = rosters.find(r => r.owner_id === uid || (r.co_owners || []).includes(uid));
  const slots = (lg.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
  const chopped = (lg.settings || {}).type === 3;   // Sleeper "Chopped" (guillotine): no opponents, lowest score each week is eliminated
  const standings = rosters.map(r => { const s = r.settings || {}; return { rid: r.roster_id, name: teamName(r), w: s.wins || 0, l: s.losses || 0, t: s.ties || 0, pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100, pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100, elim: s.eliminated || 0, me: !!(mine && r.roster_id === mine.roster_id) }; })
    .sort(chopped ? (a, b) => (!!a.elim - !!b.elim) || (b.elim - a.elim) || b.pf - a.pf : (a, b) => b.w - a.w || a.l - b.l || b.pf - a.pf);
  standings.forEach((s, i) => s.rank = i + 1);
  const rosterById = {}; for (const r of rosters) rosterById[r.roster_id] = r;
  return { id: lg.league_id, kind: 'sleeper', name: lg.name, lg, scoring: lg.scoring_settings || {}, slots, rosters, rosterById, users: umap, teamName, mine, standings, matchups: mu || [],
    teams: rosters.length, playoff: (lg.settings && lg.settings.playoff_teams) || 6, type: lg.settings && lg.settings.type, chopped,
    myElim: (mine && (mine.settings || {}).eliminated) || 0,
    myIds: mine ? (mine.players || []) : [], starters: mine ? (mine.starters || []) : null, ir: (mine && mine.reserve) || [], taxi: (mine && mine.taxi) || [], me: standings.find(s => s.me) };
}
function buildManual(m) {
  const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', ...(m.sf ? ['SUPER_FLEX'] : []), 'K', 'DEF'];
  return { id: m.id, kind: 'manual', name: m.name, platform: m.platform, url: m.url, scoring: PRESETS[m.scoring || 'ppr'], slots, myIds: m.roster || [], starters: null, ir: [], taxi: [], standings: null, teams: null, m };
}
const manualList = () => ST.get('manual', []);
const allLeagues = () => [...G.sleeperLeagues, ...manualList().map(buildManual)];
const getLeague = id => allLeagues().find(l => l.id === id);
function selLeague() { const ls = allLeagues(); if (!ls.length) return null; return ls.find(l => l.id === G.sel) || ls[0]; }
function setSel(id) { G.sel = id; ST.set('sel', id); }
function fmtBits(L) {
  const sc = L.scoring || {}, rec = sc.rec ?? 0, bits = [rec >= 1 ? 'PPR' : rec > 0 ? 'Half PPR' : 'Standard'];
  if (L.slots.includes('SUPER_FLEX') || L.slots.filter(s => s === 'QB').length > 1) bits.push('Superflex');
  if ((sc.bonus_rec_te || 0) > 0) bits.push('TE +' + sc.bonus_rec_te);
  if ((sc.pass_td || 4) >= 6) bits.push('6pt pass TD');
  if (L.chopped) bits.unshift('Chopped'); else if (L.type === 2) bits.push('Dynasty'); else if (L.type === 1) bits.push('Keeper');
  if (L.teams) bits.push(L.teams + ' teams');
  if (L.kind === 'manual') bits.push(L.platform || 'Manual');
  return bits;
}
async function loadUser(name, fresh = false, freshProj = false) {
  const u = await sleeper(`/v1/user/${encodeURIComponent(name.trim())}`);
  if (!u || !u.user_id) throw new Error(`Couldn't find a Sleeper user named "${name}".`);
  G.user = u; ST.set('username', u.username || name.trim());
  const ls = await sleeper(`/v1/user/${u.user_id}/leagues/nfl/${G.season}`, { fresh });
  await loadWeek(G.week, freshProj).catch(() => {});
  G.sleeperLeagues = await Promise.all((ls || []).map(async lg => {
    const [rosters, users, mu] = await Promise.all([sleeper(`/v1/league/${lg.league_id}/rosters`, { fresh }), sleeper(`/v1/league/${lg.league_id}/users`), sleeper(`/v1/league/${lg.league_id}/matchups/${G.week}`, { fresh }).catch(() => [])]);
    return buildSleeperLeague(lg, rosters, users, mu);
  }));
  saveSummaries();
}

/* ---------- matchups + alerts ---------- */
function erf(x) { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const phi = x => .5 * (1 + erf(x / Math.SQRT2));
function liveProj(entry, L, w) {
  let tot = 0, rem = 0;
  (entry.starters || []).forEach((id, i) => {
    if (!id || id === '0') return;
    const p = pl(id), pts = (entry.starters_points || [])[i] || 0, g = weekGames(w)[p.team];
    if (!g || g.status === 'complete' || (g.date < today() && g.status !== 'in_game')) tot += pts;
    else if (g.status === 'in_game' || g.status === 'in_progress') { tot += Math.max(pts, projFor(id, L, w)); rem += .5; }
    else { tot += evalPlayer(id, L, w).v; rem++; }
  });
  return { proj: tot, rem };
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
/* Chopped leagues: every surviving team is scored on its own and the lowest final score is eliminated.
   Each team's final = points so far + projections for players yet to play; survival odds come from simulating
   the rest of the week (about 6.5 pts of spread per player left) and counting how often you're not the lowest. */
function chopInfo(L) {
  if (L._chop) return L._chop;
  const w = G.week, alive = L.rosters.filter(r => !(r.settings || {}).eliminated);
  const rows = alive.map(r => {
    const e = L.matchups.find(m => m.roster_id === r.roster_id) || { starters: [], points: 0 }, lp = liveProj(e, L, w);
    return { rid: r.roster_id, name: L.teamName(r), pts: e.points || 0, proj: Math.max(lp.proj, e.points || 0), rem: lp.rem, me: !!(L.mine && r.roster_id === L.mine.roster_id) };
  }).sort((a, b) => b.proj - a.proj);
  rows.forEach((x, i) => x.rank = i + 1);
  const me = rows.find(x => x.me), others = rows.filter(x => !x.me), low = others.length ? others[others.length - 1] : null;
  let survive = null;
  if (me && rows.length > 1) {
    if (!rows.some(x => x.rem > 0)) survive = rows[rows.length - 1].me ? 0 : 1;
    else { const N = 3000; let safe = 0; for (let k = 0; k < N; k++) { let mv = Infinity, mm = false; for (const x of rows) { const v = x.proj + gauss() * 6.5 * Math.sqrt(x.rem); if (v < mv) { mv = v; mm = x.me; } } if (!mm) safe++; } survive = safe / N; }
  }
  const out = L.rosters.filter(r => (r.settings || {}).eliminated).map(r => ({ name: L.teamName(r), wk: r.settings.eliminated, pf: (r.settings.fpts || 0) + (r.settings.fpts_decimal || 0) / 100 })).sort((a, b) => b.wk - a.wk);
  return (L._chop = { rows, me, low, cushion: me && low ? me.proj - low.proj : null, survive, alive: rows.length, out, lastChop: (L.lg.settings || {}).last_chopped_leg || 0 });
}
const myPoints = L => { const e = L.mine && L.matchups.find(m => m.roster_id === L.mine.roster_id); return e ? e.points || 0 : null; };
function matchupOf(L) {
  if (L.kind !== 'sleeper' || !L.mine || !L.matchups.length || L.chopped) return null;
  const me = L.matchups.find(m => m.roster_id === L.mine.roster_id); if (!me) return null;
  const opp = me.matchup_id != null ? L.matchups.find(m => m.matchup_id === me.matchup_id && m.roster_id !== me.roster_id) : null;
  const a = liveProj(me, L, G.week), b = opp ? liveProj(opp, L, G.week) : { proj: 0, rem: 0 };
  const sd = Math.sqrt((a.rem + b.rem) * 42 + .0001);
  const wp = opp ? (a.rem + b.rem === 0 ? (me.points > opp.points ? 1 : me.points < opp.points ? 0 : .5) : phi((a.proj - b.proj) / sd)) : null;
  return { me, opp, myName: L.teamName(L.mine), oppName: opp ? L.teamName(L.rosterById[opp.roster_id]) : 'Bye week', myPts: me.points || 0, oppPts: opp ? opp.points || 0 : 0, myProj: a.proj, oppProj: b.proj, wp };
}
function optimize(L, w) {
  const usable = L.myIds.filter(id => !L.ir.includes(id) && !L.taxi.includes(id));
  const res = new Array(L.slots.length).fill(null), used = new Set();
  // Locked starters (game started or done) stay put.
  if (L.starters && w === G.week) L.starters.forEach((id, i) => { if (id && id !== '0') { const e = evalPlayer(id, L, w); if (e.locked) { res[i] = e; used.add(id); } } });
  const pool = usable.filter(id => !used.has(id)).map(id => evalPlayer(id, L, w)).filter(e => !(e.locked && w === G.week));
  const ELIG = HQ.ELIG, order = L.slots.map((s, i) => ({ s, i, n: (ELIG[s] || []).length || 99 })).sort((a, b) => a.n - b.n);
  for (const o of order) {
    if (res[o.i]) continue; const el = ELIG[o.s];
    if (!el) { const cur = L.starters && L.starters[o.i]; if (cur && cur !== '0') { res[o.i] = evalPlayer(cur, L, w); used.add(cur); } continue; }
    let best = null; for (const e of pool) { if (used.has(e.id) || !el.includes(e.p.pos)) continue; if (!best || e.v > best.v) best = e; }
    if (best) { used.add(best.id); res[o.i] = best; }
  }
  // Keep players in the slot they already occupy when an equivalent swap exists, so only real changes show.
  if (L.starters) for (let pass = 0; pass < 2; pass++) for (let i = 0; i < res.length; i++) {
    const c = L.starters[i]; if (!c || c === '0' || !res[i] || res[i].id === c) continue;
    const j = res.findIndex(e => e && e.id === c); if (j < 0) continue;
    const a = res[i], b = res[j], ei = ELIG[L.slots[i]], ej = ELIG[L.slots[j]];
    if (ei && ej && ei.includes(b.p.pos) && ej.includes(a.p.pos)) { res[i] = b; res[j] = a; }
  }
  const bench = usable.filter(id => !used.has(id)).map(id => evalPlayer(id, L, w)).sort((a, b) => b.v - a.v);
  const cur = L.starters ? L.slots.map((s, i) => { const id = L.starters[i]; return id && id !== '0' ? evalPlayer(id, L, w) : null; }) : null;
  const sum = arr => arr.reduce((t, e) => t + (e ? e.v : 0), 0);
  return { lineup: res, bench, cur, best: sum(res), now: cur ? sum(cur) : null };
}
function alertsFor(L) {
  const out = [], w = G.week;
  if (L.starters) L.slots.forEach((s, i) => {
    const id = L.starters[i];
    if (!id || id === '0') { out.push({ k: 'out', tag: 'Empty', L, html: `<b>${esc(SLOT_LBL[s] || s)}</b> slot is empty.` }); return; }
    const e = evalPlayer(id, L, w); if (e.locked) return;
    if (e.flag === 'BYE') out.push({ k: 'bye', tag: 'Bye', L, html: `<b data-pid="${esc(id)}" style="cursor:pointer">${esc(e.p.name)}</b> is on bye and in your lineup.` });
    else if (e.flag === 'OUT') out.push({ k: 'out', tag: 'Out', L, html: `<b data-pid="${esc(id)}" style="cursor:pointer">${esc(e.p.name)}</b> is listed ${esc(e.p.inj)} and starting at ${esc(SLOT_LBL[s] || s)}.` });
    else if (e.flag === 'D' || e.flag === 'Q') out.push({ k: 'q', tag: e.flag === 'D' ? 'Doubtful' : 'Q', L, html: `<b data-pid="${esc(id)}" style="cursor:pointer">${esc(e.p.name)}</b> is ${esc(e.p.inj).toLowerCase()}. Check news before kickoff.` });
  });
  if (L.chopped && !L.myElim && L.matchups.length) {
    const c = chopInfo(L);
    if (c.me && c.survive != null && c.survive < .75) out.push({ k: c.survive < .4 ? 'out' : 'q', tag: 'Chop risk', L, html: `Only <b>${Math.round(c.survive * 100)}%</b> to survive this week. You're projected #${c.me.rank} of ${c.alive}${c.cushion != null ? `, ${c.cushion >= 0 ? f1(c.cushion) + ' above' : f1(-c.cushion) + ' below'} the next-lowest team` : ''}.`, fix: true });
  }
  if (L.myIds.length) {
    const o = optimize(L, w);
    if (o.now != null && o.best - o.now > 1.5) out.push({ k: 'up', tag: `+${f1(o.best - o.now)}`, L, html: `A better lineup is projected to score <b>${f1(o.best - o.now)}</b> more points.`, fix: true });
  }
  return out;
}
function saveSummaries() {
  const sums = G.sleeperLeagues.filter(L => L.me).map(L => {
    if (L.chopped) {
      if (L.myElim) return { name: L.name, record: 'CHOPPED', rank: 0, teams: 0, playoff: 0, line: `Eliminated in week ${L.myElim}` };
      const c = chopInfo(L);
      return { name: L.name, record: 'ALIVE', rank: c.me ? c.me.rank : 0, teams: c.alive, playoff: c.alive - 1,
        line: c.me ? `Wk ${G.week}: ${f1(c.me.pts)} pts · ${c.survive != null ? Math.round(c.survive * 100) + '% to survive' : ''} · ${c.alive} of ${L.teams} left` : '' };
    }
    const m = matchupOf(L);
    return { name: L.name, record: `${L.me.w}-${L.me.l}${L.me.t ? '-' + L.me.t : ''}`, rank: L.me.rank, teams: L.teams, playoff: L.playoff,
      line: m ? `Wk ${G.week}: ${f1(m.myPts)}–${f1(m.oppPts)} vs ${m.oppName}${m.wp != null ? ` · ${Math.round(m.wp * 100)}% to win` : ''}` : '' };
  });
  ST.set('summaries', sums);
}

/* ---------- hero + scoreboard ---------- */
ambient($('#heroCv'), { kind: 'football', count: 10 });
$('#snapDate').textContent = SNAP.asOf || 'recently';
const etOffset = d => (d >= Date.UTC(2026, 10, 1, 6) && d < Date.UTC(2027, 2, 14, 7)) ? 5 : 4;
function kickoffTime(dateStr) { const [y, m, d] = dateStr.split('-').map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); const [hh, mm] = dow === 0 ? [13, 0] : dow === 6 ? [16, 30] : [20, 15]; const g = Date.UTC(y, m - 1, d, hh, mm); return g + etOffset(g) * 36e5; }
let nextKick = null;
setInterval(() => { if (nextKick) $('#hbKick').textContent = Date.now() > nextKick && Date.now() < nextKick + 4 * 36e5 ? 'LIVE' : fmtCountdown(nextKick); }, 1000);
function updateBoard() {
  $('#hbWeek').textContent = `WEEK ${G.week}`;
  const open = G.sched.filter(g => g.status !== 'complete').sort((a, b) => a.date.localeCompare(b.date));
  if (open.length) nextKick = kickoffTime(open[0].date);
  const ls = allLeagues(); $('#hbLeagues').textContent = ls.length;
  let w = 0, l = 0, t = 0; for (const L of G.sleeperLeagues) if (L.me && !L.chopped) { w += L.me.w; l += L.me.l; t += L.me.t; }
  $('#hbRecord').textContent = `${w}-${l}${t ? '-' + t : ''}`;
  const n = ls.reduce((s, L) => s + alertsFor(L).length, 0);
  $('#hbAlerts').textContent = ls.length ? (n ? n : 'ALL CLEAR') : '–';
}

/* ---------- router ---------- */
const VIEWS = ['gameday', 'leagues', 'startsit', 'waivers', 'dynasty', 'trade', 'mock', 'plan'];
const renderers = {};
function show(v) {
  if (!VIEWS.includes(v)) v = 'gameday';
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v ? 'true' : 'false'));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  G.view = v; if (renderers[v]) renderers[v]();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; if (location.hash.slice(1) === b.dataset.v) show(b.dataset.v); else location.hash = b.dataset.v; });
addEventListener('hashchange', () => show(location.hash.slice(1)));
document.addEventListener('click', e => { const el = e.target.closest('[data-pid]'); if (el && !e.target.closest('button,a,input')) openPlayer(el.dataset.pid); });

/* ---------- league chips ---------- */
function chips(el, onPick) {
  const ls = allLeagues(), cur = selLeague();
  if (!ls.length) { el.innerHTML = ''; return; }
  el.innerHTML = ls.map(L => `<button data-id="${esc(L.id)}" class="${cur && cur.id === L.id ? 'on' : ''}" title="${esc(L.name)}">${esc(L.name)}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; setSel(b.dataset.id); onPick(); };
}
function needLeagues(el) {
  if (allLeagues().length) return false;
  el.innerHTML = `<div class="card empty"><div style="font-size:40px">🏈</div><h3 style="margin:8px 0">No leagues yet</h3><p class="sub">Connect your Sleeper username or add a league by hand on the Gameday tab.</p><a class="btn gold" href="#gameday">Go to Gameday</a></div>`;
  return true;
}

/* =================== GAMEDAY =================== */
function renderConnect() {
  const box = $('#connectBox'), name = ST.get('username', '');
  if (G.user) {
    box.innerHTML = `<div class="card" style="margin-bottom:16px;padding:12px 16px"><div class="row"><span class="tag good live-dot">● LIVE</span><b>${esc(G.user.display_name || G.user.username)}</b><span class="sub">${G.sleeperLeagues.length} Sleeper league${G.sleeperLeagues.length === 1 ? '' : 's'} · ${manualList().length} manual · Week ${G.week}</span><span class="sub" id="syncAgo" style="font-size:12px"></span><span class="sp"></span><button class="btn small" id="gdRefresh">↻ Refresh</button><button class="btn small" id="gdManual">+ Add ESPN/Yahoo league</button><button class="btn small ghost" id="gdSwitch">Switch user</button></div></div>`;
    $('#gdRefresh').onclick = async () => { $('#gdRefresh').disabled = true; await refreshLive(true); toast('Scores refreshed'); const b = $('#gdRefresh'); if (b) b.disabled = false; };
    $('#gdSwitch').onclick = () => { G.user = null; G.sleeperLeagues = []; ST.del('username'); ST.del('summaries'); renderGameday(); updateBoard(); };
    $('#gdManual').onclick = () => manualForm();
    return;
  }
  box.innerHTML = `<div class="connect" style="margin-bottom:16px">
    <div class="card hash"><div class="eyebrow">Step onto the field</div><div class="big">Connect your Sleeper leagues</div>
      <p class="sub">Enter your Sleeper username. Football HQ reads your leagues, rosters and matchups from Sleeper's public API. It's read-only and doesn't need a password.</p>
      <form id="cnForm"><label class="vh" for="cnName">Sleeper username</label><input type="text" id="cnName" placeholder="Sleeper username" value="${esc(name)}" autocomplete="username" required><button class="btn gold" type="submit">Load my leagues</button></form>
      <div class="sub" id="cnMsg" style="margin-top:8px"></div></div>
    <div class="card"><div class="eyebrow">Not on Sleeper?</div><h3 style="margin:8px 0 6px">Add an ESPN or Yahoo league</h3><p class="sub">Type in your roster and scoring, and Start/Sit and Waivers work off Sleeper's projections. You can add as many as you like.</p><button class="btn" id="cnManual">+ Add a league by hand</button>
      <ul class="sub" style="margin:14px 0 0;padding-left:18px;line-height:1.8"><li>Live scores and win odds for every matchup</li><li>Lineup alerts for byes, injuries and empty slots</li><li>Waiver targets that are actually free in your league</li></ul></div></div>`;
  $('#cnForm').onsubmit = async e => {
    e.preventDefault(); const v = $('#cnName').value.trim(); if (!v) return;
    $('#cnMsg').innerHTML = '<div class="spinner" style="margin:6px 0"></div>';
    try { await loadUser(v); LIVE.last = LIVE.proj = Date.now(); scheduleLive(); toast(`Loaded ${G.sleeperLeagues.length} league${G.sleeperLeagues.length === 1 ? '' : 's'}`); const r = $('#cnForm').getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 60); renderGameday(); updateBoard(); }
    catch (err) { $('#cnMsg').textContent = err.message || 'Could not reach Sleeper.'; }
  };
  $('#cnManual').onclick = () => manualForm();
}
function wpBar(wp) { const pc = Math.round(clamp(wp, .02, .98) * 100); return `<div class="wp" data-w="${pc}"><i style="width:50%"></i><b style="left:50%"></b></div>`; }
function animateBars(root) { if (G.silent) { $$('.wp', root).forEach(el => { const i = el.querySelector('i'), b = el.querySelector('b'); i.style.transition = b.style.transition = 'none'; i.style.width = b.style.left = el.dataset.w + '%'; }); return; } requestAnimationFrame(() => setTimeout(() => $$('.wp', root).forEach(el => { const w = el.dataset.w + '%'; el.querySelector('i').style.width = w; el.querySelector('b').style.left = w; }), 60)); }
function renderGameday() {
  renderConnect();
  const body = $('#gamedayBody'), ls = allLeagues();
  if (!ls.length) { body.innerHTML = ''; return; }
  const cards = ls.map(L => {
    const bits = fmtBits(L).slice(0, 3).map(b => `<span class="tag rk">${esc(b)}</span>`).join(' ');
    if (L.kind === 'manual') {
      const o = optimize(L, G.week);
      return `<div class="card mcard tilt reveal" data-lg="${esc(L.id)}"><div class="row"><div class="lgname">${esc(L.name)}</div><span class="sp"></span>${bits}</div>
        <div class="vs"><div class="side me"><div class="tm">Your best lineup</div><div class="sc num">${f1(o.best)}</div><div class="pj">projected · week ${G.week}</div></div><div class="mid">${esc(L.platform || '')}</div><div class="side r"><div class="tm">${L.myIds.length} players</div><div class="pj">${L.url ? `<a href="${esc(L.url)}" target="_blank" rel="noopener">Open league ↗</a>` : 'Manual league'}</div></div></div>
        <div class="sub">Set this lineup on ${esc(L.platform || 'your site')}. Start/Sit has the slot-by-slot breakdown.</div></div>`;
    }
    if (L.chopped) return chopCard(L, bits);
    const m = matchupOf(L), rec = L.me ? `${L.me.w}-${L.me.l}${L.me.t ? '-' + L.me.t : ''}` : '';
    const rk = L.me ? `<span class="tag ${L.me.rank <= L.playoff ? 'good' : 'q'}">#${L.me.rank} of ${L.teams}</span>` : '';
    if (!m) return `<div class="card mcard tilt reveal" data-lg="${esc(L.id)}"><div class="row"><div class="lgname">${esc(L.name)}</div><span class="sp"></span>${bits}</div><p class="sub" style="margin-top:14px">No matchup this week. ${L.mine ? '' : "You don't own a team in this league."}</p><div class="row">${rk}<span class="sub">${rec}</span></div></div>`;
    return `<div class="card mcard tilt reveal" data-lg="${esc(L.id)}"><div class="row"><div class="lgname">${esc(L.name)}</div><span class="sp"></span>${bits}</div>
      <div class="vs"><div class="side me"><div class="tm">${esc(m.myName)}</div><div class="sc num">${f1(m.myPts)}</div><div class="pj">proj ${f1(m.myProj)}</div></div><div class="mid">VS</div>
      <div class="side r"><div class="tm">${esc(m.oppName)}</div><div class="sc num">${f1(m.oppPts)}</div><div class="pj">proj ${f1(m.oppProj)}</div></div></div>
      ${m.wp != null ? wpBar(m.wp) : ''}<div class="row" style="margin-top:8px">${m.wp != null ? `<b style="font-family:var(--font-jersey);color:${m.wp >= .5 ? 'var(--lime)' : '#fda4af'}">${Math.round(m.wp * 100)}%</b><span class="sub">to win</span>` : ''}<span class="sp"></span>${rk}<span class="sub">${rec}</span></div></div>`;
  }).join('');
  const alerts = ls.flatMap(alertsFor);
  body.innerHTML = `<div class="vhead"><div><h2>Week ${G.week}</h2><div class="sub">Live scores update when you refresh. Projections add Sleeper's forecast for players who haven't played yet.</div></div></div>
    <div class="mcards">${cards}</div>
    <div class="yard"><span>2 0</span></div>
    <div class="grid g2">
      <div class="card hash"><div class="head"><h3>Lineup alerts</h3><span class="sp"></span><span class="tag ${alerts.length ? 'q' : 'good'}">${alerts.length || 'All clear'}</span></div>
        ${alerts.length ? alerts.map(a => `<div class="alert ${a.k}"><span class="k">${esc(a.tag)}</span><div style="min-width:0"><div class="sub" style="font-size:12px">${esc(a.L.name)}</div>${a.html}${a.fix ? ` <a href="#startsit" data-fix="${esc(a.L.id)}">Fix it →</a>` : ''}</div></div>`).join('') : `<div class="alert ok"><span class="k">OK</span><div>Every lineup is set: no byes, no one ruled out, no better options on the bench.</div></div>`}</div>
      <div class="card hash"><div class="head"><h3>Trending on Sleeper</h3><span class="sp"></span><span class="sub">adds, last 24h</span></div><div id="gdTrend"><div class="spinner"></div></div></div>
    </div>`;
  $$('.mcard', body).forEach(c => { tilt(c, 5); c.onclick = e => { if (e.target.closest('a')) return; setSel(c.dataset.lg); location.hash = 'leagues'; }; });
  $$('[data-fix]', body).forEach(a => a.onclick = () => setSel(a.dataset.fix));
  if (G.silent) $$('.reveal', body).forEach(e => { e.style.transition = 'none'; e.classList.add('in'); }); else reveal(body);
  animateBars(body); loadTrendingInto($('#gdTrend'));
}
function chopCard(L, bits) {
  const head = `<div class="row"><div class="lgname">${esc(L.name)}</div><span class="sp"></span>${bits}</div>`;
  if (L.myElim) return `<div class="card mcard tilt reveal" data-lg="${esc(L.id)}">${head}<div class="chopped-out">🪓 Chopped in week ${L.myElim}</div><p class="sub">You're out of this one. The Leagues tab still shows who's left on the chopping block.</p></div>`;
  const c = chopInfo(L);
  if (!c.me) return `<div class="card mcard tilt reveal" data-lg="${esc(L.id)}">${head}<p class="sub" style="margin-top:14px">No scores yet this week.</p></div>`;
  const safe = c.cushion == null || c.cushion >= 0;
  return `<div class="card mcard chop tilt reveal" data-lg="${esc(L.id)}">${head}
    <div class="vs"><div class="side me"><div class="tm">${esc(c.me.name)}</div><div class="sc num">${f1(c.me.pts)}</div><div class="pj">proj ${f1(c.me.proj)} · #${c.me.rank} of ${c.alive}</div></div><div class="mid" title="Lowest score is eliminated">🪓</div>
    <div class="side r"><div class="tm">Chopping block</div><div class="sc num low">${c.low ? f1(c.low.proj) : '–'}</div><div class="pj">${c.low ? (safe ? 'lowest: ' : 'next-lowest: ') + esc(c.low.name) : ''}</div></div></div>
    ${c.survive != null ? wpBar(c.survive) : ''}<div class="row" style="margin-top:8px">${c.survive != null ? `<b style="font-family:var(--font-jersey);color:${c.survive >= .75 ? 'var(--lime)' : c.survive >= .4 ? '#fde68a' : '#fda4af'}">${Math.round(c.survive * 100)}%</b><span class="sub">to survive</span>` : ''}<span class="sp"></span>
    <span class="tag ${safe ? 'good' : 'inj'}">${c.cushion == null ? '' : (safe ? '+' : '−') + f1(Math.abs(c.cushion)) + (safe ? ' cushion' : ' short')}</span><span class="sub">${c.alive} of ${L.teams} left</span></div></div>`;
}
async function trending() {
  if (G.trend) return G.trend;
  const [add, drop] = await Promise.all([sleeper('/v1/players/nfl/trending/add?lookback_hours=24&limit=40'), sleeper('/v1/players/nfl/trending/drop?lookback_hours=24&limit=25')]);
  return (G.trend = { add, drop });
}
function rosteredSet(L) { const s = new Set(); if (L.kind === 'sleeper') for (const r of L.rosters) { for (const id of (r.players || [])) s.add(id); for (const id of (r.taxi || [])) s.add(id); for (const id of (r.reserve || [])) s.add(id); } else for (const id of L.myIds) s.add(id); return s; }
async function loadTrendingInto(el) {
  try {
    const t = await trending(), sl = G.sleeperLeagues, sets = sl.map(rosteredSet);
    el.innerHTML = t.add.slice(0, 10).map((a, i) => {
      const p = pl(a.player_id), free = sets.filter(s => !s.has(a.player_id)).length;
      return `<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--line);flex-wrap:nowrap"><span class="team" style="min-width:26px;text-align:center">${i + 1}</span><div style="flex:1;min-width:0">${pcell(p)}</div>${sl.length ? `<span class="tag ${free ? 'good' : 'q'}">${free ? `Free in ${free}/${sl.length}` : 'Rostered'}</span>` : ''}<span class="up num" style="font:700 12px var(--font-mono);color:var(--lime)">▲${a.count.toLocaleString()}</span></div>`;
    }).join('');
  } catch (e) { el.innerHTML = '<div class="empty">Trending data is unavailable right now.</div>'; }
}

/* ---------- manual league form ---------- */
function manualForm(existing) {
  const m = existing || { id: 'm_' + Date.now(), name: '', platform: 'ESPN', url: '', scoring: 'ppr', sf: false, roster: [], notes: '' };
  const roster = [...m.roster];
  openModal(`<div class="modal-head"><div><div class="eyebrow">${existing ? 'Edit league' : 'New league'}</div><h2>${existing ? esc(m.name) : 'Add a league'}</h2></div><button class="xbtn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body"><form id="mfForm" class="grid" style="gap:12px">
      <div class="grid g2"><label class="f">League name<input type="text" id="mfName" required value="${esc(m.name)}" placeholder="Work league"></label>
      <label class="f">Platform<select id="mfPlat">${['ESPN', 'Yahoo', 'NFL.com', 'CBS', 'Fleaflicker', 'Other'].map(x => `<option ${x === m.platform ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <div class="grid g2"><label class="f">Scoring<select id="mfScore"><option value="ppr" ${m.scoring === 'ppr' ? 'selected' : ''}>PPR</option><option value="half" ${m.scoring === 'half' ? 'selected' : ''}>Half PPR</option><option value="std" ${m.scoring === 'std' ? 'selected' : ''}>Standard</option></select></label>
      <label class="f">League link (optional)<input type="text" id="mfUrl" value="${esc(m.url)}" placeholder="https://…"></label></div>
      <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="mfSf" ${m.sf ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"><span class="sub">Superflex slot</span></label>
      <div><div class="eyebrow" style="margin-bottom:6px">Your roster</div><div class="picker"><input type="search" id="mfSearch" placeholder="Search players to add…" style="width:100%" autocomplete="off"><div class="dd" id="mfDD"></div></div><div id="mfRoster" style="margin-top:8px"></div></div>
      <label class="f">Notes<textarea id="mfNotes" placeholder="Trade ideas, league quirks…">${esc(m.notes || '')}</textarea></label>
      <div class="row">${existing ? '<button type="button" class="btn ghost" id="mfDel" style="color:#fda4af">Delete league</button>' : ''}<span class="sp"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn gold" type="submit">Save league</button></div>
    </form></div>`);
  const draw = () => { $('#mfRoster').innerHTML = roster.length ? roster.map(id => { const p = pl(id); return `<div class="row" style="padding:5px 0;border-bottom:1px dashed var(--line);flex-wrap:nowrap"><div style="flex:1;min-width:0">${pcell(p)}</div><button type="button" class="btn small ghost" data-rm="${esc(id)}" aria-label="Remove ${esc(p.name)}">✕</button></div>`; }).join('') : '<div class="sub">No players yet.</div>'; };
  draw();
  $('#mfRoster').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { roster.splice(roster.indexOf(b.dataset.rm), 1); draw(); } };
  playerPicker($('#mfSearch'), $('#mfDD'), id => { if (!roster.includes(id)) roster.push(id); draw(); }, { exclude: () => roster });
  $('#mfForm').onsubmit = e => {
    e.preventDefault();
    const rec = { ...m, name: $('#mfName').value.trim() || 'My league', platform: $('#mfPlat').value, scoring: $('#mfScore').value, url: $('#mfUrl').value.trim(), sf: $('#mfSf').checked, roster, notes: $('#mfNotes').value };
    if (rec.url && !/^https?:\/\//i.test(rec.url)) rec.url = 'https://' + rec.url;
    const list = manualList().filter(x => x.id !== rec.id); list.push(rec); ST.set('manual', list); setSel(rec.id);
    closeModal(); toast('League saved'); rerender();
  };
  if (existing) $('#mfDel').onclick = () => { if (!confirm(`Delete ${m.name}?`)) return; ST.set('manual', manualList().filter(x => x.id !== m.id)); closeModal(); toast('League deleted'); rerender(); };
}
function rerender() { updateBoard(); show(G.view || 'gameday'); }

/* ---------- player search picker (shared) ---------- */
function searchPlayers(q, { positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], limit = 12, exclude = [] } = {}) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const ex = new Set(exclude), out = [];
  for (const p of Object.values(P)) {
    if (!positions.includes(p.pos) || ex.has(p.id)) continue;
    const n = p.name.toLowerCase(), i = n.indexOf(q), t = (p.team || '').toLowerCase() === q;
    if (i < 0 && !t) continue;
    out.push({ p, s: (i === 0 ? 0 : i > 0 && n[i - 1] === ' ' ? 1 : 2) * 1e5 + (p.rank || 9e4) });
  }
  return out.sort((a, b) => a.s - b.s).slice(0, limit).map(x => x.p);
}
function playerPicker(input, dd, onPick, opts = {}) {
  let items = [], hi = 0;
  const draw = () => {
    items = opts.source ? opts.source(input.value) : searchPlayers(input.value, { exclude: opts.exclude ? opts.exclude() : [], positions: opts.positions });
    hi = 0;
    dd.innerHTML = items.map((it, i) => opts.renderItem ? `<button type="button" data-i="${i}" class="${i === hi ? 'hi' : ''}">${opts.renderItem(it)}</button>` : `<button type="button" data-i="${i}" class="${i === hi ? 'hi' : ''}">${ph(it)}<span style="min-width:0"><b>${esc(it.name)}</b> ${posTag(it.pos)} <span class="team">${esc(it.team)}</span></span></button>`).join('');
    dd.classList.toggle('on', items.length > 0);
  };
  input.addEventListener('input', draw);
  input.addEventListener('focus', () => { if (input.value) draw(); });
  input.addEventListener('keydown', e => {
    if (!dd.classList.contains('on')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$('button', dd).forEach((b, i) => b.classList.toggle('hi', i === hi)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[hi]) pick(items[hi]); }
    else if (e.key === 'Escape') dd.classList.remove('on');
  });
  dd.addEventListener('mousedown', e => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); pick(items[+b.dataset.i]); } });
  input.addEventListener('blur', () => setTimeout(() => dd.classList.remove('on'), 120));
  function pick(it) { onPick(opts.source ? it : it.id); input.value = ''; dd.classList.remove('on'); }
}

/* =================== LEAGUES =================== */
function renderLeagues() {
  const body = $('#leagueBody');
  if (needLeagues(body)) { $('#lgChipsL').innerHTML = ''; return; }
  chips($('#lgChipsL'), renderLeagues);
  const L = selLeague(), w = G.week;
  const bits = fmtBits(L).map(b => `<span class="tag rk">${esc(b)}</span>`).join(' ');
  const rosterRows = (ids, label) => ids.length ? `<div class="eyebrow" style="margin:14px 0 4px">${label}</div>` + ids.map(id => { const e = evalPlayer(id, L, w); return `<div class="slot"><span>${posTag(e.p.pos)}</span>${pcell(e.p, e.opp.opp ? `${e.opp.home ? 'vs' : '@'} ${esc(e.opp.opp)}` : onBye(e.p.team, w) ? '<span class="tag bye">BYE</span>' : '')}<div class="pts">${f1(e.raw)}<small>proj</small></div></div>`; }).join('') : '';
  if (L.kind === 'manual') {
    const o = optimize(L, w);
    body.innerHTML = `<div class="grid g2"><div class="card hash"><div class="head"><h3>${esc(L.name)}</h3><span class="sp"></span><button class="btn small" id="lgEdit">Edit league</button></div><div class="row" style="margin-bottom:6px">${bits}</div>
      ${L.url ? `<a class="btn small" href="${esc(L.url)}" target="_blank" rel="noopener">Open on ${esc(L.platform)} ↗</a>` : ''}
      ${rosterRows(o.lineup.filter(Boolean).map(e => e.id), 'Best lineup this week')}${rosterRows(o.bench.map(e => e.id), 'Bench')}</div>
      <div class="card hash"><div class="head"><h3>Notes</h3></div><textarea id="lgNotes" style="min-height:240px" placeholder="Trade targets, league quirks, who's tilting…">${esc(L.m.notes || '')}</textarea><div class="sub" style="margin-top:6px">Saved automatically.</div></div></div>`;
    $('#lgEdit').onclick = () => manualForm(L.m);
    $('#lgNotes').oninput = e => { const list = manualList(); const r = list.find(x => x.id === L.id); if (r) { r.notes = e.target.value; ST.set('manual', list); } };
    return;
  }
  if (L.chopped) return renderChopLeague(L, body, bits, rosterRows, w);
  const m = matchupOf(L);
  const h2h = m ? (() => {
    const rows = L.slots.map((s, i) => {
      const a = m.me.starters && m.me.starters[i], b = m.opp && m.opp.starters && m.opp.starters[i];
      const side = (id, pts, r) => id && id !== '0' ? `<div class="p ${r ? 'r' : ''}" data-pid="${esc(id)}" style="cursor:pointer">${ph(pl(id))}<b>${esc(pl(id).name)}</b><span class="v">${f1(pts || 0)}</span></div>` : `<div class="p ${r ? 'r' : ''}"><span class="sub">Empty</span></div>`;
      return side(a, m.me.starters_points && m.me.starters_points[i]) + `<div class="c">${esc(SLOT_LBL[s] || s)}</div>` + side(b, m.opp && m.opp.starters_points && m.opp.starters_points[i], true);
    }).join('');
    return `<div class="vs"><div class="side me"><div class="tm">${esc(m.myName)}</div><div class="sc">${f1(m.myPts)}</div><div class="pj">proj ${f1(m.myProj)}</div></div><div class="mid">VS</div><div class="side r"><div class="tm">${esc(m.oppName)}</div><div class="sc">${f1(m.oppPts)}</div><div class="pj">proj ${f1(m.oppProj)}</div></div></div>${m.wp != null ? wpBar(m.wp) : ''}<div class="h2h" style="margin-top:12px">${rows}</div>`;
  })() : '<div class="empty">No matchup this week.</div>';
  const S = L.standings;
  const stand = `<div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="r">W-L</th><th class="r">PF</th><th class="r">PA</th></tr></thead><tbody>${S.map((s, i) => `<tr class="${s.me ? 'me' : ''} ${i + 1 === L.playoff ? 'cut' : ''}"><td class="num">${s.rank}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</td><td class="r num">${s.w}-${s.l}${s.t ? '-' + s.t : ''}</td><td class="r num">${f1(s.pf)}</td><td class="r num">${f1(s.pa)}</td></tr>`).join('')}</tbody></table></div><div class="sub" style="margin-top:6px">Dashed line = playoff cut (top ${L.playoff}).</div>`;
  const starters = (L.starters || []).filter(id => id && id !== '0'), bench = L.myIds.filter(id => !starters.includes(id) && !L.ir.includes(id) && !L.taxi.includes(id));
  const sc = L.scoring, st = L.lg.settings || {};
  const info = [['Reception', sc.rec ?? 0], ['Pass TD', sc.pass_td ?? 4], ['Pass yds / pt', sc.pass_yd ? Math.round(1 / sc.pass_yd) : '–'], ['Rush/Rec yds / pt', sc.rush_yd ? Math.round(1 / sc.rush_yd) : '–'], ['TE bonus / rec', sc.bonus_rec_te || 0], ['INT', sc.pass_int ?? -1], ['Fumble lost', sc.fum_lost ?? -2], ['Playoff teams', L.playoff], ['FAAB budget', st.waiver_budget != null ? '$' + st.waiver_budget : '–'], ['Trade deadline', st.trade_deadline ? 'Week ' + st.trade_deadline : 'None']];
  body.innerHTML = `<div class="grid g2">
    <div class="card hash"><div class="head"><h3>Week ${w} matchup</h3><span class="sp"></span><a class="btn small" href="https://sleeper.com/leagues/${esc(L.id)}" target="_blank" rel="noopener">Open in Sleeper ↗</a></div>${h2h}</div>
    <div class="card hash"><div class="head"><h3>Standings</h3><span class="sp"></span>${L.me ? `<span class="tag ${L.me.rank <= L.playoff ? 'good' : 'q'}">You're #${L.me.rank}</span>` : ''}</div>${stand}</div>
    <div class="card hash"><div class="head"><h3>Your roster</h3><span class="sp"></span><a class="btn small" href="#startsit">Optimize →</a></div>${rosterRows(starters, 'Starters')}${rosterRows(bench, 'Bench')}${rosterRows(L.ir, 'Injured reserve')}${rosterRows(L.taxi, 'Taxi squad')}</div>
    <div class="card hash"><div class="head"><h3>League settings</h3></div><div class="row" style="margin-bottom:10px">${bits}</div><div class="mstat">${info.map(([l, v]) => `<div><span class="l">${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="eyebrow" style="margin:16px 0 6px">Lineup</div><div class="row">${L.slots.map(posTag).join(' ')}</div></div>
  </div>`;
  animateBars(body);
}

function renderChopLeague(L, body, bits, rosterRows, w) {
  const c = chopInfo(L), st = L.lg.settings || {};
  const block = c.rows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="r">Pts</th><th class="r">Proj</th><th class="r">Left</th></tr></thead><tbody>${c.rows.map((x, i) => `<tr class="${x.me ? 'me' : ''} ${i === c.rows.length - 1 ? 'danger' : ''}"><td class="num">${x.rank}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${i === c.rows.length - 1 ? '🪓 ' : ''}${esc(x.name)}</td><td class="r num">${f1(x.pts)}</td><td class="r num">${f1(x.proj)}</td><td class="r num">${x.rem ? Math.ceil(x.rem) : '✓'}</td></tr>`).join('')}</tbody></table></div>
    <div class="sub" style="margin-top:6px">Sorted by projected final score. The bottom team gets chopped. "Left" is how many starters haven't finished.</div>` : '<div class="empty">No scores yet this week.</div>';
  const top = L.myElim ? `<div class="chopped-out">🪓 You were chopped in week ${L.myElim}</div>`
    : c.me ? `<div class="vs"><div class="side me"><div class="tm">${esc(c.me.name)}</div><div class="sc">${f1(c.me.pts)}</div><div class="pj">proj ${f1(c.me.proj)} · #${c.me.rank} of ${c.alive}</div></div><div class="mid">🪓</div><div class="side r"><div class="tm">Survival odds</div><div class="sc" style="color:${c.survive >= .75 ? 'var(--lime)' : c.survive >= .4 ? '#fde68a' : '#fda4af'}">${c.survive != null ? Math.round(c.survive * 100) + '%' : '–'}</div><div class="pj">${c.cushion != null ? (c.cushion >= 0 ? f1(c.cushion) + ' above' : f1(-c.cushion) + ' below') + ' the next-lowest' : ''}</div></div></div>${c.survive != null ? wpBar(c.survive) : ''}` : '';
  const survivors = L.standings.filter(s => !s.elim), outs = L.standings.filter(s => s.elim);
  const surv = `<div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="r">Total pts</th><th class="r">Status</th></tr></thead><tbody>
    ${survivors.map((s, i) => `<tr class="${s.me ? 'me' : ''}"><td class="num">${i + 1}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</td><td class="r num">${f1(s.pf)}</td><td class="r"><span class="tag good">Alive</span></td></tr>`).join('')}
    ${outs.map(s => `<tr class="${s.me ? 'me' : ''}" style="opacity:.55"><td class="num">–</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</td><td class="r num">${f1(s.pf)}</td><td class="r"><span class="tag inj">Chopped wk ${s.elim}</span></td></tr>`).join('')}</tbody></table></div>`;
  const myRoster = L.mine ? (L.mine.settings || {}) : {};
  const info = [['Format', 'Chopped'], ['Teams left', `${c.alive} of ${L.teams}`], ['Last chop', c.lastChop ? 'Week ' + c.lastChop : 'None yet'], ['Reception', L.scoring.rec ?? 0], ['Pass TD', L.scoring.pass_td ?? 4],
    ['FAAB budget', st.waiver_budget != null ? '$' + st.waiver_budget : '–'], ['Your FAAB left', st.waiver_budget != null && L.mine ? '$' + (st.waiver_budget - (myRoster.waiver_budget_used || 0)) : '–'], ['Waivers clear', st.waiver_clear_days != null ? st.waiver_clear_days + ' days' : '–']];
  const starters = (L.starters || []).filter(id => id && id !== '0'), bench = L.myIds.filter(id => !starters.includes(id) && !L.ir.includes(id) && !L.taxi.includes(id));
  body.innerHTML = `<div class="grid g2">
    <div class="card hash"><div class="head"><h3>Week ${w} chopping block</h3><span class="sp"></span><a class="btn small" href="https://sleeper.com/leagues/${esc(L.id)}" target="_blank" rel="noopener">Open in Sleeper ↗</a></div>${top}<div style="margin-top:12px">${block}</div></div>
    <div class="card hash"><div class="head"><h3>Survivors</h3><span class="sp"></span><span class="tag ${L.myElim ? 'inj' : 'good'}">${L.myElim ? 'You: chopped wk ' + L.myElim : 'You: alive'}</span></div>${surv}
      <div class="sub" style="margin-top:6px">No opponents and no win/loss record here. You just need to avoid the lowest score each week.</div></div>
    <div class="card hash"><div class="head"><h3>Your roster</h3><span class="sp"></span><a class="btn small" href="#startsit">Optimize →</a></div>${rosterRows(starters, 'Starters')}${rosterRows(bench, 'Bench')}${rosterRows(L.ir, 'Injured reserve')}</div>
    <div class="card hash"><div class="head"><h3>League settings</h3></div><div class="row" style="margin-bottom:10px">${bits}</div><div class="mstat">${info.map(([l, v]) => `<div><span class="l">${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="eyebrow" style="margin:16px 0 6px">Lineup</div><div class="row">${L.slots.map(posTag).join(' ')}</div>
      <div class="sub" style="margin-top:10px">Chopped teams' players go straight to waivers, so check the Waivers tab after every chop.</div></div>
  </div>`;
  animateBars(body);
}

/* =================== START / SIT =================== */
function defaultSsWeek() { const gs = G.sched.filter(g => g.week === G.week); const done = gs.filter(g => g.status === 'complete').length; return gs.length && done / gs.length >= .75 && G.week < 18 ? G.week + 1 : G.week; }
function weekOptions() {
  const sel = $('#ssWeek'), cur = +sel.value || defaultSsWeek();
  sel.innerHTML = [G.week, G.week + 1, G.week + 2].filter(x => x <= 18).map(x => `<option value="${x}" ${x === cur ? 'selected' : ''}>Week ${x}${x === G.week ? ' (current)' : ''}</option>`).join('');
}
$('#ssWeek').onchange = () => renderStartSit();
async function renderStartSit() {
  const body = $('#ssBody'); weekOptions();
  const w = +$('#ssWeek').value || defaultSsWeek();
  if (needLeagues(body)) { $('#lgChipsS').innerHTML = ''; renderCompare(); return; }
  chips($('#lgChipsS'), renderStartSit);
  if (!G.wk[w]) { body.innerHTML = '<div class="spinner"></div>'; try { await loadWeek(w); } catch (e) { body.innerHTML = '<div class="card empty">Projections are unavailable right now.</div>'; return; } }
  const L = selLeague(), o = optimize(L, w), hasCur = !!o.cur;
  const curSet = new Set(hasCur ? o.cur.filter(Boolean).map(e => e.id) : []);
  const changes = hasCur ? o.lineup.filter(e => e && !curSet.has(e.id)).length : 0;
  const gain = hasCur ? o.best - o.now : null;
  const cellHtml = (e, cls = '') => e ? `<div class="cell ${cls}" data-pid="${esc(e.id)}" style="cursor:pointer">${ph(e.p)}<b>${esc(e.p.name)}${e.locked && w === G.week ? ' 🔒' : ''}</b>${e.flag ? `<span class="tag ${e.flag === 'BYE' ? 'bye' : e.flag === 'Q' ? 'q' : e.flag === 'FINAL' || e.flag === 'LIVE' ? 'good' : 'inj'}">${esc(e.flag)}</span>` : ''}<span class="v">${f1(e.v)}</span></div>` : `<div class="cell bad"><span class="sub">Empty</span></div>`;
  const rows = L.slots.map((s, i) => {
    const b = o.lineup[i], c = hasCur ? o.cur[i] : null, chg = hasCur && b && (!c || c.id !== b.id);
    return `<div>${posTag(s)}</div>${hasCur ? cellHtml(c, c && !c.actual && (c.flag === 'BYE' || c.flag === 'OUT') ? 'bad' : '') : '<div class="cell"><span class="sub">—</span></div>'}<div class="arr ${chg ? 'go' : ''}">${chg ? '→' : '='}</div>${cellHtml(b, chg ? 'chg' : '')}`;
  }).join('');
  body.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:16px" id="ssGrid">
    <div class="card hash"><div class="head"><h3>${esc(L.name)}</h3><span class="sp"></span>${fmtBits(L).slice(0, 3).map(b => `<span class="tag rk">${esc(b)}</span>`).join(' ')}</div>
      <div class="lineup"><div class="hd">Slot</div><div class="hd">${hasCur ? 'Current' : ''}</div><div></div><div class="hd">Best</div>${rows}</div></div>
    <div class="grid" style="align-content:start;gap:16px">
      <div class="card" style="text-align:center"><div class="eyebrow">${hasCur ? 'Projected gain' : 'Best lineup projects'}</div><div class="bigdelta" id="ssBig">0.0</div>
        <div class="sub">${hasCur ? (changes ? `${changes} change${changes === 1 ? '' : 's'} to make in Sleeper` : 'Your lineup is already optimal 👌') : `${esc(L.platform || 'Manual')} league · set it by hand`}</div>
        ${hasCur && changes ? `<a class="btn gold" style="margin-top:12px" href="https://sleeper.com/leagues/${esc(L.id)}" target="_blank" rel="noopener">Make the swaps in Sleeper ↗</a>` : ''}</div>
      <div class="card hash"><div class="head"><h3>Bench</h3></div>${o.bench.length ? o.bench.map(e => `<div class="slot"><span>${posTag(e.p.pos)}</span>${pcell(e.p, e.opp.opp ? `${e.opp.home ? 'vs' : '@'} ${esc(e.opp.opp)}` : e.flag === 'BYE' ? '<span class="tag bye">BYE</span>' : '')}<div class="pts">${f1(e.v)}<small>proj</small></div></div>`).join('') : '<div class="sub">Nobody on the bench.</div>'}</div>
    </div></div>`;
  if (innerWidth < 1000) $('#ssGrid').style.gridTemplateColumns = 'minmax(0,1fr)';
  if (G.silent) $('#ssBig').textContent = (hasCur ? '+' : '') + f1(hasCur ? Math.max(0, gain) : o.best);
  else countUp($('#ssBig'), hasCur ? Math.max(0, gain) : o.best, { dec: 1, prefix: hasCur ? '+' : '' });
  if (hasCur && changes && gain > 3 && !G.silent) { const r = $('#ssBig').getBoundingClientRect(); setTimeout(() => popText(r.left + r.width / 2, r.top, 'UPGRADE!', '#a3e635', 40), 600); }
  renderCompare();
}
let CMP = ST.get('cmp', []);
playerPicker($('#cmpSearch'), $('#cmpDD'), id => { if (!CMP.includes(id)) CMP = [...CMP, id].slice(-4); ST.set('cmp', CMP); renderCompare(true); }, { exclude: () => CMP });
async function renderCompare(fresh) {
  const w = +$('#ssWeek').value || defaultSsWeek(), L = selLeague();
  $('#cmpScoring').textContent = `Week ${w} · ${L ? fmtBits(L)[0] + ' (' + L.name + ')' : 'PPR'}`;
  const grid = $('#cmpGrid');
  if (!CMP.length) { grid.innerHTML = '<div class="sub" style="grid-column:1/-1">No players picked yet.</div>'; return; }
  if (!G.wk[w]) await loadWeek(w).catch(() => {});
  await loadStats();
  const es = CMP.map(id => evalPlayer(id, L, w)), max = Math.max(...es.map(e => e.v), 1), best = es.reduce((a, b) => b.v > a.v ? b : a, es[0]);
  grid.innerHTML = es.map(e => { const g = ppg(e.id, L); return `<div class="cmp"><button class="btn small ghost x" data-x="${esc(e.id)}" aria-label="Remove ${esc(e.p.name)}">✕</button>${es.length > 1 ? `<div class="stamp ${e === best ? '' : 'sit'}">${e === best ? 'START' : 'SIT'}</div>` : ''}
    <div data-pid="${esc(e.id)}" style="cursor:pointer">${ph(e.p)}<b style="display:block">${esc(e.p.name)}</b></div><div class="sub">${posTag(e.p.pos)} <span class="team">${esc(e.p.team)}</span> ${e.opp.opp ? `${e.opp.home ? 'vs' : '@'} ${esc(e.opp.opp)}` : '<span class="tag bye">BYE</span>'} ${injTag(e.p.inj)}</div>
    <div class="v" style="color:${e === best ? 'var(--gold)' : 'var(--chalk)'}">${f1(e.v)}</div><div class="sub">projected${g != null ? ` · ${f1(g)} per game` : ''}</div><div class="meter"><i style="width:0" data-w="${(e.v / max * 100).toFixed(0)}"></i></div></div>`; }).join('');
  requestAnimationFrame(() => setTimeout(() => $$('.meter i', grid).forEach(i => i.style.width = i.dataset.w + '%'), 50));
  grid.onclick = e => { const b = e.target.closest('[data-x]'); if (b) { CMP = CMP.filter(x => x !== b.dataset.x); ST.set('cmp', CMP); renderCompare(); } };
  if (fresh && es.length > 1) { const st = $$('.stamp', grid).find(s => !s.classList.contains('sit')); if (st) { const r = st.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 10, 40, .7); } }
}

/* =================== WAIVERS =================== */
let WVPOS = 'ALL';
async function renderWaivers() {
  const body = $('#wvBody');
  if (needLeagues(body)) { $('#lgChipsW').innerHTML = ''; return; }
  chips($('#lgChipsW'), renderWaivers);
  body.innerHTML = '<div class="spinner"></div>';
  const L = selLeague(), w = G.week;
  try { await Promise.all([loadWeek(w), loadWeek(w + 1).catch(() => {}), loadStats(), trending()]); } catch (e) { body.innerHTML = '<div class="card empty">Sleeper data is unavailable right now.</div>'; return; }
  const taken = rosteredSet(L), t = G.trend;
  const trendMap = {}; for (const a of t.add) trendMap[a.player_id] = a.count;
  const hot = t.add.filter(a => !taken.has(a.player_id)).slice(0, 10);
  const pool = Object.keys(G.wk[w] || {}).filter(id => !taken.has(id) && P[id] && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(P[id].pos))
    .map(id => { const e = evalPlayer(id, L, w); return { e, nxt: projFor(id, L, w + 1), g: ppg(id, L), tr: trendMap[id] || 0 }; })
    .filter(x => WVPOS === 'ALL' || x.e.p.pos === WVPOS)
    .sort((a, b) => (b.e.raw + b.nxt) - (a.e.raw + a.nxt)).slice(0, 40);
  let chopHtml = '';
  if (L.chopped) {
    const lw = (L.lg.settings || {}).last_chopped_leg, dead = lw && L.rosters.find(r => (r.settings || {}).eliminated === lw);
    if (dead) {
      const mu = await sleeper(`/v1/league/${L.id}/matchups/${lw}`).catch(() => []), e = mu.find(m => m.roster_id === dead.roster_id);
      const freed = ((e && e.players) || []).filter(id => !taken.has(id) && P[id]).map(id => ({ e: evalPlayer(id, L, w), nxt: projFor(id, L, w + 1) })).sort((a, b) => (b.e.raw + b.nxt) - (a.e.raw + a.nxt));
      const st = L.lg.settings || {}, left = st.waiver_budget != null && L.mine ? st.waiver_budget - ((L.mine.settings || {}).waiver_budget_used || 0) : null;
      chopHtml = `<div class="card hash chopwire" style="margin-bottom:16px"><div class="head"><h3>🪓 Just chopped: ${esc(L.teamName(dead))}</h3><span class="sp"></span><span class="sub">week ${lw}${left != null ? ` · you have $${left} of $${st.waiver_budget} FAAB` : ''}</span></div>
        <div class="sub" style="margin-bottom:8px">Their whole roster went to waivers. These are still unclaimed, best first by the next two weeks' projections.</div>
        ${freed.length ? `<div class="tablewrap"><table><thead><tr><th>Player</th><th class="r">Wk ${w} proj</th><th class="r">Wk ${w + 1} proj</th></tr></thead><tbody>${freed.map(x => `<tr><td>${pcell(x.e.p)}</td><td class="r num">${f1(x.e.raw)}</td><td class="r num">${f1(x.nxt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Every one of their players has already been claimed.</div>'}</div>`;
    }
  }
  const drops = L.myIds.filter(id => !(L.starters || []).includes(id) && !L.ir.includes(id) && !L.taxi.includes(id))
    .map(id => ({ e: evalPlayer(id, L, w), g: ppg(id, L), nxt: projFor(id, L, w + 1) })).sort((a, b) => ((a.g || 0) + a.nxt) - ((b.g || 0) + b.nxt)).slice(0, 5);
  body.innerHTML = chopHtml + `<div class="grid g2">
    <div class="card hash"><div class="head"><h3>🔥 Hot and available</h3><span class="sp"></span><span class="sub">Sleeper adds, last 24h</span></div>
      ${hot.length ? hot.map(a => { const p = pl(a.player_id); return `<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--line);flex-wrap:nowrap"><div style="flex:1;min-width:0">${pcell(p, `<span class="sub">${f1(projFor(p.id, L, w))} proj</span>`)}</div><span style="font:700 12px var(--font-mono);color:var(--lime)">▲${a.count.toLocaleString()}</span></div>`; }).join('') : '<div class="empty">Every trending player is already rostered here.</div>'}
      ${L.kind === 'manual' ? '<div class="sub" style="margin-top:8px">Manual league: only your roster is excluded, so double-check availability on your site.</div>' : ''}</div>
    <div class="card hash"><div class="head"><h3>Drop candidates</h3><span class="sp"></span><span class="sub">your weakest bench spots</span></div>
      ${drops.length ? drops.map(d => `<div class="slot"><span>${posTag(d.e.p.pos)}</span>${pcell(d.e.p, d.g != null ? `<span class="sub">${f1(d.g)} per game</span>` : '')}<div class="pts">${f1(d.nxt)}<small>next wk</small></div></div>`).join('') : '<div class="empty">No bench players to judge.</div>'}</div>
  </div>
  <div class="card hash" style="margin-top:16px"><div class="head"><h3>Best available</h3><span class="sp"></span><div class="chips" id="wvPos">${['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `<button data-p="${p}" class="${p === WVPOS ? 'on' : ''}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div></div>
    <div class="sub" style="margin-bottom:10px">Sorted by projected points over the next two weeks in this league's scoring.</div>
    <div class="tablewrap" style="max-height:560px"><table><thead><tr><th>Player</th><th>Wk ${w}</th><th class="r">Wk ${w} proj</th><th class="r">Wk ${w + 1} proj</th><th class="r">Per game</th><th class="r">Trend</th></tr></thead><tbody>
    ${pool.map(x => `<tr><td>${pcell(x.e.p)}</td><td class="sub">${x.e.opp.opp ? `${x.e.opp.home ? 'vs' : '@'} ${esc(x.e.opp.opp)}` : '<span class="tag bye">BYE</span>'}</td><td class="r num">${f1(x.e.raw)}</td><td class="r num">${f1(x.nxt)}</td><td class="r num">${x.g != null ? f1(x.g) : '–'}</td><td class="r">${x.tr ? `<span class="tag hot">▲${x.tr.toLocaleString()}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  $('#wvPos').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { WVPOS = b.dataset.p; renderWaivers(); } };
}

/* =================== PLAYER CARD =================== */
const modalBg = $('#modalBg');
function openModal(html) { $('#modal').innerHTML = html; modalBg.classList.add('on'); document.body.style.overflow = 'hidden'; const f = $('#modal [data-close]'); if (f) f.focus(); }
function closeModal() { modalBg.classList.remove('on'); document.body.style.overflow = ''; }
modalBg.addEventListener('click', e => { if (e.target === modalBg || e.target.closest('[data-close]')) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && modalBg.classList.contains('on')) closeModal(); });
const CURVE = { QB: { a: 21, rise: 26, fall: 33, end: 39 }, RB: { a: 21, rise: 22, fall: 26, end: 31 }, WR: { a: 21, rise: 24, fall: 29, end: 34 }, TE: { a: 21, rise: 25, fall: 30, end: 35 } };
function curveVal(pos, age) { const c = CURVE[pos]; if (!c) return .5; if (age < c.rise) return clamp(.55 + .45 * (age - c.a) / (c.rise - c.a), .3, 1); if (age <= c.fall) return 1; return clamp(1 - (age - c.fall) / (c.end - c.fall), 0, 1); }
function ageCurveSvg(pos, age) {
  const c = CURVE[pos]; if (!c || age == null) return '';
  const X = a => 20 + (a - 20) / 20 * 500, Y = v => 150 - v * 120;
  let d = ''; for (let a = 20; a <= 40; a += .25) d += (d ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(curveVal(pos, a)).toFixed(1);
  return `<svg viewBox="0 0 540 175" style="width:100%;height:auto" role="img" aria-label="${pos} age curve with this player marked at age ${age.toFixed(1)}">
    <rect x="${X(c.rise)}" y="20" width="${X(c.fall) - X(c.rise)}" height="130" fill="rgba(163,230,53,.10)"/><text x="${(X(c.rise) + X(c.fall)) / 2}" y="34" fill="#d9f99d" font-size="12" text-anchor="middle" font-family="Barlow" font-weight="700">PEAK ${c.rise}–${c.fall}</text>
    <path d="${d}" fill="none" stroke="${POS_COL[pos]}" stroke-width="3.5"/>
    ${[22, 26, 30, 34, 38].map(a => `<text x="${X(a)}" y="170" fill="#86ab92" font-size="11" text-anchor="middle" font-family="Barlow">${a}</text>`).join('')}
    <line x1="${X(age)}" x2="${X(age)}" y1="20" y2="150" stroke="#facc15" stroke-dasharray="4 4"/><circle cx="${X(age)}" cy="${Y(curveVal(pos, age))}" r="8" fill="#facc15" stroke="#03110a" stroke-width="3"><animate attributeName="r" values="6;10;6" dur="1.6s" repeatCount="indefinite"/></circle></svg>`;
}
async function openPlayer(id) {
  const p = pl(id), age = ageOf(p), L = selLeague();
  const leagues = allLeagues().filter(x => x.myIds.includes(id));
  const bi = HQ.boardInfo ? HQ.boardInfo(id) : null;
  const ht = p.ht ? `${Math.floor(p.ht / 12)}'${p.ht % 12}"` : '';
  const draw = () => {
    const e = evalPlayer(id, L, G.week), g = ppg(id, L), s = G.stats && G.stats[id];
    openModal(`<div class="modal-head">${ph(p, 'xl')}<div style="min-width:0"><div class="eyebrow">${esc(p.pos)} · ${esc(p.team || 'FA')}${p.num != null ? ' · #' + esc(p.num) : ''}</div><h2>${esc(p.name)}</h2>
      <div class="sub">${[age ? `Age ${age.toFixed(1)}` : '', p.exp != null ? (p.exp === 0 ? 'Rookie' : `${p.exp} yr${p.exp === 1 ? '' : 's'} exp`) : '', p.college, ht && p.wt ? `${ht}, ${p.wt} lb` : ''].filter(Boolean).map(esc).join(' · ')} ${injTag(p.inj)}</div></div><button class="xbtn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">
        <div class="mstat">
          <div><span class="l">Week ${G.week} proj</span><b>${f1(e.raw)}</b></div>
          <div><span class="l">Opponent</span><b>${e.opp.opp ? `${e.opp.home ? 'vs' : '@'} ${esc(e.opp.opp)}` : onBye(p.team, G.week) ? 'BYE' : '–'}</b></div>
          <div><span class="l">Per game '26</span><b>${g != null ? f1(g) : '–'}</b></div>
          <div><span class="l">Games</span><b>${s && s.gp ? s.gp : '–'}</b></div>
          <div><span class="l">Dynasty ADP SF</span><b>${p.sfAdp ? f1(p.sfAdp) : '–'}</b></div>
          <div><span class="l">Dynasty ADP 1QB</span><b>${p.oneAdp ? f1(p.oneAdp) : '–'}</b></div>
          ${bi ? `<div><span class="l">Your board</span><b>#${bi.rank}</b></div><div><span class="l">Trade value</span><b>${bi.value.toLocaleString()}</b></div>` : ''}
        </div>
        ${CURVE[p.pos] && age ? `<div class="eyebrow" style="margin:18px 0 4px">Where he sits on the ${esc(p.pos)} age curve</div>${ageCurveSvg(p.pos, age)}` : ''}
        <div class="row" style="margin-top:14px">${leagues.length ? `<span class="sub">On your roster in:</span> ${leagues.map(x => `<span class="tag good">${esc(x.name)}</span>`).join(' ')}` : '<span class="sub">Not on any of your rosters.</span>'}<span class="sp"></span>
          <button class="btn small" id="pcCmp">+ Compare</button><button class="btn small" id="pcTrade">+ Trade Lab</button><a class="btn small" href="https://www.google.com/search?q=${encodeURIComponent(p.name + ' fantasy football news')}" target="_blank" rel="noopener">News ↗</a></div>
      </div>`);
    $('#pcCmp').onclick = () => { if (!CMP.includes(id)) CMP = [...CMP, id].slice(-4); ST.set('cmp', CMP); closeModal(); location.hash = 'startsit'; };
    $('#pcTrade').onclick = () => { closeModal(); HQ.addToTrade && HQ.addToTrade(id); };
  };
  draw();
  if (!G.stats || !G.wk[G.week]) { await Promise.all([loadStats(), loadWeek(G.week).catch(() => {})]); if (modalBg.classList.contains('on')) draw(); }
}

/* ---------- live refresh ----------
   Re-pulls the week's state, matchups and rosters from Sleeper on a timer (every 30s while games are on,
   every 5 min otherwise, projections every 10 min) and redraws the open tab in place, flashing scores that moved. */
const LIVE = { last: 0, proj: 0, busy: false, timer: null };
function gamesLiveNow() { const t = today(); return G.sched.some(g => g.week === G.week && (g.status === 'in_game' || g.status === 'in_progress' || (g.date === t && g.status !== 'complete'))); }
const liveEvery = () => gamesLiveNow() ? 30e3 : 5 * 60e3;
async function refreshLive(manual) {
  if (LIVE.busy || !G.user) return; LIVE.busy = true;
  const before = {}; for (const L of G.sleeperLeagues) { if (L.chopped) { const p = myPoints(L); if (p != null) before[L.id] = [p, Infinity]; continue; } const m = matchupOf(L); if (m) before[L.id] = [m.myPts, m.oppPts]; }
  const wk = G.week;
  try {
    await loadCore(true);
    if (G.week !== wk) G.wk = {};
    const projStale = manual || Date.now() - LIVE.proj > 10 * 60e3; if (projStale) LIVE.proj = Date.now();
    await loadUser(G.user.username, true, projStale);
    LIVE.last = Date.now();
    updateBoard();
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (['gameday', 'leagues', 'startsit'].includes(G.view) && !modalBg.classList.contains('on') && !typing) { G.silent = true; try { await renderers[G.view](); } finally { G.silent = false; } }
    flashChanges(before);
  } catch (e) { if (manual) toast('Could not reach Sleeper'); }
  LIVE.busy = false;
}
function flashChanges(before) {
  for (const L of G.sleeperLeagues) {
    const b = before[L.id]; if (!b) continue;
    const m = L.chopped ? { myPts: myPoints(L) || 0, oppPts: 0 } : matchupOf(L); if (!m) continue;
    const card = document.querySelector(`.mcard[data-lg="${CSS.escape(L.id)}"]`); if (!card) continue;
    const [me, op] = card.querySelectorAll('.sc');
    const bump = el => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
    if (me && m.myPts > b[0] + .05) { bump(me); const r = me.getBoundingClientRect(); popText(r.left + r.width / 2, r.top, '+' + f1(m.myPts - b[0]), '#86efac', 30); }
    if (op && m.oppPts > b[1] + .05) bump(op);
  }
}
function scheduleLive() { clearTimeout(LIVE.timer); LIVE.timer = setTimeout(async () => { if (document.visibilityState === 'visible') await refreshLive(); scheduleLive(); }, liveEvery()); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G.user && Date.now() - LIVE.last > 30e3) refreshLive().then(scheduleLive); });
setInterval(() => { const el = document.getElementById('syncAgo'); if (!el || !LIVE.last) return; const s = Math.round((Date.now() - LIVE.last) / 1000); el.textContent = `· updated ${s < 60 ? s + 's' : Math.round(s / 60) + ' min'} ago · auto every ${gamesLiveNow() ? '30s' : '5 min'}`; }, 1000);

/* ---------- expose to dynasty.js ---------- */
const HQ = window.HQ = { P, G, ST, pl, ph, posTag, injTag, pcell, ageOf, POS_COL, CURVE, curveVal, f1, openPlayer, openModal, closeModal, playerPicker, searchPlayers, renderers, show,
  ELIG: { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'] } };
Object.assign(renderers, { gameday: renderGameday, leagues: renderLeagues, startsit: renderStartSit, waivers: renderWaivers });

/* ---------- boot ---------- */
(async () => {
  renderConnect();
  $('#gamedayBody').innerHTML = '<div class="spinner"></div>';
  try { await loadCore(); } catch (e) { toast('Sleeper is unreachable, so live data is off'); }
  const name = ST.get('username', '');
  if (name) { try { await loadUser(name); LIVE.last = LIVE.proj = Date.now(); scheduleLive(); } catch (e) { toast(e.message || 'Could not load your leagues'); } }
  else await loadWeek(G.week).catch(() => {});
  updateBoard();
  show(location.hash.slice(1) || 'gameday');
})();
})();
