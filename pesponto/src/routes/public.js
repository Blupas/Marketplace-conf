'use strict';
const express = require('express');
const { db } = require('../db');
const U = require('../util');
const D = require('../domain');
const cat = require('../catalog');
const config = require('../config');
const { geocode } = require('../geo');
const { csrfCheck, spamCheck, requireLogin } = require('../auth');
const { limit } = require('../ratelimit');
const { sendMail } = require('../mailer');
const router = express.Router();

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse/i;
const isBot = (req) => BOT.test(req.get('user-agent') || '');
const arr = (v) => [].concat(v || []).filter(Boolean).map(String);
const favSet = (req) => new Set(req.user ? db.prepare('SELECT company_id FROM favorites WHERE user_id=?').all(req.user.id).map((r) => r.company_id) : []);

// Lê e normaliza parâmetros de busca; resolve "perto de" (cidade/CEP) para coordenadas.
async function parseSearch(q) {
  const p = {
    q: U.text(q.q, 100) || '', categoria: arr(q.categoria).slice(0, 10), estado: cat.UFS.includes(String(q.estado || '').toUpperCase()) ? String(q.estado).toUpperCase() : '',
    cidade: U.text(q.cidade, 80) || '', perto: U.text(q.perto, 120) || '', raio: U.intOrNull(q.raio, { min: 1, max: 5000 }),
    maquina: U.text(q.maquina, 60) || '', maquinas_min: U.intOrNull(q.maquinas_min, { min: 1, max: 100000 }),
    capacidade_min: U.intOrNull(q.capacidade_min, { min: 1, max: 1e8 }), peca: U.text(q.peca, 60) || '', tecido: U.text(q.tecido, 60) || '',
    etapa: arr(q.etapa).filter((e) => cat.STEP_DEFAULTS.some((s) => s[0] === e)), lote_max: U.intOrNull(q.lote_max, { min: 1, max: 1e7 }),
    porte: arr(q.porte).filter((x) => ['pequena', 'media', 'grande'].includes(x)), disponibilidade: ['disponivel', 'aberta'].includes(q.disponibilidade) ? q.disponibilidade : '',
    ordem: ['relevancia', 'proximidade', 'recentes', 'nome', 'capacidade'].includes(q.ordem) ? q.ordem : 'relevancia', page: parseInt(q.page, 10) || 1,
    lat: q.lat !== undefined && q.lat !== '' ? Number(q.lat) : NaN, lng: q.lng !== undefined && q.lng !== '' ? Number(q.lng) : NaN,
  };
  if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) { p.lat = NaN; p.lng = NaN; }
  p.nearLabel = '';
  if (!Number.isFinite(p.lat) && p.perto) {
    const g = await geocode(p.perto);
    if (g) { p.lat = g.lat; p.lng = g.lng; p.nearLabel = g.label; } else p.nearFailed = true;
  } else if (Number.isFinite(p.lat)) p.nearLabel = p.perto || 'Minha localização';
  if (!Number.isFinite(p.lat) && p.ordem === 'proximidade') p.ordem = 'relevancia';
  return p;
}

function qsOf(p, omit = []) {
  const u = new URLSearchParams();
  const put = (k, v) => { if (!omit.includes(k) && v !== '' && v != null && !(typeof v === 'number' && !Number.isFinite(v))) u.append(k, v); };
  ['q', 'estado', 'cidade', 'perto', 'raio', 'maquina', 'maquinas_min', 'capacidade_min', 'peca', 'tecido', 'lote_max', 'disponibilidade'].forEach((k) => put(k, p[k]));
  if (Number.isFinite(p.lat) && !p.perto && !omit.includes('lat')) { put('lat', p.lat); put('lng', p.lng); }
  ['categoria', 'etapa', 'porte'].forEach((k) => { if (!omit.includes(k)) p[k].forEach((v) => u.append(k, v)); });
  if (p.ordem !== 'relevancia') put('ordem', p.ordem);
  return u.toString();
}
function qsOfWithout(p, key, val) { return qsOf({ ...p, [key]: p[key].filter((x) => x !== val) }); }

