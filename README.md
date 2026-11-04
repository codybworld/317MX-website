# 317MX · Cody B's Server

Main website: https://317mx.duckdns.org/

GitHub Pages mirror: https://codybworld.github.io/317MX-website/

Static HTML/CSS/JavaScript, with a compact track collection, photo gallery, About page, live timing, per-track records and a themed mirror of the official recent-server index.

Public data comes from the separate read-only bridge on the droplet: `/api/status`, `/api/records`, `/api/servers`. GitHub Pages itself runs no backend. `data-config.js` points both copies to that HTTPS bridge.

Live lap times require a complete observed timing-gate sequence. Position follows timing progress. The server index mirrors uploaded last-race information, not online-player presence on other servers.

Commit and push changes here to update the Pages mirror. The DigitalOcean copy is deployed separately. Keep all assets and their capitalization intact. Never commit game startup files, SSH keys, private backups or credentials.

## Current rotation (October 31, 2026)

Home now lists 12 server layouts: the original 11 plus the guest track Delb SX. The complete 19-layout 317MX collection remains Cody B’s own tracks. CANVAS MX and SX are separate layouts in one download. Every page links to `index.html#rotation`.

`rotation.json` records the supplied rotation and settings (2 laps, 0 race minutes, 10-minute track interval). The visible list is static HTML so downloads still work without JavaScript. Update both the data file and the home list when you change the actual game rotation; this website list does not alter or automatically read the game configuration.

`evolution-v6.css` adds the botanical, geometric and phone-layout foundation. `spectacle-v7.css` and `spectacle-v7.js` add the neon room treatment, floating hero fragments, interactive tilt, command deck, quick dock, track search and random track spotlight. Motion is the default experience; the browser's reduced-motion accessibility preference is still respected.

## Server commands

The home-page command deck documents `server,listtracks`, `server,callvote settrack #` and `server,callvote erode #`. The `#` is a placeholder for the track number or erode value, and each command has a copy control. Keep this guidance aligned with the live server rules.

## Current track

Home and Live Timing show the current track photo from the same validated live snapshot as the riders table. The bridge exports the documented `track_dir` field as `trackDir`; `rotation.json` maps that ID and exact server names to local images and forum downloads. No extra status polling is added. Stale or unavailable live data clears the current photo rather than guessing from a clock or the configured fallback track. Rotation changes occur at a race restart after the 10-minute interval; a passed track vote may change it sooner.

## Guest track: Delb SX (November 4, 2026)

`DelbSx` is a guest track, by KaWorkz / kylemx322, with thanks to Josh (JGMX). Forum: https://forum.mxsimulator.com/viewtopic.php?t=42795 . It uses 7 laps, 0 race minutes, and a 999999999-minute track interval. The original 11 tracks retain 2 laps and 10-minute intervals. Delb SX is downloaded separately from its forum post; the existing 11-track ZIP is unchanged. Current-track cards now render lap counts and interval text per layout. The server selects Japan once at process startup; votes and later race restarts work normally.
