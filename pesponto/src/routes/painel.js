'use strict';
const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const U = require('../util');
const D = require('../domain');
const cat = require('../catalog');
const storage = require('../storage');
const { geocode } = require('../geo');
const { requireLogin, csrfCheck } = require('../auth');
const { limit } = require('../ratelimit');
const router = express.Router();

const mem = (mb, files = 10) => multer({ storage: multer.memoryStorage(), limits: { fileSize: mb * 1024 * 1024, files, fields: 80 } });
const upImg = mem(8, 8), upVideo = mem(40, 1);
const arr = (v) => [].concat(v === undefined ? [] : v);
const OK = { salvo: 'Alterações salvas.', criado: 'Pronto! Agora complete o perfil e envie para análise.', enviado: 'Enviado para análise. Você será avisado quando for publicado.', excluido: 'Item excluído.', adicionado: 'Item adicionado.', status: 'Situação atualizada.', padrao: 'Etapas padrão adicionadas. Ajuste a ordem e quem executa cada uma.' };

const myCompany = (req) => db.prepare('SELECT * FROM companies WHERE owner_id=? ORDER BY id LIMIT 1').get(req.user.id);
const log = (req, companyId, action, note) => db.prepare('INSERT INTO moderation_logs(admin_id,company_id,action,note) VALUES(?,?,?,?)').run(req.user.id, companyId, action, note || null);
const touch = (id) => { db.prepare("UPDATE companies SET updated_at=datetime('now') WHERE id=?").run(id); D.reindexCompany(id); };
const allCats = () => db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY position').all();

router.use(requireLogin);
router.use((req, res, next) => {
  if (req.user.role === 'anunciante') return next();
  if (req.user.role === 'admin') return res.redirect('/admin');
  if (req.path === '/ativar') return next();
  return res.render('painel/ativar', { title: 'Anunciar minha empresa', noindex: true });
});
router.post('/ativar', csrfCheck, (req, res) => {
  if (req.user.role === 'buscador') db.prepare("UPDATE users SET role='anunciante' WHERE id=?").run(req.user.id);
  res.redirect(303, '/painel/empresa?novo=1');
});

router.use((req, res, next) => {
  req.company = myCompany(req);
  res.locals.company = req.company;
  res.locals.panelActive = req.path.split('/')[1] || '';
  res.locals.okMsg = OK[req.query.ok] || null;
  res.locals.newQuotes = req.company ? db.prepare("SELECT COUNT(*) n FROM quote_requests WHERE company_id=? AND status='novo'").get(req.company.id).n : 0;
  res.locals.scripts = ['painel'];
  res.locals.noindex = true;
  next();
});
const needCompany = (req, res, next) => (req.company ? next() : res.redirect('/painel/empresa?novo=1'));

// ---------- Visão geral ----------
router.get('/', needCompany, (req, res) => {
  const c = req.company;
  const dias = [7, 30, 90].includes(+req.query.dias) ? +req.query.dias : 30;
  const since = `-${dias - 1} day`;
  const tot = {};
  db.prepare("SELECT type, COUNT(*) n FROM events WHERE company_id=? AND day >= date('now', ?) GROUP BY type").all(c.id, since).forEach((r) => { tot[r.type] = r.n; });
  const perDay = new Map(db.prepare("SELECT day, COUNT(*) n FROM events WHERE company_id=? AND type='view_empresa' AND day >= date('now', ?) GROUP BY day").all(c.id, since).map((r) => [r.day, r.n]));
  const series = [];
  for (let i = dias - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); series.push({ day: d, n: perDay.get(d) || 0 }); }
  const topServices = db.prepare(`SELECT s.id,s.name,s.kind,(SELECT COUNT(*) FROM events e WHERE e.service_id=s.id AND e.type='view_anuncio' AND e.day >= date('now', ?)) AS views,
      (SELECT COUNT(*) FROM events e WHERE e.service_id=s.id AND e.type='click_whatsapp' AND e.day >= date('now', ?)) AS wa FROM services s WHERE s.company_id=? ORDER BY views DESC, s.id LIMIT 6`).all(since, since, c.id);
  const quotes = db.prepare('SELECT q.*, s.name AS service_name FROM quote_requests q LEFT JOIN services s ON s.id=q.service_id WHERE q.company_id=? ORDER BY q.id DESC LIMIT 5').all(c.id);
  const cap = db.prepare('SELECT * FROM company_capacity WHERE company_id=?').get(c.id);
  res.render('painel/inicio', { title: 'Painel da empresa', tot, series, dias, topServices, quotes, comp: D.completeness(c.id), cap });
});

