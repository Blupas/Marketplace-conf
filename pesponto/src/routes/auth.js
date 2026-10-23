'use strict';
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const U = require('../util');
const config = require('../config');
const storage = require('../storage');
const A = require('../auth');
const { limit, hit } = require('../ratelimit');
const { sendMail } = require('../mailer');
const router = express.Router();

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : null);
const home = (u, next) => safeNext(next) || (u.role === 'admin' ? '/admin' : u.role === 'anunciante' ? '/painel' : '/');
const DUMMY = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

router.get('/entrar', (req, res) => req.user ? res.redirect(home(req.user, req.query.next)) : res.render('auth/login', { title: 'Entrar', noindex: true, next: safeNext(req.query.next) || '', error: null, email: '' }));

router.post('/entrar', limit('login', 20, 15 * 60_000), A.csrfCheck, async (req, res) => {
  const email = U.text(req.body.email, 200) || '';
  const next = safeNext(req.body.next) || '';
  const fail = (msg, code = 401) => res.status(code).render('auth/login', { title: 'Entrar', noindex: true, next, error: msg, email });
  if (!hit(`login-email:${email.toLowerCase()}`, 8, 15 * 60_000).ok) return fail('Muitas tentativas para este e-mail. Aguarde 15 minutos ou redefina sua senha.', 429);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = await A.verifyPassword(String(req.body.password || ''), u ? u.password_hash : DUMMY);
  if (!u || !ok) return fail('E-mail ou senha incorretos.');
  if (!u.active) return fail('Esta conta está desativada. Fale com o suporte.', 403);
  db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(u.id);
  A.createSession(res, u.id);
  res.redirect(303, home(u, next));
});

router.get('/cadastro', (req, res) => req.user ? res.redirect('/') : res.render('auth/register', { title: 'Criar conta', noindex: true, tipo: req.query.tipo === 'anunciante' ? 'anunciante' : 'buscador', next: safeNext(req.query.next) || '', errors: [], v: {} }));

