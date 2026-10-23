'use strict';
// Regras de negócio e consultas compartilhadas entre site público, painel do anunciante e administração.
const { db } = require('./db');
const U = require('./util');
const { MACHINE_TYPES } = require('./catalog');

const track = (type, { companyId = null, serviceId = null, term = null } = {}) => {
  try { db.prepare('INSERT INTO events(type,company_id,service_id,term) VALUES(?,?,?,?)').run(type, companyId, serviceId, term ? String(term).slice(0, 120) : null); } catch { /* não bloqueia o fluxo */ }
};

function uniqueSlug(base, table = 'companies', excludeId = null, scope = null) {
  const root = U.slugify(base);
  let slug = root, i = 2;
  const q = scope ? db.prepare(`SELECT id FROM ${table} WHERE slug=? AND company_id=? AND id<>?`) : db.prepare(`SELECT id FROM ${table} WHERE slug=? AND id<>?`);
  while (scope ? q.get(slug, scope, excludeId ?? 0) : q.get(slug, excludeId ?? 0)) slug = `${root}-${i++}`;
  return slug;
}

// Recalcula os campos de busca (texto normalizado) da empresa e dos seus anúncios.
function reindexCompany(id) {
  const c = db.prepare('SELECT * FROM companies WHERE id=?').get(id);
  if (!c) return;
  const a = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(id) || {};
  const cats = db.prepare('SELECT c.name FROM categories c JOIN company_categories cc ON cc.category_id=c.id WHERE cc.company_id=?').all(id).map((r) => r.name);
  const sv = db.prepare('SELECT id,name,description,fabrics,piece_types FROM services WHERE company_id=? AND active=1').all(id);
  const mc = db.prepare('SELECT name,type,brand,model FROM machines WHERE company_id=?').all(id);
  const st = db.prepare("SELECT name FROM production_steps WHERE company_id=? AND mode='interna'").all(id).map((r) => r.name);
  const cap = db.prepare('SELECT piece_types FROM company_capacity WHERE company_id=?').get(id) || {};
  const parts = [c.name, c.tagline, c.specialties, c.fabrics, a.city, a.state, a.neighborhood, cats.join(' '),
    sv.map((s) => `${s.name} ${s.fabrics || ''} ${s.piece_types || ''}`).join(' '),
    mc.map((m) => `${m.name} ${m.type} ${m.brand || ''} ${m.model || ''}`).join(' '), st.join(' '), cap.piece_types];
  db.prepare('UPDATE companies SET search_text=?, name_norm=? WHERE id=?').run(U.norm(parts.filter(Boolean).join(' ')), U.norm(c.name), id);
  const upd = db.prepare('UPDATE services SET search_text=? WHERE id=?');
  for (const s of db.prepare('SELECT * FROM services WHERE company_id=?').all(id)) {
    upd.run(U.norm(`${s.name} ${s.description || ''} ${s.fabrics || ''} ${s.piece_types || ''} ${c.name} ${a.city || ''} ${a.state || ''}`), s.id);
  }
}
function setPublicCoords(companyId) {
  const a = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(companyId);
  if (!a) return;
  const p = U.publicCoords(a.lat, a.lng, a.privacy, companyId);
  db.prepare('UPDATE company_addresses SET pub_lat=?, pub_lng=? WHERE company_id=?').run(p.lat, p.lng, companyId);
}

const BASE_SELECT = `
  SELECT c.id,c.slug,c.name,c.tagline,c.logo,c.cover,c.status,c.featured,c.is_demo,c.availability,c.availability_updated_at,
         c.min_batch,c.lead_time_days,c.approved_at,c.created_at,c.attends_small,c.attends_medium,c.attends_large,
         (c.whatsapp IS NOT NULL AND c.whatsapp<>'') AS has_wa,
         a.city,a.state,a.neighborhood,a.privacy,a.pub_lat AS lat,a.pub_lng AS lng,
         cap.max_monthly,cap.avg_monthly,cap.available_monthly,
         (SELECT COALESCE(SUM(quantity),0) FROM machines m WHERE m.company_id=c.id) AS machine_total,
         (SELECT COUNT(*) FROM services s WHERE s.company_id=c.id AND s.active=1) AS service_count,
         (SELECT COUNT(*) FROM production_steps ps WHERE ps.company_id=c.id AND ps.mode='interna') AS steps_internal,
         (SELECT COUNT(*) FROM production_steps ps WHERE ps.company_id=c.id) AS steps_total
  FROM companies c
  LEFT JOIN company_addresses a ON a.company_id=c.id
  LEFT JOIN company_capacity cap ON cap.company_id=c.id`;