function activeFilters(p) {
  const out = [];
  const add = (label, omit) => out.push({ label, qs: qsOf(p, omit) });
  if (p.q) add(`“${p.q}”`, ['q']);
  p.categoria.forEach((s) => { const k = db.prepare('SELECT name FROM categories WHERE slug=?').get(s); if (k) out.push({ label: k.name, qs: qsOfWithout(p, 'categoria', s) }); });
  if (p.estado) add(`Estado: ${p.estado}`, ['estado']);
  if (p.cidade) add(`Cidade: ${p.cidade}`, ['cidade']);
  if (p.nearLabel) add(`Perto de ${p.nearLabel}${p.raio ? ` (até ${p.raio} km)` : ''}`, ['perto', 'raio', 'lat', 'lng']);
  if (p.maquina) add(`Máquina: ${D.machineTypeName(p.maquina)}${p.maquinas_min ? ` (mín. ${p.maquinas_min})` : ''}`, ['maquina', 'maquinas_min']);
  else if (p.maquinas_min) add(`Mín. ${p.maquinas_min} máquinas`, ['maquinas_min']);
  if (p.capacidade_min) add(`Capacidade ≥ ${U.fmtInt(p.capacidade_min)} pç/mês`, ['capacidade_min']);
  if (p.peca) add(`Peça: ${p.peca}`, ['peca']);
  if (p.tecido) add(`Tecido: ${p.tecido}`, ['tecido']);
  p.etapa.forEach((e) => out.push({ label: `Faz internamente: ${(cat.STEP_DEFAULTS.find((s) => s[0] === e) || [])[1]}`, qs: qsOfWithout(p, 'etapa', e) }));
  if (p.lote_max) add(`Lote mínimo ≤ ${U.fmtInt(p.lote_max)} pç`, ['lote_max']);
  p.porte.forEach((x) => out.push({ label: cat.SIZE_LABEL[x], qs: qsOfWithout(p, 'porte', x) }));
  if (p.disponibilidade) add(p.disponibilidade === 'disponivel' ? 'Aceitando novos pedidos' : 'Com vaga na agenda', ['disponibilidade']);
  return out;
}

// ---------------------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const featured = D.attachCategories(db.prepare(`${D.BASE_SELECT} WHERE c.status='aprovado' AND c.featured=1 AND (c.featured_until IS NULL OR c.featured_until > datetime('now')) ORDER BY c.approved_at DESC LIMIT 3`).all());
  const newest = D.attachCategories(db.prepare(`${D.BASE_SELECT} WHERE c.status='aprovado' ORDER BY c.approved_at DESC, c.id DESC LIMIT 4`).all());
  const popularCats = res.locals.categories.slice().sort((a, b) => b.n - a.n || a.position - b.position).slice(0, 8);
  const services = db.prepare(`SELECT s.id,s.slug,s.kind,s.name,s.description,s.fabrics,s.piece_types,s.min_batch,s.lead_time_days,s.price_min_cents,s.price_max_cents,s.price_unit,
      c.id AS company_id,c.slug AS company_slug,c.name AS company_name,c.is_demo,c.logo,a.city,a.state,k.name AS category_name,
      (SELECT thumb FROM media WHERE service_id=s.id AND kind='imagem' AND hidden=0 ORDER BY position LIMIT 1) AS photo,
      (SELECT COUNT(*) FROM events e WHERE e.service_id=s.id AND e.day >= date('now','-30 day')) AS hits
    FROM services s JOIN companies c ON c.id=s.company_id AND c.status='aprovado' LEFT JOIN company_addresses a ON a.company_id=c.id LEFT JOIN categories k ON k.id=s.category_id
    WHERE s.active=1 AND s.kind='servico' ORDER BY hits DESC, s.id DESC LIMIT 6`).all();
  const sample = featured[0] || newest[0];
  let spec = null;
  if (sample) {
    const cap = db.prepare('SELECT * FROM company_capacity WHERE company_id=?').get(sample.id);
    const top = db.prepare('SELECT name,quantity FROM machines WHERE company_id=? ORDER BY quantity DESC LIMIT 3').all(sample.id);
    spec = { c: sample, cap, top, steps: db.prepare("SELECT COUNT(*) n FROM production_steps WHERE company_id=? AND mode='interna'").get(sample.id).n,
      stepsTotal: db.prepare('SELECT COUNT(*) n FROM production_steps WHERE company_id=?').get(sample.id).n };
  }
  const quick = res.locals.categories.filter((k) => ['fabricas-de-jeans', 'faccoes-de-costura', 'lavanderias-industriais', 'estamparia', 'bordado-industrial', 'moda-fitness', 'private-label', 'corte-e-preparacao'].includes(k.slug));
  const banners = db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY position,id LIMIT 3').all();
  res.render('home', { banners, title: 'Encontre a confecção certa para produzir suas peças', home: true, canonical: '/', description: res.locals.site.hero_subtitle,
    featured, newest, popularCats, services, spec, quick, favIds: favSet(req), scripts: ['inicio'] });
});

