'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (_) { /* .env é opcional */ }

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Segredo usado em tokens CSRF e anti-spam. Em produção é obrigatório definir SECRET no ambiente.
let secret = env.SECRET;
if (!secret) {
  if (isProd) throw new Error('Defina a variável SECRET em produção (veja .env.example).');
  const f = path.join(dataDir, '.dev-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  secret = fs.readFileSync(f, 'utf8');
}

module.exports = {
  ROOT, isProd,
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  secret, dataDir,
  dbPath: path.resolve(ROOT, env.DB_PATH || path.join(dataDir, 'pesponto.db')),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
  siteName: env.SITE_NAME || 'Pesponto',
  trustProxy: env.TRUST_PROXY === '1',
  contactEmail: env.CONTACT_EMAIL || 'contato@exemplo.com.br',
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === '1',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    from: env.SMTP_FROM || 'Pesponto <nao-responda@exemplo.com.br>',
  } : null,
  nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  geocodeUserAgent: env.GEOCODE_USER_AGENT || 'Pesponto/1.0 (marketplace de confeccoes)',
  tileUrl: env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  billingEnabled: env.BILLING_ENABLED === '1', // cobrança desligada no lançamento
  termsVersion: '2026-10',
};
