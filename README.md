# Fantasy Hub

Personal fantasy sports site: an animated landing page, Football HQ (Sleeper leagues + dynasty prep) and Basketball HQ (Dynasty Draft HQ + season tools). Plain HTML/CSS/JS with no build step.

## Run it

```
node serve.js
```

Then open http://localhost:5173. Double-clicking `index.html` also works in Chrome or Edge.

To host it, upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages).

## What's where

| Path | What it is |
| --- | --- |
| `index.html` | Landing page: stadium animation, click-to-throw, live countdowns, Sleeper trending ticker |
| `football/` | Football HQ: Gameday, Leagues, Start/Sit, Waivers, Dynasty Board, Trade Lab, Mock Startup, Dynasty Plan |
| `football/nfl-snapshot.js` | Player bios (age, college, size) from Sleeper, built 2026-10-12. Live data refreshes over it |
| `basketball/index.html` | Basketball HQ landing: calendar, Sleeper NBA leagues, Lock-In helper, rules, lottery drum |
| `basketball/draft-hq.html` | The Dynasty Draft HQ artifact, unchanged apart from a "← Hub" button |
| `assets/` | Shared theme (`hub.css`) and helpers (`fx.js`) |

## Data

Everything live comes from Sleeper's public, read-only API (no login). Your username, flags, notes, watchlist and settings are saved in your browser's localStorage, so they stay on the device you use.

To refresh the player snapshot later, re-download `https://api.sleeper.app/v1/players/nfl` and rebuild `football/nfl-snapshot.js` (ask Claude).