router.get('/categoria/:slug', (req, res) => res.redirect(301, '/confeccoes?categoria=' + encodeURIComponent(req.params.slug)));

router.get('/confeccoes', async (req, res) => {
  const p = await parseSearch(req.query);
  const result = D.searchCompanies(p);
  if (p.page === 1 && (p.q || p.categoria.length || p.maquina || p.cidade || p.estado || p.perto) && !isBot(req)) D.track(result.total ? 'busca' : 'busca_vazia', { term: p.q || p.categoria[0] || p.maquina || p.cidade || p.perto });
  const baseQs = qsOf(p);
  res.render('busca', { title: p.q ? `Confecções: ${p.q}` : 'Encontrar confecções', description: 'Pesquise confecções, facções, lavanderias e fornecedores por máquinas, capacidade, etapas de produção e localização.',
    canonical: '/confeccoes' + (p.categoria.length === 1 && !p.q && !p.cidade && !p.estado ? '?categoria=' + p.categoria[0] : ''), noindex: !!(p.q || p.page > 1 || p.maquina || p.perto),
    p, result, baseQs, filters: activeFilters(p), favIds: favSet(req), machineTypes: cat.MACHINE_TYPES, scripts: ['busca'],
    pieces: cat.PIECE_SUGGESTIONS, fabrics: cat.FABRIC_SUGGESTIONS });
});

function listing(kind) {
  return (req, res) => {
    const p = { q: U.text(req.query.q, 100) || '', categoria: U.text(req.query.categoria, 80) || '', estado: cat.UFS.includes(String(req.query.estado || '').toUpperCase()) ? String(req.query.estado).toUpperCase() : '',
      cidade: U.text(req.query.cidade, 80) || '', lote_max: U.intOrNull(req.query.lote_max, { min: 1 }), page: parseInt(req.query.page, 10) || 1, kind };
    const result = D.searchServices(p);
    if (p.page === 1 && p.q && !isBot(req)) D.track('busca', { term: p.q });
    const u = new URLSearchParams(); ['q', 'categoria', 'estado', 'cidade', 'lote_max'].forEach((k) => p[k] && u.set(k, p[k]));
    const label = kind === 'produto' ? 'Produtos' : 'Serviços';
    res.render('anuncios', { title: p.q ? `${label}: ${p.q}` : `${label} da cadeia têxtil`, noindex: !!(p.q || p.page > 1), canonical: kind === 'produto' ? '/produtos' : '/servicos',
      description: kind === 'produto' ? 'Tecidos, aviamentos, máquinas e outros produtos oferecidos por empresas do setor têxtil.' : 'Facção de costura, corte, lavanderia, bordado, estamparia, modelagem e outros serviços de produção de roupas.',
      p, result, kind, label, baseQs: u.toString() });
  };
}
router.get('/servicos', listing('servico'));
router.get('/produtos', listing('produto'));

router.get('/mapa', (req, res) => res.render('mapa', { title: 'Mapa de confecções', description: 'Veja no mapa confecções, facções, lavanderias e fornecedores perto de você.', canonical: '/mapa', needsMap: true, scripts: ['mapa'],
  bodyClass: 'page-map', states: cat.UFS, cats: res.locals.categories }));

