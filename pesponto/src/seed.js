'use strict';
// Dados iniciais e de DEMONSTRAÇÃO.
//   node src/seed.js            → dados base (categorias, planos, textos) + empresas fictícias
//   node src/seed.js --reset    → apaga e recria as empresas/usuários fictícios
//   node src/seed.js --no-demo  → somente dados base
// Todas as empresas de demonstração são FICTÍCIAS (is_demo = 1): nomes, contatos e endereços não correspondem a empresas reais.
const config = require('./config');
const { db, setSetting } = require('./db');
const U = require('./util');
const { hashPassword, passwordProblem } = require('./auth');
const { CATEGORIES, PLANS, MACHINE_TYPES, STEP_DEFAULTS } = require('./catalog');
const { reindexCompany, setPublicCoords, uniqueSlug } = require('./domain');
const { places } = require('./geo');

const DEMO_PASSWORD = 'Demo@1234';
const DEMO_DOMAIN = '@pesponto.example';

const ins = (table, obj) => {
  const k = Object.keys(obj);
  return db.prepare(`INSERT INTO ${table}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => obj[x]));
};
const ts = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const ago = (days, hours = 0) => ts(new Date(Date.now() - days * 864e5 - hours * 36e5));
const ahead = (days) => ts(new Date(Date.now() + days * 864e5));

// ----------------------------------------------------------------------------------------
// Dados base (idempotente — não sobrescreve edições feitas pelo administrador)
// ----------------------------------------------------------------------------------------
async function ensureBaseData() {
  const insCat = db.prepare('INSERT INTO categories(slug,name,kind,icon,description,position) VALUES(?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING');
  CATEGORIES.forEach(([slug, name, kind, icon, desc], i) => insCat.run(slug, name, kind, icon, desc, i + 1));

  const insPlan = db.prepare('INSERT INTO plans(slug,name,price_cents,description,features,search_boost,available,position) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING');
  PLANS.forEach(([slug, name, price, desc, feats, boost, avail], i) => insPlan.run(slug, name, price, desc, JSON.stringify(feats), boost, avail, i + 1));

  const defaults = {
    site_name: config.siteName,
    hero_title: 'O que você precisa produzir?',
    hero_subtitle: 'Encontre confecções, facções, lavanderias e fornecedores pelo que realmente importa: máquinas, processo, capacidade e localização.',
    about_text: `A ${config.siteName} é uma vitrine comercial para a cadeia produtiva da moda. Reunimos confecções, facções, lavanderias, estamparias, bordadarias e fornecedores em páginas que mostram a estrutura de cada empresa — máquinas, etapas de produção, capacidade e localização — para que marcas e empreendedores encontrem o parceiro certo. Não vendemos nem intermediamos pagamentos: o contato e a negociação acontecem diretamente entre você e a empresa.`,
    footer_text: 'Vitrine da cadeia produtiva da moda. Sem carrinho, sem comissão: o contato é direto com a empresa.',
    contact_email: config.contactEmail,
    billing_enabled: '0',
    demo_banner: '1',
  };
  const insSet = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING');
  Object.entries(defaults).forEach(([k, v]) => insSet.run(k, v));

  if (!db.prepare('SELECT 1 FROM banners LIMIT 1').get()) {
    ins('banners', { title: 'Anuncie sua confecção gratuitamente', text: 'Monte a página da sua empresa com máquinas, processo produtivo e capacidade, e receba contatos direto no WhatsApp.', link: '/anunciar', cta: 'Cadastrar minha empresa', position: 1 });
    ins('banners', { title: 'Encontre a confecção certa pelas máquinas e pela capacidade', text: 'Filtre por tipo de máquina, lote mínimo, etapas internas e distância.', link: '/confeccoes', cta: 'Buscar fornecedores', position: 2 });
  }

  // Primeiro administrador (opcional, via variáveis de ambiente)
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && !db.prepare("SELECT 1 FROM users WHERE role='admin' AND email NOT LIKE ?").get('%' + DEMO_DOMAIN)) {
    const prob = passwordProblem(ADMIN_PASSWORD);
    if (prob) console.warn(`ADMIN_PASSWORD não aceita: ${prob}`);
    else if (!db.prepare('SELECT 1 FROM users WHERE email=?').get(ADMIN_EMAIL)) {
      ins('users', { name: 'Administrador', email: ADMIN_EMAIL, password_hash: await hashPassword(ADMIN_PASSWORD), role: 'admin', lgpd_consent_at: ts(new Date()), terms_version: config.termsVersion });
      console.log(`Administrador criado: ${ADMIN_EMAIL}`);
    }
  }
}

// ----------------------------------------------------------------------------------------
// Auxiliares de modelagem dos dados fictícios
// ----------------------------------------------------------------------------------------
const MT = Object.fromEntries(MACHINE_TYPES.map((m) => [m[0], m]));
const SD = Object.fromEntries(STEP_DEFAULTS.map((s) => [s[0], s]));
const M = (key, qty, brand, model, op) => ({ type: key, name: MT[key][1], qty, brand: brand || null, model: model || null, op: op || MT[key][3], sector: MT[key][2] });
const X = (name, qty, brand, model, op, sector) => ({ type: name, name, qty, brand: brand || null, model: model || null, op: op || null, sector: sector || null });
const st = (key, mode = 'interna', desc) => ({ key, name: SD[key][1], desc: desc || SD[key][2], mode });
const cs = (name, desc, mode = 'interna') => ({ key: null, name, desc, mode });
const SV = (kind, name, cat, desc, o = {}) => ({ kind, name, cat, desc, ...o });
const reais = (v) => (v == null ? null : Math.round(v * 100));
const FULL_FLOW = (over = {}) => STEP_DEFAULTS.map(([k]) => st(k, over[k] || 'interna'));

// Marcas e modelos de máquinas também são fictícios.
const COMPANIES = [
  { slug: 'denim-serra-alta-confeccoes', name: 'Denim Serra Alta Confecções', owner: true, status: 'aprovado', featured: true, approvedDays: 80, city: 'Jaraguá do Sul', state: 'SC', hood: 'Vila Lalau', street: 'Rua das Agulhas', number: '1200', ddd: '47', n: '1001', handle: 'denimserraalta',
    tagline: 'Jeans do desenvolvimento à expedição, com lavanderia própria.',
    description: 'Confecção de jeans e sarja que atende marcas de pequeno e médio porte. Realizamos modelagem, corte, costura, lavanderia e acabamento no mesmo endereço, o que facilita o acompanhamento de cada lote.\n\nTrabalhamos com coleções de calças, bermudas, jaquetas e saias, em tecidos planos e com elastano.',
    history: 'A empresa começou como uma pequena facção de costura e foi ampliando as etapas até produzir peças completas. Hoje mantém equipe própria de modelagem e uma lavanderia interna para beneficiamento.',
    founded: 2009, specialties: 'Jeans masculino, Jeans feminino, Sarja, Jeans com elastano', fabrics: 'Jeans, Sarja, Brim', hours: 'Seg a sex, 7h30 às 17h30', employees: 62, shifts: '1 turno', min_batch: 300, lead: 35, size: [1, 1, 0],
    avail: 'disponivel', availDays: 6, availNote: 'Agenda aberta para coleções de verão a partir de novembro.', site: true, ig: true, email: true, phone: true,
    cats: ['fabricas-de-jeans', 'confeccoes-completas', 'private-label', 'lavanderias-industriais'], cover: 1, logo: 1, gallery: [1, 3, 5, 8, 9, 2],
    cap: { avg: 18000, max: 26000, free: 4000, day: 900, shift: 900, staff: 48, pieces: 'Calça jeans, Bermuda, Jaqueta jeans, Saia jeans', min: 300, lead: 35, notes: 'Capacidade varia conforme a complexidade da lavagem e o número de bolsos e detalhes.' },
    machines: [M('reta-industrial', 40, 'Costerra', 'CT-8800'), M('overloque', 14, 'Costerra', 'OV-5T'), M('interloque', 6, 'Tramar', 'IL-900'), M('maquina-de-cos', 4, 'Tramar', 'MC-22'), M('caseadeira', 3, 'Agulhaço', 'CZ-1790'), M('botoneira', 3, 'Agulhaço', 'BT-1377'), M('travete', 4, 'Agulhaço', 'TV-1900'), M('maquina-de-corte', 3, 'Ponteiro', 'MC-10'), M('mesa-de-corte-automatica', 1, 'Ponteiro', 'CAD-1800'), M('lavadora-industrial', 4, null, 'Capacidade 60 kg'), M('secadora-industrial', 3), M('ferro-caldeira', 4), X('Máquina de aplicar rebites', 3, null, null, 'Fixação de rebites e botões de pressão', 'Aviamentos')],
    steps: FULL_FLOW(),
    services: [
      SV('servico', 'Produção completa de jeans', 'fabricas-de-jeans', 'Da modelagem à embalagem: desenvolvimento da peça, corte, costura, lavagem, acabamento e revisão no mesmo local. Aceitamos ficha técnica ou peça de referência.', { fabrics: 'Jeans, Sarja, Jeans com elastano', pieces: 'Calça, Bermuda, Jaqueta, Saia', min: 300, cap: 'Até cerca de 900 peças por dia', lead: 35, pmin: 38, pmax: 72, unit: 'por peça (mão de obra, sem tecido)', cond: 'Valores variam conforme modelo e lavagem. Pedido mínimo de 300 peças por modelo. Tecido pode ser fornecido pelo cliente.' }),
      SV('servico', 'Facção de costura de jeans', 'faccoes-de-costura', 'Costura de peças com corte fornecido pelo cliente, com revisão e acabamento.', { fabrics: 'Jeans, Sarja', pieces: 'Calça jeans, Bermuda', min: 200, lead: 20, pmin: 14, pmax: 26, unit: 'por peça' }),
      SV('servico', 'Private label em jeans', 'private-label', 'Desenvolvimento e produção de linhas completas com a marca do cliente, incluindo etiquetas, tags e embalagem personalizada.', { fabrics: 'Jeans, Sarja', pieces: 'Calça jeans, Jaqueta jeans', min: 400, lead: 45, cond: 'Orçamento sob consulta, conforme coleção.' }),
      SV('servico', 'Lavagem e beneficiamento de jeans', 'lavanderias-industriais', 'Lavagem, amaciamento, efeitos de desgaste e secagem para peças produzidas aqui ou enviadas por terceiros.', { fabrics: 'Jeans, Sarja', pieces: 'Calça, Bermuda, Jaqueta', min: 150, lead: 10, pmin: 6, pmax: 18, unit: 'por peça' }),
      SV('servico', 'Corte industrial', 'corte-e-preparacao', 'Enfesto e corte de tecidos planos com encaixe planejado para o melhor aproveitamento.', { fabrics: 'Jeans, Sarja, Brim', min: 300, lead: 7 }),
    ],
    svcPhotos: { 0: [1, 9] } },

  { slug: 'faccao-ponto-certo', name: 'Facção Ponto Certo', status: 'aprovado', approvedDays: 66, privacy: 'cidade', city: 'Brusque', state: 'SC', hood: 'Centro', street: 'Rua das Linhas', number: '85', ddd: '47', n: '1002', handle: 'faccaopontocerto',
    tagline: 'Costura em malha com prazo curto e lotes pequenos.',
    description: 'Facção de costura especializada em malha para marcas que produzem coleções em lotes pequenos e médios. Recebemos o corte pronto e entregamos as peças costuradas, revisadas e embaladas.',
    founded: null, specialties: 'Malha, Camisetas, Vestidos', fabrics: 'Malha, Cotton, Viscose', hours: 'Seg a sex, 7h às 16h48', employees: 14, shifts: '1 turno', min_batch: 200, lead: 12, size: [1, 1, 0],
    avail: 'limitada', availDays: 15, availNote: 'Poucas vagas na agenda deste mês.', site: false, ig: true, email: true, phone: false,
    cats: ['faccoes-de-costura', 'oficinas-de-costura'], cover: 2, logo: 2, gallery: [1, 2, 8, 9],
    cap: { avg: 6000, max: null, free: null, day: 300, shift: null, staff: 12, pieces: 'Camiseta, Vestido, Blusa, Short', min: 200, lead: 12, notes: null },
    machines: [M('reta-industrial', 10, 'Costerra', 'CT-8800'), M('overloque', 6, 'Costerra', 'OV-5T'), M('interloque', 4, 'Tramar', 'IL-900'), M('galoneira', 2, 'Tramar', 'GL-500'), X('Máquina de pregar elástico', 1, null, null, 'Pregação de elástico em cós e punhos', 'Costura')],
    steps: [st('costura', 'interna', 'Costura de malha com peças cortadas pelo cliente.'), st('aviamentos'), st('acabamento'), st('revisao'), st('passadoria', 'terceirizada', 'Passadoria feita por parceiro da região.'), st('expedicao'), st('corte', 'nao_oferece'), st('modelagem', 'nao_oferece')],
    services: [
      SV('servico', 'Facção de costura em malha', 'faccoes-de-costura', 'Costura completa de peças em malha: camisetas, vestidos, blusas e shorts. O cliente envia o corte separado por tamanho, com aviamentos.', { fabrics: 'Malha, Cotton, Viscose', pieces: 'Camiseta, Vestido, Blusa, Short', min: 200, cap: 'Cerca de 300 peças por dia', lead: 12, pmin: 4.5, pmax: 11, unit: 'por peça' }),
      SV('servico', 'Acabamento e revisão de peças', 'acabamento-e-revisao', 'Limpeza de fios, revisão peça a peça e embalagem para quem já tem a costura pronta.', { pieces: 'Diversas', min: 100, lead: 5, pmin: 1.2, pmax: 3, unit: 'por peça' }),
    ] },

  { slug: 'lavanderia-rio-claro-textil', name: 'Lavanderia Rio Claro Têxtil', status: 'aprovado', approvedDays: 58, city: 'Toritama', state: 'PE', hood: 'Distrito Industrial', street: 'Avenida dos Tecelões', number: '450', ddd: '81', n: '1003', handle: 'lavanderiarioclaro',
    tagline: 'Lavagem, tingimento e efeitos para jeans e malhas.',
    description: 'Lavanderia industrial que atende confecções da região e de outros estados. Fazemos lavagens, amaciamento, tingimento de peças e efeitos manuais, com controle de lote e retorno rápido.',
    founded: 2014, specialties: 'Lavagem de jeans, Efeitos de desgaste, Tingimento de peças', fabrics: 'Jeans, Sarja, Malha, Moletom', hours: 'Seg a sáb, 6h às 18h', employees: 38, shifts: '2 turnos', min_batch: 100, lead: 5, size: [1, 1, 1],
    avail: 'disponivel', availDays: 75, availNote: null, site: false, ig: true, email: true, phone: true,
    cats: ['lavanderias-industriais', 'tingimento-e-beneficiamento', 'servicos-especializados'], cover: 6, logo: 3, gallery: [5, 7, 8],
    cap: { avg: null, max: 40000, free: null, day: null, shift: null, staff: 30, pieces: 'Calça jeans, Bermuda, Camiseta, Moletom', min: 100, lead: 5, notes: 'A capacidade depende do tipo de lavagem.' },
    machines: [M('lavadora-industrial', 8, 'Aquatex', 'AT-80'), M('secadora-industrial', 6, 'Aquatex', 'SC-60'), X('Centrífuga industrial', 4, null, null, 'Retirada de excesso de água', 'Lavanderia'), X('Tanque de tingimento', 3, null, null, 'Tingimento de peças por imersão', 'Lavanderia'), M('ferro-caldeira', 2)],
    steps: [st('lavanderia', 'interna', 'Lavagem, amaciamento e enxágue controlados por lote.'), cs('Tingimento de peças', 'Tingimento por imersão com amostra de cor aprovada antes do lote.'), cs('Efeitos manuais', 'Desgaste, puídos e marcações feitos à mão por equipe treinada.'), st('acabamento'), st('revisao'), st('passadoria'), st('expedicao'), st('costura', 'nao_oferece'), st('corte', 'nao_oferece')],
    services: [
      SV('servico', 'Lavagem e amaciamento industrial', 'lavanderias-industriais', 'Lavagens simples e especiais para jeans, sarja e malhas, com secagem e acabamento.', { fabrics: 'Jeans, Sarja, Malha', pieces: 'Calça, Bermuda, Camiseta, Moletom', min: 100, lead: 5, pmin: 2.5, pmax: 9, unit: 'por peça' }),
      SV('servico', 'Efeitos de desgaste em jeans', 'lavanderias-industriais', 'Stone, desgaste manual, marcações e efeitos desbotados conforme amostra aprovada.', { fabrics: 'Jeans, Sarja', pieces: 'Calça jeans, Jaqueta jeans', min: 150, lead: 8, pmin: 6, pmax: 20, unit: 'por peça' }),
      SV('servico', 'Tingimento de peças prontas', 'tingimento-e-beneficiamento', 'Tingimento de peças em algodão e misturas, com prova de cor antes do lote.', { fabrics: 'Algodão, Malha, Moletom', min: 100, lead: 7, cond: 'Cores sob consulta. Fios sintéticos puros podem não tingir.' }),
    ] },

  { slug: 'corte-preciso-atelie-industrial', name: 'Corte Preciso Ateliê Industrial', status: 'aprovado', approvedDays: 52, city: 'São Paulo', state: 'SP', place: 'Bom Retiro, São Paulo', hood: 'Bom Retiro', street: 'Rua dos Botões', number: '310', ddd: '11', n: '1004', handle: 'cortepreciso',
    tagline: 'Enfesto, encaixe e corte para quem terceiriza a preparação.',
    description: 'Ateliê industrial de corte e modelagem no Bom Retiro. Preparamos o tecido da sua coleção: risco, enfesto e corte, com a separação em kits por tamanho prontos para a costura.',
    founded: 2011, specialties: 'Corte industrial, Encaixe, Graduação', fabrics: 'Malha, Plano, Jeans, Viscose', hours: 'Seg a sex, 8h às 17h', employees: 16, shifts: '1 turno', min_batch: 100, lead: 4, size: [1, 1, 0],
    avail: null, site: true, ig: false, email: true, phone: true,
    cats: ['corte-e-preparacao', 'modelagem-e-desenvolvimento'], cover: 5, logo: 4, gallery: [3, 10, 4],
    cap: null,
    machines: [M('maquina-de-corte', 3, 'Ponteiro', 'MC-10'), M('mesa-de-corte-automatica', 1, 'Ponteiro', 'CAD-1800'), X('Mesa de enfesto', 4, null, null, 'Enfesto de tecido em camadas', 'Corte'), X('Plotter de encaixe', 1, null, null, 'Impressão de riscos e encaixes', 'Corte')],
    steps: [st('modelagem'), st('moldes'), st('encaixe'), st('corte'), st('separacao'), st('costura', 'nao_oferece'), st('expedicao')],
    services: [
      SV('servico', 'Enfesto e corte industrial', 'corte-e-preparacao', 'Corte de lotes com enfesto controlado e separação em kits por tamanho. Também cortamos com mesa automática para tecidos delicados.', { fabrics: 'Malha, Plano, Jeans, Viscose', pieces: 'Diversas', min: 100, lead: 4, pmin: 0.9, pmax: 2.6, unit: 'por peça' }),
      SV('servico', 'Encaixe e risco computadorizado', 'corte-e-preparacao', 'Planejamento do encaixe para reduzir o desperdício de tecido, com plotagem do risco.', { lead: 2 }),
      SV('servico', 'Graduação de moldes', 'modelagem-e-desenvolvimento', 'Graduação de tamanhos a partir do molde piloto aprovado.', { lead: 3, pmin: 35, pmax: 90, unit: 'por molde' }),
    ] },

  { slug: 'bordados-linha-de-ouro', name: 'Bordados Linha de Ouro', status: 'aprovado', approvedDays: 47, city: 'Americana', state: 'SP', hood: 'Jardim São Paulo', street: 'Rua do Carretel', number: '77', ddd: '19', n: '1005', handle: 'bordadoslinhadeouro',
    tagline: 'Bordado computadorizado para uniformes e coleções.',
    description: 'Bordadaria industrial com máquinas multicabeças. Digitalizamos a matriz do seu logotipo ou desenho e bordamos em lotes, em peças suas ou produzidas por nós em parceria.',
    founded: 2016, specialties: 'Bordado de logotipos, Nomes e números, Patches', fabrics: 'Malha, Piquet, Brim, Tricoline', hours: 'Seg a sex, 8h às 17h48', employees: 21, shifts: '1 turno', min_batch: 50, lead: 10, size: [1, 1, 0],
    avail: 'disponivel', availDays: 3, availNote: null, site: true, ig: true, email: true, phone: true,
    cats: ['bordado-industrial', 'uniformes-profissionais', 'servicos-especializados'], cover: 7, logo: 5, gallery: [6, 9, 8, 2],
    cap: { avg: 9000, max: 15000, free: null, day: 500, shift: null, staff: 14, pieces: 'Camisa polo, Jaleco, Boné, Uniforme', min: 50, lead: 10, notes: 'Prazo depende da quantidade de pontos do bordado.' },
    machines: [M('bordadeira', 12, 'Linhar', 'BR-6C'), M('prensa-termica', 3), X('Máquina de patches', 1, null, null, 'Aplicação de patches e etiquetas', 'Bordado')],
    steps: [cs('Digitalização do bordado (matriz)', 'Transformamos o seu desenho em arquivo de bordado e fazemos uma prova.'), cs('Bordado', 'Bordado em máquinas multicabeças, com troca de linhas conforme as cores do projeto.'), cs('Corte de fios e limpeza', 'Retirada de sobras de linha e do entretela.'), st('revisao'), st('expedicao')],
    services: [
      SV('servico', 'Bordado computadorizado em peças', 'bordado-industrial', 'Bordado de logotipos e desenhos em camisas, jalecos, bonés e outros. Fazemos a digitalização e a prova antes do lote.', { fabrics: 'Malha, Piquet, Brim, Tricoline', pieces: 'Camisa polo, Jaleco, Boné, Camiseta', min: 50, lead: 10, pmin: 4, pmax: 18, unit: 'por peça bordada', cond: 'Valor depende do tamanho e do número de pontos. Matriz cobrada à parte, uma única vez.' }),
      SV('servico', 'Bordado para uniformes', 'uniformes-profissionais', 'Bordado de nome, cargo e logotipo para equipes, em lotes recorrentes.', { fabrics: 'Piquet, Brim, Tricoline', pieces: 'Uniforme, Jaleco', min: 30, lead: 7 }),
      SV('servico', 'Aplicação de patches e termocolantes', 'servicos-especializados', 'Aplicação por prensa térmica de patches, etiquetas e transfers.', { min: 100, lead: 5, pmin: 1.5, pmax: 4, unit: 'por aplicação' }),
    ], svcPhotos: { 0: [6] } },

  { slug: 'estamparia-cor-e-trama', name: 'Estamparia Cor e Trama', status: 'aprovado', approvedDays: 41, city: 'Blumenau', state: 'SC', hood: 'Itoupava Norte', street: 'Rua das Tintas', number: '630', ddd: '47', n: '1006', handle: 'estampariacoretrama',
    tagline: 'Silk, sublimação e estampa digital em diferentes tiragens.',
    description: 'Estamparia que combina silk em carrossel, sublimação e impressão digital. Atendemos desde pequenos lotes de teste até tiragens maiores, com prova de cor aprovada antes da produção.',
    founded: 2012, specialties: 'Silk localizado, Sublimação total, Estampa digital', fabrics: 'Malha, Poliéster, Algodão', hours: 'Seg a sex, 7h30 às 17h', employees: 26, shifts: '1 turno', min_batch: 30, lead: 8, size: [1, 1, 0],
    avail: 'limitada', availDays: 20, availNote: 'Prazo maior em datas comemorativas.', site: true, ig: true, email: true, phone: false,
    cats: ['estamparia', 'private-label', 'servicos-especializados'], cover: 8, logo: 6, gallery: [8, 4, 9],
    cap: { avg: null, max: 12000, free: null, day: 600, shift: null, staff: 18, pieces: 'Camiseta, Moletom, Camisa esportiva', min: 30, lead: 8, notes: null },
    machines: [M('estampa-silk', 2, 'Colortec', 'CR-8'), M('estampa-digital', 2, 'Colortec', 'DG-1800'), M('prensa-termica', 4), X('Estufa de secagem (túnel)', 1, null, null, 'Cura da tinta após a estampa', 'Estamparia')],
    steps: [cs('Preparação de telas e gravação', 'Gravação das telas a partir da arte aprovada.'), cs('Prova de cor', 'Estampa de teste para aprovação antes do lote.'), cs('Estampa', 'Aplicação da estampa por silk, sublimação ou digital.'), cs('Cura e secagem', 'Secagem em estufa para fixação da tinta.'), st('revisao'), st('expedicao'), st('costura', 'nao_oferece')],
    services: [
      SV('servico', 'Estampa silk localizada', 'estamparia', 'Estampas no peito, costas e mangas, com até 8 cores, em peças cortadas ou prontas.', { fabrics: 'Malha, Algodão', pieces: 'Camiseta, Moletom', min: 100, lead: 8, pmin: 2.8, pmax: 9, unit: 'por peça' }),
      SV('servico', 'Sublimação total', 'estamparia', 'Estampa em toda a peça ou em painéis de poliéster para depois da costura.', { fabrics: 'Poliéster, Poliamida', pieces: 'Camisa esportiva, Legging', min: 50, lead: 10 }),
      SV('servico', 'Estampa digital em pequenos lotes', 'estamparia', 'Para testes de coleção e lotes a partir de 30 peças, sem custo de tela.', { fabrics: 'Algodão, Malha', pieces: 'Camiseta', min: 30, lead: 6, pmin: 14, pmax: 28, unit: 'por peça' }),
    ] },

  { slug: 'fit-malha-studio', name: 'Fit Malha Studio', status: 'aprovado', featured: true, approvedDays: 33, city: 'Fortaleza', state: 'CE', hood: 'Messejana', street: 'Rua das Malhas', number: '95', ddd: '85', n: '1007', handle: 'fitmalhastudio',
    tagline: 'Confecção de moda fitness: da peça piloto ao lote.',
    description: 'Confecção especializada em moda fitness e roupas de treino, com costura plana e de cobertura. Desenvolvemos a peça piloto com a marca e produzimos em lotes pequenos e médios.',
    founded: 2017, specialties: 'Legging, Top, Conjunto fitness, Shorts de treino', fabrics: 'Suplex, Poliamida, Helanca, Malha', hours: 'Seg a sex, 7h às 17h', employees: 48, shifts: '2 turnos', min_batch: 150, lead: 25, size: [1, 1, 1],
    avail: 'disponivel', availDays: 2, availNote: 'Aceitando novas marcas para coleções de verão.', site: true, ig: true, email: true, phone: true,
    cats: ['moda-fitness', 'confeccoes-completas', 'private-label'], cover: 9, logo: 7, gallery: [1, 2, 3, 8, 9],
    cap: { avg: 22000, max: 30000, free: 5000, day: 1100, shift: 600, staff: 40, pieces: 'Legging, Top fitness, Conjunto fitness, Short', min: 150, lead: 25, notes: null },
    machines: [M('overloque', 18, 'Tramar', 'OV-5T'), M('interloque', 14, 'Tramar', 'IL-900'), M('galoneira', 8, 'Tramar', 'GL-500'), M('reta-industrial', 6, 'Costerra', 'CT-8800'), M('maquina-de-corte', 2, 'Ponteiro', 'MC-10'), X('Máquina de costura plana (flatlock)', 10, null, null, 'Costura plana sem relevo para peças de treino', 'Costura')],
    steps: FULL_FLOW({ lavanderia: 'nao_oferece' }),
    services: [
      SV('servico', 'Produção completa de moda fitness', 'moda-fitness', 'Corte, costura, acabamento e embalagem de peças fitness em suplex e poliamida, com costura plana para maior conforto.', { fabrics: 'Suplex, Poliamida, Helanca', pieces: 'Legging, Top, Conjunto, Short', min: 150, cap: 'Até 1.100 peças por dia', lead: 25, pmin: 11, pmax: 24, unit: 'por peça (mão de obra)' }),
      SV('servico', 'Desenvolvimento de peça piloto', 'modelagem-e-desenvolvimento', 'Modelagem, corte e costura de peça piloto para aprovação antes do lote.', { fabrics: 'Suplex, Poliamida', pieces: 'Legging, Top', min: 1, lead: 10, pmin: 90, pmax: 180, unit: 'por peça piloto' }),
      SV('servico', 'Private label fitness', 'private-label', 'Linhas completas para marcas de moda fitness, com etiquetas e embalagem personalizadas.', { fabrics: 'Suplex, Poliamida', pieces: 'Conjunto fitness, Legging', min: 150, lead: 30 }),
    ], svcPhotos: { 0: [1] } },

  { slug: 'doce-renda-moda-intima', name: 'Doce Renda Moda Íntima', status: 'aprovado', approvedDays: 28, city: 'Nova Friburgo', state: 'RJ', hood: 'Conselheiro Paulino', street: 'Rua das Rendas', number: '240', ddd: '22', n: '1008', handle: 'docerendamodaintima',
    tagline: 'Lingerie, pijamas e peças íntimas com acabamento delicado.',
    description: 'Confecção de moda íntima com experiência em renda, elástico e microfibra. Atendemos marcas que buscam acabamento cuidadoso e produção em lotes médios.',
    founded: 2003, specialties: 'Lingerie, Pijama, Meias, Moda praia', fabrics: 'Renda, Microfibra, Malha, Algodão', hours: 'Seg a sex, 7h às 16h30', employees: 44, shifts: '1 turno', min_batch: 200, lead: 30, size: [0, 1, 1],
    avail: 'indisponivel', availDays: 10, availNote: 'Agenda fechada até janeiro.', site: true, ig: true, email: true, phone: true,
    cats: ['moda-intima', 'confeccoes-completas'], cover: 10, logo: 8, gallery: [1, 2, 9, 8],
    cap: { avg: 14000, max: 20000, free: 0, day: 700, shift: null, staff: 36, pieces: 'Calcinha, Sutiã, Pijama, Camisola', min: 200, lead: 30, notes: null },
    machines: [M('overloque', 10, 'Tramar', 'OV-5T'), M('interloque', 6, 'Tramar', 'IL-900'), M('reta-industrial', 6, 'Costerra', 'CT-8800'), X('Máquina zigue-zague', 8, null, null, 'Aplicação de renda e elástico decorativo', 'Costura'), X('Pregadeira de elástico', 5, null, null, 'Pregação de elástico de cós e pernas', 'Costura')],
    steps: [st('modelagem'), st('moldes'), st('corte'), st('separacao'), cs('Aplicação de renda e elástico', 'Fixação de renda, elástico e detalhes decorativos.'), st('costura'), cs('Tingimento', 'Tingimento de peças é feito por parceiro.', 'terceirizada'), st('acabamento'), st('revisao'), st('expedicao')],
    services: [
      SV('servico', 'Confecção de lingerie', 'moda-intima', 'Produção de calcinhas, sutiãs e conjuntos com renda e microfibra, a partir da ficha técnica da marca.', { fabrics: 'Renda, Microfibra', pieces: 'Calcinha, Sutiã, Conjunto', min: 200, lead: 30, pmin: 5, pmax: 14, unit: 'por peça' }),
      SV('servico', 'Pijamas e roupas de dormir', 'moda-intima', 'Pijamas, camisolas e conjuntos em malha, algodão e viscose.', { fabrics: 'Algodão, Malha, Viscose', pieces: 'Pijama, Camisola', min: 200, lead: 25 }),
      SV('servico', 'Facção de acabamento em renda', 'acabamento-e-revisao', 'Aplicação de renda e elástico e revisão para quem já tem a peça cortada.', { fabrics: 'Renda', min: 300, lead: 12 }),
    ] },

  { slug: 'camisaria-quatro-botoes', name: 'Camisaria Quatro Botões', status: 'aprovado', approvedDays: 24, city: 'Maringá', state: 'PR', hood: 'Zona 7', street: 'Rua dos Colarinhos', number: '510', ddd: '44', n: '1009', handle: 'camisariaquatrobotoes',
    tagline: 'Camisas sociais e casuais em lotes para marcas e empresas.',
    description: 'Confecção especializada em camisaria. Produzimos camisas sociais, casuais e para uniforme, com atenção ao colarinho, ao pesponto e ao acabamento.',
    founded: 2008, specialties: 'Camisa social, Camisa casual, Camisa de uniforme', fabrics: 'Tricoline, Oxford, Linho, Viscose', hours: 'Seg a sex, 7h às 17h', employees: 35, shifts: '1 turno', min_batch: 100, lead: 25, size: [1, 1, 0],
    avail: 'limitada', availDays: 40, availNote: null, site: false, ig: true, email: true, phone: true,
    cats: ['camisaria', 'confeccoes-completas', 'uniformes-profissionais'], cover: 10, logo: 9, gallery: [1, 7, 8, 3],
    cap: { avg: 7000, max: 10000, free: null, day: 380, shift: null, staff: 30, pieces: 'Camisa social, Camisa casual, Blusa', min: 100, lead: 25, notes: null },
    machines: [M('reta-industrial', 24, 'Costerra', 'CT-8800'), M('overloque', 6, 'Costerra', 'OV-5T'), M('caseadeira', 3, 'Agulhaço', 'CZ-1790'), M('botoneira', 3, 'Agulhaço', 'BT-1377'), M('travete', 2, 'Agulhaço', 'TV-1900'), X('Máquina de montar colarinho', 2, null, null, 'Montagem e pesponto de colarinho e punho', 'Costura'), M('ferro-caldeira', 3)],
    steps: FULL_FLOW({ lavanderia: 'nao_oferece' }),
    services: [
      SV('servico', 'Camisa social em lotes', 'camisaria', 'Produção de camisas sociais com colarinho estruturado e pesponto cuidadoso, a partir da ficha técnica.', { fabrics: 'Tricoline, Oxford', pieces: 'Camisa social', min: 100, lead: 25, pmin: 18, pmax: 34, unit: 'por peça' }),
      SV('servico', 'Camisaria para uniformes', 'uniformes-profissionais', 'Camisas para equipes e empresas, com opção de bordado do logotipo por parceiro.', { fabrics: 'Tricoline, Oxford', pieces: 'Camisa de uniforme', min: 100, lead: 20 }),
      SV('servico', 'Modelagem de camisaria', 'modelagem-e-desenvolvimento', 'Desenvolvimento e ajuste de modelagem de camisas masculinas e femininas.', { pieces: 'Camisa', lead: 10 }),
    ] },

  { slug: 'uniformes-norte-forte', name: 'Uniformes Norte Forte', status: 'aprovado', featured: true, featuredUntil: 60, approvedDays: 19, city: 'Goiânia', state: 'GO', hood: 'Setor Industrial', street: 'Avenida dos Operários', number: '2100', ddd: '62', n: '1010', handle: 'uniformesnorteforte',
    tagline: 'Uniformes corporativos, de saúde e industriais em grande escala.',
    description: 'Fábrica de uniformes para empresas, clínicas, indústrias e redes de lojas. Temos corte automatizado, costura em linha e bordaria própria, o que permite entregar lotes grandes com padronização.',
    founded: 1998, specialties: 'Uniforme corporativo, Jaleco, Uniforme industrial, Macacão', fabrics: 'Brim, Gabardine, Oxford, Piquet', hours: 'Seg a sex, 7h às 17h', employees: 95, shifts: '2 turnos', min_batch: 200, lead: 30, size: [0, 1, 1],
    avail: 'disponivel', availDays: 8, availNote: null, site: true, ig: true, email: true, phone: true,
    cats: ['uniformes-profissionais', 'confeccoes-completas', 'bordado-industrial'], cover: 5, logo: 10, gallery: [1, 3, 6, 7, 8, 9],
    cap: { avg: 30000, max: 42000, free: 6000, day: 1800, shift: 900, staff: 78, pieces: 'Uniforme, Jaleco, Macacão, Camisa polo, Calça de uniforme', min: 200, lead: 30, notes: null },
    machines: [M('reta-industrial', 55, 'Costerra', 'CT-8800'), M('overloque', 20, 'Costerra', 'OV-5T'), M('interloque', 10, 'Tramar', 'IL-900'), M('galoneira', 6, 'Tramar', 'GL-500'), M('caseadeira', 6, 'Agulhaço', 'CZ-1790'), M('botoneira', 6, 'Agulhaço', 'BT-1377'), M('travete', 5, 'Agulhaço', 'TV-1900'), M('maquina-de-corte', 4, 'Ponteiro', 'MC-10'), M('mesa-de-corte-automatica', 1, 'Ponteiro', 'CAD-1800'), M('bordadeira', 6, 'Linhar', 'BR-6C'), M('prensa-termica', 3), M('ferro-caldeira', 6)],
    steps: FULL_FLOW({ lavanderia: 'nao_oferece' }),
    services: [
      SV('servico', 'Uniformes corporativos', 'uniformes-profissionais', 'Camisas, calças e conjuntos para equipes, com bordado do logotipo e controle de tamanhos por colaborador.', { fabrics: 'Gabardine, Oxford, Piquet', pieces: 'Camisa polo, Camisa social, Calça', min: 200, lead: 30 }),
      SV('servico', 'Jalecos e uniformes de saúde', 'uniformes-profissionais', 'Jalecos, scrubs e conjuntos para clínicas e hospitais, com opção de bordado de nome e cargo.', { fabrics: 'Brim leve, Oxford', pieces: 'Jaleco, Scrub', min: 200, lead: 25, pmin: 28, pmax: 60, unit: 'por peça' }),
      SV('servico', 'Uniformes industriais', 'uniformes-profissionais', 'Macacões, calças e jaquetas em brim para uso industrial, com faixas refletivas sob pedido.', { fabrics: 'Brim, Gabardine', pieces: 'Macacão, Calça, Jaqueta', min: 300, lead: 35 }),
    ], svcPhotos: { 0: [7] } },

  { slug: 'molde-livre-modelagem', name: 'Molde Livre Modelagem', status: 'aprovado', approvedDays: 14, privacy: 'aproximada', city: 'Belo Horizonte', state: 'MG', hood: 'Santa Efigênia', street: 'Rua das Réguas', number: '45', ddd: '31', n: '1011', handle: 'moldelivre',
    tagline: 'Modelagem, graduação e peça piloto para marcas independentes.',
    description: 'Estúdio de modelagem que desenvolve moldes planos e digitais para marcas independentes. Entregamos o molde graduado e a ficha técnica pronta para enviar a qualquer confecção.',
    founded: 2019, specialties: 'Modelagem plana, Graduação, Ficha técnica, Peça piloto', fabrics: 'Malha, Plano, Jeans', hours: 'Seg a sex, 9h às 18h', employees: 5, shifts: null, min_batch: null, lead: 10, size: [1, 1, 0],
    avail: 'disponivel', availDays: 12, availNote: 'Atendimento por agendamento.', site: true, ig: true, email: true, phone: false,
    cats: ['modelagem-e-desenvolvimento', 'private-label', 'servicos-especializados'], cover: 5, logo: 11, gallery: [10, 3],
    cap: null,
    machines: [X('Mesa digitalizadora', 1, null, null, 'Digitalização de moldes de papel', 'Modelagem'), X('Plotter de moldes', 1, null, null, 'Impressão de moldes em tamanho real', 'Modelagem'), M('reta-industrial', 2, 'Costerra', 'CT-8800', 'Costura de peça piloto')],
    steps: [cs('Briefing e ficha técnica', 'Levantamento do produto com a marca e montagem da ficha técnica.'), st('modelagem'), st('moldes'), cs('Peça piloto', 'Costura de uma peça para prova e ajustes.'), st('costura', 'nao_oferece'), st('corte', 'nao_oferece')],
    services: [
      SV('servico', 'Modelagem plana', 'modelagem-e-desenvolvimento', 'Criação de moldes a partir de desenho, foto de referência ou peça-modelo.', { pieces: 'Camisa, Vestido, Calça, Blusa', lead: 10, pmin: 120, pmax: 380, unit: 'por modelo' }),
      SV('servico', 'Graduação de moldes', 'modelagem-e-desenvolvimento', 'Graduação do molde piloto para toda a grade de tamanhos, em arquivo digital e papel.', { lead: 5, pmin: 60, pmax: 160, unit: 'por modelo' }),
      SV('servico', 'Peça piloto e ficha técnica', 'private-label', 'Costura da peça piloto e ficha técnica completa para enviar à confecção.', { min: 1, lead: 12 }),
    ] },

  { slug: 'marca-propria-producao', name: 'Marca Própria Produção', status: 'aprovado', approvedDays: 10, city: 'Santa Cruz do Capibaribe', state: 'PE', hood: 'Centro', street: 'Rua das Confecções', number: '980', ddd: '81', n: '1012', handle: 'marcapropriaproducao',
    tagline: 'Produção para marcas que querem lançar coleções próprias.',
    description: 'Confecção com foco em private label: recebemos a ficha técnica da marca, desenvolvemos as peças e produzimos em lotes pequenos e médios, com etiquetas e embalagem personalizadas.',
    founded: 2015, specialties: 'Private label, Coleções cápsula, Facção para marcas', fabrics: 'Malha, Viscose, Algodão, Poliéster', hours: 'Seg a sex, 7h às 17h', employees: 70, shifts: '2 turnos', min_batch: 100, lead: 28, size: [1, 1, 1],
    avail: 'limitada', availDays: 25, availNote: null, site: false, ig: true, email: true, phone: true,
    cats: ['private-label', 'confeccoes-completas', 'faccoes-de-costura'], cover: 3, logo: 12, gallery: [1, 2, 4, 9],
    cap: { avg: 25000, max: 35000, free: null, day: 1400, shift: null, staff: 58, pieces: 'Camiseta, Vestido, Calça, Short, Blusa', min: 100, lead: 28, notes: null },
    machines: [M('reta-industrial', 30, 'Costerra', 'CT-8800'), M('overloque', 14, 'Costerra', 'OV-5T'), M('interloque', 8, 'Tramar', 'IL-900'), M('galoneira', 5, 'Tramar', 'GL-500'), M('caseadeira', 2, 'Agulhaço', 'CZ-1790'), M('botoneira', 2, 'Agulhaço', 'BT-1377')],
    steps: FULL_FLOW({ lavanderia: 'terceirizada' }),
    services: [
      SV('servico', 'Private label completo', 'private-label', 'Do desenvolvimento à expedição, com etiquetas, tags e embalagem da sua marca.', { fabrics: 'Malha, Viscose, Algodão', pieces: 'Camiseta, Vestido, Calça, Blusa', min: 100, lead: 28 }),
      SV('servico', 'Coleções cápsula', 'private-label', 'Pequenas coleções de 3 a 8 modelos para testar a aceitação da marca.', { min: 100, lead: 25 }),
      SV('servico', 'Facção para marcas', 'faccoes-de-costura', 'Costura de peças com corte fornecido pela marca.', { fabrics: 'Malha, Algodão', min: 100, lead: 15, pmin: 5, pmax: 12, unit: 'por peça' }),
    ] },

  { slug: 'tecidos-fio-mestre', name: 'Tecidos Fio Mestre', status: 'aprovado', approvedDays: 7, city: 'São Paulo', state: 'SP', place: 'Brás, São Paulo', hood: 'Brás', street: 'Rua das Fibras', number: '188', ddd: '11', n: '1013', handle: 'tecidosfiomestre',
    tagline: 'Malhas, planos e jeans por metro e por rolo.',
    description: 'Fornecedor de tecidos no Brás. Vendemos malhas, tecidos planos e jeans para confecções e marcas, por corte ou por rolo, com envio para todo o Brasil mediante combinação.',
    founded: null, specialties: 'Malhas, Jeans, Tecidos planos', fabrics: 'Malha, Jeans, Sarja, Viscose, Moletom', hours: 'Seg a sex, 8h às 17h; sáb, 8h às 12h', employees: 22, shifts: null, min_batch: null, lead: null, size: [1, 1, 1],
    avail: null, site: true, ig: true, email: true, phone: true,
    cats: ['fornecedores-de-tecidos'], cover: 3, logo: 13, gallery: [4, 2],
    cap: null, machines: [], steps: [],
    services: [
      SV('produto', 'Malha cotton penteada', 'fornecedores-de-tecidos', 'Malha de algodão penteado em várias cores lisas, indicada para camisetas e peças básicas.', { fabrics: 'Algodão', pmin: 22, pmax: 34, unit: 'por metro', cond: 'Venda mínima de 25 metros por cor. Consulte disponibilidade e cartela.' }),
      SV('produto', 'Jeans e sarja', 'fornecedores-de-tecidos', 'Jeans e sarja em diferentes gramaturas, com e sem elastano.', { fabrics: 'Jeans, Sarja', pmin: 19, pmax: 42, unit: 'por metro', cond: 'Venda por rolo ou corte mínimo. Consulte as gramaturas.' }),
      SV('produto', 'Moletom flanelado', 'fornecedores-de-tecidos', 'Moletom flanelado e peluciado para coleções de inverno.', { fabrics: 'Moletom', pmin: 28, pmax: 45, unit: 'por metro' }),
      SV('produto', 'Viscose e tecidos leves', 'fornecedores-de-tecidos', 'Viscose lisa e estampada para vestidos, blusas e camisas.', { fabrics: 'Viscose, Tricoline', pmin: 16, pmax: 30, unit: 'por metro' }),
      SV('produto', 'Suplex e poliamida', 'fornecedores-de-tecidos', 'Malhas técnicas para moda fitness e praia.', { fabrics: 'Suplex, Poliamida', pmin: 30, pmax: 58, unit: 'por metro' }),
    ] },

  { slug: 'aviamentos-casa-do-botao', name: 'Aviamentos Casa do Botão', status: 'aprovado', approvedDays: 5, privacy: 'cidade', city: 'Caruaru', state: 'PE', hood: 'Centro', street: 'Rua dos Aviamentos', number: '12', ddd: '81', n: '1014', handle: 'casadobotao',
    tagline: 'Zíperes, botões, linhas e etiquetas para confecções.',
    description: 'Loja e distribuidora de aviamentos para confecções do Agreste. Trabalhamos com zíperes, botões, rebites, linhas, elásticos, etiquetas e fitas, em pequenas e grandes quantidades.',
    founded: 2010, specialties: 'Zíperes, Botões, Linhas, Elásticos, Etiquetas', fabrics: null, hours: 'Seg a sáb, 8h às 17h', employees: 12, shifts: null, min_batch: null, lead: null, size: [1, 1, 0],
    avail: 'disponivel', availDays: 30, availNote: null, site: false, ig: true, email: true, phone: true,
    cats: ['fornecedores-de-aviamentos'], cover: 4, logo: 14, gallery: [4, 9, 2],
    cap: null, machines: [], steps: [],
    services: [
      SV('produto', 'Zíperes', 'fornecedores-de-aviamentos', 'Zíperes de metal, nylon e invisível, em vários comprimentos e cores.', { pmin: 0.9, pmax: 4.8, unit: 'por unidade', cond: 'Preço varia por tipo e quantidade. Consulte cores disponíveis.' }),
      SV('produto', 'Botões e rebites', 'fornecedores-de-aviamentos', 'Botões de pressão, de jeans, de camisa e rebites em metal, em caixas ou por milheiro.', { pmin: 0.1, pmax: 1.6, unit: 'por unidade' }),
      SV('produto', 'Linhas de costura', 'fornecedores-de-aviamentos', 'Linhas de poliéster e algodão em cones e carretéis, em cartela de cores.', { pmin: 4, pmax: 18, unit: 'por cone' }),
      SV('produto', 'Etiquetas e fitas', 'fornecedores-de-aviamentos', 'Etiquetas tecidas, de composição e fitas sob encomenda.', { cond: 'Produção sob encomenda. Consulte prazos e quantidades.' }),
    ] },

  { slug: 'maquinas-agulha-viva', name: 'Máquinas Agulha Viva', status: 'pendente', approvedDays: null, city: 'Apucarana', state: 'PR', hood: 'Jardim Apucarana', street: 'Avenida das Máquinas', number: '700', ddd: '43', n: '1015', handle: 'maquinasagulhaviva',
    tagline: 'Manutenção, locação e venda de máquinas de costura industriais.',
    description: 'Oficina técnica para máquinas de costura industriais. Fazemos manutenção preventiva e corretiva, locação por período e venda de equipamentos revisados.',
    founded: 2013, specialties: 'Manutenção, Locação, Máquinas revisadas', fabrics: null, hours: 'Seg a sex, 8h às 18h', employees: 9, shifts: null, min_batch: null, lead: null, size: [1, 1, 0],
    avail: null, site: false, ig: true, email: true, phone: true,
    cats: ['maquinas-e-equipamentos', 'servicos-especializados'], cover: 2, logo: 15, gallery: [1, 2],
    cap: null, machines: [], steps: [],
    services: [
      SV('servico', 'Manutenção preventiva e corretiva', 'servicos-especializados', 'Revisão, ajuste e reparo de máquinas retas, overloques, interloques e outras, na oficina ou na sua confecção.', { lead: 3 }),
      SV('servico', 'Locação de máquinas', 'maquinas-e-equipamentos', 'Locação por período para atender picos de produção, com manutenção inclusa.', { pmin: 90, pmax: 260, unit: 'por máquina/mês' }),
      SV('produto', 'Máquinas retas industriais revisadas', 'maquinas-e-equipamentos', 'Máquinas retas revisadas e testadas, com garantia de oficina informada na venda.', { cond: 'Disponibilidade e valores sob consulta.' }),
    ] },

  { slug: 'costura-solidaria-divinopolis', name: 'Costura Solidária Divinópolis', status: 'rascunho', approvedDays: null, privacy: 'aproximada', city: 'Divinópolis', state: 'MG', hood: 'Bela Vista', street: 'Rua das Costureiras', number: '33', ddd: '37', n: '1016', handle: null,
    tagline: 'Oficina de costura em estruturação.',
    description: 'Oficina de costura em fase de cadastro.',
    founded: null, specialties: 'Ajustes, Pequenos lotes', fabrics: null, hours: null, employees: null, shifts: null, min_batch: null, lead: null, size: [1, 0, 0],
    avail: null, site: false, ig: false, email: false, phone: false, noCover: true,
    cats: ['oficinas-de-costura', 'acabamento-e-revisao'], cover: 1, logo: 16, gallery: [1],
    cap: null,
    machines: [M('reta-industrial', 3, 'Costerra', 'CT-8800'), M('overloque', 1, 'Costerra', 'OV-5T')], steps: [],
    services: [] },
];

// ----------------------------------------------------------------------------------------
// Dados de demonstração
// ----------------------------------------------------------------------------------------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function wipeDemo() {
  const ids = db.prepare('SELECT id FROM companies WHERE is_demo=1').all().map((r) => r.id);
  const range = db.prepare("SELECT value FROM settings WHERE key='demo_events_range'").get();
  db.transaction(() => {
    if (ids.length) {
      const q = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM moderation_logs WHERE company_id IN (${q})`).run(...ids);
      db.prepare(`DELETE FROM companies WHERE id IN (${q})`).run(...ids);
    }
    db.prepare('DELETE FROM moderation_logs WHERE company_id IS NULL AND note LIKE ?').run('%(demonstração)%');
    if (range && /^\d+-\d+$/.test(range.value)) {
      const [a, b] = range.value.split('-').map(Number);
      db.prepare("DELETE FROM events WHERE type='busca' AND company_id IS NULL AND id BETWEEN ? AND ?").run(a, b);
    }
    db.prepare("DELETE FROM settings WHERE key='demo_events_range'").run();
    db.prepare('DELETE FROM users WHERE email LIKE ?').run('%' + DEMO_DOMAIN);
  })();
}

