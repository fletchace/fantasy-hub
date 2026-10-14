/* Fantasy Hub · ESPN bridge
   Runs on an ESPN fantasy page when you click the "ESPN → Hub" bookmark. ESPN only shares a private league with
   pages on espn.com, so this reads the league right here, with the ESPN sign-in this tab already has, and passes the
   league data to your Fantasy Hub tab. It only answers the Fantasy Hub page, and never reads or sends your password. */
(() => {
  const src = (document.currentScript && document.currentScript.src) || 'https://fletchace.github.io/fantasy-hub/assets/espn-bridge.js';
  const ORIGIN = new URL(src).origin;
  const href = location.href, lid0 = (href.match(/leagueId=(\d+)/i) || [])[1] || '';
  const urlSeason = +((href.match(/seasonId=(\d{4})/i) || [])[1] || 0), now = new Date();
  const defSeason = urlSeason || (now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear());
  // Your ESPN member id is only compared with each team's owner to find your team. It never leaves this tab.
  const me = decodeURIComponent((document.cookie.match(/(?:^|;\s*)SWID=([^;]+)/) || [])[1] || '');

  function badge(msg, ok) {
    let b = document.getElementById('fh-bridge');
    if (!b) {
      b = document.createElement('div'); b.id = 'fh-bridge'; b.title = 'Click to hide'; b.onclick = () => b.remove();
      b.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:12px 14px;border-radius:12px;font:600 13px/1.45 system-ui,sans-serif;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.35);cursor:pointer';
      document.body.appendChild(b);
    }
    b.style.background = ok ? '#14532d' : '#7f1d1d'; b.textContent = msg;
  }
  if (!/(^|\.)espn\.com$/i.test(location.hostname)) { alert('Open your league on fantasy.espn.com first, then click the ESPN → Hub bookmark.'); return; }
  if (/\/basketball\//i.test(location.pathname)) { badge('This is an ESPN basketball league. Fantasy Hub reads ESPN football leagues.'); return; }

  const api = (lid, yr, wk) => 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + yr + '/segments/0/leagues/' + lid
    + '?' + (wk ? 'scoringPeriodId=' + (+wk) + '&' : '') + 'view=mTeam&view=mRoster&view=mSettings&view=mMatchupScore&view=mScoreboard';
  async function send(target, o) {
    o = o || {};
    const lid = String(o.leagueId || lid0);
    if (!/^\d+$/.test(lid)) { badge('Open a page inside your ESPN league (its address has leagueId= in it), then click the bookmark again.'); return; }
    const yr = +o.season || defSeason;
    try {
      const r = await fetch(api(lid, yr, o.week), { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      let teamId = lid === lid0 ? +((href.match(/teamId=(\d+)/i) || [])[1] || 0) : 0;
      if (!teamId && me) { const t = (data.teams || []).find(t => t.primaryOwner === me || (t.owners || []).includes(me)); if (t) teamId = t.id; }
      target.postMessage({ fh: 'espn', leagueId: lid, teamId, season: yr, data }, ORIGIN);
      badge('🏈 ' + ((data.settings || {}).name || 'Your league') + ' is in Fantasy Hub. Leave this tab open to keep scores live.', true);
    } catch (e) {
      const s = String((e && e.message) || e);
      target.postMessage({ fh: 'espn-error', leagueId: lid, status: s }, ORIGIN);
      badge(s === '401' || s === '403' ? "ESPN won't show this league to this tab. Sign in to ESPN here, then click the bookmark again." : 'Could not read the league from ESPN (' + s + '). Try again in a minute.');
    }
  }
  const kick = () => { const w = window.__fhHub; if (w && !w.closed) send(w); };
  if (!window.__fhBridge) addEventListener('message', e => {
    if (e.origin !== ORIGIN || !e.data || (e.data.fh !== 'ready' && e.data.fh !== 'get')) return;
    send(e.source, e.data);
  });
  window.__fhBridge = kick;
  badge('Connecting to Fantasy Hub…', true);
  kick();
})();
