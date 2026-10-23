# Pesponto — vitrine da cadeia produtiva da moda

Site em português (pt-BR) onde confecções, facções, lavanderias, estamparias, bordadarias, fornecedores de tecidos e aviamentos publicam uma página com **máquinas, capacidade, etapas do processo, serviços e localização**, e compradores encontram o parceiro certo. **Não há carrinho, checkout nem pagamento**: o contato acontece por WhatsApp (mensagem pré-preenchida), telefone, e-mail ou pedido de orçamento encaminhado à empresa.

Stack: Node 22 ou superior, Express 5, EJS, SQLite (better-sqlite3), sharp, Leaflet (mapa). Sem build de front-end e sem serviços externos obrigatórios.

## 1. Rodar localmente

```bash
npm install                # também copia fontes/Leaflet para public/ e gera a imagem de compartilhamento
cp .env.example .env       # opcional em desenvolvimento
npm run seed               # cria as 20 categorias, os planos "em breve" e dados de DEMONSTRAÇÃO
npm start                  # http://localhost:3000
```

Contas de demonstração (senha `Demo@1234`): `admin@pesponto.example`, `anunciante@pesponto.example`, `buscador@pesponto.example`.
Todas as empresas de exemplo são **fictícias** e aparecem marcadas como "Demonstração" (faixa no topo e selo nos cartões).

**Antes de publicar de verdade, remova a demonstração e crie seu administrador:**

```bash
npm run demo:remove                                   # apaga empresas, dados e contas de exemplo (mantém o que for real)
ADMIN_EMAIL=voce@empresa.com.br ADMIN_PASSWORD='uma-senha-forte-123' npm run create-admin
```

Para recomeçar a demonstração do zero: `npm run seed:reset`.

## 2. Testar

```bash
npm test
```

Os testes sobem o app com um banco temporário e percorrem, de ponta a ponta: cadastro de empresa → publicação (rascunho → análise → aprovação) → busca e filtros → perfil público → link de WhatsApp (e registro do clique) → pedido de orçamento → denúncia → suspensão/reativação → favoritos e comparação, além de CSRF, honeypot, isolamento entre anunciantes, privacidade de endereço, upload malicioso, exportação/exclusão de conta (LGPD) e regras do admin.

## 3. Publicar (produção)

Qualquer host que rode Node com **disco persistente** serve (VPS, Render, Railway, Fly.io…). Um processo único é suficiente: o SQLite fica em arquivo.

1. Defina as variáveis de ambiente (veja `.env.example`):
   - `NODE_ENV=production`
   - `SECRET` — obrigatório: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `BASE_URL=https://seudominio.com.br` (usado em canonical, sitemap, e-mails)
   - `TRUST_PROXY=1` se estiver atrás de proxy/HTTPS do provedor (necessário para cookies seguros e limite de requisições por IP corretos)
   - `DATA_DIR` (ou `DB_PATH` + `UPLOAD_DIR`) apontando para o **volume persistente**. Sem isso, banco e fotos somem a cada deploy.
   - `SMTP_*` para recuperação de senha e aviso de novos orçamentos. Sem SMTP o texto do e-mail só vai para o log.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` para criar o primeiro administrador no primeiro boot (ou use `npm run create-admin`).
2. `npm ci && npm start` (o `postinstall` prepara fontes e Leaflet).
3. Faça **backup** do `DATA_DIR` (banco `pesponto.db` + pasta `uploads/`). Com o servidor parado, basta copiar; com ele ligado, use `sqlite3 pesponto.db ".backup bkp.db"`.
4. Entre como administrador, abra **Admin → Banners e textos** e preencha razão social, CNPJ e e-mail do encarregado de dados: eles aparecem nos Termos de Uso e na Política de Privacidade. Os textos legais são um modelo; **peça revisão a um advogado** antes do lançamento.
5. Envie `https://seudominio.com.br/sitemap.xml` ao Google Search Console.

Mapa: usa blocos do OpenStreetMap e geocodificação Nominatim/ViaCEP, que têm limites de uso. Para alto volume configure `TILE_URL` e `NOMINATIM_URL` de um provedor próprio. Se a geocodificação externa falhar, há um dicionário interno de cidades como reserva.

## 4. O que tem

**Público (sem conta):** busca textual e filtros (categoria, tipo e quantidade de máquinas, capacidade, lote mínimo, etapas internas/terceirizadas, tecido, tipo de peça, porte, disponibilidade, estado, cidade, distância), ordenação, mapa interativo com agrupamento de marcadores, "perto de você" (a localização do navegador não é enviada nem guardada), página da empresa (galeria, máquinas por setor, capacidade em três números separados — histórica, máxima e disponível —, linha do tempo do processo, serviços e produtos, endereço conforme privacidade, orçamento), página de cada anúncio, comparação de 2 a 4 empresas, páginas por categoria, sitemap, robots, dados estruturados (JSON-LD).

**Conta de comprador:** favoritos, pedidos de orçamento ligados à conta, exportar e excluir os próprios dados.

**Painel do anunciante:** dados da empresa e privacidade do endereço (exato, aproximado ou só cidade), capacidade, máquinas, etapas (reordenar, interna/terceirizada/não oferece), serviços e produtos com fotos, galeria e vídeos (upload ou YouTube/Vimeo), disponibilidade com data de atualização, checklist de completude, orçamentos recebidos e estatísticas (visitas, cliques no WhatsApp, anúncios mais vistos).

**Administração:** visão geral e buscas mais feitas, análise de empresas (aprovar, rejeitar e suspender com motivo e e-mail ao dono), denúncias, usuários e perfis, categorias (criar, editar, ordenar, ativar; bloqueia exclusão se em uso), moderação de fotos e vídeos, registro de moderação, destaques com prazo, planos, banners e textos do site, mensagens de contato.

**Segurança e privacidade:** senhas com scrypt, sessões com cookie httpOnly (token guardado só como hash), CSRF, honeypot e tempo mínimo de preenchimento, limite de requisições, cabeçalhos e CSP, imagens recodificadas com remoção de EXIF/GPS, estatísticas sem IP, só cookies essenciais, consentimento registrado no cadastro e no envio de orçamento.

## 5. Escolhas de produto

- **Sem avaliações inventadas, sem selos ou certificações pré-preenchidos.** O que a empresa não informa aparece como "não informado". Textos na página avisam que dados são declarados pelo anunciante.
- **Capacidade** é mostrada em três números distintos para evitar promessas irreais; a disponibilidade tem data e é sinalizada como "desatualizada" após 60 dias.
- **Planos pagos estão preparados e desligados** (tabela de planos, peso na busca, destaque com prazo; `BILLING_ENABLED=0`). Não existe integração de pagamento no código; os planos aparecem como "em breve".
- Quem cadastra empresa começa em **rascunho** e só vai ao ar depois de enviar e ser **aprovado** por um administrador.

## 6. Estrutura

```
server.js          app Express, segurança, locals das views
src/               config, db + schema.sql, auth, domain (busca/completude), geo, storage, seed, catálogo
src/routes/        public, api, auth, painel (anunciante), admin
views/             EJS (partials, painel/, admin/, auth/)
public/            css, js, fontes, vendor (Leaflet), ilustrações de demonstração
scripts/           create-admin, copy-vendor, make-og, make-illustrations
tests/             testes de fluxo ponta a ponta (node:test)
```
