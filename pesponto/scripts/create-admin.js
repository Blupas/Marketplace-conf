'use strict';
// Uso: ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD='SenhaForte1' npm run create-admin   (ou passe e-mail e senha como argumentos)
const { db } = require('../src/db');
const { hashPassword, passwordProblem } = require('../src/auth');
const config = require('../src/config');
(async () => {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.argv[3] || process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) { console.error('Informe e-mail e senha: npm run create-admin -- email@dominio.com "SenhaForte1"'); process.exit(1); }
  const prob = passwordProblem(pw); if (prob) { console.error(prob); process.exit(1); }
  const hash = await hashPassword(pw);
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) { db.prepare("UPDATE users SET role='admin', active=1, password_hash=? WHERE id=?").run(hash, u.id); console.log('Usuário existente promovido a administrador e senha atualizada.'); }
  else { db.prepare("INSERT INTO users(name,email,password_hash,role,lgpd_consent_at,terms_version) VALUES('Administrador',?,?,'admin',datetime('now'),?)").run(email, hash, config.termsVersion); console.log('Administrador criado.'); }
})();
