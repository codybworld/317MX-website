# 317MX · Cody B’s Server

Main site: https://317mx.duckdns.org/
GitHub Pages: https://codybworld.github.io/317MX-website/

Home shows the November track rotation, its eleven individual forum downloads, the live Current Track panel and the track collection. All pages link to the November downloads. Guest tracks retain their creator credits.

The current track, riders, timing, moto progress and erode come from the read-only `/api/status` bridge. `rotation.json` lists November's download metadata and per-track settings. `tracks.json` holds the separate track collection. Monthly rotation changes require publishing a new configuration.

The game controller runs two completed motos on each track. A restart before any rider completes the required laps replays the same moto. After the winner finishes, other riders have up to 60 seconds to finish. The controller saves progress across service restarts and applies each track's locked erode before the next race loads.

Track and erode voting are disabled. Ten announcement panels run 100 seconds apart, covering all downloads, the installation warning, race rules, creator credits, social accounts, and setup/help resources.

Public APIs remain `/api/status`, `/api/records`, and `/api/servers`. GitHub Pages uses the same HTTPS bridge. Live lap times require a complete observed gate sequence; position follows timing progress. The server index mirrors uploaded race results.

Commit/push updates the Pages mirror; the DigitalOcean site is deployed separately. Never commit server startup files, credentials, SSH keys or private backups.
