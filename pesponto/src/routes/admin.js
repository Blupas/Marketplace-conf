'use strict';
const express = require('express');
const { db, setSetting } = require('../db');
const U = require('../util');
const D = require('../domain');
const cat = require('../catalog');
const storage = require('../storage');
const { requireRole, csrfCheck } = require('../auth');
const { sendMail } = require('../mailer');
const config = require('../config');
const router = express.Router();

const OK = { salvo: 'Alterações salvas.', aprovado: 'Empresa aprovada e publicada.', rejeitado: 'Empresa rejeitada.', suspenso: 'Empresa suspensa.', reativado: 'Empresa reativada.', criado: 'Criado.', excluido: 'Excluído.', resolvida: 'Denúncia resolvida.' };
const arr = (v) => [].concat(v === undefined ? [] : v);
const trim = (v, n = 300) => (v == null ? '' : String(v).trim().slice(0, n));
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const back = (req, res, to, ok) => res.redirect(303, `${to}${to.includes('?') ? '&' : '?'}ok=${ok}`);
const fail = (res, to, msg) => res.redirect(303, `${to}${to.includes('?') ? '&' : '?'}erro=${encodeURIComponent(msg)}`);
const log = (req, companyId, action, note) => db.prepare('INSERT INTO moderation_logs(admin_id,company_id,action,note) VALUES(?,?,?,?)').run(req.user.id, companyId || null, action, note || null);
const bust = (req) => req.app.locals.invalidateSettings && req.app.locals.invalidateSettings();
const notify = (companyId, subject, text) => {
  const o = db.prepare('SELECT u.email,u.name FROM companies c JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(companyId);
  if (o) sendMail({ to: o.email, subject: `${subject} — ${config.siteName}`, text: `Olá, ${o.name}!\n\n${text}\n\n${config.baseUrl}/painel` }).catch(() => {});
};

router.use(requireRole('admin'));
router.use((req, res, next) => {
  res.locals.pendingCount = db.prepare("SELECT COUNT(*) n FROM companies WHERE status='pendente'").get().n;
  res.locals.openReports = db.prepare("SELECT COUNT(*) n FROM reports WHERE status='aberta'").get().n;
  res.locals.panelActive = req.path.split('/')[1] || '';
  res.locals.okMsg = OK[req.query.ok] || null;
  res.locals.noindex = true;
  res.locals.scripts = [];
  next();
});

// ---------- Visão geral ----------
router.get('/', (req, res) => {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  const kpi = {
    empresas: n("SELECT COUNT(*) n FROM companies WHERE status='aprovado' AND is_demo=0"),
    demo: n("SELECT COUNT(*) n FROM companies WHERE is_demo=1"),
    pendentes: res.locals.pendingCount,
    usuarios: n('SELECT COUNT(*) n FROM users'),
    servicos: n("SELECT COUNT(*) n FROM services s JOIN companies c ON c.id=s.company_id WHERE s.active=1 AND c.status='aprovado'"),
    denuncias: res.locals.openReports,
    msgs: n('SELECT COUNT(*) n FROM contact_messages WHERE handled=0'),
  };
  const ev = {};
  db.prepare("SELECT type, COUNT(*) n FROM events WHERE day >= date('now','-29 day') GROUP BY type").all().forEach((r) => { ev[r.type] = r.n; });
  const perDay = new Map(db.prepare("SELECT day, COUNT(*) n FROM events WHERE type IN ('view_empresa','view_anuncio') AND day >= date('now','-29 day') GROUP BY day").all().map((r) => [r.day, r.n]));
  const series = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); series.push({ day: d, n: perDay.get(d) || 0 }); }
  const terms = db.prepare("SELECT term, COUNT(*) n FROM events WHERE type='busca' AND term IS NOT NULL AND term<>'' AND day >= date('now','-29 day') GROUP BY term ORDER BY n DESC, term LIMIT 10").all();
  const noResult = db.prepare("SELECT term, COUNT(*) n FROM events WHERE type='busca_vazia' AND term IS NOT NULL AND term<>'' AND day >= date('now','-29 day') GROUP BY term ORDER BY n DESC LIMIT 8").all();
  const topCompanies = db.prepare(`SELECT c.id,c.name,c.slug,COUNT(e.id) n FROM events e JOIN companies c ON c.id=e.company_id WHERE e.type='view_empresa' AND e.day >= date('now','-29 day') AND c.is_demo=0 GROUP BY c.id ORDER BY n DESC LIMIT 8`).all();
  const states = db.prepare("SELECT a.state, COUNT(*) n FROM companies c JOIN company_addresses a ON a.company_id=c.id WHERE c.status='aprovado' AND a.state IS NOT NULL GROUP BY a.state ORDER BY n DESC LIMIT 8").all();
  res.render('admin/inicio', { title: 'Administração', kpi, ev, series, terms, noResult, topCompanies, states });
});