// ---------- Página da empresa ----------
router.get('/empresa/:slug', (req, res, next) => {
  const c = D.getCompanyFull('slug=?', req.params.slug);
  if (!c) return next();
  const isOwner = req.user && c.owner_id === req.user.id, isAdmin = req.user && req.user.role === 'admin';
  if (c.status !== 'aprovado' && !isOwner && !isAdmin) return next();
  const pa = D.publicAddress(c);
  const active = c.services.filter((s) => s.active);
  const media = c.media.filter((m) => !m.hidden);
  if (c.status === 'aprovado' && !isOwner && !isBot(req)) D.track('view_empresa', { companyId: c.id });
  const sectors = {};
  c.machines.forEach((m) => { const k = m.sector || 'Outros'; (sectors[k] = sectors[k] || []).push(m); });
  const stale = c.availability_updated_at && (Date.now() - new Date(c.availability_updated_at.replace(' ', 'T') + 'Z')) > 60 * 864e5;
  const first = active[0];
  const where = [pa.city, pa.state].filter(Boolean).join(' - ');
  const jsonld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: c.name, url: `${config.baseUrl}/empresa/${c.slug}`, description: c.tagline || undefined,
    image: c.cover ? config.baseUrl + res.locals.img(c.cover) : undefined, telephone: c.phone || undefined,
    address: { '@type': 'PostalAddress', addressLocality: pa.city, addressRegion: pa.state, streetAddress: pa.line || undefined, postalCode: pa.cep || undefined, addressCountry: 'BR' },
    geo: pa.hasPoint ? { '@type': 'GeoCoordinates', latitude: pa.lat, longitude: pa.lng } : undefined };
  res.render('empresa', { title: `${c.name}${where ? ' — ' + where : ''}`, description: (c.tagline || c.description || '').slice(0, 160), canonical: '/empresa/' + c.slug, noindex: c.status !== 'aprovado',
    ogImage: c.cover ? res.locals.img(c.cover) : null, jsonld, c, pa, active, media, sectors, stale, favIds: favSet(req), isOwner, isAdmin, needsMap: pa.hasPoint, scripts: ['empresa'],
    pre: { service: U.intOrNull(req.query.servico) || (first && active.length === 1 ? first.id : null) }, sent: req.query.orcamento === 'ok', reported: req.query.denuncia === 'ok' });
});

router.get('/anuncio/:id{/:slug}', (req, res, next) => {
  const s = db.prepare('SELECT s.*, k.name AS category_name FROM services s LEFT JOIN categories k ON k.id=s.category_id WHERE s.id=? AND s.active=1').get(req.params.id);
  if (!s) return next();
  const c = D.getCompanyFull('id=?', s.company_id);
  const isOwner = req.user && c.owner_id === req.user.id;
  if (c.status !== 'aprovado' && !isOwner && !(req.user && req.user.role === 'admin')) return next();
  if (req.params.slug !== s.slug) return res.redirect(301, `/anuncio/${s.id}/${s.slug}`);
  if (c.status === 'aprovado' && !isOwner && !isBot(req)) { D.track('view_anuncio', { companyId: c.id, serviceId: s.id }); db.prepare('UPDATE services SET views=views+1 WHERE id=?').run(s.id); }
  const photos = db.prepare("SELECT * FROM media WHERE service_id=? AND kind='imagem' AND hidden=0 ORDER BY position,id").all(s.id);
  const others = c.services.filter((x) => x.active && x.id !== s.id).slice(0, 4);
  res.render('anuncio', { title: `${s.name} — ${c.name}`, description: (s.description || '').slice(0, 160), canonical: `/anuncio/${s.id}/${s.slug}`, noindex: c.status !== 'aprovado',
    s, c, pa: D.publicAddress(c), photos, others, ogImage: photos[0] ? res.locals.img(photos[0].path) : (c.cover ? res.locals.img(c.cover) : null), scripts: ['empresa'] });
});