router.post('/disponibilidade', needCompany, csrfCheck, (req, res) => {
  const a = ['disponivel', 'limitada', 'indisponivel'].includes(req.body.availability) ? req.body.availability : null;
  db.prepare("UPDATE companies SET availability=?, availability_note=?, availability_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(a, U.text(req.body.availability_note, 300), req.company.id);
  if (req.body.available_monthly !== undefined) {
    db.prepare("INSERT INTO company_capacity(company_id,available_monthly,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(company_id) DO UPDATE SET available_monthly=excluded.available_monthly, updated_at=datetime('now')").run(req.company.id, U.intOrNull(req.body.available_monthly, { min: 0 }));
  }
  res.redirect(303, '/painel?ok=salvo');
});

router.post('/enviar', needCompany, csrfCheck, (req, res) => {
  const c = req.company, comp = D.completeness(c.id);
  if (!['rascunho', 'rejeitado'].includes(c.status)) return res.redirect('/painel');
  if (!comp.canSubmit) return res.redirect('/painel?erro=incompleto');
  db.prepare("UPDATE companies SET status='pendente', status_reason=NULL, updated_at=datetime('now') WHERE id=?").run(c.id);
  log(req, c.id, 'enviado_para_analise');
  res.redirect(303, '/painel?ok=enviado');
});

// ---------- Dados da empresa ----------
function cnpjValid(s) {
  const d = U.digits(s); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { let sum = 0, pos = n - 7; for (let i = n; i >= 1; i--) { sum += d[n - i] * pos--; if (pos < 2) pos = 9; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +d[12] && calc(13) === +d[13];
}
function valuesOf(c) {
  const a = c.address || {};
  return { ...c, ...a, phone: c.phone ? U.formatPhone(c.phone) : '', whatsapp: c.whatsapp ? U.formatPhone(c.whatsapp) : '', cep: a.cep ? U.formatCep(a.cep) : '', privacy: a.privacy || 'exata', cnpj: c.cnpj || '' };
}
const renderCompany = (res, status, c, errors, v, selCats, novo) => res.status(status).render('painel/empresa', { title: novo ? 'Cadastrar empresa' : 'Dados da empresa', c, errors, v, selCats, novo, allCats: allCats(), states: cat.UFS });

router.get('/empresa', (req, res) => {
  const c = req.company ? D.getCompanyFull('id=?', req.company.id) : null;
  renderCompany(res, 200, c, [], c ? valuesOf(c) : {}, c ? c.categories.map((k) => k.id) : [], !c);
});

router.post('/empresa', limit('company-save', 40, 3_600_000), upImg.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), csrfCheck, async (req, res) => {
  const b = req.body, errors = [];
  const existing = req.company;
  const full = () => (existing ? D.getCompanyFull('id=?', existing.id) : null);
  if (existing && existing.status === 'suspenso') errors.push('Esta empresa está suspensa. Fale com o suporte para reativá-la.');
  const name = U.text(b.name, 120);
  if (!name || name.length < 2) errors.push('Informe o nome da empresa.');
  const whatsapp = b.whatsapp ? U.normalizeBrPhone(b.whatsapp) : null; if (b.whatsapp && !whatsapp) errors.push('WhatsApp inválido. Use DDD + número, ex.: (47) 99999-0000.');
  const phone = b.phone ? U.normalizeBrPhone(b.phone) : null; if (b.phone && !phone) errors.push('Telefone inválido. Use DDD + número.');
  const email = U.text(b.email, 200); if (email && !U.isValidEmail(email)) errors.push('E-mail comercial inválido.');
  const website = b.website ? U.cleanUrl(b.website) : null; if (b.website && !website) errors.push('Endereço do site inválido.');
  const cnpj = b.cnpj ? U.digits(b.cnpj) : null; if (cnpj && !cnpjValid(cnpj)) errors.push('CNPJ inválido. Confira os 14 dígitos ou deixe em branco.');
  const year = U.intOrNull(b.founded_year, { min: 1800, max: new Date().getFullYear() }); if (b.founded_year && !year) errors.push('Ano de fundação inválido.');
  const cats = arr(b.categories).map(Number).filter((n) => db.prepare('SELECT 1 FROM categories WHERE id=? AND active=1').get(n)).slice(0, 8);
  const state = String(b.state || '').toUpperCase(); if (state && !cat.UFS.includes(state)) errors.push('Estado inválido.');
  const privacy = ['exata', 'aproximada', 'cidade'].includes(b.privacy) ? b.privacy : 'exata';
  let lat = b.lat !== '' && b.lat != null ? Number(String(b.lat).replace(',', '.')) : null, lng = b.lng !== '' && b.lng != null ? Number(String(b.lng).replace(',', '.')) : null;
  if ((lat != null && !(Math.abs(lat) <= 90)) || (lng != null && !(Math.abs(lng) <= 180))) { errors.push('Latitude/longitude inválidas.'); lat = lng = null; }
  const files = req.files || {};
  if (errors.length) return renderCompany(res, 422, full(), errors, b, cats, !existing);

  const fields = {
    name, legal_name: U.text(b.legal_name, 150), cnpj, tagline: U.text(b.tagline, 160), description: U.text(b.description, 3000), history: U.text(b.history, 3000),
    founded_year: year, specialties: U.text(b.specialties, 300), fabrics: U.text(b.fabrics, 300), phone, whatsapp, email, website,
    instagram: U.socialUrl('instagram', b.instagram), facebook: U.socialUrl('facebook', b.facebook), linkedin: U.socialUrl('linkedin', b.linkedin), hours: U.text(b.hours, 200),
    employees: U.intOrNull(b.employees, { min: 1, max: 100000 }), shifts: U.text(b.shifts, 80), min_batch: U.intOrNull(b.min_batch, { min: 1, max: 1e7 }), lead_time_days: U.intOrNull(b.lead_time_days, { min: 1, max: 720 }),
    attends_small: b.attends_small ? 1 : 0, attends_medium: b.attends_medium ? 1 : 0, attends_large: b.attends_large ? 1 : 0,
  };
  const av = ['disponivel', 'limitada', 'indisponivel'].includes(b.availability) ? b.availability : null;
  const oldFiles = [];
  try {
    if (files.logo && files.logo[0]) { const r = await storage.saveImage(files.logo[0].buffer, { max: 600, thumb: 200 }); fields.logo = r.path; oldFiles.push(existing && existing.logo); }
    if (files.cover && files.cover[0]) { const r = await storage.saveImage(files.cover[0].buffer, { max: 1800, thumb: 640 }); fields.cover = r.path; oldFiles.push(existing && existing.cover); }
  } catch (e) { return renderCompany(res, 422, full(), [e.message], b, cats, !existing); }

  let id;
  const note = U.text(b.availability_note, 300);
  if (existing) {
    id = existing.id;
    const availChanged = av !== existing.availability || note !== existing.availability_note;
    const keys = Object.keys(fields);
    db.prepare(`UPDATE companies SET ${keys.map((k) => `${k}=?`).join(',')}, availability=?, availability_note=?, ${availChanged ? "availability_updated_at=datetime('now')," : ''} updated_at=datetime('now') WHERE id=?`)
      .run(...keys.map((k) => fields[k]), av, note, id);
  } else {
    fields.slug = D.uniqueSlug(name);
    const keys = Object.keys(fields);
    id = db.prepare(`INSERT INTO companies(owner_id,${keys.join(',')},availability,availability_note,availability_updated_at,status) VALUES(?,${keys.map(() => '?').join(',')},?,?,${av ? "datetime('now')" : 'NULL'},'rascunho')`)
      .run(req.user.id, ...keys.map((k) => fields[k]), av, note).lastInsertRowid;
  }
  db.prepare('DELETE FROM company_categories WHERE company_id=?').run(id);
  cats.forEach((k) => db.prepare('INSERT INTO company_categories(company_id,category_id) VALUES(?,?)').run(id, k));

  // Endereço + geocodificação
  const addr = { cep: U.digits(b.cep) || null, street: U.text(b.street, 150), number: U.text(b.number, 20), complement: U.text(b.complement, 80), neighborhood: U.text(b.neighborhood, 80), city: U.text(b.city, 80), state: state || null };
  const prev = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(id);
  let geocoded = 0;
  const changedAddr = !prev || ['cep', 'street', 'number', 'neighborhood', 'city', 'state'].some((k) => (prev[k] || null) !== (addr[k] || null));
  if (lat == null && addr.city && addr.state && (changedAddr || !prev || prev.lat == null)) {
    const q = [addr.street && addr.street + (addr.number ? ', ' + addr.number : ''), addr.neighborhood, addr.city, addr.state].filter(Boolean).join(', ');
    const g = (await geocode(q, { precise: true }).catch(() => null)) || (await geocode(`${addr.city} ${addr.state}`).catch(() => null));
    if (g) { lat = g.lat; lng = g.lng; geocoded = g.approx || g.source === 'gazetteer' ? 0 : 1; }
  } else if (lat != null) geocoded = 1;
  else if (prev && !changedAddr) { lat = prev.lat; lng = prev.lng; geocoded = prev.geocoded; }
  db.prepare(`INSERT INTO company_addresses(company_id,cep,street,number,complement,neighborhood,city,state,lat,lng,geocoded,privacy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET cep=excluded.cep,street=excluded.street,number=excluded.number,complement=excluded.complement,neighborhood=excluded.neighborhood,city=excluded.city,state=excluded.state,lat=excluded.lat,lng=excluded.lng,geocoded=excluded.geocoded,privacy=excluded.privacy`)
    .run(id, addr.cep, addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state, lat, lng, geocoded, privacy);
  D.setPublicCoords(id);
  touch(id);
  await storage.remove(...oldFiles.filter(Boolean));
  res.redirect(303, existing ? '/painel/empresa?ok=salvo' : '/painel?ok=criado');
});

// ---------- Capacidade ----------
router.get('/capacidade', needCompany, (req, res) => res.render('painel/capacidade', { title: 'Capacidade produtiva', cap: db.prepare('SELECT * FROM company_capacity WHERE company_id=?').get(req.company.id) || {}, pieces: cat.PIECE_SUGGESTIONS }));
router.post('/capacidade', needCompany, csrfCheck, (req, res) => {
  const b = req.body, n = (k, max = 1e8) => U.intOrNull(b[k], { min: 0, max });
  db.prepare(`INSERT INTO company_capacity(company_id,avg_monthly,max_monthly,available_monthly,per_day,per_shift,production_staff,piece_types,min_batch,lead_time_days,notes,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(company_id) DO UPDATE SET avg_monthly=excluded.avg_monthly,max_monthly=excluded.max_monthly,available_monthly=excluded.available_monthly,per_day=excluded.per_day,per_shift=excluded.per_shift,
      production_staff=excluded.production_staff,piece_types=excluded.piece_types,min_batch=excluded.min_batch,lead_time_days=excluded.lead_time_days,notes=excluded.notes,updated_at=datetime('now')`)
    .run(req.company.id, n('avg_monthly'), n('max_monthly'), n('available_monthly'), n('per_day'), n('per_shift'), n('production_staff', 100000), U.csvList(b.piece_types).join(', ') || null, n('min_batch', 1e7), n('lead_time_days', 720), U.text(b.notes, 600));
  if (b.available_monthly !== '' && b.available_monthly != null) db.prepare("UPDATE companies SET availability_updated_at=datetime('now') WHERE id=?").run(req.company.id);
  touch(req.company.id);
  res.redirect(303, '/painel/capacidade?ok=salvo');
});

// ---------- Máquinas ----------
router.get('/maquinas', needCompany, (req, res) => {
  const list = db.prepare('SELECT * FROM machines WHERE company_id=? ORDER BY position,id').all(req.company.id);
  const edit = req.query.editar ? list.find((m) => m.id === +req.query.editar) : null;
  res.render('painel/maquinas', { title: 'Máquinas e equipamentos', list, edit, types: cat.MACHINE_TYPES, total: list.reduce((s, m) => s + m.quantity, 0) });
});
router.post('/maquinas', needCompany, limit('mach', 120, 3_600_000), upImg.single('photo'), csrfCheck, async (req, res) => {
  const b = req.body, id = b.id ? +b.id : null;
  const own = id ? db.prepare('SELECT * FROM machines WHERE id=? AND company_id=?').get(id, req.company.id) : null;
  if (id && !own) return res.redirect('/painel/maquinas');
  const known = cat.MACHINE_TYPES.find((t) => t[0] === b.type);
  const type = known ? known[0] : U.text(b.type_custom, 60);
  const name = U.text(b.name, 100) || (known && known[1]);
  const qty = U.intOrNull(b.quantity, { min: 1, max: 100000 });
  const back = (msg) => res.redirect(303, `/painel/maquinas?erro=${encodeURIComponent(msg)}${id ? '&editar=' + id : ''}`);
  if (!type || !name) return back('Escolha o tipo e informe o nome da máquina.');
  if (!qty) return back('Informe a quantidade (mínimo 1).');
  let photo = own ? own.photo : null;
  if (req.file) { try { const r = await storage.saveImage(req.file.buffer, { max: 1000, thumb: 300 }); await storage.remove(own && own.photo); photo = r.path; } catch (e) { return back(e.message); } }
  const vals = [type, name, qty, U.text(b.brand, 60), U.text(b.model, 60), U.text(b.operation, 150), U.text(b.sector, 60), photo];
  if (own) db.prepare('UPDATE machines SET type=?,name=?,quantity=?,brand=?,model=?,operation=?,sector=?,photo=? WHERE id=?').run(...vals, id);
  else db.prepare('INSERT INTO machines(type,name,quantity,brand,model,operation,sector,photo,company_id,position) VALUES(?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM machines WHERE company_id=?))').run(...vals, req.company.id, req.company.id);
  touch(req.company.id);
  res.redirect(303, '/painel/maquinas?ok=' + (own ? 'salvo' : 'adicionado'));
});
router.post('/maquinas/:id/excluir', needCompany, csrfCheck, async (req, res) => {
  const m = db.prepare('SELECT * FROM machines WHERE id=? AND company_id=?').get(req.params.id, req.company.id);
  if (m) { db.prepare('DELETE FROM machines WHERE id=?').run(m.id); await storage.remove(m.photo); touch(req.company.id); }
  res.redirect(303, '/painel/maquinas?ok=excluido');
});

// ---------- Etapas do processo ----------
router.get('/etapas', needCompany, (req, res) => res.render('painel/etapas', { title: 'Etapas do processo produtivo', steps: db.prepare('SELECT * FROM production_steps WHERE company_id=? ORDER BY position,id').all(req.company.id), defaults: cat.STEP_DEFAULTS }));
router.post('/etapas/padrao', needCompany, csrfCheck, (req, res) => {
  if (!db.prepare('SELECT 1 FROM production_steps WHERE company_id=?').get(req.company.id)) {
    cat.STEP_DEFAULTS.forEach((s, i) => db.prepare('INSERT INTO production_steps(company_id,step_key,name,description,mode,position) VALUES(?,?,?,?,?,?)').run(req.company.id, s[0], s[1], s[2], 'interna', i));
    touch(req.company.id);
  }
  res.redirect(303, '/painel/etapas?ok=padrao');
});
router.post('/etapas', needCompany, csrfCheck, (req, res) => {
  const names = arr(req.body.name), keys = arr(req.body.step_key), descs = arr(req.body.description), modes = arr(req.body.mode);
  const rows = names.map((n, i) => ({ name: U.text(n, 120), key: cat.STEP_DEFAULTS.some((s) => s[0] === keys[i]) ? keys[i] : null, desc: U.text(descs[i], 400), mode: ['interna', 'terceirizada', 'nao_oferece'].includes(modes[i]) ? modes[i] : 'interna' })).filter((r) => r.name).slice(0, 40);
  db.transaction(() => {
    db.prepare('DELETE FROM production_steps WHERE company_id=?').run(req.company.id);
    rows.forEach((r, i) => db.prepare('INSERT INTO production_steps(company_id,step_key,name,description,mode,position) VALUES(?,?,?,?,?,?)').run(req.company.id, r.key, r.name, r.desc, r.mode, i));
  })();
  touch(req.company.id);
  res.redirect(303, '/painel/etapas?ok=salvo');
});

// ---------- Produtos e serviços ----------
router.get('/servicos', needCompany, (req, res) => res.render('painel/servicos', { title: 'Produtos e serviços', list: db.prepare(`SELECT s.*, k.name AS category_name, (SELECT COUNT(*) FROM events e WHERE e.service_id=s.id AND e.type='view_anuncio') AS views FROM services s LEFT JOIN categories k ON k.id=s.category_id WHERE s.company_id=? ORDER BY s.id DESC`).all(req.company.id) }));
const serviceForm = (req, res, s, errors = [], v = null, status = 200) => res.status(status).render('painel/servico-form', { title: s ? 'Editar anúncio' : 'Novo anúncio', s, errors, v: v || s || { kind: req.query.tipo === 'produto' ? 'produto' : 'servico' },
  photos: s ? db.prepare("SELECT * FROM media WHERE service_id=? AND kind='imagem' ORDER BY position,id").all(s.id) : [], allCats: allCats() });
router.get('/servicos/novo', needCompany, (req, res) => serviceForm(req, res, null));
router.get('/servicos/:id/editar', needCompany, (req, res, next) => { const s = db.prepare('SELECT * FROM services WHERE id=? AND company_id=?').get(req.params.id, req.company.id); if (!s) return next(); serviceForm(req, res, s); });
router.post('/servicos', needCompany, limit('svc', 100, 3_600_000), upImg.array('fotos', 6), csrfCheck, async (req, res) => {
  const b = req.body, id = b.id ? +b.id : null;
  const own = id ? db.prepare('SELECT * FROM services WHERE id=? AND company_id=?').get(id, req.company.id) : null;
  if (id && !own) return res.redirect('/painel/servicos');
  const name = U.text(b.name, 120), errors = [];
  if (!name) errors.push('Informe o nome do serviço ou produto.');
  const pmin = U.priceToCents(b.price_min), pmax = U.priceToCents(b.price_max);
  if (pmin != null && pmax != null && pmax < pmin) errors.push('O preço máximo não pode ser menor que o mínimo.');
  if (errors.length) return serviceForm(req, res, own, errors, b, 422);
  const catId = db.prepare('SELECT id FROM categories WHERE id=? AND active=1').get(b.category_id);
  const vals = { kind: b.kind === 'produto' ? 'produto' : 'servico', name, category_id: catId ? catId.id : null, description: U.text(b.description, 2000), fabrics: U.text(b.fabrics, 200), piece_types: U.text(b.piece_types, 200),
    min_batch: U.intOrNull(b.min_batch, { min: 1, max: 1e7 }), capacity_note: U.text(b.capacity_note, 200), lead_time_days: U.intOrNull(b.lead_time_days, { min: 1, max: 720 }),
    price_min_cents: pmin, price_max_cents: pmax, price_unit: U.text(b.price_unit, 40), conditions: U.text(b.conditions, 1000), active: b.active === '0' ? 0 : 1 };
  let sid = id;
  const ks = Object.keys(vals);
  if (own) db.prepare(`UPDATE services SET ${ks.map((k) => `${k}=?`).join(',')}, slug=?, updated_at=datetime('now') WHERE id=?`).run(...ks.map((k) => vals[k]), D.uniqueSlug(name, 'services', id, req.company.id), id);
  else sid = db.prepare(`INSERT INTO services(company_id,slug,${ks.join(',')}) VALUES(?,?,${ks.map(() => '?').join(',')})`).run(req.company.id, D.uniqueSlug(name, 'services', null, req.company.id), ...ks.map((k) => vals[k])).lastInsertRowid;
  let photoErr = null;
  for (const f of req.files || []) {
    try { const r = await storage.saveImage(f.buffer, { max: 1400, thumb: 480 }); db.prepare("INSERT INTO media(company_id,service_id,kind,path,thumb,position) VALUES(?,?,'imagem',?,?,(SELECT COALESCE(MAX(position),0)+1 FROM media WHERE service_id=?))").run(req.company.id, sid, r.path, r.thumb, sid); }
    catch (e) { photoErr = e.message; }
  }
  touch(req.company.id);
  res.redirect(303, `/painel/servicos?ok=${own ? 'salvo' : 'adicionado'}${photoErr ? '&erro=' + encodeURIComponent('Alguma foto não foi aceita: ' + photoErr) : ''}`);
});
router.post('/servicos/:id/ativar', needCompany, csrfCheck, (req, res) => { db.prepare("UPDATE services SET active=1-active, updated_at=datetime('now') WHERE id=? AND company_id=?").run(req.params.id, req.company.id); touch(req.company.id); res.redirect(303, '/painel/servicos?ok=salvo'); });
router.post('/servicos/:id/excluir', needCompany, csrfCheck, async (req, res) => {
  const s = db.prepare('SELECT id FROM services WHERE id=? AND company_id=?').get(req.params.id, req.company.id);
  if (s) { const m = db.prepare('SELECT path,thumb FROM media WHERE service_id=?').all(s.id); db.prepare('DELETE FROM services WHERE id=?').run(s.id); await storage.remove(...m.flatMap((x) => [x.path, x.thumb])); touch(req.company.id); }
  res.redirect(303, '/painel/servicos?ok=excluido');
});
router.post('/servicos/:id/foto/:mid/excluir', needCompany, upImg.none(), csrfCheck, async (req, res) => {
  const m = db.prepare('SELECT m.* FROM media m JOIN services s ON s.id=m.service_id WHERE m.id=? AND s.id=? AND s.company_id=?').get(req.params.mid, req.params.id, req.company.id);
  if (m) { db.prepare('DELETE FROM media WHERE id=?').run(m.id); await storage.remove(m.path, m.thumb); }
  res.redirect(303, `/painel/servicos/${req.params.id}/editar?ok=excluido`);
});

// ---------- Galeria ----------
router.get('/galeria', needCompany, (req, res) => res.render('painel/galeria', { title: 'Fotos e vídeos', media: db.prepare('SELECT * FROM media WHERE company_id=? AND service_id IS NULL ORDER BY position,id').all(req.company.id) }));
router.post('/galeria/imagens', needCompany, limit('gal', 60, 3_600_000), upImg.array('fotos', 8), csrfCheck, async (req, res) => {
  let bad = 0;
  for (const f of req.files || []) {
    try { const r = await storage.saveImage(f.buffer); db.prepare("INSERT INTO media(company_id,kind,path,thumb,caption,position) VALUES(?,'imagem',?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM media WHERE company_id=?))").run(req.company.id, r.path, r.thumb, U.text(req.body.caption, 140), req.company.id); } catch (e) { bad++; }
  }
  touch(req.company.id);
  res.redirect(303, '/painel/galeria?ok=adicionado' + (bad ? '&erro=' + encodeURIComponent(`${bad} arquivo(s) não aceito(s). Envie JPG, PNG ou WebP.`) : ''));
});
router.post('/galeria/video', needCompany, limit('galv', 30, 3_600_000), upVideo.single('video'), csrfCheck, async (req, res) => {
  try {
    if (req.file) { const r = await storage.saveVideo(req.file.buffer); db.prepare("INSERT INTO media(company_id,kind,path,caption,position) VALUES(?,'video_upload',?,?,(SELECT COALESCE(MAX(position),0)+1 FROM media WHERE company_id=?))").run(req.company.id, r.path, U.text(req.body.caption, 140), req.company.id); }
    else { const emb = U.videoEmbed(req.body.url); if (!emb) throw new Error('Link inválido. Cole um link do YouTube ou Vimeo.'); db.prepare("INSERT INTO media(company_id,kind,path,caption,position) VALUES(?,'video_embed',?,?,(SELECT COALESCE(MAX(position),0)+1 FROM media WHERE company_id=?))").run(req.company.id, emb, U.text(req.body.caption, 140), req.company.id); }
  } catch (e) { return res.redirect(303, '/painel/galeria?erro=' + encodeURIComponent(e.message)); }
  res.redirect(303, '/painel/galeria?ok=adicionado');
});
router.post('/galeria/:id/legenda', needCompany, csrfCheck, (req, res) => { db.prepare('UPDATE media SET caption=? WHERE id=? AND company_id=?').run(U.text(req.body.caption, 140), req.params.id, req.company.id); res.redirect(303, '/painel/galeria?ok=salvo'); });
router.post('/galeria/:id/excluir', needCompany, csrfCheck, async (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND company_id=?').get(req.params.id, req.company.id);
  if (m) { db.prepare('DELETE FROM media WHERE id=?').run(m.id); if (m.kind !== 'video_embed') await storage.remove(m.path, m.thumb); }
  res.redirect(303, '/painel/galeria?ok=excluido');
});

// ---------- Contatos recebidos ----------
router.get('/contatos', needCompany, (req, res) => {
  const quotes = db.prepare('SELECT q.*, s.name AS service_name FROM quote_requests q LEFT JOIN services s ON s.id=q.service_id WHERE q.company_id=? ORDER BY q.id DESC LIMIT 200').all(req.company.id);
  const ev = {}; db.prepare("SELECT type, COUNT(*) n FROM events WHERE company_id=? AND type IN ('click_whatsapp','click_telefone','click_email','copiar_contato','rota') GROUP BY type").all(req.company.id).forEach((r) => { ev[r.type] = r.n; });
  res.render('painel/contatos', { title: 'Contatos recebidos', quotes, ev });
});
router.post('/contatos/:id/status', needCompany, csrfCheck, (req, res) => {
  if (['novo', 'visto', 'respondido', 'arquivado'].includes(req.body.status)) db.prepare('UPDATE quote_requests SET status=? WHERE id=? AND company_id=?').run(req.body.status, req.params.id, req.company.id);
  res.redirect(303, '/painel/contatos?ok=status');
});

module.exports = router;
