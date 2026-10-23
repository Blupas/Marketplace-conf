'use strict';
// Copia fontes e bibliotecas (hospedagem própria: sem Google Fonts/CDN, por desempenho e LGPD).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'public', p);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
try {
  copy(nm('@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'), out('fonts/bricolage.woff2'));
  copy(nm('@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2'), out('fonts/instrument.woff2'));
  copy(nm('leaflet/dist/leaflet.css'), out('vendor/leaflet/leaflet.css'));
  copy(nm('leaflet/dist/leaflet.js'), out('vendor/leaflet/leaflet.js'));
  copy(nm('leaflet/dist/images'), out('vendor/leaflet/images'));
  copy(nm('leaflet.markercluster/dist/MarkerCluster.css'), out('vendor/leaflet/MarkerCluster.css'));
  copy(nm('leaflet.markercluster/dist/MarkerCluster.Default.css'), out('vendor/leaflet/MarkerCluster.Default.css'));
  copy(nm('leaflet.markercluster/dist/leaflet.markercluster.js'), out('vendor/leaflet/leaflet.markercluster.js'));
  console.log('Fontes e bibliotecas copiadas para public/.');
} catch (e) { console.warn('Aviso ao copiar vendor:', e.message); }