async function seedDemo({ reset = false } = {}) {
  if (reset) wipeDemo();
  else if (db.prepare('SELECT 1 FROM companies WHERE is_demo=1 LIMIT 1').get()) return { skipped: true };

  const rand = mulberry32(20261022);
  const pwHash = await hashPassword(DEMO_PASSWORD);
  const gratuito = db.prepare("SELECT id FROM plans WHERE slug='gratuito'").get();
  const destaque = db.prepare("SELECT id FROM plans WHERE slug='destaque'").get();
  const catId = Object.fromEntries(db.prepare('SELECT id,slug FROM categories').all().map((c) => [c.slug, c.id]));
  const place = (name) => places.find((p) => p.name === name);

  const out = { companies: 0, services: 0, machines: 0, steps: 0, media: 0, events: 0 };
  const run = db.transaction(() => {
    const mkUser = (name, email, role) => ins('users', { name, email, password_hash: pwHash, role, lgpd_consent_at: ago(60), terms_version: config.termsVersion, last_login_at: ago(2) }).lastInsertRowid;
    const adminId = mkUser('Administrador Demonstração', 'admin' + DEMO_DOMAIN, 'admin');
    const advertiserId = mkUser('Anunciante Demonstração', 'anunciante' + DEMO_DOMAIN, 'anunciante');
    const seekerId = mkUser('Buscador Demonstração', 'buscador' + DEMO_DOMAIN, 'buscador');

    const idBySlug = {}, svcIds = {};
    COMPANIES.forEach((c, i) => {
      const base = place(c.place || c.city);
      const lat = base.lat + Math.sin((i + 1) * 7.1) * 0.02, lng = base.lng + Math.cos((i + 1) * 3.7) * 0.02;
      const created = ago((c.approvedDays || 20) + 6);
      const cid = ins('companies', {
        owner_id: c.owner ? advertiserId : null, slug: uniqueSlug(c.slug), name: c.name, tagline: c.tagline, description: c.description, history: c.history || null,
        founded_year: c.founded, specialties: c.specialties, fabrics: c.fabrics,
        logo: `/img/demo/logo-${c.logo}.svg`, cover: c.noCover ? null : `/img/demo/cover-${c.cover}.svg`,
        phone: c.phone ? `55${c.ddd}3000${c.n}` : null, whatsapp: `55${c.ddd}90000${c.n}`,
        email: c.email ? `contato@${c.handle}.example` : null, website: c.site ? `https://www.${c.handle}.example` : null,
        instagram: c.ig && c.handle ? U.socialUrl('instagram', '@' + c.handle) : null, hours: c.hours, employees: c.employees, shifts: c.shifts, min_batch: c.min_batch, lead_time_days: c.lead,
        attends_small: c.size[0], attends_medium: c.size[1], attends_large: c.size[2],
        availability: c.avail || null, availability_updated_at: c.avail ? ago(c.availDays) : null, availability_note: c.availNote || null,
        status: c.status, featured: c.featured ? 1 : 0, featured_until: c.featuredUntil ? ahead(c.featuredUntil) : null, plan_id: c.featured ? destaque.id : gratuito.id,
        is_demo: 1, created_at: created, updated_at: ago(Math.max(1, (c.approvedDays || 6) - 3)), approved_at: c.status === 'aprovado' ? ago(c.approvedDays) : null,
      }).lastInsertRowid;
      idBySlug[c.slug] = cid;
      out.companies++;

      ins('company_addresses', { company_id: cid, cep: '00000-000', street: c.street, number: c.number, neighborhood: c.hood, city: c.city, state: c.state, lat, lng, geocoded: 1, privacy: c.privacy || 'exata' });
      c.cats.forEach((k) => ins('company_categories', { company_id: cid, category_id: catId[k] }));
      if (c.cap) ins('company_capacity', { company_id: cid, avg_monthly: c.cap.avg, max_monthly: c.cap.max, available_monthly: c.cap.free, per_day: c.cap.day, per_shift: c.cap.shift, production_staff: c.cap.staff, piece_types: c.cap.pieces, min_batch: c.cap.min, lead_time_days: c.cap.lead, notes: c.cap.notes, updated_at: c.avail ? ago(c.availDays) : created });
      c.machines.forEach((m, j) => { ins('machines', { company_id: cid, name: m.name, type: m.type, quantity: m.qty, brand: m.brand, model: m.model, operation: m.op, sector: m.sector, position: j }); out.machines++; });
      c.steps.forEach((s, j) => { ins('production_steps', { company_id: cid, step_key: s.key, name: s.name, description: s.desc, mode: s.mode, position: j }); out.steps++; });
      svcIds[c.slug] = [];
      c.services.forEach((s) => {
        const sid = ins('services', {
          company_id: cid, kind: s.kind, name: s.name, slug: uniqueSlug(s.name, 'services', null, cid), category_id: catId[s.cat] || null, description: s.desc, fabrics: s.fabrics || null, piece_types: s.pieces || null,
          min_batch: s.min || null, capacity_note: s.cap || null, lead_time_days: s.lead || null, price_min_cents: reais(s.pmin), price_max_cents: reais(s.pmax), price_unit: s.unit || null, conditions: s.cond || null,
          created_at: created, updated_at: ago(Math.max(1, (c.approvedDays || 6) - 2)),
        }).lastInsertRowid;
        svcIds[c.slug].push(sid); out.services++;
      });
      c.gallery.forEach((g, j) => { ins('media', { company_id: cid, kind: 'imagem', path: `/img/demo/gal-${g}.svg`, thumb: `/img/demo/gal-${g}.svg`, caption: `${['Linha de produção', 'Área de costura', 'Setor de corte', 'Estoque de materiais', 'Equipe em operação', 'Detalhe das máquinas'][j % 6]} (ilustração demonstrativa)`, position: j }); out.media++; });
      Object.entries(c.svcPhotos || {}).forEach(([idx, gs]) => gs.forEach((g, j) => { ins('media', { company_id: cid, service_id: svcIds[c.slug][+idx], kind: 'imagem', path: `/img/demo/gal-${g}.svg`, thumb: `/img/demo/gal-${g}.svg`, caption: 'Foto do serviço (ilustração demonstrativa)', position: j }); out.media++; }));
      setPublicCoords(cid);
      reindexCompany(cid);
    });

    // ----- Interações de exemplo -----
    const first = idBySlug['denim-serra-alta-confeccoes'], firstSvc = svcIds['denim-serra-alta-confeccoes'];
    [['Marcela Antunes', 'marcela@exemplo.example', '55479' + '00000011', 1200, 'Queremos produzir 1.200 calças jeans feminina em dois modelos para a coleção de verão. Podem informar prazo e valor da mão de obra? (solicitação de demonstração)', 'novo', firstSvc[0], 1],
      ['Rafael Prado', 'rafael@exemplo.example', null, 400, 'Procuro private label de jaquetas jeans, lote inicial de 400 peças. Vocês fazem a modelagem? (solicitação de demonstração)', 'novo', firstSvc[2], 4],
      ['Studio Bruma', 'contato@studiobruma.example', '55119' + '00000022', 300, 'Gostaríamos de orçar a lavagem de 300 bermudas já costuradas. (solicitação de demonstração)', 'respondido', firstSvc[3], 11]]
      .forEach(([name, email, phone, qty, message, status, sid, days]) => ins('quote_requests', { company_id: first, service_id: sid, name, email, phone, quantity: qty, message, consent_at: ago(days), status, created_at: ago(days) }));
    ins('favorites', { user_id: seekerId, company_id: first });
    ins('favorites', { user_id: seekerId, company_id: idBySlug['fit-malha-studio'] });
    ins('reports', { company_id: idBySlug['faccao-ponto-certo'], reason: 'informacao_incorreta', details: 'Denúncia de demonstração: o número de máquinas informado parece diferente do real.', created_at: ago(3) });
    [['denim-serra-alta-confeccoes', 'aprovado', 'Cadastro completo (demonstração)', 80], ['fit-malha-studio', 'aprovado', 'Perfil completo (demonstração)', 33], ['uniformes-norte-forte', 'destaque', 'Empresa destacada na página inicial (demonstração)', 19], ['maquinas-agulha-viva', 'enviado_para_analise', 'Aguardando análise (demonstração)', 2]]
      .forEach(([slug, action, note, d]) => ins('moderation_logs', { admin_id: action === 'enviado_para_analise' ? null : adminId, company_id: idBySlug[slug], action, note, created_at: ago(d) }));

    // ----- Eventos de uso sintéticos (30 dias, determinísticos) -----
    const stmt = db.prepare('INSERT INTO events(type,company_id,service_id,term,day,created_at) VALUES(?,?,?,?,?,?)');
    const approved = COMPANIES.filter((c) => c.status === 'aprovado');
    const weight = (c, i) => 0.6 + (c.featured ? 1.2 : 0) + ((i * 37) % 10) / 12;
    const stamp = (d) => { const hh = String(7 + Math.floor(rand() * 15)).padStart(2, '0'), mm = String(Math.floor(rand() * 60)).padStart(2, '0'); return `${ago(d).slice(0, 10)} ${hh}:${mm}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`; };
    const add = (type, cid, sid, term, d) => { const t = stamp(d); stmt.run(type, cid, sid, term, t.slice(0, 10), t); out.events++; };
    const termos = ['jeans', 'facção de costura', 'bordado', 'overloque', 'lavanderia', 'moda fitness', 'uniforme', 'estampa', 'private label', 'corte', 'camisa social', 'malha', 'legging', 'lingerie', 'zíper'];
    const firstSearchRow = db.prepare('SELECT COALESCE(MAX(id),0)+1 AS n FROM events').get().n;
    for (let d = 29; d >= 0; d--) {
      approved.forEach((c, i) => {
        const cid = idBySlug[c.slug], w = weight(c, i), trend = 0.7 + (29 - d) / 60; // leve tendência de alta
        const views = Math.round(rand() * 6 * w * trend);
        for (let k = 0; k < views; k++) {
          add('view_empresa', cid, null, null, d);
          if (rand() < 0.14) add('click_whatsapp', cid, null, null, d);
          if (rand() < 0.04) add('click_telefone', cid, null, null, d);
          if (rand() < 0.02) add('click_email', cid, null, null, d);
          if (rand() < 0.012) add('orcamento', cid, null, null, d);
        }
        (svcIds[c.slug] || []).forEach((sid) => { const n = Math.round(rand() * 2.2 * w * trend); for (let k = 0; k < n; k++) { add('view_anuncio', cid, sid, null, d); if (rand() < 0.08) add('click_whatsapp', cid, sid, null, d); } });
      });
      const buscas = Math.round(4 + rand() * 8);
      for (let k = 0; k < buscas; k++) add('busca', null, null, termos[Math.floor(rand() * termos.length)], d);
    }
    const lastRow = db.prepare('SELECT MAX(id) AS n FROM events').get().n;
    setSetting('demo_events_range', `${firstSearchRow}-${lastRow}`);
    db.prepare('UPDATE services SET views=(SELECT COUNT(*) FROM events e WHERE e.service_id=services.id AND e.type=\'view_anuncio\') WHERE company_id IN (SELECT id FROM companies WHERE is_demo=1)').run();
  });
  run();
  return out;
}

module.exports = { ensureBaseData, seedDemo, wipeDemo, DEMO_PASSWORD, DEMO_DOMAIN };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    await ensureBaseData();
    if (args.includes('--remove-demo')) {
      wipeDemo();
      console.log('Dados e contas de demonstração removidos. Empresas, contas e mensagens reais foram mantidas.');
    } else if (!args.includes('--no-demo')) {
      const r = await seedDemo({ reset: args.includes('--reset') });
      if (r.skipped) console.log('Dados de demonstração já existem (use --reset para recriar).');
      else console.log('Dados de demonstração criados:', r, `\nLogins (senha ${DEMO_PASSWORD}): admin${DEMO_DOMAIN}, anunciante${DEMO_DOMAIN}, buscador${DEMO_DOMAIN}`);
    }
    db.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
