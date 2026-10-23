'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, Client } = require('./helpers');

let env;
const jpg = fs.readFileSync(path.join(__dirname, 'fixture.jpg'));
const loc = (r) => r.location || '';

test.before(async () => { env = await boot(); });
test.after(async () => { await env.close(); });

test('páginas públicas respondem e trazem SEO básico', async () => {
  const c = new Client(env.base);
  for (const u of ['/', '/confeccoes', '/servicos', '/produtos', '/mapa', '/anunciar', '/sobre', '/termos', '/privacidade', '/contato', '/entrar', '/cadastro']) {
    const r = await c.get(u);
    assert.equal(r.status, 200, u);
    assert.match(r.text, /<title>[^<]+<\/title>/, `${u} sem title`);
    assert.match(r.text, /<html lang="pt-BR"/);
  }
  const home = await c.get('/');
  assert.match(home.text, /<meta name="description"/);
  assert.match(home.text, /rel="canonical"/);
  assert.match((await c.get('/robots.txt')).text, /Sitemap:/);
  const sm = await c.get('/sitemap.xml');
  assert.match(sm.text, /<urlset/);
  assert.match(sm.text, /\/empresa\//);
  assert.equal((await c.get('/pagina-que-nao-existe')).status, 404);
  assert.equal((await c.get('/empresa/nao-existe')).status, 404);
});

test('dados de demonstração estão sinalizados', async () => {
  const c = new Client(env.base);
  assert.match((await c.get('/')).text, /demonstra/i);
  const list = await c.get('/confeccoes');
  assert.match(list.text, /demonstra/i);
});

test('busca por texto, máquina, categoria, capacidade e proximidade', async () => {
  const c = new Client(env.base);
  const all = await c.get('/confeccoes');
  assert.equal(all.status, 200);
  const jeans = await c.get('/confeccoes?q=jeans');
  assert.equal(jeans.status, 200);
  assert.match(jeans.text, /empresas? encontradas?/i);
  const maq = await c.get('/confeccoes?maquina=overloque');
  assert.equal(maq.status, 200);
  const cap = await c.get('/confeccoes?capacidade_min=1000&lote_max=500&disponibilidade=disponivel');
  assert.equal(cap.status, 200);
  const near = await c.get('/confeccoes?perto=Blumenau%20SC&raio=100');
  assert.equal(near.status, 200);
  const none = await c.get('/confeccoes?q=zzzxxyyqq');
  assert.equal(none.status, 200);
  assert.match(none.text, /Nenhum|nenhuma/i);
  const api = await c.get('/api/empresas', { headers: { accept: 'application/json' } });
  assert.equal(api.status, 200);
  const data = JSON.parse(api.text);
  const rows = data.empresas || data.items || data;
  assert.ok(Array.isArray(rows) && rows.length > 0, 'mapa sem empresas');
  assert.ok(rows.every((r) => r.lat == null || (r.lat !== undefined && typeof r.lat === 'number')));
  const srv = await c.get('/servicos?q=costura');
  assert.equal(srv.status, 200);
});

test('privacidade da localização: coordenadas públicas de empresas "cidade" são arredondadas', async () => {
  const { db } = require('../src/db');
  const rows = db.prepare("SELECT a.pub_lat, a.pub_lng FROM company_addresses a WHERE a.privacy='cidade' AND a.pub_lat IS NOT NULL").all();
  for (const r of rows) assert.ok(String(r.pub_lat).replace(/^-?\d+\.?/, '').length <= 3, 'precisão excessiva');
  const priv = db.prepare("SELECT c.slug FROM companies c JOIN company_addresses a ON a.company_id=c.id WHERE a.privacy IN ('aproximada','cidade') AND c.status='aprovado' AND a.street IS NOT NULL AND a.street<>'' LIMIT 1").get();
  if (priv) {
    const { text } = await new Client(env.base).get(`/empresa/${priv.slug}`);
    const street = db.prepare('SELECT a.street FROM company_addresses a JOIN companies c ON c.id=a.company_id WHERE c.slug=?').get(priv.slug).street;
    assert.ok(!text.includes(street), 'rua exposta mesmo com privacidade ativada');
  }
});

test('segurança: CSRF, honeypot e áreas restritas', async () => {
  const c = new Client(env.base);
  await c.get('/entrar');
  const noCsrf = await c.req('POST', '/entrar', { body: { email: 'a@b.com', password: 'x' } });
  assert.equal(noCsrf.status, 403);
  const hp = await c.post('/contato', { name: 'Robô', email: 'r@r.com', message: 'mensagem de teste longa', website_url_confirm: 'http://spam' });
  assert.equal(hp.status, 400);
  assert.equal((await c.get('/painel')).status, 302);
  assert.equal((await c.get('/admin')).status, 302);
  assert.equal((await c.get('/favoritos')).status, 302);
  const res = await c.get('/');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('fluxo completo: cadastro de empresa, publicação, moderação, busca, perfil, WhatsApp, orçamento e denúncia', async () => {
  const owner = new Client(env.base);
  // 1. cadastro como anunciante
  let r = await owner.post('/cadastro', { name: 'Maria Teste', email: 'maria@teste.com', password: 'Senha-Forte-123', password2: 'Senha-Forte-123', consent: 'on', tipo: 'anunciante' }, { spam: true });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  assert.match(loc(r), /\/painel\/empresa/);
  assert.ok(owner.jar.pp_sid, 'sem sessão após cadastro');

  // senha fraca é recusada
  const weak = await new Client(env.base).post('/cadastro', { name: 'X Y', email: 'fraca@teste.com', password: '123', password2: '123', consent: 'on' }, { spam: true });
  assert.equal(weak.status, 422);

  // 2. empresa
  const form = await owner.get('/painel/empresa?novo=1');
  assert.equal(form.status, 200);
  r = await owner.postForm('/painel/empresa', {
    name: 'Confecção Ponto Azul Teste', description: 'Confecção especializada em jeans e sarja, com corte, costura e acabamento próprios para marcas pequenas e médias.',
    categories: ['1', '2'], whatsapp: '(47) 99999-1234', email: 'contato@pontoazul.test', city: 'Blumenau', state: 'SC', street: 'Rua das Flores', number: '100', neighborhood: 'Centro', privacy: 'aproximada',
    attends_small: 'on', min_batch: '200', availability: 'disponivel',
  }, [{ field: 'logo', buffer: jpg, type: 'image/jpeg', name: 'logo.jpg' }]);
  assert.equal(r.status, 303, r.text.slice(0, 400));
  const { db } = require('../src/db');
  const comp = db.prepare("SELECT * FROM companies WHERE name='Confecção Ponto Azul Teste'").get();
  assert.ok(comp, 'empresa não criada');
  assert.equal(comp.status, 'rascunho');
  assert.ok(comp.logo, 'logo não salvo');
  const addr = db.prepare('SELECT * FROM company_addresses WHERE company_id=?').get(comp.id);
  assert.ok(addr.lat != null && addr.pub_lat != null, 'sem geocodificação');
  assert.notEqual(addr.lat, addr.pub_lat, 'coordenada pública igual à exata em modo aproximado');

  // rascunho não aparece publicamente
  assert.equal((await new Client(env.base).get(`/empresa/${comp.slug}`)).status, 404);
  // não pode enviar incompleto
  r = await owner.post('/painel/enviar');
  assert.match(loc(r), /erro=incompleto/);

  // 3. capacidade, máquinas, etapas, serviço, fotos
  r = await owner.post('/painel/capacidade', { avg_monthly: '4000', max_monthly: '6000', available_monthly: '1500', min_batch: '200', lead_time_days: '25', piece_types: 'calça jeans, bermuda' });
  assert.equal(r.status, 303);
  r = await owner.postForm('/painel/maquinas', { type: 'overloque', name: 'Overloque', quantity: '8', brand: 'Juki' });
  assert.match(loc(r), /ok=adicionado/);
  r = await owner.postForm('/painel/maquinas', { type: 'reta', name: '', quantity: '0' });
  assert.match(loc(r), /erro=/, 'máquina inválida deveria ser recusada');
  r = await owner.post('/painel/etapas/padrao');
  assert.match(loc(r), /ok=padrao/);
  r = await owner.postForm('/painel/servicos', { kind: 'servico', name: 'Facção de costura de jeans', description: 'Costura completa de calças jeans.', min_batch: '200', price_min: '12,50', price_max: '20', price_unit: 'por peça' },
    [{ field: 'fotos', buffer: jpg, type: 'image/jpeg', name: 'a.jpg' }]);
  assert.match(loc(r), /ok=adicionado/);
  const svc = db.prepare('SELECT * FROM services WHERE company_id=?').get(comp.id);
  assert.equal(svc.price_min_cents, 1250);
  for (let i = 0; i < 3; i++) {
    r = await owner.postForm('/painel/galeria/imagens', { caption: 'Foto ' + i }, [{ field: 'fotos', buffer: jpg, type: 'image/jpeg', name: `g${i}.jpg` }]);
    assert.match(loc(r), /ok=adicionado/);
  }
  // arquivo que não é imagem é recusado
  r = await owner.postForm('/painel/galeria/imagens', {}, [{ field: 'fotos', buffer: Buffer.from('<?php echo 1; ?>'), type: 'image/jpeg', name: 'x.php.jpg' }]);
  assert.match(loc(r), /erro=/);
  for (const p of ['', '/empresa', '/capacidade', '/maquinas', '/etapas', '/servicos', '/servicos/novo', `/servicos/${svc.id}/editar`, '/galeria', '/contatos']) {
    assert.equal((await owner.get('/painel' + p)).status, 200, '/painel' + p);
  }

  // 4. enviar para análise
  r = await owner.post('/painel/enviar');
  assert.match(loc(r), /ok=enviado/, loc(r));
  assert.equal(db.prepare('SELECT status FROM companies WHERE id=?').get(comp.id).status, 'pendente');
  assert.equal((await new Client(env.base).get(`/empresa/${comp.slug}`)).status, 404, 'pendente não deve ser público');

  // 5. admin aprova; outro usuário não acessa
  assert.equal((await owner.get('/admin')).status, 403);
  const admin = new Client(env.base);
  r = await admin.post('/entrar', { email: 'admin@pesponto.example', password: 'Demo@1234' });
  assert.equal(r.status, 303, 'login admin demo');
  for (const p of ['', '/empresas', `/empresas/${comp.id}`, '/denuncias', '/usuarios', '/categorias', '/moderacao', '/planos', '/conteudo', '/mensagens']) {
    assert.equal((await admin.get('/admin' + p)).status, 200, '/admin' + p);
  }
  r = await admin.post(`/admin/empresas/${comp.id}/rejeitar`, { reason: '' });
  assert.match(loc(r), /erro=/, 'rejeitar sem motivo deve falhar');
  r = await admin.post(`/admin/empresas/${comp.id}/aprovar`);
  assert.match(loc(r), /ok=aprovado/, loc(r));

  // 6. público: perfil, busca, WhatsApp, orçamento, denúncia
  const pub = new Client(env.base);
  const page = await pub.get(`/empresa/${comp.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Confecção Ponto Azul Teste/);
  assert.match(page.text, /application\/ld\+json/);
  assert.ok(!page.text.includes('Rua das Flores'), 'endereço exato exposto com privacidade aproximada');
  assert.ok(!page.text.includes('99999-1234') || /wa\.me|ir\/whatsapp/.test(page.text));
  const found = await pub.get('/confeccoes?q=Ponto+Azul');
  assert.match(found.text, /Ponto Azul Teste/);
  const foundMach = await pub.get('/confeccoes?maquina=overloque&q=Ponto+Azul');
  assert.match(foundMach.text, /Ponto Azul Teste/);
  const srvPage = await pub.get(`/anuncio/${svc.id}`);
  assert.ok([200, 301].includes(srvPage.status));

  r = await pub.get(`/ir/whatsapp/${comp.id}?servico=${svc.id}`);
  assert.equal(r.status, 302);
  assert.match(loc(r), /^https:\/\/wa\.me\/5547999991234\?text=/);
  assert.match(decodeURIComponent(loc(r)), /Confecção Ponto Azul Teste/);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM events WHERE type='click_whatsapp' AND company_id=?").get(comp.id).n >= 1, 'clique não registrado');

  r = await pub.post('/orcamento', { company_id: comp.id, name: 'João Comprador', email: 'joao@marca.test', message: 'Preciso de 500 calças jeans para a coleção de verão.', quantity: '500', consent: 'on' }, { spam: true });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  r = await pub.post('/orcamento', { company_id: comp.id, name: 'J', message: 'curto' }, { spam: true });
  assert.equal(r.status, 422);
  r = await pub.post('/denunciar', { company_id: comp.id, reason: 'informacao_incorreta', details: 'Teste' }, { spam: true });
  assert.equal(r.status, 303);

  // 7. o dono vê o orçamento e as estatísticas; admin vê a denúncia
  const contatos = await owner.get('/painel/contatos');
  assert.match(contatos.text, /João Comprador/);
  const ini = await owner.get('/painel');
  assert.match(ini.text, /Cliques no WhatsApp/);
  const den = await admin.get('/admin/denuncias');
  assert.match(den.text, /Ponto Azul Teste/);
  const rep = db.prepare('SELECT id FROM reports WHERE company_id=?').get(comp.id);
  r = await admin.post(`/admin/denuncias/${rep.id}`, { status: 'improcedente', resolution: 'Sem fundamento' });
  assert.equal(r.status, 303);

  // 8. suspender tira do ar; reativar volta
  r = await admin.post(`/admin/empresas/${comp.id}/suspender`, { reason: 'Teste' });
  assert.match(loc(r), /ok=suspenso/);
  assert.equal((await new Client(env.base).get(`/empresa/${comp.slug}`)).status, 404);
  r = await admin.post(`/admin/empresas/${comp.id}/reativar`);
  assert.match(loc(r), /ok=reativado/);
  assert.equal((await new Client(env.base).get(`/empresa/${comp.slug}`)).status, 200);

  // 9. favoritos e comparação
  const fav = await pub.post('/api/favoritos/' + comp.id, {});
  assert.equal(fav.status, 401);
  const buyer = new Client(env.base);
  r = await buyer.post('/cadastro', { name: 'Comprador Teste', email: 'comprador@teste.com', password: 'Senha-Forte-123', password2: 'Senha-Forte-123', consent: 'on', tipo: 'buscador' }, { spam: true });
  assert.equal(r.status, 303);
  const tog = await buyer.req('POST', '/api/favoritos/' + comp.id, { body: { _csrf: await buyer.csrf() }, headers: { accept: 'application/json' } });
  assert.equal(tog.status, 200, tog.text);
  assert.match((await buyer.get('/favoritos')).text, /Ponto Azul Teste/);
  const other = db.prepare("SELECT id FROM companies WHERE status='aprovado' AND id<>? LIMIT 1").get(comp.id);
  const cmp = await pub.get(`/comparar?ids=${comp.id},${other.id}`);
  assert.equal(cmp.status, 200);
  assert.match(cmp.text, /Ponto Azul Teste/);

  // 10. isolamento: outro anunciante não edita meu serviço
  const evil = new Client(env.base);
  await evil.post('/cadastro', { name: 'Outro Dono', email: 'outro@teste.com', password: 'Senha-Forte-123', password2: 'Senha-Forte-123', consent: 'on', tipo: 'anunciante' }, { spam: true });
  r = await evil.postForm('/painel/empresa', { name: 'Outra Empresa Teste', city: 'Joinville', state: 'SC' });
  assert.equal(r.status, 303);
  assert.equal((await evil.get(`/painel/servicos/${svc.id}/editar`)).status, 404);
  r = await evil.post(`/painel/servicos/${svc.id}/excluir`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM services WHERE id=?').get(svc.id).n, 1, 'serviço de outra empresa foi excluído');
});

test('LGPD: exportação e exclusão da conta', async () => {
  const c = new Client(env.base);
  await c.post('/cadastro', { name: 'Lgpd Teste', email: 'lgpd@teste.com', password: 'Senha-Forte-123', password2: 'Senha-Forte-123', consent: 'on', tipo: 'buscador' }, { spam: true });
  const exp = await c.get('/conta/exportar');
  assert.equal(exp.status, 200);
  assert.equal(JSON.parse(exp.text).usuario.email, 'lgpd@teste.com');
  const del = await c.post('/conta/excluir', { password: 'Senha-Forte-123', confirm: 'EXCLUIR' });
  assert.equal(del.status, 303, del.text.slice(0, 200));
  const again = await new Client(env.base).post('/entrar', { email: 'lgpd@teste.com', password: 'Senha-Forte-123' });
  assert.notEqual(again.status, 303);
});

test('admin: não remove o último administrador e protege categorias em uso', async () => {
  const { db } = require('../src/db');
  const admin = new Client(env.base);
  await admin.post('/entrar', { email: 'admin@pesponto.example', password: 'Demo@1234' });
  const me = db.prepare("SELECT id FROM users WHERE email='admin@pesponto.example'").get();
  const r = await admin.post(`/admin/usuarios/${me.id}`, { role: 'buscador', active: '1' });
  assert.match(loc(r), /erro=/);
  const used = db.prepare('SELECT category_id id FROM company_categories LIMIT 1').get();
  const d = await admin.post(`/admin/categorias/${used.id}/excluir`);
  assert.match(loc(d), /erro=/);
  const created = await admin.post('/admin/categorias', { name: 'Categoria Nova de Teste', kind: 'servico' });
  assert.match(loc(created), /ok=criado/);
  assert.match((await new Client(env.base).get('/confeccoes')).text, /Categoria Nova de Teste/);
});
