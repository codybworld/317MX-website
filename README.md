# 317MX · Cody B’s Server

Main site: https://317mx.duckdns.org/
GitHub Pages: https://codybworld.github.io/317MX-website/

Home shows the November track rotation, its eleven individual forum downloads, the live Current Track panel and the track collection. All pages link to the November downloads. Guest tracks retain their creator credits.

The current track, riders, timing, moto progress and erode come from the read-only `/api/status` bridge. `rotation.json` lists November's download metadata and lap counts. `tracks.json` holds the separate track collection. Monthly rotation changes require publishing a new configuration.

The game controller runs two completed motos on each track. A restart before any rider completes the required laps replays the same moto. After the winner finishes, other riders have up to 60 seconds to finish. The controller saves progress across service restarts and preserves the shared erode value across all tracks and process restarts.

Public track and erode voting are enabled (server,callvote settrack # / server,callvote erode #). Use server,listtracks for zero-based native track numbers and server,vote yes/no to respond. Successful votes apply on the next race restart. Owner UID 15155 retains native Admin permissions. Admin track additions/removals and erode changes persist. Sandtop replaces Park Canyon SX with five laps. One welcome panel appears after each rider loads a race. The yellow moto-complete message remains.

Public APIs remain `/api/status`, `/api/records`, and `/api/servers`. GitHub Pages uses the same HTTPS bridge. Live lap times require a complete observed gate sequence; position follows timing progress. The server index mirrors uploaded race results.

Commit/push updates the Pages mirror; the DigitalOcean site is deployed separately. Never commit server startup files, credentials, SSH keys or private backups.
