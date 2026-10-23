(function () {
  'use strict';
  const cfg = JSON.parse(document.getElementById('map-config').textContent);
  const form = document.getElementById('map-form'), listEl = document.getElementById('map-list'), statusEl = document.getElementById('map-status');
  const $ = (s, r = document) => r.querySelector(s);
  if (typeof L === 'undefined') { statusEl.textContent = 'Não foi possível carregar o mapa.'; return; }

  const map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([-15.8, -47.9], 4);
  L.tileLayer(cfg.tile, { maxZoom: 18, subdomains: 'abc', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
  map.addLayer(cluster);
  let circle = null, userMarker = null, markers = new Map();

  const icon = (f) => L.divIcon({ className: '', html: '<div class="map-pin' + (f ? ' is-featured' : '') + '" style="width:26px;height:26px;position:relative"></div>', iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] });
  const AV = { disponivel: 'Aceitando novos pedidos', limitada: 'Agenda limitada', indisponivel: 'Sem capacidade no momento' };

  function popup(c) {
    const el = document.createElement('div'); el.className = 'pop';
    const h = document.createElement('h3'); h.textContent = c.name; el.appendChild(h);
    const p = document.createElement('p'); p.textContent = [c.city && c.city + (c.state ? ' – ' + c.state : ''), c.distance != null ? c.distance + ' km' : null, c.approx ? 'localização aproximada' : null].filter(Boolean).join(' · '); el.appendChild(p);
    if (c.categories.length) { const t = document.createElement('p'); t.textContent = c.categories.join(' · '); el.appendChild(t); }
    if (c.availability) { const s = document.createElement('p'); s.textContent = AV[c.availability]; el.appendChild(s); }
    const btn = (href, text, cls, ext) => { const a = document.createElement('a'); a.href = href; a.className = 'btn btn-sm ' + cls; a.textContent = text; if (ext) { a.target = '_blank'; a.rel = 'noopener nofollow'; } el.appendChild(a); return a; };
    btn('/empresa/' + c.slug, 'Ver perfil completo', 'btn-primary');
    if (c.whatsapp) btn('/ir/whatsapp/' + c.id, 'Conversar pelo WhatsApp', 'btn-wa', true);
    const r = btn('https://www.google.com/maps/dir/?api=1&destination=' + c.lat + ',' + c.lng, 'Abrir rota no app de mapas', '', true);
    r.addEventListener('click', () => PP.post('/api/evento', { type: 'rota', company_id: c.id }).catch(() => {}));
    return el;
  }

  function params() {
    const u = new URLSearchParams(new FormData(form));
    for (const [k, v] of Array.from(u.entries())) if (!v) u.delete(k);
    return u;
  }
  let geoPoint = null;
  async function refresh(fit = true) {
    statusEl.innerHTML = '<span class="loading" aria-hidden="true"></span> Buscando…';
    const u = params(); if (geoPoint && !u.get('perto')) { u.set('lat', geoPoint.lat); u.set('lng', geoPoint.lng); }
    u.set('mapa', '1');
    let data;
    try { const r = await fetch('/api/empresas?' + u, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); data = await r.json(); }
    catch (e) { statusEl.textContent = 'Não foi possível carregar as empresas. Tente de novo.'; return; }
    const shown = new URLSearchParams(u); shown.delete('mapa'); history.replaceState(null, '', '/mapa' + (shown.toString() ? '?' + shown : ''));
    cluster.clearLayers(); markers = new Map(); listEl.innerHTML = '';
    if (circle) { map.removeLayer(circle); circle = null; } if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    const bounds = [];
    data.items.forEach((c) => {
      const m = L.marker([c.lat, c.lng], { icon: icon(c.featured), title: c.name, alt: c.name }).bindPopup(() => popup(c), { maxWidth: 280 });
      cluster.addLayer(m); markers.set(c.id, m); bounds.push([c.lat, c.lng]);
      const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button';
      if (c.logo) { const i = document.createElement('img'); i.src = c.logo; i.alt = ''; i.width = 40; i.height = 40; i.loading = 'lazy'; b.appendChild(i); }
      const d = document.createElement('div'); const s = document.createElement('strong'); s.textContent = c.name; const sp = document.createElement('span'); sp.textContent = [c.city && c.city + '/' + c.state, c.distance != null ? c.distance + ' km' : null].filter(Boolean).join(' · ');
      d.append(s, sp); b.appendChild(d);
      b.addEventListener('click', () => { cluster.zoomToShowLayer(m, () => { map.setView(m.getLatLng(), Math.max(map.getZoom(), 12)); m.openPopup(); }); });
      li.appendChild(b); listEl.appendChild(li);
    });
    if (data.near) {
      userMarker = L.circleMarker([data.near.lat, data.near.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#e4b33c', fillOpacity: 1 }).addTo(map).bindTooltip(data.near.label);
      const raio = parseInt(u.get('raio'), 10); if (raio) { circle = L.circle([data.near.lat, data.near.lng], { radius: raio * 1000, color: '#254583', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04 }).addTo(map); }
      bounds.push([data.near.lat, data.near.lng]);
    }
    statusEl.textContent = data.nearFailed ? 'Não encontramos esse local. Tente a cidade com o estado ou um CEP.' :
      (data.items.length ? data.total + (data.total === 1 ? ' empresa' : ' empresas') + (data.items.length < data.total ? ' (mostrando ' + data.items.length + ')' : '') + (data.near ? ' · ordenadas por distância de ' + data.near.label : '') : 'Nenhuma empresa com esses filtros.');
    if (fit && bounds.length) { if (circle) map.fitBounds(circle.getBounds(), { padding: [30, 30], maxZoom: 11 }); else map.fitBounds(bounds, { padding: [40, 40], maxZoom: data.near ? 10 : 12 }); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); geoPoint = null; refresh(); });
  form.addEventListener('reset', () => { setTimeout(() => { Array.from(form.elements).forEach((el) => { if (el.name) el.value = ''; }); geoPoint = null; refresh(); }, 0); });
  ['m-raio', 'm-uf', 'm-cat', 'm-mq'].forEach((id) => document.getElementById(id).addEventListener('change', () => refresh()));
  $('[data-geo-map]').addEventListener('click', async () => {
    try { geoPoint = await PP.geolocate(); form.elements.perto.value = ''; if (!form.elements.raio.value) form.elements.raio.value = '50'; refresh(); }
    catch (e) { PP.toast(e.message); }
  });
  refresh();
})();