// ---------- Contato direto: redireciona ao link oficial do WhatsApp (registrando o clique) ----------
router.get('/ir/whatsapp/:id', limit('wa', 60, 60_000), (req, res, next) => {
  const c = db.prepare('SELECT id,name,whatsapp,status,owner_id FROM companies WHERE id=?').get(req.params.id);
  if (!c || !c.whatsapp) return next();
  if (c.status !== 'aprovado' && !(req.user && (req.user.id === c.owner_id || req.user.role === 'admin'))) return next();
  const sv = req.query.servico ? db.prepare('SELECT id,name FROM services WHERE id=? AND company_id=?').get(req.query.servico, c.id) : null;
  const url = U.waLink(c.whatsapp, U.waMessage(c.name, sv && sv.name));
  if (!isBot(req) && !(req.user && req.user.id === c.owner_id)) D.track('click_whatsapp', { companyId: c.id, serviceId: sv && sv.id });
  res.set('Cache-Control', 'no-store').redirect(302, url);
});

// ---------- Solicitação de orçamento (apenas encaminha o contato ao anunciante) ----------
router.post('/orcamento', limit('quote', 6, 3_600_000), csrfCheck, spamCheck(3), async (req, res) => {
  const b = req.body;
  const c = db.prepare("SELECT id,slug,name,email,owner_id FROM companies WHERE id=? AND status='aprovado'").get(b.company_id);
  if (!c) return res.status(404).render('erro', { title: 'Empresa não encontrada', code: 404, message: 'Esta empresa não está disponível para receber solicitações.' });
  const name = U.text(b.name, 100), email = U.text(b.email, 200), phone = U.normalizeBrPhone(b.phone) || U.text(b.phone, 30), message = U.text(b.message, 2000);
  const errors = [];
  if (!name) errors.push('Informe seu nome.');
  if (!email && !phone) errors.push('Informe um e-mail ou telefone para a empresa responder.');
  if (email && !U.isValidEmail(email)) errors.push('E-mail inválido.');
  if (!message || message.length < 10) errors.push('Descreva o que você precisa produzir (mínimo de 10 caracteres).');
  if (b.consent !== 'on') errors.push('Autorize o envio dos seus dados à empresa para continuar.');
  const url = `/empresa/${c.slug}`;
  if (errors.length) return res.status(422).render('erro', { title: 'Confira os dados', code: 422, message: errors.join(' '), back: url + '#orcamento' });
  const sv = b.service_id ? db.prepare('SELECT id FROM services WHERE id=? AND company_id=?').get(b.service_id, c.id) : null;
  db.prepare("INSERT INTO quote_requests(company_id,service_id,user_id,name,email,phone,quantity,message,consent_at) VALUES(?,?,?,?,?,?,?,?,datetime('now'))")
    .run(c.id, sv && sv.id, req.user ? req.user.id : null, name, email, phone, U.intOrNull(b.quantity, { min: 1 }), message);
  D.track('orcamento', { companyId: c.id, serviceId: sv && sv.id });
  if (c.email) sendMail({ to: c.email, subject: `Nova solicitação de orçamento — ${config.siteName}`, text: `Olá, ${c.name}!\n\n${name} pediu um orçamento pela ${config.siteName}.\n\nMensagem:\n${message}\n\nContato: ${[email, phone].filter(Boolean).join(' / ')}\n\nVeja todas no seu painel: ${config.baseUrl}/painel/contatos` }).catch(() => {});
  res.redirect(303, `${url}?orcamento=ok#orcamento`);
});

router.post('/denunciar', limit('report', 5, 3_600_000), csrfCheck, spamCheck(3), (req, res) => {
  const b = req.body;
  const c = db.prepare('SELECT id,slug FROM companies WHERE id=?').get(b.company_id);
  const reasons = ['informacao_incorreta', 'golpe_ou_fraude', 'conteudo_improprio', 'empresa_inexistente', 'outro'];
  if (!c || !reasons.includes(b.reason)) return res.status(422).render('erro', { title: 'Denúncia inválida', code: 422, message: 'Escolha o motivo da denúncia.' });
  db.prepare('INSERT INTO reports(company_id,reporter_id,reason,details,contact) VALUES(?,?,?,?,?)').run(c.id, req.user ? req.user.id : null, b.reason, U.text(b.details, 1500), U.text(b.contact, 150));
  res.redirect(303, `/empresa/${c.slug}?denuncia=ok#denuncia`);
});

