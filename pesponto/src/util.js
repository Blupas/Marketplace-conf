'use strict';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slugify = (s) => norm(s).replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
const digits = (s) => String(s ?? '').replace(/\D/g, '');

function normalizeBrPhone(s) {
  let d = digits(s);
  if (!d) return null;
  d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}
function formatPhone(s) {
  const d = digits(s).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s || '';
}
const formatCep = (s) => { const d = digits(s); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (s || ''); };
const fmtInt = (n) => (n == null || n === '' ? '' : new Intl.NumberFormat('pt-BR').format(n));

function fmtDate(s, withTime = false) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' } : { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(d);
}
function timeAgo(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'agora há pouco';
  if (sec < 3600) return `há ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `há ${Math.floor(sec / 3600)} h`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  if (days < 365) { const m = Math.floor(days / 30); return `há ${m} ${m === 1 ? 'mês' : 'meses'}`; }
  const y = Math.floor(days / 365); return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}
const money = (cents) => (cents == null ? '' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100));
const csvList = (s) => String(s ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function waLink(number, text) {
  const n = digits(number);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
function waMessage(companyName, serviceName) {
  const alvo = serviceName ? `o serviço/produto “${serviceName}”` : 'os serviços de confecção';
  return `Olá! Encontrei a ${companyName} na plataforma Pesponto e gostaria de saber mais sobre ${alvo}. Poderia me informar os detalhes, a quantidade mínima e o prazo de produção?`;
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// Localização pública conforme a privacidade escolhida: 'exata' | 'aproximada' (~1–2 km) | 'cidade' (ponto grosseiro).
function publicCoords(lat, lng, privacy, seed = 1) {
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (privacy === 'exata') return { lat, lng };
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const h2 = Math.abs(Math.sin(seed * 78.233) * 12345.6789) % 1;
  if (privacy === 'aproximada') {
    const ang = h * 2 * Math.PI, dist = 0.008 + h2 * 0.008;
    return { lat: +(lat + Math.sin(ang) * dist).toFixed(3), lng: +(lng + Math.cos(ang) * dist).toFixed(3) };
  }
  return { lat: +(+lat.toFixed(1) + (h - 0.5) * 0.04).toFixed(3), lng: +(+lng.toFixed(1) + (h2 - 0.5) * 0.04).toFixed(3) };
}
function isValidEmail(s) { return /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '')) && String(s).length <= 254; }
function cleanUrl(s) {
  s = String(s || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
}
function socialUrl(kind, s) {
  s = String(s || '').trim();
  if (!s) return null;
  const base = { instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', linkedin: 'https://linkedin.com/company/' }[kind];
  if (/^https?:\/\//i.test(s)) return cleanUrl(s);
  if (/^[\w.\-]+\.[a-z]{2,}\//i.test(s)) return cleanUrl(s);
  const handle = s.replace(/^@/, '').replace(/[^\w.\-]/g, '');
  return handle ? base + handle : null;
}
function videoEmbed(url) {
  try {
    const u = new URL(cleanUrl(url));
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}` : null;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/) || [])[1];
      return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === 'vimeo.com') { const id = u.pathname.match(/^\/(\d+)/); return id ? `https://player.vimeo.com/video/${id[1]}` : null; }
  } catch { /* ignora */ }
  return null;
}
const intOrNull = (v, { min = 0, max = 1e9 } = {}) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (v, max = 500) => { const s = String(v ?? '').replace(/\r/g, '').trim(); return s ? s.slice(0, max) : null; };
const priceToCents = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

module.exports = { norm, slugify, digits, normalizeBrPhone, formatPhone, formatCep, fmtInt, fmtDate, timeAgo, money, csvList,
  waLink, waMessage, haversine, publicCoords, isValidEmail, cleanUrl, socialUrl, videoEmbed, intOrNull, text, priceToCents };
