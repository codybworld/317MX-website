# 317MX · Cody B’s Server

Main site: https://317mx.duckdns.org/
GitHub Pages: https://codybworld.github.io/317MX-website/

Home shows the live Current Track panel before the individual track-download gallery. All pages link to this panel. The gallery contains Cody B’s creations and a credited Delb SX guest card; gallery membership does not mean a track is active on the server.

The current track, riders and timing come from the read-only `/api/status` bridge. `rotation.json` is retained as an image/download metadata catalog for the live card; it does not configure or list the game’s active rotation. `tracks.json` is the download catalog. No ZIP download is promoted on the website.

The saved server startup list contains DelbSx only, at 7 laps and a 999999999-minute interval. Additional tracks must be added to the saved server configuration if they should survive a process restart. In-game announcements read runtime `track_count` and `track_list` on every delivery, so the displayed list follows additions/removals after the server loads them.

Repeating in-game information contains the website, `server,callvote erode #`, `server,callvote settrack #`, and the current numbered track list. Replace # with the desired number. Votes must pass.

Public APIs remain `/api/status`, `/api/records`, and `/api/servers`. GitHub Pages uses the same HTTPS bridge. Live lap times require a complete observed gate sequence; position follows timing progress. The server index mirrors uploaded race results.

Commit/push updates the Pages mirror; the DigitalOcean site is deployed separately. Never commit server startup files, credentials, SSH keys or private backups.