router.post('/cadastro', limit('register', 10, 3_600_000), A.csrfCheck, A.spamCheck(3), async (req, res) => {
  const b = req.body, errors = [];
  const tipo = b.tipo === 'anunciante' ? 'anunciante' : 'buscador';
  const name = U.text(b.name, 100), email = (U.text(b.email, 200) || '').toLowerCase();
  if (!name || name.length < 2) errors.push('Informe seu nome.');
  if (!U.isValidEmail(email)) errors.push('Informe um e-mail válido.');
  const pw = A.passwordProblem(b.password); if (pw) errors.push(pw);
  if (b.password !== b.password2) errors.push('As senhas não conferem.');
  if (b.consent !== 'on') errors.push('Aceite os Termos de uso e a Política de privacidade para criar a conta.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) errors.push('Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.');
  const next = safeNext(b.next) || '';
  if (errors.length) return res.status(422).render('auth/register', { title: 'Criar conta', noindex: true, tipo, next, errors, v: { name, email } });
  const r = db.prepare("INSERT INTO users(name,email,password_hash,role,phone,lgpd_consent_at,terms_version) VALUES(?,?,?,?,?,datetime('now'),?)")
    .run(name, email, await A.hashPassword(b.password), tipo, U.normalizeBrPhone(b.phone), config.termsVersion);
  A.createSession(res, r.lastInsertRowid);
  res.redirect(303, tipo === 'anunciante' ? '/painel/empresa?novo=1' : (next || '/'));
});

router.post('/sair', A.csrfCheck, (req, res) => { A.destroySession(req, res); res.redirect(303, '/'); });

// ---- Recuperação de senha ----
router.get('/esqueci-senha', (req, res) => res.render('auth/forgot', { title: 'Recuperar senha', noindex: true, sent: false }));
router.post('/esqueci-senha', limit('forgot', 5, 3_600_000), A.csrfCheck, async (req, res) => {
  const u = db.prepare('SELECT id,email,name FROM users WHERE email=? AND active=1').get(U.text(req.body.email, 200) || '');
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("UPDATE users SET reset_token_hash=?, reset_expires=datetime('now','+1 hour') WHERE id=?").run(A.sha(token), u.id);
    sendMail({ to: u.email, subject: `Redefinir sua senha — ${config.siteName}`, text: `Olá, ${u.name}!\n\nPara criar uma nova senha, acesse (válido por 1 hora):\n${config.baseUrl}/redefinir-senha/${token}\n\nSe não foi você, ignore este e-mail.` }).catch(() => {});
  }
  res.render('auth/forgot', { title: 'Recuperar senha', noindex: true, sent: true });
});
router.get('/redefinir-senha/:token', (req, res) => {
  const ok = /^[a-f0-9]{64}$/.test(req.params.token) && db.prepare("SELECT 1 FROM users WHERE reset_token_hash=? AND reset_expires > datetime('now')").get(A.sha(req.params.token));
  res.render('auth/reset', { title: 'Nova senha', noindex: true, valid: !!ok, token: req.params.token, error: null });
});
router.post('/redefinir-senha/:token', limit('reset', 10, 3_600_000), A.csrfCheck, async (req, res) => {
  const u = /^[a-f0-9]{64}$/.test(req.params.token) && db.prepare("SELECT id FROM users WHERE reset_token_hash=? AND reset_expires > datetime('now')").get(A.sha(req.params.token));
  if (!u) return res.render('auth/reset', { title: 'Nova senha', noindex: true, valid: false, token: '', error: null });
  const pw = A.passwordProblem(req.body.password) || (req.body.password !== req.body.password2 ? 'As senhas não conferem.' : null);
  if (pw) return res.status(422).render('auth/reset', { title: 'Nova senha', noindex: true, valid: true, token: req.params.token, error: pw });
  db.prepare('UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_expires=NULL WHERE id=?').run(await A.hashPassword(req.body.password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  res.redirect(303, '/entrar?senha=ok');
});

// ---- Minha conta (LGPD: editar, exportar, excluir) ----
const acct = (req, res, extra = {}) => res.render('auth/account', { title: 'Minha conta', noindex: true, msg: null, error: null, me: db.prepare('SELECT id,name,email,phone,role,created_at,lgpd_consent_at FROM users WHERE id=?').get(req.user.id), ...extra });
router.get('/conta', A.requireLogin, (req, res) => acct(req, res, { msg: req.query.ok === '1' ? 'Dados atualizados.' : req.query.senha === 'ok' ? 'Senha alterada.' : null }));
router.post('/conta', A.requireLogin, A.csrfCheck, (req, res) => {
  const name = U.text(req.body.name, 100), email = (U.text(req.body.email, 200) || '').toLowerCase();
  if (!name || !U.isValidEmail(email)) return acct(req, res, { error: 'Informe nome e um e-mail válido.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, req.user.id)) return acct(req, res, { error: 'Este e-mail já está em uso por outra conta.' });
  db.prepare('UPDATE users SET name=?, email=?, phone=? WHERE id=?').run(name, email, U.normalizeBrPhone(req.body.phone), req.user.id);
  res.redirect(303, '/conta?ok=1');
});
router.post('/conta/senha', A.requireLogin, limit('chpw', 10, 3_600_000), A.csrfCheck, async (req, res) => {
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!(await A.verifyPassword(String(req.body.current || ''), u.password_hash))) return acct(req, res, { error: 'A senha atual está incorreta.' });
  const pw = A.passwordProblem(req.body.password) || (req.body.password !== req.body.password2 ? 'As senhas não conferem.' : null);
  if (pw) return acct(req, res, { error: pw });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await A.hashPassword(req.body.password), req.user.id);
  res.redirect(303, '/conta?senha=ok');
});
router.get('/conta/exportar', A.requireLogin, (req, res) => {
  const id = req.user.id;
  const data = {
    exportado_em: new Date().toISOString(),
    usuario: db.prepare('SELECT id,name,email,phone,role,created_at,last_login_at,lgpd_consent_at,terms_version FROM users WHERE id=?').get(id),
    favoritos: db.prepare('SELECT c.name,c.slug,f.created_at FROM favorites f JOIN companies c ON c.id=f.company_id WHERE f.user_id=?').all(id),
    solicitacoes_de_orcamento: db.prepare('SELECT q.created_at,c.name AS empresa,q.name,q.email,q.phone,q.quantity,q.message FROM quote_requests q JOIN companies c ON c.id=q.company_id WHERE q.user_id=?').all(id),
    empresas: db.prepare('SELECT id,name,slug,status,created_at FROM companies WHERE owner_id=?').all(id),
  };
  res.set({ 'Content-Disposition': 'attachment; filename="meus-dados.json"', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send(JSON.stringify(data, null, 2));
});
router.post('/conta/excluir', A.requireLogin, limit('delacct', 5, 3_600_000), A.csrfCheck, async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!(await A.verifyPassword(String(req.body.password || ''), u.password_hash))) return acct(req, res, { error: 'Senha incorreta. A conta não foi excluída.' });
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n <= 1) return acct(req, res, { error: 'Você é o único administrador. Promova outro administrador antes de excluir esta conta.' });
  const files = [];
  for (const c of db.prepare('SELECT id,logo,cover FROM companies WHERE owner_id=? AND is_demo=0').all(u.id)) {
    files.push(c.logo, c.cover);
    db.prepare("SELECT path,thumb FROM media WHERE company_id=? AND kind != 'video_embed'").all(c.id).forEach((m) => files.push(m.path, m.thumb));
    db.prepare('SELECT photo FROM machines WHERE company_id=?').all(c.id).forEach((m) => files.push(m.photo));
    db.prepare('DELETE FROM companies WHERE id=?').run(c.id);
  }
  db.prepare('UPDATE companies SET owner_id=NULL WHERE owner_id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  await storage.remove(...files);
  A.destroySession(req, res);
  res.redirect(303, '/?conta=excluida');
});

module.exports = router;
