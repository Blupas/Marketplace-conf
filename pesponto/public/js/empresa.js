(function () {
  'use strict';
  // Mapa da empresa: ponto exato só quando a empresa autorizou; senão, área aproximada.
  const el = document.getElementById('co-map');
  if (el && typeof L !== 'undefined') {
    const lat = +el.dataset.lat, lng = +el.dataset.lng, privacy = el.dataset.privacy;
    const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], privacy === 'exata' ? 15 : privacy === 'aproximada' ? 13 : 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    if (privacy === 'exata') L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="map-pin" style="width:26px;height:26px;position:relative"></div>', iconSize: [26, 26], iconAnchor: [13, 26] }), title: el.dataset.name }).addTo(map);
    else L.circle([lat, lng], { radius: privacy === 'aproximada' ? 1500 : 6000, color: '#254583', weight: 2, dashArray: '6 6', fillColor: '#2f5597', fillOpacity: 0.12 }).addTo(map);
  }
  if (location.hash === '#orcamento') { const f = document.getElementById('q-name'); if (f && !new URLSearchParams(location.search).get('orcamento')) setTimeout(() => f.focus({ preventScroll: true }), 400); }
})();
