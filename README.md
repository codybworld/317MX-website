# 317MX · Cody B's Server

Main website: https://317mx.duckdns.org/

GitHub Pages mirror: https://codybworld.github.io/317MX-website/

Static HTML/CSS/JavaScript, with a compact track collection, photo gallery, About page, live timing, per-track records and a themed mirror of the official recent-server index.

Public data comes from the separate read-only bridge on the droplet: `/api/status`, `/api/records`, `/api/servers`. GitHub Pages itself runs no backend. `data-config.js` points both copies to that HTTPS bridge.

Live lap times require a complete observed timing-gate sequence. Position follows timing progress. The server index mirrors uploaded last-race information, not online-player presence on other servers.

Commit and push changes here to update the Pages mirror. The DigitalOcean copy is deployed separately. Keep all assets and their capitalization intact. Never commit game startup files, SSH keys, private backups or credentials.
