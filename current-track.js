(function (root) {
  'use strict';
  const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  function currentModel(snapshot, tracks, now = Date.now()) {
    if (!snapshot || snapshot.state !== 'live' || !Number.isFinite(snapshot.generatedAt) ||
        now - snapshot.generatedAt > 45000 || snapshot.generatedAt > now + 5000) return null;
    const pending = !snapshot.trackDir && !snapshot.track && !!snapshot.selectedTrackDir;
    const id = normalize(snapshot.trackDir || (pending ? snapshot.selectedTrackDir : '')), name = normalize(snapshot.track);
    // Exact folder/name matching keeps the CANVAS MX and SX layouts distinct.
    const track = (id && tracks.find(t => normalize(t.id) === id)) ||
      tracks.find(t => [t.name, t.id, ...(t.serverNames || [])].some(alias => normalize(alias) === name));
    const rotation = snapshot.rotation?.id === '2026-11' ? snapshot.rotation : null;
    const laps = pending ? track?.laps : Number.isFinite(snapshot.race?.laps) ? snapshot.race.laps : track?.laps;
    const erode = rotation?.erode ?? track?.erode;
    const settings = (rotation?.moto ? 'MOTO '+rotation.moto+'/2 · ' : '') +
      (laps ? laps+' LAPS' : 'PER-TRACK RACE SETTINGS') +
      (Number.isFinite(erode) ? ' · ERODE '+erode.toFixed(1)+' LOCKED' : '');
    const next = rotation?.nextTrackDir && tracks.find(item => item.id === rotation.nextTrackDir);
    const rule = rotation?.paused ? 'Automatic rotation is paused. The server operator is checking the saved progress.' :
      next ? 'Moto complete. Next race: '+next.name+' · Moto '+rotation.nextMoto+'/2. Riders have up to 60 seconds to finish after the winner.' :
      'Two completed motos per track. An unfinished restart keeps the same moto. Track selection and erode settings are locked.';
    return {track: track || null, name: track?.name || snapshot.track || snapshot.trackDir || 'Waiting for first race', waiting:!id&&!name, pending, settings, rule, generatedAt: snapshot.generatedAt};
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = {currentModel}; return; }
  const cards = [...document.querySelectorAll('[data-current-track]')];
  if (!cards.length) return;
  let tracks = [], snapshot = null;
  function render() {
    const model = currentModel(snapshot, tracks);
    for (const card of cards) {
      const image = card.querySelector('[data-current-photo]'), note = card.querySelector('[data-current-photo-note]');
      const link = card.querySelector('[data-current-download]');
      card.querySelector('[data-current-name]').textContent = model?.name || 'Current track unavailable';
      card.querySelector('[data-current-freshness]').textContent = model ?
        (model.pending ? 'Selected for the next race · updated ' : 'Live server · updated ')+new Date(model.generatedAt).toLocaleTimeString() :
        'Waiting for a fresh server update. The track will appear automatically.';
      card.querySelector('[data-current-settings]').textContent = model?.settings || 'Per-track race settings';
      card.querySelector('[data-current-rule]').textContent = model?.rule || 'Settings appear with a fresh server update.';
      const credit = card.querySelector('[data-current-credit]');
      credit.hidden = !model?.track?.guest;
      credit.textContent = model?.track?.credit || '';
      // Only bundled images and the supplied official forum URLs are used.
      const track = model?.track;
      const safeImage = track && /^assets\/tracks\/[a-zA-Z0-9_.-]+\.webp$/.test(track.image);
      const safeLink = track && /^https:\/\/forum\.mxsimulator\.com\/viewtopic\.php\?/.test(track.url);
      link.hidden = !safeLink;
      if (safeLink) link.href = track.url; else link.removeAttribute('href');
      if (!safeImage) {
        image.hidden = true; image.removeAttribute('src'); delete image.dataset.track;
        note.hidden = false; note.textContent = model?.waiting ? 'The photo appears when a track is loaded.' : model ? 'Track photo unavailable' : 'Waiting for the live track…';
      } else if (image.dataset.track !== track.id) {
        image.dataset.track = track.id;
        image.alt = track.name+(track.imageLabel ? ' · '+track.imageLabel : ' track');
        image.style.objectFit = track.imageFit === 'contain' ? 'contain' : 'cover';
        image.style.objectPosition = track.imagePosition || '50% 50%';
        image.hidden = true; note.hidden = false; note.textContent = 'Loading track photo…';
        image.onload = () => { if(image.dataset.track===track.id && currentModel(snapshot,tracks)) { image.hidden = false; note.hidden = true; } };
        image.onerror = () => { image.hidden = true; note.hidden = false; note.textContent = 'Track photo unavailable'; };
        image.src = track.image;
      }
    }
  }
  document.addEventListener('317mx:status', event => { snapshot = event.detail; render(); });
  fetch('rotation.json?v=20261107', {cache:'no-cache', signal:AbortSignal.timeout(8000)})
    .then(response => { if (!response.ok) throw Error('Rotation unavailable'); return response.json(); })
    .then(data => { tracks = Array.isArray(data.tracks) ? data.tracks : []; render(); })
    .catch(() => { tracks = []; render(); });
})(this);
