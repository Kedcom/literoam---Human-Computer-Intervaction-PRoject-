'use strict';
/* LiteRoam – low-data travel discovery.
   Part 1 is pure logic (testable in Node). Part 2 is the browser UI.
   HCI principle numbers in comments refer to the proposal table. */

/* ───────────────────────── Part 1: logic ───────────────────────── */

const CATEGORIES = { eat: 'Eat', visit: 'Visit', do: 'Do' };

// Simple chain filter: brand tags or well-known chain names.
const CHAIN_RE = new RegExp(
  "\\b(mcdonald'?s|burger king|wendy'?s|subway|starbucks|tim hortons|dunkin|kfc|pizza hut|domino'?s|" +
  "taco bell|a&w|popeyes|harvey'?s|second cup|papa john'?s|little caesars|dairy queen|baskin|krispy kreme|" +
  "costa coffee|pret a manger|greggs|nando'?s|five guys|chipotle|panera|arby'?s|denny'?s|ihop|applebee'?s|" +
  "boston pizza|swiss chalet|pizza pizza|booster juice|mary brown'?s|cineplex|famous players)\\b", 'i');

const LABEL_OVERRIDES = {
  yes: 'Historic site', fast_food: 'Fast food', ice_cream: 'Ice cream',
  arts_centre: 'Arts centre', community_centre: 'Community centre',
  cave_entrance: 'Cave', hot_spring: 'Hot spring', picnic_site: 'Picnic site',
  camp_site: 'Campsite', nature_reserve: 'Nature reserve', swimming_area: 'Swimming area',
  place_of_worship: 'Place of worship', artwork: 'Public art'
};

