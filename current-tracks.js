(function () {
  'use strict';
  const grid = document.querySelector('[data-current-track-list]');
  if (!grid) return;
  let metadata = new Map(), snapshot = null, signature = '';
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function render() {
    if (!metadata.size || !snapshot || snapshot.state !== 'live' || !Array.isArray(snapshot.trackList)) return;
    if (Date.now() - snapshot.generatedAt > 45000 || snapshot.generatedAt > Date.now() + 5000) return;
    const groups = new Map();
    for (const entry of snapshot.trackList) {
      if (!entry || typeof entry.id !== 'string') continue;
      let track = groups.get(entry.id);
      if (!track) {
        track = {...metadata.get(entry.id), id:entry.id, name:entry.name || entry.id, options:[]};
        groups.set(entry.id, track);
      }
      track.options.push({index:entry.index, laps:entry.laps, minutes:entry.minutes});
    }
    if (!groups.size) return;
    const nextSignature = JSON.stringify([...groups.values()]);
    if (signature === nextSignature) return;
    const fragment = document.createDocumentFragment();
    for (const track of groups.values()) {
      const card = element('article','november-card');
      card.dataset.rotationId = track.id;
      const photo = element('div','november-photo');
      if (/^assets\/tracks\/[a-zA-Z0-9_.-]+\.webp$/.test(track.image || '')) {
        const img = element('img');
        img.src = track.image;
        img.alt = track.name + ' track';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 900;
        img.height = 560;
        img.addEventListener('error', () => photo.replaceChildren(element('span','rotation-wordmark',track.name)), {once:true});
        photo.append(img);
      } else photo.append(element('span','rotation-wordmark',track.name));
      const body = element('div','november-card-body');
      body.append(element('h3','',track.name));
      const laps = [...new Set(track.options.map(option => option.laps))].sort((a,b)=>a-b);
      body.append(element('p','november-settings',laps.join(' / ')+' LAPS'));
      if (track.credit) body.append(element('p','november-credit',track.credit));
      const actions = element('div','november-actions');
      if (/^https:\/\/forum\.mxsimulator\.com\/viewtopic\.php\?/.test(track.url || '')) {
        const link = element('a','button','DOWNLOAD ↗');
        link.href = track.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label','Download '+track.name);
        actions.append(link);
      }
      const records = element('a','november-records','LAPTIME RECORDS ↗');
      records.href = 'records.html?track='+encodeURIComponent(track.serverNames?.[0] || track.name);
      actions.append(records);
      body.append(actions);
      card.append(photo,body);
      fragment.append(card);
    }
    grid.replaceChildren(fragment);
    const instruction = document.querySelector('[data-track-count]');
    if (instruction) instruction.textContent = 'Install all '+groups.size+' tracks before joining.';
    signature = nextSignature;
  }
  document.addEventListener('317mx:status', event => { snapshot = event.detail; render(); });
  fetch('rotation.json?v=20261119-race',{cache:'no-cache',signal:AbortSignal.timeout(8000)})
    .then(response => { if (!response.ok) throw Error('Track metadata unavailable'); return response.json(); })
    .then(data => { metadata = new Map(data.tracks.map(track=>[track.id,track])); render(); })
    .catch(() => {});
}());
