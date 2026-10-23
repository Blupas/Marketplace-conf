'use strict';
// Ambiente isolado para os testes: banco e uploads temporários, sem limite de requisições.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pesponto-test-'));
Object.assign(process.env, { DATA_DIR: dir, SECRET: 'segredo-de-teste', DISABLE_RATE_LIMIT: '1', NODE_ENV: 'test', BASE_URL: 'http://localhost' });

const { app } = require('../server');
const { ensureBaseData, seedDemo } = require('../src/seed');

async function boot() {
  await ensureBaseData();
  await seedDemo();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }) };
}

// Token anti-spam com idade suficiente (o servidor exige alguns segundos entre abrir e enviar o formulário).
function oldSpamToken() {
  const t = (Date.now() - 20_000).toString(36);
  return `${t}.${crypto.createHmac('sha256', process.env.SECRET).update('spam:' + t).digest('hex').slice(0, 16)}`;
}

// Cliente HTTP mínimo com cookies e CSRF.
class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  _cookies() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  _store(res) {
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = c.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c) || v === '') delete this.jar[k]; else this.jar[k] = v;
    }
  }
  async req(method, url, { body, form, headers = {} } = {}) {
    const opts = { method, redirect: 'manual', headers: { cookie: this._cookies(), 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36', ...headers } };
    if (form) { opts.body = form; } else if (body) { opts.body = new URLSearchParams(body).toString(); opts.headers['content-type'] = 'application/x-www-form-urlencoded'; }
    const res = await fetch(this.base + url, opts);
    this._store(res);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }
  get(url, o) { return this.req('GET', url, o); }
  async csrf() { if (!this.jar.pp_csrf) await this.get('/entrar'); const r = await this.get('/api/csrf', { headers: { accept: 'application/json' } }); try { return JSON.parse(r.text).token; } catch { return this.jar.pp_csrf; } }
  async post(url, body = {}, { spam = false } = {}) {
    const token = await this.csrf();
    const b = { _csrf: token, ...body };
    if (spam) { b._ts = oldSpamToken(); b.website_url_confirm = ''; }
    return this.req('POST', url, { body: b });
  }
  async postForm(url, fields = {}, files = []) {
    const token = await this.csrf();
    const fd = new FormData();
    fd.append('_csrf', token);
    for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => fd.append(k, x));
    for (const f of files) fd.append(f.field, new Blob([f.buffer], { type: f.type }), f.name);
    return this.req('POST', url, { form: fd });
  }
}

module.exports = { boot, Client, oldSpamToken, dir };