// ---------- Empresas ----------
router.get('/empresas', (req, res) => {
  const status = ['rascunho', 'pendente', 'aprovado', 'rejeitado', 'suspenso'].includes(req.query.status) ? req.query.status : '';
  const q = trim(req.query.q, 80);
  const demo = req.query.demo === '1';
  const where = []; const p = [];
  if (status) { where.push('c.status=?'); p.push(status); }
  if (demo) where.push('c.is_demo=1');
  if (q) { where.push('(c.name_norm LIKE ? OR u.email LIKE ?)'); p.push(`%${U.norm(q)}%`, `%${q}%`); }
  const list = db.prepare(`SELECT c.id,c.name,c.slug,c.status,c.featured,c.featured_until,c.is_demo,c.created_at,c.updated_at,a.city,a.state,u.email AS owner_email,pl.name AS plan_name,
      (SELECT COUNT(*) FROM reports r WHERE r.company_id=c.id AND r.status='aberta') AS reports
    FROM companies c LEFT JOIN company_addresses a ON a.company_id=c.id LEFT JOIN users u ON u.id=c.owner_id LEFT JOIN plans pl ON pl.id=c.plan_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE c.status WHEN 'pendente' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT 300`).all(...p);
  const counts = {}; db.prepare('SELECT status, COUNT(*) n FROM companies GROUP BY status').all().forEach((r) => { counts[r.status] = r.n; });
  res.render('admin/empresas', { title: 'Empresas', list, status, q, demo, counts });
});

