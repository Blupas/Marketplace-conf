'use strict';
const express = require('express');
const { db } = require('../db');
const U = require('../util');
const D = require('../domain');
const { geocode, lookupCep } = require('../geo');
const { csrfToken, csrfCheck, requireLogin } = require('../auth');
const { limit } = require('../ratelimit');
const router = express.Router();

router.get('/api/csrf', (req, res) => res.set('Cache-Control', 'no-store').json({ token: csrfToken(req, res) }));

// Empresas para o mapa (coordenadas PÚBLICAS apenas).
router.get('/api/empresas', limit('api-search', 120, 60_000), async (req, res) => {
  const { parseSearch } = require('./public');
  const p = await parseSearch(req.query);
  const limitN = Math.min(500, parseInt(req.query.limite, 10) || 300);
  let rows = [], total = 0;
  for (let page = 1; rows.length < limitN; page++) {
    const r = D.searchCompanies({ ...p, perPage: 48, page });
    total = r.total; rows.push(...r.rows);
    if (page >= r.pages || req.query.mapa !== '1') break;
  }
  rows = rows.slice(0, limitN);
  res.json({
    total, near: p.nearLabel ? { lat: p.lat, lng: p.lng, label: p.nearLabel } : null, nearFailed: !!p.nearFailed,
    items: rows.filter((c) => c.lat != null || req.query.mapa !== '1').map((c) => ({
      id: c.id, slug: c.slug, name: c.name, city: c.city, state: c.state, lat: c.lat, lng: c.lng, logo: c.logo ? res.locals.img(c.logo) : null,
      featured: !!c.featured, demo: !!c.is_demo, availability: c.availability, categories: (c.categories || []).slice(0, 3).map((k) => k.name), approx: c.privacy !== 'exata',
      distance: c.distance_km != null ? Math.round(c.distance_km * 10) / 10 : null, whatsapp: !!c.has_wa, machines: c.machine_total || null, capacity: c.max_monthly || c.avg_monthly || null,
    })),
  });
});

// Fragmento HTML de cards (seção "perto de você" da página inicial)
router.get('/fragmento/empresas', limit('frag', 60, 60_000), async (req, res) => {
  const { parseSearch } = require('./public');
  const p = await parseSearch({ ...req.query, ordem: 'proximidade' });
  if (!Number.isFinite(p.lat)) return res.status(422).json({ error: p.nearFailed ? 'Não encontramos esse local. Tente a cidade com o estado ou um CEP.' : 'Informe uma cidade, CEP ou use sua localização.' });
  const r = D.searchCompanies({ ...p, perPage: 6, page: 1 });
  const favIds = new Set(req.user ? db.prepare('SELECT company_id FROM favorites WHERE user_id=?').all(req.user.id).map((x) => x.company_id) : []);
  res.render('partials/cards-list', { rows: r.rows, favIds, label: p.nearLabel, total: r.total, qs: `perto=${encodeURIComponent(p.perto || '')}${p.perto ? '' : `&lat=${p.lat}&lng=${p.lng}`}&ordem=proximidade` });
});

router.get('/api/geocode', limit('geo', 40, 60_000), async (req, res) => {
  const q = U.text(req.query.q, 160);
  if (!q) return res.status(400).json({ error: 'Informe um local.' });
  const g = await geocode(q);
  if (!g) return res.status(404).json({ error: 'Local não encontrado.' });
  res.json({ lat: g.lat, lng: g.lng, label: g.label });
});

router.get('/api/cep/:cep', limit('cep', 40, 60_000), async (req, res) => {
  const r = await lookupCep(req.params.cep);
  if (!r) return res.status(404).json({ error: 'CEP não encontrado. Preencha o endereço manualmente.' });
  res.json(r);
});

router.post('/api/favoritos/:id', limit('fav', 120, 60_000), requireLogin, csrfCheck, (req, res) => {
  const c = db.prepare("SELECT id FROM companies WHERE id=? AND status='aprovado'").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND company_id=?').get(req.user.id, c.id);
  if (has) db.prepare('DELETE FROM favorites WHERE user_id=? AND company_id=?').run(req.user.id, c.id);
  else { db.prepare('INSERT INTO favorites(user_id,company_id) VALUES(?,?)').run(req.user.id, c.id); D.track('favorito', { companyId: c.id }); }
  res.json({ favorite: !has });
});

router.post('/api/evento', limit('evt', 120, 60_000), csrfCheck, (req, res) => {
  const type = req.body.type;
  if (!['click_telefone', 'click_email', 'copiar_contato', 'rota'].includes(type)) return res.status(400).json({ error: 'Evento inválido.' });
  const c = db.prepare("SELECT id FROM companies WHERE id=? AND status='aprovado'").get(req.body.company_id);
  if (c) D.track(type, { companyId: c.id });
  res.json({ ok: true });
});

module.exports = router;
