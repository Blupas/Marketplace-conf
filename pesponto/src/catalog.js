'use strict';
// Taxonomias iniciais. Categorias e planos ficam no banco e podem ser editados pelo administrador;
// máquinas e etapas abaixo são apenas SUGESTÕES — o anunciante pode cadastrar itens personalizados.

const CATEGORIES = [
  ['confeccoes-completas', 'Confecções completas', 'empresa', 'camisa', 'Produção completa, do corte à expedição.'],
  ['faccoes-de-costura', 'Facções de costura', 'empresa', 'agulha', 'Serviço de costura para marcas e confecções.'],
  ['fabricas-de-jeans', 'Fábricas de jeans', 'segmento', 'calca', 'Jeans e sarja: corte, costura e beneficiamento.'],
  ['oficinas-de-costura', 'Oficinas de costura', 'empresa', 'agulha', 'Oficinas para pequenos lotes e ajustes.'],
  ['lavanderias-industriais', 'Lavanderias industriais', 'servico', 'gota', 'Lavagem, stone, destroyer e beneficiamento.'],
  ['corte-e-preparacao', 'Corte e preparação', 'servico', 'tesoura', 'Enfesto, encaixe e corte de tecidos.'],
  ['modelagem-e-desenvolvimento', 'Modelagem e desenvolvimento', 'servico', 'regua', 'Moldes, graduação e peça piloto.'],
  ['bordado-industrial', 'Bordado industrial', 'servico', 'carretel', 'Bordado computadorizado em grandes e pequenos lotes.'],
  ['estamparia', 'Estamparia', 'servico', 'estrela', 'Silk, sublimação, digital e localizada.'],
  ['tingimento-e-beneficiamento', 'Tingimento e beneficiamento', 'servico', 'gota', 'Tingimento de peças e tecidos.'],
  ['acabamento-e-revisao', 'Acabamento e revisão', 'servico', 'check', 'Arremate, revisão de qualidade e passadoria.'],
  ['private-label', 'Private label', 'servico', 'estrela', 'Produção com a sua marca, do desenvolvimento ao pronto.'],
  ['uniformes-profissionais', 'Uniformes profissionais', 'segmento', 'camisa', 'Uniformes corporativos, escolares e industriais.'],
  ['moda-fitness', 'Moda fitness', 'segmento', 'camisa', 'Malhas técnicas, legging, top e conjuntos.'],
  ['moda-intima', 'Moda íntima', 'segmento', 'camisa', 'Lingerie, pijamas e meias.'],
  ['camisaria', 'Camisaria', 'segmento', 'camisa', 'Camisas sociais e casuais.'],
  ['fornecedores-de-tecidos', 'Fornecedores de tecidos', 'empresa', 'tecido', 'Malhas, planos, jeans e tecidos técnicos.'],
  ['fornecedores-de-aviamentos', 'Fornecedores de aviamentos', 'empresa', 'carretel', 'Zíperes, botões, linhas, etiquetas e mais.'],
  ['maquinas-e-equipamentos', 'Máquinas e equipamentos', 'empresa', 'engrenagem', 'Venda, locação e manutenção de máquinas.'],
  ['servicos-especializados', 'Serviços especializados', 'servico', 'estrela', 'Serviços técnicos específicos da cadeia têxtil.'],
];

// [chave, nome, setor, operação típica]
const MACHINE_TYPES = [
  ['reta-industrial', 'Máquina reta industrial', 'Costura', 'Costura reta e pesponto'],
  ['overloque', 'Overloque', 'Costura', 'Chuleio e fechamento de malhas'],
  ['interloque', 'Interloque', 'Costura', 'Costura de malhas com cobertura'],
  ['galoneira', 'Galoneira', 'Costura', 'Bainhas e acabamentos em malha'],
  ['maquina-de-cos', 'Máquina de cós', 'Costura', 'Aplicação de cós e passantes'],
  ['caseadeira', 'Caseadeira', 'Aviamentos', 'Execução de casas de botão'],
  ['botoneira', 'Botoneira', 'Aviamentos', 'Pregação de botões'],
  ['travete', 'Travete', 'Reforços', 'Reforços e fixações'],
  ['maquina-de-braco', 'Máquina de braço', 'Costura', 'Costura tubular (barras, punhos, cavas)'],
  ['maquina-de-corte', 'Máquina de corte', 'Corte', 'Corte de tecidos em enfesto'],
  ['mesa-de-corte-automatica', 'Mesa de corte automática (CAD/CAM)', 'Corte', 'Corte computadorizado'],
  ['bordadeira', 'Máquina de bordado', 'Bordado', 'Bordado computadorizado'],
  ['estampa-silk', 'Equipamento de estamparia (silk)', 'Estamparia', 'Estampa serigráfica'],
  ['estampa-digital', 'Impressora digital / sublimação', 'Estamparia', 'Estampa digital e sublimação'],
  ['lavadora-industrial', 'Lavadora industrial', 'Lavanderia', 'Lavagem e beneficiamento'],
  ['secadora-industrial', 'Secadora industrial', 'Lavanderia', 'Secagem de peças'],
  ['ferro-caldeira', 'Ferro a vapor com caldeira', 'Acabamento', 'Passadoria'],
  ['prensa-termica', 'Prensa térmica', 'Acabamento', 'Aplicação de termocolantes e transfers'],
];

