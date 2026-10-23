'use strict';
const { db } = require('./db');
const config = require('./config');
const { norm, digits } = require('./util');

// Gazetteer embutido: a busca por cidade/mapa funciona mesmo sem acesso ao serviço de geocodificação.
const G = `São Paulo|SP|-23.5505|-46.6333;Bom Retiro, São Paulo|SP|-23.5271|-46.6362;Brás, São Paulo|SP|-23.5440|-46.6206;Rio de Janeiro|RJ|-22.9068|-43.1729;Belo Horizonte|MG|-19.9167|-43.9345;
Curitiba|PR|-25.4284|-49.2733;Porto Alegre|RS|-30.0346|-51.2177;Florianópolis|SC|-27.5954|-48.5480;Brasília|DF|-15.7939|-47.8828;Goiânia|GO|-16.6869|-49.2648;
Salvador|BA|-12.9777|-38.5016;Recife|PE|-8.0476|-34.8770;Fortaleza|CE|-3.7319|-38.5267;Belém|PA|-1.4558|-48.4902;Manaus|AM|-3.1190|-60.0217;
Vitória|ES|-20.3155|-40.3128;Campo Grande|MS|-20.4697|-54.6201;Cuiabá|MT|-15.6014|-56.0979;Natal|RN|-5.7945|-35.2110;João Pessoa|PB|-7.1195|-34.8450;
Maceió|AL|-9.6498|-35.7089;Aracaju|SE|-10.9472|-37.0731;Teresina|PI|-5.0892|-42.8019;São Luís|MA|-2.5307|-44.3068;Palmas|TO|-10.1689|-48.3317;
Porto Velho|RO|-8.7612|-63.9004;Rio Branco|AC|-9.9747|-67.8100;Macapá|AP|0.0349|-51.0694;Boa Vista|RR|2.8235|-60.6758;
Jaraguá do Sul|SC|-26.4858|-49.0667;Blumenau|SC|-26.9194|-49.0661;Brusque|SC|-27.0977|-48.9175;Pomerode|SC|-26.7406|-49.1769;Gaspar|SC|-26.9314|-48.9586;
Joinville|SC|-26.3045|-48.8487;Itajaí|SC|-26.9078|-48.6619;Americana|SP|-22.7374|-47.3331;Nova Odessa|SP|-22.7783|-47.2956;Campinas|SP|-22.9099|-47.0626;
Itapira|SP|-22.4369|-46.8222;Jacutinga|MG|-22.2878|-46.6178;Monte Sião|MG|-22.4361|-46.5736;Ibitinga|SP|-21.7578|-48.8294;Birigui|SP|-21.2889|-50.3400;
Toritama|PE|-8.0112|-36.0561;Caruaru|PE|-8.2760|-35.9819;Santa Cruz do Capibaribe|PE|-7.9568|-36.2060;Cianorte|PR|-23.6600|-52.6050;Maringá|PR|-23.4205|-51.9331;
Apucarana|PR|-23.5510|-51.4614;Londrina|PR|-23.3045|-51.1696;Nova Friburgo|RJ|-22.2819|-42.5311;Petrópolis|RJ|-22.5050|-43.1789;Juiz de Fora|MG|-21.7642|-43.3503;
Divinópolis|MG|-20.1386|-44.8839;Uberlândia|MG|-18.9186|-48.2772;Pará de Minas|MG|-19.8603|-44.6089;Muriaé|MG|-21.1306|-42.3664;Anápolis|GO|-16.3281|-48.9534;
Jaraguá|GO|-15.7544|-49.3336;Guarulhos|SP|-23.4543|-46.5333;Osasco|SP|-23.5329|-46.7917;Santo André|SP|-23.6639|-46.5383;Campina Grande|PB|-7.2307|-35.8811;
Sobral|CE|-3.6890|-40.3482;Juazeiro do Norte|CE|-7.2131|-39.3153;Franca|SP|-20.5386|-47.4008;Ribeirão Preto|SP|-21.1775|-47.8103;Sorocaba|SP|-23.5015|-47.4526;Santos|SP|-23.9608|-46.3336`;

const places = G.replace(/\n/g, '').split(';').map((r) => { const [name, uf, lat, lng] = r.split('|'); return { name, uf, lat: +lat, lng: +lng, key: norm(name) }; });

function fromGazetteer(q) {
  const n = norm(q).replace(/[,\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const ufMatch = n.match(/\b([a-z]{2})$/);
  const uf = ufMatch ? ufMatch[1].toUpperCase() : null;
  const stripped = ufMatch ? n.slice(0, -3).trim() : n;
  const cand = (s) => places.filter((p) => p.key === s || p.key.split(',')[0] === s);
  let hits = cand(stripped).concat(cand(n));
  if (!hits.length) hits = places.filter((p) => p.key.includes(stripped) && stripped.length >= 4);
  if (uf) hits = hits.filter((p) => p.uf === uf).concat(hits.filter((p) => p.uf !== uf));
  const p = hits[0];
  return p ? { lat: p.lat, lng: p.lng, label: `${p.name} - ${p.uf}`, source: 'gazetteer' } : null;
}
async function fetchJson(url, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': config.geocodeUserAgent, 'Accept-Language': 'pt-BR' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function lookupCep(cep) {
  const d = digits(cep);
  if (d.length !== 8) return null;
  const key = `cep:${d}`;
  const cached = db.prepare('SELECT label FROM geocode_cache WHERE query=?').get(key);
  if (cached) { try { return JSON.parse(cached.label); } catch { /* segue */ } }
  try {
    const j = await fetchJson(`https://viacep.com.br/ws/${d}/json/`);
    if (j.erro) return null;
    const out = { cep: d, street: j.logradouro, neighborhood: j.bairro, city: j.localidade, state: j.uf };
    db.prepare('INSERT OR REPLACE INTO geocode_cache(query,lat,lng,label) VALUES(?,?,?,?)').run(key, null, null, JSON.stringify(out));
    return out;
  } catch { return null; }
}
// Ordem: cache → CEP → Nominatim → gazetteer embutido.
async function geocode(query, { precise = false } = {}) {
  let q = String(query || '').trim().slice(0, 200);
  if (!q) return null;
  const key = `q:${precise ? 'p:' : ''}${norm(q)}`;
  const cached = db.prepare('SELECT lat,lng,label FROM geocode_cache WHERE query=?').get(key);
  if (cached && cached.lat != null) return { lat: cached.lat, lng: cached.lng, label: cached.label, source: 'cache' };
  const asCep = /^\d{5}-?\d{3}$/.test(q) ? await lookupCep(q) : null;
  if (asCep) q = `${asCep.street ? asCep.street + ', ' : ''}${asCep.neighborhood ? asCep.neighborhood + ', ' : ''}${asCep.city} - ${asCep.state}`;
  let res = null;
  try {
    const j = await fetchJson(`${config.nominatimUrl}/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
    if (j && j[0]) res = { lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name.split(',').slice(0, 3).join(',').trim(), source: 'nominatim' };
  } catch { /* offline ou bloqueado: usa gazetteer */ }
  if (!res) res = fromGazetteer(asCep ? `${asCep.city} ${asCep.state}` : (precise ? q.split(',').slice(-2).join(' ') : q));
  if (res) {
    if (res.source === 'gazetteer' && precise) res.approx = true;
    db.prepare('INSERT OR REPLACE INTO geocode_cache(query,lat,lng,label) VALUES(?,?,?,?)').run(key, res.lat, res.lng, res.label);
  }
  return res;
}
module.exports = { geocode, lookupCep, fromGazetteer, places };