router.get('/empresas/:id', (req, res, next) => {
  const c = db.prepare('SELECT c.*, u.email AS owner_email, u.name AS owner_name FROM companies c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(req.params.id);
  if (!c) return next();
  const a = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(c.id) || {};
  const comp = D.completeness(c.id);
  const cats = db.prepare('SELECT k.name FROM company_categories cc JOIN categories k ON k.id=cc.category_id WHERE cc.company_id=?').all(c.id).map((x) => x.name);
  const logs = db.prepare('SELECT l.*, u.name AS admin_name FROM moderation_logs l LEFT JOIN users u ON u.id=l.admin_id WHERE l.company_id=? ORDER BY l.id DESC LIMIT 30').all(c.id);
  const reports = db.prepare('SELECT * FROM reports WHERE company_id=? ORDER BY id DESC LIMIT 20').all(c.id);
  const counts = {
    servicos: db.prepare('SELECT COUNT(*) n FROM services WHERE company_id=?').get(c.id).n,
    maquinas: db.prepare('SELECT COUNT(*) n FROM machines WHERE company_id=?').get(c.id).n,
    midias: db.prepare('SELECT COUNT(*) n FROM media WHERE company_id=?').get(c.id).n,
  };
  const plans = db.prepare('SELECT * FROM plans ORDER BY position').all();
  res.render('admin/empresa', { title: c.name, c, a, comp, cats, logs, reports, counts, plans });
});

const setStatus = (status, okKey, action) => (req, res, next) => {
  const c = db.prepare('SELECT * FROM companies WHERE id=?').get(req.params.id);
  if (!c) return next();
  const reason = trim(req.body.reason, 500);
  if (['rejeitado', 'suspenso'].includes(status) && !reason) return fail(res, `/admin/empresas/${c.id}`, "Informe o motivo.");
  if (status === 'aprovado') {
    const comp = D.completeness(c.id);
    if (!comp.canSubmit && !req.body.force) return fail(res, `/admin/empresas/${c.id}`, "O perfil ainda não tem os itens obrigatórios. Marque “aprovar mesmo assim” só se tiver certeza.");
    db.prepare("UPDATE companies SET status='aprovado', status_reason=NULL, approved_at=COALESCE(approved_at, datetime('now')), updated_at=datetime('now') WHERE id=?").run(c.id);
  } else {
    db.prepare("UPDATE companies SET status=?, status_reason=?, updated_at=datetime('now') WHERE id=?").run(status, reason || null, c.id);
  }
  D.reindexCompany(c.id); D.setPublicCoords(c.id);
  log(req, c.id, action, reason);
  if (status === 'aprovado') notify(c.id, 'Sua empresa foi publicada', `A página de ${c.name} foi aprovada e já está visível em ${config.baseUrl}/empresa/${c.slug}.`);
  if (status === 'rejeitado') notify(c.id, 'Sua empresa precisa de ajustes', `A página de ${c.name} não foi aprovada.\nMotivo: ${reason}\nAjuste e envie novamente para análise.`);
  if (status === 'suspenso') notify(c.id, 'Sua página foi suspensa', `A página de ${c.name} foi suspensa.\nMotivo: ${reason}\nResponda este contato para esclarecer.`);
  back(req, res, req.body.next === 'lista' ? '/admin/empresas?status=pendente' : `/admin/empresas/${c.id}`, okKey);
};
router.post('/empresas/:id/aprovar', csrfCheck, setStatus('aprovado', 'aprovado', 'aprovada'));
router.post('/empresas/:id/rejeitar', csrfCheck, setStatus('rejeitado', 'rejeitado', 'rejeitada'));
router.post('/empresas/:id/suspender', csrfCheck, setStatus('suspenso', 'suspenso', 'suspensa'));
router.post('/empresas/:id/reativar', csrfCheck, setStatus('aprovado', 'reativado', 'reativada'));

router.post('/empresas/:id/destaque', csrfCheck, (req, res, next) => {
  const c = db.prepare('SELECT id FROM companies WHERE id=?').get(req.params.id);
  if (!c) return next();
  const on = req.body.featured ? 1 : 0;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(req.body.featured_until || '') ? req.body.featured_until : null;
  db.prepare('UPDATE companies SET featured=?, featured_until=? WHERE id=?').run(on, on ? until : null, c.id);
  log(req, c.id, on ? 'destaque_ligado' : 'destaque_desligado', until ? `até ${until}` : null);
  back(req, res, `/admin/empresas/${c.id}`, 'salvo');
});
router.post('/empresas/:id/plano', csrfCheck, (req, res, next) => {
  const c = db.prepare('SELECT id FROM companies WHERE id=?').get(req.params.id);
  if (!c) return next();
  const plan = db.prepare('SELECT id,name FROM plans WHERE id=?').get(int(req.body.plan_id));
  db.prepare('UPDATE companies SET plan_id=? WHERE id=?').run(plan ? plan.id : null, c.id);
  log(req, c.id, 'plano', plan ? plan.name : 'nenhum');
  back(req, res, `/admin/empresas/${c.id}`, 'salvo');
});
router.post('/empresas/:id/excluir', csrfCheck, (req, res, next) => {
  const c = db.prepare('SELECT id,name,logo,cover FROM companies WHERE id=?').get(req.params.id);
  if (!c) return next();
  if (trim(req.body.confirm, 200) !== c.name) return fail(res, `/admin/empresas/${c.id}`, "Digite o nome exato da empresa para confirmar a exclusão.");
  db.prepare('SELECT path,thumb FROM media WHERE company_id=?').all(c.id).forEach((m) => { storage.remove(m.path); storage.remove(m.thumb); });
  storage.remove(c.logo); storage.remove(c.cover);
  db.prepare('DELETE FROM companies WHERE id=?').run(c.id);
  log(req, null, 'empresa_excluida', c.name);
  back(req, res, '/admin/empresas', 'excluido');
});

// ---------- Denúncias ----------
router.get('/denuncias', (req, res) => {
  const status = ['aberta', 'procedente', 'improcedente'].includes(req.query.status) ? req.query.status : 'aberta';
  const list = db.prepare(`SELECT r.*, c.name AS company_name, c.slug, c.status AS company_status, u.email AS reporter_email FROM reports r JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=? ORDER BY r.id DESC LIMIT 200`).all(status);
  res.render('admin/denuncias', { title: 'Denúncias', list, status });
});
router.post('/denuncias/:id', csrfCheck, (req, res, next) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!r) return next();
  const status = ['procedente', 'improcedente'].includes(req.body.status) ? req.body.status : null;
  if (!status) return back(req, res, '/admin/denuncias', 'salvo');
  const resolution = trim(req.body.resolution, 500);
  db.prepare("UPDATE reports SET status=?, resolution=?, resolved_at=datetime('now') WHERE id=?").run(status, resolution || null, r.id);
  log(req, r.company_id, `denuncia_${status}`, resolution);
  if (status === 'procedente' && req.body.suspend) {
    db.prepare("UPDATE companies SET status='suspenso', status_reason=?, updated_at=datetime('now') WHERE id=?").run(resolution || 'Denúncia procedente', r.company_id);
    D.reindexCompany(r.company_id); log(req, r.company_id, 'suspensa', 'Após denúncia procedente');
    notify(r.company_id, 'Sua página foi suspensa', `Uma denúncia contra sua página foi considerada procedente.\n${resolution}`);
  }
  back(req, res, `/admin/denuncias?status=${r.status}`, 'resolvida');
});