function attachCategories(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const all = db.prepare(`SELECT cc.company_id, c.slug, c.name FROM company_categories cc JOIN categories c ON c.id=cc.category_id
    WHERE cc.company_id IN (${ids.map(() => '?').join(',')}) AND c.active=1 ORDER BY c.position`).all(...ids);
  const by = new Map();
  for (const r of all) { if (!by.has(r.company_id)) by.set(r.company_id, []); by.get(r.company_id).push({ slug: r.slug, name: r.name }); }
  rows.forEach((r) => { r.categories = by.get(r.id) || []; });
  return rows;
}

function searchCompanies(p = {}) {
  const where = ["c.status='aprovado'"], args = [];
  const tokens = U.norm(p.q).split(/\s+/).filter((t) => t.length > 1).slice(0, 6);
  for (const t of tokens) { where.push('c.search_text LIKE ?'); args.push(`%${t}%`); }
  const cats = [].concat(p.categoria || []).filter(Boolean);
  if (cats.length) {
    where.push(`c.id IN (SELECT cc.company_id FROM company_categories cc JOIN categories k ON k.id=cc.category_id WHERE k.slug IN (${cats.map(() => '?').join(',')}))`);
    args.push(...cats);
  }
  if (p.estado) { where.push('a.state=?'); args.push(String(p.estado).toUpperCase()); }
  if (p.cidade) { where.push('a.city LIKE ?'); args.push(`%${p.cidade.trim()}%`); }
  if (p.maquina) {
    const key = U.norm(p.maquina);
    const minQty = U.intOrNull(p.maquinas_min, { min: 1 }) || 1;
    where.push('c.id IN (SELECT company_id FROM machines WHERE (lower(type)=? OR lower(name) LIKE ?) GROUP BY company_id HAVING SUM(quantity) >= ?)');
    args.push(key, `%${key}%`, minQty);
  } else if (U.intOrNull(p.maquinas_min, { min: 1 })) {
    where.push('(SELECT COALESCE(SUM(quantity),0) FROM machines m WHERE m.company_id=c.id) >= ?'); args.push(U.intOrNull(p.maquinas_min, { min: 1 }));
  }
  const capMin = U.intOrNull(p.capacidade_min, { min: 1 });
  if (capMin) { where.push('cap.max_monthly >= ?'); args.push(capMin); }
  if (p.peca) { where.push('(cap.piece_types LIKE ? OR c.search_text LIKE ?)'); args.push(`%${p.peca}%`, `%${U.norm(p.peca)}%`); }
  if (p.tecido) { where.push('(c.fabrics LIKE ? OR c.id IN (SELECT company_id FROM services WHERE fabrics LIKE ? AND active=1))'); args.push(`%${p.tecido}%`, `%${p.tecido}%`); }
  for (const e of [].concat(p.etapa || []).filter(Boolean)) { where.push("c.id IN (SELECT company_id FROM production_steps WHERE step_key=? AND mode='interna')"); args.push(e); }
  const lote = U.intOrNull(p.lote_max, { min: 1 });
  if (lote) { where.push('(COALESCE(c.min_batch, cap.min_batch) IS NOT NULL AND COALESCE(c.min_batch, cap.min_batch) <= ?)'); args.push(lote); }
  const porte = [].concat(p.porte || []).filter((x) => ['pequena', 'media', 'grande'].includes(x));
  if (porte.length) where.push('(' + porte.map((x) => `c.attends_${x === 'pequena' ? 'small' : x === 'media' ? 'medium' : 'large'}=1`).join(' OR ') + ')');
  if (p.disponibilidade === 'disponivel') where.push("c.availability='disponivel'");
  else if (p.disponibilidade === 'aberta') where.push("c.availability IN ('disponivel','limitada')");

  const hasPoint = Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const dist = hasPoint ? 'haversine(a.pub_lat,a.pub_lng,?,?)' : 'NULL';
  const distArgs = hasPoint ? [p.lat, p.lng] : [];
  const raio = U.intOrNull(p.raio, { min: 1, max: 5000 });
  const having = hasPoint && raio ? `AND ${dist} <= ?` : '';
  const havingArgs = hasPoint && raio ? [...distArgs, raio] : [];

  let order = '(c.featured*2 + COALESCE(pl.search_boost,0)/10.0) DESC, c.approved_at DESC';
  const nameScore = tokens.length ? `(${tokens.map(() => '(c.name_norm LIKE ?)*3').join('+')}) DESC, ` : '';
  const nameScoreArgs = tokens.map((t) => `%${t}%`);
  let orderArgs = [];
  const ord = p.ordem || 'relevancia';
  if (ord === 'proximidade' && hasPoint) { order = `(a.pub_lat IS NULL) ASC, ${dist} ASC`; orderArgs = distArgs; }
  else if (ord === 'recentes') order = 'c.approved_at DESC';
  else if (ord === 'nome') order = 'c.name_norm ASC';
  else if (ord === 'capacidade') order = 'cap.max_monthly DESC';
  const orderSql = ord === 'relevancia' ? nameScore + order : order;
  const orderAll = ord === 'relevancia' ? [...nameScoreArgs] : orderArgs;

  const from = `${BASE_SELECT.replace('FROM companies c', `, ${dist} AS distance_km FROM companies c`)} LEFT JOIN plans pl ON pl.id=c.plan_id`;
  const whereSql = `WHERE ${where.join(' AND ')} ${having}`;
  const total = db.prepare(`SELECT COUNT(*) n FROM companies c LEFT JOIN company_addresses a ON a.company_id=c.id LEFT JOIN company_capacity cap ON cap.company_id=c.id ${whereSql}`).get(...args, ...havingArgs).n;
  const perPage = Math.min(48, p.perPage || 12);
  const page = Math.max(1, parseInt(p.page, 10) || 1);
  const rows = db.prepare(`${from} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`).all(...distArgs, ...args, ...havingArgs, ...orderAll, perPage, (page - 1) * perPage);
  attachCategories(rows);
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), hasPoint };
}