// HCI 2: plain words instead of OSM tags.
function humanize(v) {
  if (LABEL_OVERRIDES[v]) return LABEL_OVERRIDES[v];
  const s = String(v).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function classify(t) {
  const a = t.amenity || '', s = t.shop || '', tr = t.tourism || '', n = t.natural || '', l = t.leisure || '', c = t.craft || '';
  if (/^(restaurant|cafe|pub|bar|fast_food|ice_cream|food_court|biergarten)$/.test(a)) return { cat: 'eat', type: a };
  if (/^(bakery|deli|pastry|confectionery|cheese|chocolate|farm)$/.test(s)) return { cat: 'eat', type: s };
  if (/^(brewery|winery|distillery|bakery)$/.test(c)) return { cat: 'eat', type: c };
  if (/^(viewpoint|museum|gallery|artwork|attraction)$/.test(tr)) return { cat: 'visit', type: tr };
  if (t.historic && !/^(no|boundary_stone|milestone)$/.test(t.historic)) return { cat: 'visit', type: t.historic };
  if (/^(waterfall|peak|beach|cave_entrance|hot_spring|spring|arch|cliff)$/.test(n)) return { cat: 'visit', type: n };
  if (t.waterway === 'waterfall') return { cat: 'visit', type: 'waterfall' };
  if (/^(lighthouse|observatory|windmill|watermill)$/.test(t.man_made || '')) return { cat: 'visit', type: t.man_made };
  if (/^(park|garden|nature_reserve|swimming_area|bird_hide)$/.test(l)) return { cat: 'do', type: l };
  if (/^(theatre|cinema|arts_centre|community_centre|marketplace)$/.test(a)) return { cat: 'do', type: a };
  if (/^(zoo|picnic_site|theme_park|camp_site)$/.test(tr)) return { cat: 'do', type: tr };
  return null;
}

// Returns a reason string if the place should be hidden, else null.
function excludeReason(t) {
  if (t.brand || t['brand:wikidata'] || t['operator:wikidata']) return 'chain';
  if (CHAIN_RE.test(t.name || '')) return 'chain';
  if (t.wikipedia) return 'major';
  if (t.tourism === 'attraction' && t.wikidata) return 'major';
  return null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// HCI 2: "7 min walk" rather than raw metres.
function walkText(m) {
  if (m == null || !isFinite(m)) return '';
  const mins = Math.max(1, Math.round(m / 80)); // ~4.8 km/h
  if (mins <= 45) return mins + ' min walk';
  return (m / 1000).toFixed(1) + ' km away';
}

function safeUrl(u) {
  if (!u) return null;
  const s = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  try { const x = new URL(s); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
}

// Three small queries (one per category) instead of one big one: each is quick,
// runs in parallel, and chains/major landmarks are dropped on the server so the
// result limit is spent on lesser-known places.
const NOT_MAJOR = '[!"brand"][!"brand:wikidata"][!"wikipedia"]';
function buildQueries(lat, lon, radius) {
  const ar = `(around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const mk = sets => `[out:json][timeout:15];(${sets.map(s => `nwr${ar}${s}${NOT_MAJOR};`).join('')});out center qt 150;`;
  return [
    { cat: 'eat', q: mk([
      `["name"]["amenity"~"^(restaurant|cafe|pub|bar|fast_food|ice_cream|food_court|biergarten)$"]`,
      `["name"]["shop"~"^(bakery|deli|pastry|confectionery|cheese|chocolate|farm)$"]`,
      `["name"]["craft"~"^(brewery|winery|distillery|bakery)$"]`]) },
    { cat: 'visit', q: mk([
      `["tourism"~"^(viewpoint|museum|gallery|artwork|attraction)$"]`,
      `["historic"]["historic"!~"^(no|boundary_stone|milestone)$"]`,
      `["natural"~"^(waterfall|peak|beach|cave_entrance|hot_spring|spring|arch|cliff)$"]["name"]`,
      `["waterway"="waterfall"]`,
      `["man_made"~"^(lighthouse|observatory|windmill|watermill)$"]`]) },
    { cat: 'do', q: mk([
      `["name"]["leisure"~"^(park|garden|nature_reserve|swimming_area|bird_hide)$"]`,
      `["name"]["amenity"~"^(theatre|cinema|arts_centre|community_centre|marketplace)$"]`,
      `["tourism"~"^(zoo|picnic_site|theme_park|camp_site)$"]`]) }
  ];
}

function parseElements(json, origin) {
  const seen = new Set(), places = [];
  let filtered = 0;
  for (const el of (json && json.elements) || []) {
    const t = el.tags;
    if (!t) continue;
    const c = classify(t);
    if (!c) continue;
    const name = t.name || (c.cat !== 'eat' ? humanize(c.type) : '');   // unnamed viewpoints, waterfalls etc. still count
    if (!name) continue;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lon == null) continue;
    const id = el.type[0] + el.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (excludeReason(t)) { filtered++; continue; }
    const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
    places.push({
      id, name, cat: c.cat, label: humanize(c.type), lat, lon,
      address: addr || '', hours: t.opening_hours || '', phone: t.phone || t['contact:phone'] || '',
      website: safeUrl(t.website || t['contact:website']),
      dist: origin ? haversine(origin.lat, origin.lon, lat, lon) : null
    });
  }
  places.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  return { places, filtered };
}

if (typeof module !== 'undefined') {
  module.exports = { classify, excludeReason, parseElements, buildQueries, walkText, haversine, safeUrl, humanize };
}

/* ───────────────────────── Part 2: UI ───────────────────────── */

if (typeof document !== 'undefined') (function () {
  // Fastest public server first (measured ~1-5 s vs ~40 s for overpass-api.de); others are fallbacks.
  const ENDPOINTS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];
  const memCache = new Map();   // repeat searches in a session are instant
  const GEOCODER = 'https://nominatim.openstreetmap.org/search';
  const $ = id => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  };

  const state = {
    origin: null, places: [], filtered: 0, cat: 'all', view: 'nearby',
    radius: 2000, bytes: 0, ctrl: null, expanded: new Set(),
    saved: store.get('lr.saved', []), recent: store.get('lr.recent', []), lastErr: null
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent only: OSM data is never inserted as HTML
    return n;
  }

  /* ---- Status line (HCI 1, 4) ---- */
  function setStatus(text, opts) {
    opts = opts || {};
    const box = $('status');
    box.className = 'status' + (opts.error ? ' error' : '') + (opts.busy ? ' busy' : '');
    box.replaceChildren(el('p', null, text));
    if (opts.actions && opts.actions.length) {
      const row = el('div', 'actions');
      for (const a of opts.actions) {
        const b = el('button', null, a.label);
        b.type = 'button';
        b.addEventListener('click', a.fn);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }

  function updateNet() {
    const on = navigator.onLine;
    const b = $('net');
    b.textContent = on ? 'Online' : 'Offline';
    b.className = 'badge' + (on ? '' : ' offline');
    $('locate').disabled = !on;
    $('go').disabled = !on || !$('place').value.trim();   // HCI 4: prevent empty / impossible searches
    if (!on) setStatus('You are offline. Your saved places still work.', {
      error: true, actions: [{ label: 'Open saved places', fn: () => setView('saved') }]
    });
  }

  function updateData() {
    const kb = state.bytes / 1024;
    $('data').textContent = 'Data: ' + (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
  }

  /* ---- Toast with Undo (HCI 3) ---- */
  let toastTimer = null;
  function toast(msg, undoFn) {
    const t = $('toast');
    t.replaceChildren(el('span', null, msg));
    if (undoFn) {
      const b = el('button', null, 'Undo');
      b.type = 'button';
      b.addEventListener('click', () => { undoFn(); t.hidden = true; });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
  }

  /* ---- Saved places ---- */
  const isSaved = id => state.saved.some(p => p.id === id);
  function persistSaved() {
    store.set('lr.saved', state.saved);
    $('saved-n').textContent = state.saved.length;
  }
  function toggleSave(p) {
    const idx = state.saved.findIndex(s => s.id === p.id);
    if (idx >= 0) {
      const [removed] = state.saved.splice(idx, 1);
      persistSaved(); render();
      toast('Removed "' + p.name + '".', () => { state.saved.splice(idx, 0, removed); persistSaved(); render(); });
    } else {
      const copy = Object.assign({}, p, { dist: null });
      state.saved.push(copy);
      persistSaved(); render();
      toast('Saved "' + p.name + '". It works offline.', () => {
        state.saved = state.saved.filter(s => s.id !== p.id); persistSaved(); render();
      });
    }
  }

  /* ---- Rendering ---- */
  function visibleList() {
    if (state.view === 'saved') {
      return state.saved
        .filter(p => state.cat === 'all' || p.cat === state.cat)
        .map(p => state.origin ? Object.assign({}, p, { dist: haversine(state.origin.lat, state.origin.lon, p.lat, p.lon) }) : p);
    }
    return state.places.filter(p => state.cat === 'all' || p.cat === state.cat);
  }

  function card(p) {
    const li = el('li', 'card');
    li.appendChild(el('h3', null, p.name));
    const meta = [CATEGORIES[p.cat], p.label, walkText(p.dist)].filter(Boolean);
    if (p.label === CATEGORIES[p.cat]) meta.splice(1, 1);
    li.appendChild(el('p', 'meta', meta.join(' · ')));

    const btns = el('div', 'btns');
    const detId = 'det-' + p.id;
    const open = state.expanded.has(p.id);

    // HCI 6: progressive disclosure – details stay hidden until asked for
    const more = el('button', null, open ? 'Hide details' : 'Details');
    more.type = 'button';
    more.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-controls', detId);
    more.addEventListener('click', () => {
      if (state.expanded.has(p.id)) state.expanded.delete(p.id); else state.expanded.add(p.id);
      render(); const again = document.querySelector('[aria-controls="' + detId + '"]'); if (again) again.focus();
    });

    const sv = el('button', null, isSaved(p.id) ? 'Saved – remove' : 'Save');
    sv.type = 'button';
    sv.setAttribute('aria-pressed', String(isSaved(p.id)));
    sv.addEventListener('click', () => toggleSave(p));
    btns.append(more, sv);
    li.appendChild(btns);

    if (open) {
      const dl = el('dl', 'details');
      dl.id = detId;
      const row = (k, v, link) => {
        const d = el('div');
        d.appendChild(el('dt', null, k + ': '));
        const dd = el('dd');
        if (link) { const a = el('a', null, v); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; dd.appendChild(a); }
        else dd.textContent = v;
        d.appendChild(dd); dl.appendChild(d);
      };
      row('Address', p.address || 'Not listed');
      if (p.hours) row('Hours', p.hours);
      if (p.phone) row('Phone', p.phone);
      if (p.website) row('Website', p.website.replace(/^https?:\/\//, ''), p.website);
      row('Map', 'Open in OpenStreetMap', 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lon + '#map=18/' + p.lat + '/' + p.lon);
      li.appendChild(dl);
    }
    return li;
  }

  function render() {
    $('saved-n').textContent = state.saved.length;
    for (const b of document.querySelectorAll('#cats button')) b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat));
    for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));

    const list = visibleList(), ul = $('results');
    ul.replaceChildren();
    if (!list.length) {
      let msg;
      if (state.view === 'saved') msg = state.saved.length ? 'No saved places in this category.' : 'Nothing saved yet. Tap Save on a place to keep it for offline use.';
      else if (state.places.length) msg = 'No places in this category here. Try "All" or a wider distance.';
      else msg = '';
      if (msg) { const li = el('li', 'empty', msg); ul.appendChild(li); }
    } else {
      for (const p of list) ul.appendChild(card(p));
    }
    $('note').textContent = state.view === 'nearby' && state.places.length
      ? list.length + ' shown · chains and major landmarks hidden' : '';
  }

  function setView(v) { state.view = v; render(); }

  /* ---- Networking ---- */
  // Hedged request: start with the first server; if it has not answered after 3.5 s (or fails),
  // start the next one too. The first good answer wins and the rest are cancelled.
  // A refused/slow server therefore costs seconds, not the full timeout.
  function overpass(query, signal) {
    return new Promise((resolve, reject) => {
      const ctrls = [];
      let started = 0, failed = 0, finished = false, hedge = null, lastErr;
      const finish = (fn, v) => {
        if (finished) return;
        finished = true; clearTimeout(hedge);
        signal.removeEventListener('abort', onAbort);
        ctrls.forEach(c => c.abort());
        fn(v);
      };
      const onAbort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort);
      if (signal.aborted) return onAbort();

      const startNext = () => {
        if (finished || started >= ENDPOINTS.length) return;
        const url = ENDPOINTS[started++], ctrl = new AbortController();
        ctrls.push(ctrl);
        if (started < ENDPOINTS.length) hedge = setTimeout(startNext, 3500);
        const kill = setTimeout(() => ctrl.abort(), 12000);
        fetch(url, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query)
        }).then(res => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        }).then(text => {
          const json = JSON.parse(text);   // non-JSON refusals (e.g. "not white-listed") throw here
          if (json.remark && !(json.elements || []).length) throw new Error('server busy');
          state.bytes += text.length; updateData();
          finish(resolve, json);
        }).catch(e => {
          if (finished) return;
          lastErr = e; failed++;
          if (started < ENDPOINTS.length) { clearTimeout(hedge); startNext(); }
          else if (failed >= started) finish(reject, lastErr);
        }).finally(() => clearTimeout(kill));
      };
      startNext();
    });
  }

  function cancelSearch() { if (state.ctrl) state.ctrl.abort(); }

  function mergeSorted(into, add) {
    const seen = new Set(into.map(p => p.id));
    for (const p of add) if (!seen.has(p.id)) into.push(p);
    into.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  }

  async function searchAround(origin) {
    cancelSearch();
    state.origin = origin;
    const ctrl = new AbortController();
    state.ctrl = ctrl;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, 28000);

    const km = state.radius >= 1000 ? (state.radius / 1000) + ' km' : state.radius + ' m';
    const key = origin.lat.toFixed(3) + ',' + origin.lon.toFixed(3) + ',' + state.radius;

    try {
      let places, filtered = 0;
      if (memCache.has(key)) {
        places = memCache.get(key).slice();
        state.places = places; state.view = 'nearby'; state.expanded.clear(); render();
      } else {
        setStatus('Searching within ' + km + ' of ' + origin.label + '…', {
          busy: true, actions: [{ label: 'Cancel', fn: cancelSearch }]
        });
        places = []; state.places = places; state.filtered = 0; state.view = 'nearby'; state.expanded.clear(); render();
        let failed = 0, done = 0;
        // Three category queries in parallel; results appear as each one lands.
        await Promise.all(buildQueries(origin.lat, origin.lon, state.radius).map(async ({ q }) => {
          try {
            const json = await overpass(q, ctrl.signal);
            mergeSorted(places, parseElements(json, origin).places);
            done++;
            if (state.ctrl === ctrl) { render(); if (done < 3 - failed) setStatus('Searching… ' + places.length + ' found so far', { busy: true, actions: [{ label: 'Cancel', fn: cancelSearch }] }); }
          } catch (e) { if (ctrl.signal.aborted) throw e; failed++; }
        }));
        if (failed === 3) throw new Error('all failed');
        if (!failed) memCache.set(key, places.slice());
      }
      state.filtered = filtered;
      store.set('lr.last', { origin, radius: state.radius, places, filtered, at: Date.now() });
      rememberRecent(origin);
      render();
      if (places.length) {
        setStatus('Found ' + places.length + ' place' + (places.length === 1 ? '' : 's') + ' near ' + origin.label + ', nearest first.');
        $('results').focus();
      } else {
        const next = state.radius < 10000 ? (state.radius < 2000 ? 2000 : state.radius < 5000 ? 5000 : 10000) : null;
        setStatus('No lesser-known places found within ' + km + ' of ' + origin.label + '.', {
          actions: next ? [{ label: 'Search ' + (next / 1000) + ' km', fn: () => { $('radius').value = String(next); state.radius = next; searchAround(origin); } }] : []
        });
      }
    } catch (e) {
      if (ctrl.signal.aborted && !timedOut) {
        setStatus('Search cancelled.', { actions: [{ label: 'Search again', fn: () => searchAround(origin) }] });
      } else {
        const last = store.get('lr.last', null);
        const actions = [{ label: 'Try again', fn: () => searchAround(origin) }];
        if (last && last.places && last.places.length) actions.push({ label: 'Show last results', fn: restoreLast });
        if (state.saved.length) actions.push({ label: 'Open saved places', fn: () => setView('saved') });
        setStatus(timedOut || !navigator.onLine
          ? 'The connection is too slow or offline. Nothing was lost.'
          : 'The places service is not responding right now. Nothing was lost.', { error: true, actions });
      }
    } finally {
      clearTimeout(timer);
      if (state.ctrl === ctrl) state.ctrl = null;
    }
  }

  async function geocode(q) {
    cancelSearch();
    const ctrl = new AbortController();
    state.ctrl = ctrl;
    setStatus('Looking up "' + q + '"…', { busy: true, actions: [{ label: 'Cancel', fn: cancelSearch }] });
    try {
      const res = await fetch(GEOCODER + '?format=json&limit=1&q=' + encodeURIComponent(q), { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text(); state.bytes += text.length; updateData();
      const hits = JSON.parse(text);
      if (!hits.length) {
        setStatus('We could not find "' + q + '". Check the spelling or try a larger nearby town.', { error: true });
        $('place').focus();
        return null;
      }
      const label = String(hits[0].display_name || q).split(',')[0];
      return { lat: parseFloat(hits[0].lat), lon: parseFloat(hits[0].lon), label };
    } catch (e) {
      if (ctrl.signal.aborted) setStatus('Search cancelled.');
      else setStatus('Could not look up that place. Check your connection and try again.', { error: true, actions: [{ label: 'Try again', fn: () => submitPlace() }] });
      return null;
    } finally {
      if (state.ctrl === ctrl) state.ctrl = null;
    }
  }

  async function submitPlace() {
    const q = $('place').value.trim();
    if (!q) return;
    const origin = await geocode(q);
    if (origin) searchAround(origin);
  }

  function useLocation() {
    if (!('geolocation' in navigator)) {
      setStatus('This browser cannot share your location. Type a town instead.', { error: true });
      $('place').focus(); return;
    }
    setStatus('Finding your location…', { busy: true });
    navigator.geolocation.getCurrentPosition(
      pos => searchAround({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'your location' }),
      err => {
        if (err.code === 1) {
          // HCI 4: denied permission is expected – offer the alternative, don't dead-end
          setStatus('Location is turned off for this site. Type a town or village below instead.', { error: true });
          $('place').focus();
        } else {
          setStatus('We could not get your location. Try again, or type a town below.', { error: true, actions: [{ label: 'Try again', fn: useLocation }] });
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* ---- Recent searches (HCI 5) ---- */
  function rememberRecent(o) {
    if (o.label === 'your location') return;
    state.recent = [o].concat(state.recent.filter(r => r.label !== o.label)).slice(0, 5);
    store.set('lr.recent', state.recent);
    renderRecent();
  }
  function renderRecent() {
    const wrap = $('recent-wrap'), box = $('recent');
    wrap.hidden = !state.recent.length;
    box.replaceChildren();
    for (const r of state.recent) {
      const b = el('button', null, r.label);
      b.type = 'button';
      b.addEventListener('click', () => { $('place').value = r.label; updateNet(); searchAround(r); });
      box.appendChild(b);
    }
  }

  function restoreLast() {
    const last = store.get('lr.last', null);
    if (!last || !last.places) return false;
    state.origin = last.origin; state.places = last.places; state.filtered = last.filtered || 0; state.view = 'nearby';
    render();
    const mins = Math.round((Date.now() - last.at) / 60000);
    const ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' d ago';
    setStatus('Showing your last search near ' + last.origin.label + ' (' + ago + '). Search again to refresh.');
    return true;
  }

  /* ---- Wiring ---- */
  $('locate').addEventListener('click', useLocation);
  $('form').addEventListener('submit', e => { e.preventDefault(); submitPlace(); });
  $('place').addEventListener('input', updateNet);
  $('radius').addEventListener('change', e => {
    state.radius = parseInt(e.target.value, 10);
    if (state.origin && !state.ctrl) searchAround(state.origin);   // HCI 3: change distance without starting over
  });
  for (const b of document.querySelectorAll('#cats button')) b.addEventListener('click', () => { state.cat = b.dataset.cat; render(); });
  for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => setView(b.dataset.view));
  window.addEventListener('online', () => { updateNet(); setStatus('Back online.'); });
  window.addEventListener('offline', updateNet);

  // Offline app shell (works when served over http/https)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  persistSaved(); renderRecent(); updateData(); render(); updateNet();
  if (navigator.onLine) restoreLast();
  else if (!state.saved.length) restoreLast();
  else setView('saved');
})();
