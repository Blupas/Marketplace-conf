'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { db } = require('./db');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 14;
const COOKIE = 'pp_sid';
const CSRF_COOKIE = 'pp_csrf';

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch { return false; }
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (pw.length > 200) return 'Senha muito longa.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}
function createSession(res, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(id), userId, expires.toISOString());
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.isProd, expires, path: '/' });
}
function destroySession(req, res) {
  const id = req.cookies && req.cookies[COOKIE];
  if (id) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha(id));
  res.clearCookie(COOKIE, { path: '/' });
}
function loadUser(req, res, next) {
  req.user = null;
  const id = req.cookies && req.cookies[COOKIE];
  if (id && /^[a-f0-9]{64}$/.test(id)) {
    const row = db.prepare('SELECT u.id,u.name,u.email,u.role,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?').get(sha(id));
    if (row && row.active && new Date(row.expires_at) > new Date()) req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
    else if (row) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha(id));
  }
  res.locals.user = req.user;
  next();
}
const wantsJson = (req) => req.path.startsWith('/api/') || req.get('x-requested-with') === 'fetch' || req.accepts(['html', 'json']) === 'json';
function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Entre na sua conta para continuar.', login: true });
  return res.redirect('/entrar?next=' + encodeURIComponent(req.originalUrl));
}
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return requireLogin(req, res, next);
  if (!roles.includes(req.user.role)) return res.status(403).render('erro', { title: 'Acesso negado', code: 403, message: 'Você não tem permissão para acessar esta área.' });
  next();
};
// CSRF: cookie aleatório + token HMAC no formulário.
function csrfBase(req, res) {
  let c = req.cookies && req.cookies[CSRF_COOKIE];
  if (!c || !/^[a-f0-9]{32}$/.test(c)) {
    c = crypto.randomBytes(16).toString('hex');
    res.cookie(CSRF_COOKIE, c, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
    req.cookies = Object.assign(req.cookies || {}, { [CSRF_COOKIE]: c });
  }
  return c;
}
const csrfToken = (req, res) => crypto.createHmac('sha256', config.secret).update('csrf:' + csrfBase(req, res)).digest('hex');
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const given = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const c = req.cookies && req.cookies[CSRF_COOKIE];
  const expected = c ? crypto.createHmac('sha256', config.secret).update('csrf:' + c).digest('hex') : null;
  const ok = expected && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (ok) return next();
  if (wantsJson(req)) return res.status(403).json({ error: 'Sessão expirada. Recarregue a página e tente de novo.' });
  return res.status(403).render('erro', { title: 'Sessão expirada', code: 403, message: 'Não foi possível validar o formulário. Volte, recarregue a página e tente de novo.' });
}
// Anti-spam: campo isca (honeypot) + tempo mínimo de preenchimento (token assinado com horário).
function spamToken() {
  const t = Date.now().toString(36);
  return `${t}.${crypto.createHmac('sha256', config.secret).update('spam:' + t).digest('hex').slice(0, 16)}`;
}
function spamCheck(minSeconds = 3) {
  return (req, res, next) => {
    const b = req.body || {};
    const [t, sig] = String(b._ts || '').split('.');
    const okSig = t && sig && crypto.createHmac('sha256', config.secret).update('spam:' + t).digest('hex').slice(0, 16) === sig;
    const age = okSig ? (Date.now() - parseInt(t, 36)) / 1000 : 0;
    if (b.website_url_confirm || !okSig || age < minSeconds || age > 86400) {
      if (wantsJson(req)) return res.status(400).json({ error: 'Não foi possível validar o envio. Recarregue a página e tente de novo.' });
      return res.status(400).render('erro', { title: 'Envio não validado', code: 400, message: 'Não foi possível validar o envio. Recarregue a página, confira os campos e tente de novo.' });
    }
    next();
  };
}
module.exports = { hashPassword, verifyPassword, passwordProblem, createSession, destroySession, loadUser, requireLogin, requireRole, csrfToken, csrfCheck, spamToken, spamCheck, sha, wantsJson };