function searchServices(p = {}) {
  const where = ["c.status='aprovado'", 's.active=1'], args = [];
  if (p.kind) { where.push('s.kind=?'); args.push(p.kind); }
  for (const t of U.norm(p.q).split(/\s+/).filter((t) => t.length > 1).slice(0, 6)) { where.push('s.search_text LIKE ?'); args.push(`%${t}%`); }
  if (p.categoria) { where.push('s.category_id=(SELECT id FROM categories WHERE slug=?)'); args.push(p.categoria); }
  if (p.estado) { where.push('a.state=?'); args.push(String(p.estado).toUpperCase()); }
  if (p.cidade) { where.push('a.city LIKE ?'); args.push(`%${p.cidade.trim()}%`); }
  const lote = U.intOrNull(p.lote_max, { min: 1 });
  if (lote) { where.push('s.min_batch IS NOT NULL AND s.min_batch <= ?'); args.push(lote); }
  const page = Math.max(1, parseInt(p.page, 10) || 1), perPage = 12;
  const base = `FROM services s JOIN companies c ON c.id=s.company_id LEFT JOIN company_addresses a ON a.company_id=c.id
    LEFT JOIN categories k ON k.id=s.category_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...args).n;
  const rows = db.prepare(`SELECT s.id,s.slug,s.kind,s.name,s.description,s.fabrics,s.piece_types,s.min_batch,s.lead_time_days,s.price_min_cents,s.price_max_cents,s.price_unit,
      c.id AS company_id,c.slug AS company_slug,c.name AS company_name,c.is_demo,c.logo,c.availability,a.city,a.state,k.name AS category_name,
      (SELECT thumb FROM media WHERE service_id=s.id AND kind='imagem' AND hidden=0 ORDER BY position LIMIT 1) AS photo
    ${base} ORDER BY c.featured DESC, s.updated_at DESC LIMIT ? OFFSET ?`).all(...args, perPage, (page - 1) * perPage);
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

function getCompanyFull(where, arg) {
  const c = db.prepare(`SELECT * FROM companies WHERE ${where}`).get(arg);
  if (!c) return null;
  c.address = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(c.id) || {};
  c.capacity = db.prepare('SELECT * FROM company_capacity WHERE company_id=?').get(c.id) || null;
  c.categories = db.prepare('SELECT k.id,k.slug,k.name FROM categories k JOIN company_categories cc ON cc.category_id=k.id WHERE cc.company_id=? ORDER BY k.position').all(c.id);
  c.services = db.prepare(`SELECT s.*,k.name AS category_name,
      (SELECT thumb FROM media WHERE service_id=s.id AND kind='imagem' AND hidden=0 ORDER BY position LIMIT 1) AS photo
      FROM services s LEFT JOIN categories k ON k.id=s.category_id WHERE s.company_id=? ORDER BY s.kind DESC, s.id`).all(c.id);
  c.machines = db.prepare('SELECT * FROM machines WHERE company_id=? ORDER BY position,id').all(c.id);
  c.steps = db.prepare('SELECT * FROM production_steps WHERE company_id=? ORDER BY position,id').all(c.id);
  c.media = db.prepare('SELECT * FROM media WHERE company_id=? AND service_id IS NULL ORDER BY position,id').all(c.id);
  return c;
}

// Dados públicos: oculta o que a empresa decidiu não divulgar.
function publicAddress(c) {
  const a = c.address || {};
  const exact = a.privacy === 'exata';
  return {
    city: a.city, state: a.state, cep: exact ? a.cep : null,
    line: exact ? [a.street, a.number].filter(Boolean).join(', ') + (a.complement ? ` – ${a.complement}` : '') : null,
    neighborhood: a.privacy === 'cidade' ? null : a.neighborhood,
    lat: a.pub_lat, lng: a.pub_lng, privacy: a.privacy, hasPoint: a.pub_lat != null,
  };
}

// Itens que ainda faltam para publicar / melhorar o perfil.
function completeness(companyId) {
  const c = db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
  if (!c) return { required: [], suggested: [], percent: 0, canSubmit: false };
  const a = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(companyId) || {};
  const n = (sql) => db.prepare(sql).get(companyId).n;
  const nCat = n('SELECT COUNT(*) n FROM company_categories WHERE company_id=?');
  const nSrv = n('SELECT COUNT(*) n FROM services WHERE company_id=? AND active=1');
  const nMac = n('SELECT COUNT(*) n FROM machines WHERE company_id=?');
  const nStep = n('SELECT COUNT(*) n FROM production_steps WHERE company_id=?');
  const nMed = n("SELECT COUNT(*) n FROM media WHERE company_id=? AND kind='imagem'");
  const cap = db.prepare('SELECT * FROM company_capacity WHERE company_id=?').get(companyId);
  const required = [
    ['Descrição da empresa (mínimo de 40 caracteres)', !!(c.description && c.description.length >= 40), '/painel/empresa'],
    ['Pelo menos uma categoria', nCat > 0, '/painel/empresa'],
    ['Cidade e estado', !!(a.city && a.state), '/painel/empresa#localizacao'],
    ['Um contato (WhatsApp, telefone ou e-mail)', !!(c.whatsapp || c.phone || c.email), '/painel/empresa#contatos'],
    ['Pelo menos um serviço ou produto', nSrv > 0, '/painel/servicos'],
  ];
  const suggested = [
    ['Logotipo e capa', !!(c.logo && c.cover), '/painel/empresa#midia'],
    ['Localização no mapa', a.lat != null, '/painel/empresa#localizacao'],
    ['Parque de máquinas', nMac > 0, '/painel/maquinas'],
    ['Etapas do processo produtivo', nStep > 0, '/painel/etapas'],
    ['Capacidade produtiva', !!(cap && (cap.max_monthly || cap.avg_monthly)), '/painel/capacidade'],
    ['Fotos da estrutura (3 ou mais)', nMed >= 3, '/painel/galeria'],
    ['Disponibilidade para novos pedidos', !!c.availability, '/painel/empresa#disponibilidade'],
  ];
  const all = [...required, ...suggested];
  return {
    required: required.map(([label, ok, href]) => ({ label, ok, href })),
    suggested: suggested.map(([label, ok, href]) => ({ label, ok, href })),
    percent: Math.round((all.filter((x) => x[1]).length / all.length) * 100),
    canSubmit: required.every((x) => x[1]),
  };
}
const machineTypeName = (key) => (MACHINE_TYPES.find((m) => m[0] === key) || [])[1] || key;

module.exports = { track, uniqueSlug, reindexCompany, setPublicCoords, searchCompanies, searchServices, getCompanyFull, publicAddress, completeness, attachCategories, BASE_SELECT, machineTypeName };