// ---------- Usuários ----------
router.get('/usuarios', (req, res) => {
  const role = ['buscador', 'anunciante', 'admin'].includes(req.query.role) ? req.query.role : '';
  const q = trim(req.query.q, 80);
  const where = []; const p = [];
  if (role) { where.push('u.role=?'); p.push(role); }
  if (q) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  const list = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.last_login_at,(SELECT COUNT(*) FROM companies c WHERE c.owner_id=u.id) AS companies
    FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC LIMIT 300`).all(...p);
  res.render('admin/usuarios', { title: 'Usuários', list, role, q });
});
router.post('/usuarios/:id', csrfCheck, (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return next();
  const role = ['buscador', 'anunciante', 'admin'].includes(req.body.role) ? req.body.role : u.role;
  const active = req.body.active === '0' ? 0 : 1;
  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n;
  if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && admins <= 1) return fail(res, '/admin/usuarios', "Não é possível remover ou desativar o último administrador.");
  if (u.id === req.user.id && (!active || role !== 'admin')) return fail(res, '/admin/usuarios', "Você não pode desativar nem rebaixar a própria conta.");
  db.prepare('UPDATE users SET role=?, active=? WHERE id=?').run(role, active, u.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  log(req, null, 'usuario', `${u.email}: ${role}${active ? '' : ' (desativado)'}`);
  back(req, res, '/admin/usuarios', 'salvo');
});

// ---------- Categorias ----------
router.get('/categorias', (req, res) => {
  const list = db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM company_categories cc WHERE cc.category_id=k.id) AS companies, (SELECT COUNT(*) FROM services s WHERE s.category_id=k.id) AS services FROM categories k ORDER BY k.position, k.id`).all();
  res.render('admin/categorias', { title: 'Categorias', list });
});
router.post('/categorias', csrfCheck, (req, res) => {
  const name = trim(req.body.name, 80);
  if (!name) return fail(res, '/admin/categorias', "Informe um nome.");
  const kind = ['empresa', 'segmento', 'servico'].includes(req.body.kind) ? req.body.kind : 'empresa';
  const slug = U.slugify(name) || 'categoria';
  let s = slug, i = 2; while (db.prepare('SELECT 1 FROM categories WHERE slug=?').get(s)) s = `${slug}-${i++}`;
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM categories').get().n;
  db.prepare('INSERT INTO categories(slug,name,kind,icon,description,position) VALUES(?,?,?,?,?,?)').run(s, name, kind, trim(req.body.icon, 30) || 'tesoura', trim(req.body.description, 200) || null, pos);
  bust(req); log(req, null, 'categoria_criada', name);
  back(req, res, '/admin/categorias', 'criado');
});
router.post('/categorias/:id', csrfCheck, (req, res, next) => {
  const k = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!k) return next();
  const name = trim(req.body.name, 80) || k.name;
  db.prepare('UPDATE categories SET name=?, description=?, icon=?, position=?, active=? WHERE id=?')
    .run(name, trim(req.body.description, 200) || null, trim(req.body.icon, 30) || k.icon, int(req.body.position, k.position), req.body.active === '0' ? 0 : 1, k.id);
  bust(req); log(req, null, 'categoria_editada', name);
  back(req, res, '/admin/categorias', 'salvo');
});
router.post('/categorias/:id/excluir', csrfCheck, (req, res, next) => {
  const k = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!k) return next();
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM company_categories WHERE category_id=?) + (SELECT COUNT(*) FROM services WHERE category_id=?) n').get(k.id, k.id).n;
  if (used) return fail(res, '/admin/categorias', "Esta categoria está em uso. Desative-a em vez de excluir.");
  db.prepare('DELETE FROM categories WHERE id=?').run(k.id);
  bust(req); log(req, null, 'categoria_excluida', k.name);
  back(req, res, '/admin/categorias', 'excluido');
});

