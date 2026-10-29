# 317MX · Cody B's Server

Main website: https://317mx.duckdns.org/

GitHub Pages mirror: https://codybworld.github.io/317MX-website/

Static HTML/CSS/JavaScript, with a compact track collection, photo gallery, About page, live timing, per-track records and a themed mirror of the official recent-server index.

Public data comes from the separate read-only bridge on the droplet: `/api/status`, `/api/records`, `/api/servers`. GitHub Pages itself runs no backend. `data-config.js` points both copies to that HTTPS bridge.

Live lap times require a complete observed timing-gate sequence. Position follows timing progress. The server index mirrors uploaded last-race information, not online-player presence on other servers.

Commit and push changes here to update the Pages mirror. The DigitalOcean copy is deployed separately. Keep all assets and their capitalization intact. Never commit game startup files, SSH keys, private backups or credentials.

## Current rotation (October 29, 2026)

Home now lists the 11 configured server layouts before the complete 19-layout collection. CANVAS MX and SX are separate layouts in one download. Every page links to `index.html#rotation`.

`rotation.json` records the supplied rotation and settings (2 laps, 0 minutes, 0-minute interval). The visible list is static HTML so downloads still work without JavaScript. Update both the data file and the home list when you change the actual game rotation; this website list does not alter or automatically read the game configuration.

`evolution-v6.css` adds restrained botanical borders, geometric detail, star glow and phone layout improvements. Reduced motion and the Motion toggle are supported. Backend feeds remain independent of this visual update.
