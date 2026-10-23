'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const { db } = require('./src/db');
const U = require('./src/util');
const cat = require('./src/catalog');
const auth = require('./src/auth');
const storage = require('./src/storage');
const { ensureBaseData } = require('./src/seed');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('etag', 'strong');

const tileHost = (() => { try { return new URL(config.tileUrl.replace('{s}', 'a')).host.replace(/^a\./, '*.'); } catch { return 'tile.openstreetmap.org'; } })();
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://${tileHost} https://*.tile.openstreetmap.org`,
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com', "media-src 'self'",
      "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()', 'X-Frame-Options': 'SAMEORIGIN',
  });
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(compression());

const pub = path.join(__dirname, 'public');
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(pub, { maxAge: config.isProd ? '7d' : 0, index: false }));

app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(auth.loadUser);

// ---------- Variáveis disponíveis em todas as views ----------
const ASSET_V = Date.now().toString(36);
let settingsCache = { at: 0, v: {} };
function siteSettings() {
  if (Date.now() - settingsCache.at > 20_000) {
    const v = {};
    for (const r of db.prepare('SELECT key,value FROM settings').all()) v[r.key] = r.value;
    settingsCache = { at: Date.now(), v };
  }
  return settingsCache.v;
}
let catCache = { at: 0, v: [] };
function allCategories() {
  if (Date.now() - catCache.at > 30_000) {
    catCache = { at: Date.now(), v: db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM company_categories cc JOIN companies c ON c.id=cc.company_id WHERE cc.category_id=k.id AND c.status='aprovado') AS n
      FROM categories k WHERE k.active=1 ORDER BY k.position, k.name`).all() };
  }
  return catCache.v;
}
app.locals.invalidateSettings = () => { settingsCache.at = 0; catCache.at = 0; };
let demoCache = { at: 0, v: false };
const hasDemo = () => { if (Date.now() - demoCache.at > 60_000) demoCache = { at: Date.now(), v: !!db.prepare("SELECT 1 FROM companies WHERE is_demo=1 AND status='aprovado' LIMIT 1").get() }; return demoCache.v; };

app.use((req, res, next) => {
  const s = siteSettings();
  const l = res.locals;
  l.config = { baseUrl: config.baseUrl, tileUrl: config.tileUrl, billingEnabled: config.billingEnabled, contactEmail: config.contactEmail, termsVersion: config.termsVersion };
  l.site = { name: s.site_name || config.siteName, tagline: s.site_tagline || 'Vitrine da cadeia produtiva da moda', ...s };
  l.categories = allCategories();
  l.cat = cat; l.U = U; l.path = req.path; l.query = req.query;
  l.img = storage.urlFor;
  l.csrf = () => auth.csrfToken(req, res);
  l.spamToken = auth.spamToken;
  l.assetV = ASSET_V; l.hasDemo = hasDemo();
  l.icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
  l.currentUrl = req.originalUrl;
  l.canonical = null; l.noindex = false; l.description = null; l.ogImage = null; l.jsonld = null; l.bodyClass = '';
  next();
});
app.use((req, res, next) => { if (/^\/(painel|admin|conta|favoritos)/.test(req.path)) res.set('Cache-Control', 'private, no-store'); next(); });

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/api'));
app.use('/painel', require('./src/routes/painel'));
app.use('/admin', require('./src/routes/admin'));
app.use(require('./src/routes/public'));

app.use((req, res) => res.status(404).render('erro', { title: 'Página não encontrada', code: 404, message: 'Não encontramos esta página. Ela pode ter sido movida ou a empresa pode não estar mais publicada.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const msg = 'O arquivo é maior que o limite permitido.';
    return auth.wantsJson(req) ? res.status(413).json({ error: msg }) : res.status(413).render('erro', { title: 'Arquivo grande demais', code: 413, message: msg });
  }
  console.error(err);
  if (res.headersSent) return;
  const message = config.isProd ? 'Algo deu errado do nosso lado. Tente novamente em instantes.' : String(err && err.message);
  if (auth.wantsJson(req)) return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  res.status(500).render('erro', { title: 'Erro inesperado', code: 500, message });
});

async function start() {
  await ensureBaseData();
  const server = app.listen(config.port, () => console.log(`${config.siteName} em ${config.baseUrl} (porta ${config.port})`));
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return server;
}
if (require.main === module) start();
module.exports = { app, start };