// ---------- Mídias e registros ----------
router.get('/moderacao', (req, res) => {
  const media = db.prepare(`SELECT m.*, c.name AS company_name FROM media m JOIN companies c ON c.id=m.company_id ORDER BY m.id DESC LIMIT 60`).all();
  const logs = db.prepare('SELECT l.*, u.name AS admin_name, c.name AS company_name FROM moderation_logs l LEFT JOIN users u ON u.id=l.admin_id LEFT JOIN companies c ON c.id=l.company_id ORDER BY l.id DESC LIMIT 80').all();
  res.render('admin/moderacao', { title: 'Mídias e registros', media, logs });
});
router.post('/midia/:id', csrfCheck, (req, res, next) => {
  const m = db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id);
  if (!m) return next();
  if (req.body.action === 'excluir') {
    storage.remove(m.path); storage.remove(m.thumb);
    db.prepare('DELETE FROM media WHERE id=?').run(m.id); log(req, m.company_id, 'midia_excluida', String(m.id));
    return back(req, res, '/admin/moderacao', 'excluido');
  }
  const hide = req.body.action === 'ocultar' ? 1 : 0;
  db.prepare('UPDATE media SET hidden=? WHERE id=?').run(hide, m.id);
  log(req, m.company_id, hide ? 'midia_ocultada' : 'midia_reexibida', String(m.id));
  back(req, res, '/admin/moderacao', 'salvo');
});