// ---------- Comparação ----------
router.get('/comparar', (req, res) => {
  const ids = [...new Set(String(req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean))].slice(0, 4);
  const rows = ids.length ? D.attachCategories(db.prepare(`${D.BASE_SELECT} WHERE c.status='aprovado' AND c.id IN (${ids.map(() => '?').join(',')})`).all(...ids)) : [];
  rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const full = rows.map((r) => {
    const c = D.getCompanyFull('id=?', r.id);
    return { ...r, c, pa: D.publicAddress(c), phone: c.phone, email: c.email, hasWa: !!c.whatsapp,
      machineTypes: Object.entries(c.machines.reduce((m, x) => { m[x.name] = (m[x.name] || 0) + x.quantity; return m; }, {})),
      pieces: U.csvList(c.capacity && c.capacity.piece_types), services: c.services.filter((s) => s.active),
      stepsInt: c.steps.filter((s) => s.mode === 'interna'), stepsOut: c.steps.filter((s) => s.mode === 'terceirizada') };
  });
  res.render('comparar', { title: 'Comparar confecções', noindex: true, items: full, ids });
});

router.get('/favoritos', requireLogin, (req, res) => {
  const rows = D.attachCategories(db.prepare(`${D.BASE_SELECT} WHERE c.status='aprovado' AND c.id IN (SELECT company_id FROM favorites WHERE user_id=?) ORDER BY c.name`).all(req.user.id));
  res.render('favoritos', { title: 'Meus favoritos', noindex: true, rows, favIds: new Set(rows.map((r) => r.id)) });
});

router.get('/anunciar', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY position').all().map((p) => ({ ...p, features: JSON.parse(p.features || '[]') }));
  res.render('anunciar', { title: 'Anuncie sua confecção gratuitamente', description: 'Monte a página comercial da sua empresa com máquinas, etapas de produção e capacidade, e receba contatos direto no WhatsApp.', canonical: '/anunciar', plans });
});

// ---------- Institucional ----------
router.get('/sobre', (req, res) => res.render('institucional', { title: 'Sobre a plataforma', canonical: '/sobre', page: 'sobre' }));
router.get('/termos', (req, res) => res.render('institucional', { title: 'Termos de uso', canonical: '/termos', page: 'termos' }));
router.get('/privacidade', (req, res) => res.render('institucional', { title: 'Política de privacidade', canonical: '/privacidade', page: 'privacidade' }));
router.get('/contato', (req, res) => res.render('contato', { title: 'Contato', canonical: '/contato', sent: req.query.ok === '1' }));
router.post('/contato', limit('contact', 5, 3_600_000), csrfCheck, spamCheck(3), (req, res) => {
  const name = U.text(req.body.name, 100), email = U.text(req.body.email, 200), message = U.text(req.body.message, 3000);
  if (!name || !U.isValidEmail(email) || !message || message.length < 10) return res.status(422).render('erro', { title: 'Confira os dados', code: 422, message: 'Preencha nome, um e-mail válido e uma mensagem com pelo menos 10 caracteres.', back: '/contato' });
  db.prepare('INSERT INTO contact_messages(name,email,message) VALUES(?,?,?)').run(name, email, message);
  res.redirect(303, '/contato?ok=1');
});

router.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /painel\nDisallow: /admin\nDisallow: /conta\nDisallow: /api/\nDisallow: /ir/\nDisallow: /favoritos\nAllow: /\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`));
router.get('/sitemap.xml', (req, res) => {
  const esc = (s) => String(s).replace(/&/g, '&amp;');
  const urls = ['/', '/confeccoes', '/servicos', '/produtos', '/mapa', '/anunciar', '/sobre', '/contato', '/termos', '/privacidade'].map((u) => ({ loc: u }));
  db.prepare("SELECT slug,updated_at FROM companies WHERE status='aprovado'").all().forEach((c) => urls.push({ loc: `/empresa/${c.slug}`, mod: c.updated_at }));
  db.prepare("SELECT s.id,s.slug,s.updated_at FROM services s JOIN companies c ON c.id=s.company_id WHERE c.status='aprovado' AND s.active=1").all().forEach((s) => urls.push({ loc: `/anuncio/${s.id}/${s.slug}`, mod: s.updated_at }));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(config.baseUrl + u.loc)}</loc>${u.mod ? `<lastmod>${u.mod.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`);
});

module.exports = router;
module.exports.parseSearch = parseSearch;