const STEP_DEFAULTS = [
  ['modelagem', 'Desenvolvimento e modelagem', 'Criação da modelagem a partir da ficha técnica ou referência.'],
  ['moldes', 'Criação e graduação de moldes', 'Moldes piloto e graduação de tamanhos.'],
  ['encaixe', 'Encaixe e planejamento do corte', 'Planejamento do aproveitamento de tecido.'],
  ['corte', 'Corte do tecido', 'Enfesto e corte manual ou automatizado.'],
  ['separacao', 'Separação e preparação dos componentes', 'Kits de peças e aviamentos organizados por lote.'],
  ['costura', 'Costura e montagem', 'Montagem das peças nas linhas de costura.'],
  ['aviamentos', 'Aplicação de bolsos, zíperes, botões e aviamentos', 'Fixação de bolsos, zíperes, botões, rebites e etiquetas.'],
  ['lavanderia', 'Lavanderia e beneficiamento', 'Lavagens, efeitos e tingimento, quando aplicável.'],
  ['acabamento', 'Acabamento', 'Arremate, limpeza de fios e conferência de medidas.'],
  ['revisao', 'Revisão de qualidade', 'Inspeção peça a peça.'],
  ['passadoria', 'Passadoria', 'Passadoria a vapor e dobra.'],
  ['expedicao', 'Embalagem e expedição', 'Embalagem, etiquetagem e envio.'],
];

const PIECE_SUGGESTIONS = ['Calça jeans', 'Jaqueta jeans', 'Bermuda', 'Camiseta', 'Camisa social', 'Vestido', 'Saia', 'Legging', 'Top fitness', 'Conjunto fitness',
  'Uniforme', 'Jaleco', 'Macacão', 'Cueca', 'Calcinha', 'Sutiã', 'Pijama', 'Moletom', 'Blusa', 'Short'];
const FABRIC_SUGGESTIONS = ['Jeans', 'Sarja', 'Malha', 'Moletom', 'Algodão', 'Viscose', 'Poliéster', 'Poliamida', 'Cotton', 'Linho', 'Tricoline', 'Helanca', 'Suplex', 'Brim', 'Oxford'];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const MODE_LABEL = { interna: 'Realizamos internamente', terceirizada: 'Terceirizamos', nao_oferece: 'Não oferecemos' };
const AVAIL_LABEL = { disponivel: 'Aceitando novos pedidos', limitada: 'Agenda limitada', indisponivel: 'Sem capacidade no momento' };
const STATUS_LABEL = { rascunho: 'Rascunho', pendente: 'Em análise', aprovado: 'Publicado', rejeitado: 'Rejeitado', suspenso: 'Suspenso' };
const SIZE_LABEL = { pequena: 'Pequenas produções', media: 'Médias produções', grande: 'Grandes produções' };

const PLANS = [
  ['gratuito', 'Gratuito', 0, 'Perfil comercial completo, sem custo.', ['Página própria com mapa, máquinas e processo', 'Anúncios de produtos e serviços', 'Estatísticas básicas', 'Contato direto por WhatsApp'], 0, 1],
  ['destaque', 'Destaque', 0, 'Mais exposição para a sua empresa.', ['Tudo do plano gratuito', 'Destaque na página inicial', 'Prioridade nos resultados de busca'], 20, 0],
  ['profissional', 'Profissional', 0, 'Página personalizada e estatísticas avançadas.', ['Tudo do plano Destaque', 'Página comercial personalizada', 'Estatísticas avançadas e exportação'], 30, 0],
];

module.exports = { CATEGORIES, MACHINE_TYPES, STEP_DEFAULTS, PIECE_SUGGESTIONS, FABRIC_SUGGESTIONS, UFS, MODE_LABEL, AVAIL_LABEL, STATUS_LABEL, SIZE_LABEL, PLANS };