// ---------- Planos ----------
router.get('/planos', (req, res) => {
  const list = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM companies c WHERE c.plan_id=p.id) AS companies FROM plans p ORDER BY position').all();
  const featured = db.prepare(`SELECT c.id,c.name,c.featured_until FROM companies c WHERE c.featured=1 ORDER BY c.name`).all();
  res.render('admin/planos', { title: 'Planos e destaques', list, featured });
});
router.post('/planos/:id', csrfCheck, (req, res, next) => {
  const p = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
  if (!p) return next();
  const features = trim(req.body.features, 1000).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const price = Math.max(0, Math.round(parseFloat(String(req.body.price || '0').replace(',', '.')) * 100) || 0);
  db.prepare('UPDATE plans SET name=?, description=?, features=?, price_cents=?, search_boost=?, available=? WHERE id=?')
    .run(trim(req.body.name, 60) || p.name, trim(req.body.description, 300) || null, JSON.stringify(features), price, Math.max(0, Math.min(10, int(req.body.search_boost))), req.body.available ? 1 : 0, p.id);
  log(req, null, 'plano_editado', p.name);
  back(req, res, '/admin/planos', 'salvo');
});

// ---------- Banners e textos ----------
const TEXT_KEYS = ['site_name', 'site_tagline', 'hero_title', 'hero_subtitle', 'about_text', 'footer_text', 'contact_email', 'dpo_email', 'legal_name', 'legal_cnpj'];
router.get('/conteudo', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners ORDER BY position, id').all();
  res.render('admin/conteudo', { title: 'Banners e textos', banners, keys: TEXT_KEYS });
});
router.post('/conteudo/textos', csrfCheck, (req, res) => {
  TEXT_KEYS.forEach((k) => { if (req.body[k] !== undefined) setSetting(k, trim(req.body[k], k === 'about_text' ? 3000 : 400)); });
  setSetting('demo_banner', req.body.demo_banner ? '1' : '0');
  bust(req); log(req, null, 'textos_editados');
  back(req, res, '/admin/conteudo', 'salvo');
});
router.post('/conteudo/banners', csrfCheck, (req, res) => {
  const title = trim(req.body.title, 120);
  if (!title) return fail(res, '/admin/conteudo', "Informe um nome.");
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM banners').get().n;
  db.prepare('INSERT INTO banners(title,text,link,cta,active,position) VALUES(?,?,?,?,1,?)').run(title, trim(req.body.text, 300) || null, safeLink(req.body.link), trim(req.body.cta, 40) || null, pos);
  log(req, null, 'banner_criado', title); back(req, res, '/admin/conteudo', 'criado');
});
const safeLink = (v) => { const s = trim(v, 300); return /^(\/(?!\/)|https?:\/\/)/.test(s) ? s : null; };
router.post('/conteudo/banners/:id', csrfCheck, (req, res, next) => {
  const b = db.prepare('SELECT * FROM banners WHERE id=?').get(req.params.id);
  if (!b) return next();
  if (req.body.action === 'excluir') { db.prepare('DELETE FROM banners WHERE id=?').run(b.id); return back(req, res, '/admin/conteudo', 'excluido'); }
  db.prepare('UPDATE banners SET title=?, text=?, link=?, cta=?, active=?, position=? WHERE id=?')
    .run(trim(req.body.title, 120) || b.title, trim(req.body.text, 300) || null, safeLink(req.body.link), trim(req.body.cta, 40) || null, req.body.active ? 1 : 0, int(req.body.position, b.position), b.id);
  back(req, res, '/admin/conteudo', 'salvo');
});

// ---------- Mensagens de contato ----------
router.get('/mensagens', (req, res) => {
  const list = db.prepare('SELECT * FROM contact_messages ORDER BY handled, id DESC LIMIT 200').all();
  res.render('admin/mensagens', { title: 'Mensagens', list });
});
router.post('/mensagens/:id', csrfCheck, (req, res) => {
  db.prepare('UPDATE contact_messages SET handled=? WHERE id=?').run(req.body.handled === '0' ? 0 : 1, req.params.id);
  back(req, res, '/admin/mensagens', 'salvo');
});

module.exports = router;
