// Leitura da nota por IA (ChatGPT ou Gemini, ver leitura/gemini.js), para quando NAO existe o XML:
// foto tirada no celular, DANFE em PDF, print, etc.
//
// Importante: o XML sempre vem primeiro. A IA so entra quando nao tem XML,
// porque leitura de imagem sempre tem chance de erro e por isso tudo o que
// vem daqui passa pela tela de conferencia antes de gravar.

import { carregarConfig } from '../config.js';
import { chamarGemini, textoDaResposta, configEconomica } from './gemini.js';
import { provedorDaIA, listarModelosOpenAI, MODELO_PRINCIPAL_OPENAI } from './openai.js';

const ENDERECO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Formato que pedimos de volta. Deixar o formato travado reduz muito o erro.
const FORMATO_RESPOSTA = {
  type: 'object',
  properties: {
    numeroNota: { type: 'string' },
    serie: { type: 'string' },
    chaveAcesso: { type: 'string' },
    dataEmissao: { type: 'string' },
    fornecedorNome: { type: 'string' },
    fornecedorCnpj: { type: 'string' },
    totalNota: { type: 'number' },
    totalProdutos: { type: 'number' },
    totalFrete: { type: 'number' },
    totalIPI: { type: 'number' },
    totalICMSST: { type: 'number' },
    observacoesDaNota: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          descricao: { type: 'string' },
          codigoBarras: { type: 'string' },
          codigoFornecedor: { type: 'string' },
          ncm: { type: 'string' },
          unidade: { type: 'string' },
          quantidade: { type: 'number' },
          valorUnitario: { type: 'number' },
          valorTotal: { type: 'number' },
          desconto: { type: 'number' },
          valorIPI: { type: 'number' },
          valorICMSST: { type: 'number' },
          ehCaixa: { type: 'boolean' },
          unidadesPorCaixa: { type: 'integer' },
          confianca: { type: 'string' },
          observacao: { type: 'string' },
        },
        required: ['descricao', 'quantidade', 'valorUnitario'],
      },
    },
  },
  required: ['itens'],
};

function montarInstrucoes(observacaoDoUsuario) {
  const base = `Voce esta lendo uma NOTA FISCAL DE ENTRADA (compra de mercadoria) de uma loja no Brasil.
Extraia os dados EXATAMENTE como estao no documento. Nao invente nada.

REGRAS IMPORTANTES:

1) QUANTIDADE E UNIDADE - este e o ponto mais critico.
   Se o item estiver em CAIXA, FARDO, PACOTE, DISPLAY (unidades CX, FD, PCT, DP, CJ):
   - marque ehCaixa = true
   - em "quantidade" coloque a quantidade COMO ESTA NA NOTA (ex.: 2 caixas = 2)
   - em "valorUnitario" coloque o valor POR CAIXA, como esta na nota
   - em "unidadesPorCaixa" coloque quantas unidades vem dentro, SE o documento disser
     (procure na descricao coisas como "C/12", "CX C/ 24", "12X500ML", "FD 6").
     Se o documento NAO disser, coloque 0. NAO CHUTE.
   Se o item ja estiver em unidade (UN, PC, KG, LT), ehCaixa = false e unidadesPorCaixa = 0.

2) VALORES: use ponto como separador decimal (ex.: 12.50). Nunca use virgula.
   Se um valor nao existir na nota, coloque 0.

3) CODIGO DE BARRAS: so preencha se estiver escrito no documento (EAN de 8, 12, 13 ou 14
   digitos). Se nao houver, deixe vazio. Nao confunda com o codigo interno do fornecedor,
   que vai em "codigoFornecedor".

4) CONFIANCA: em cada item, coloque "alta" se leu com clareza, "media" se teve alguma
   duvida, "baixa" se o documento estava borrado/cortado naquele item. Se ficou em duvida,
   explique em "observacao" o que estava dificil de ler.

5) Se a foto estiver cortada e faltar itens, diga isso em "observacoesDaNota".`;

  if (!observacaoDoUsuario || !observacaoDoUsuario.trim()) return base;

  return `${base}

OBSERVACAO DE QUEM ENVIOU A NOTA (leve isso em conta na leitura):
"""
${observacaoDoUsuario.trim()}
"""`;
}

/**
 * Manda o arquivo para a IA e devolve a nota estruturada.
 * `arquivos` e uma lista de { base64, tipo } - da para mandar varias fotos
 * da mesma nota (frente/verso, ou nota que ocupa mais de uma pagina).
 */
export async function lerDocumentoComIA(arquivos, observacao = '') {
  const partes = [{ text: montarInstrucoes(observacao) }];
  for (const arquivo of arquivos) {
    partes.push({ inline_data: { mime_type: arquivo.tipo, data: arquivo.base64 } });
  }

  // chamarGemini ja tenta de novo sozinho e troca de modelo se a IA estiver cheia
  const dados = await chamarGemini({
    contents: [{ parts: partes }],
    // leitura de documento nao pode ser criativa nem precisa 'pensar' antes
    generationConfig: configEconomica({
      maximoDeResposta: 8192,      // nota grande tem muito item
      responseMimeType: 'application/json',
      responseSchema: FORMATO_RESPOSTA,
    }),
  });
  const modelo = dados.modeloUsado;
  const texto = textoDaResposta(dados);
  if (!texto.trim()) {
    const motivo = dados?.candidates?.[0]?.finishReason || 'sem resposta';
    throw new Error(`A IA nao conseguiu ler o documento (${motivo}). Tente uma foto mais nitida.`);
  }

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new Error('A IA respondeu num formato inesperado. Tente novamente.');
  }

  return converterParaNota(bruto, modelo);
}

async function traduzErroDaIA(resposta) {
  let detalhe = '';
  try {
    const corpo = await resposta.json();
    detalhe = corpo?.error?.message || '';
  } catch { /* resposta sem corpo JSON */ }

  if (resposta.status === 400 && /API key/i.test(detalhe)) {
    return 'A chave da IA parece invalida. Confira na tela de Configuracao.';
  }
  if (resposta.status === 429) {
    return 'A IA atingiu o limite de uso do plano gratuito agora ha pouco. Espere um minuto e tente de novo.';
  }
  if (resposta.status === 503) {
    return 'O servico da IA esta sobrecarregado no momento. Tente novamente em instantes.';
  }
  return `A IA nao respondeu (erro ${resposta.status}). ${detalhe}`.trim();
}

/** Coloca a resposta da IA no mesmo formato que sai do XML. */
function converterParaNota(bruto, modelo) {
  const itens = (bruto.itens || []).map((item, indice) => {
    const quantidade = Number(item.quantidade) || 0;
    const valorUnitario = Number(item.valorUnitario) || 0;
    const porCaixa = Number(item.unidadesPorCaixa) || 0;
    const ehCaixa = Boolean(item.ehCaixa);

    // mesma conversao que o XML faz: transformar caixa em unidade
    const converteu = ehCaixa && porCaixa > 1;
    const quantidadeUnidades = converteu ? quantidade * porCaixa : quantidade;
    const custoUnitario = converteu ? valorUnitario / porCaixa : valorUnitario;

    let explicacao = '';
    let confianca = item.confianca || 'media';
    if (ehCaixa && porCaixa > 1) {
      explicacao = `A nota veio em ${item.unidade || 'caixa'} e o documento indica ${porCaixa} unidades por caixa. Confira.`;
      confianca = 'media';
    } else if (ehCaixa) {
      explicacao = `A nota veio em ${item.unidade || 'caixa'} mas nao da para saber quantas unidades tem dentro. Informe a quantidade.`;
      confianca = 'baixa';
    }

    return {
      numero: Number(item.numero) || indice + 1,
      descricao: String(item.descricao || '').trim(),
      codigoFornecedor: String(item.codigoFornecedor || '').trim(),
      codigoBarras: String(item.codigoBarras || '').replace(/\D/g, ''),
      ncm: String(item.ncm || '').replace(/\D/g, ''),
      cest: '',
      cfop: '',

      unidadeComercial: String(item.unidade || '').trim(),
      quantidadeComercial: quantidade,
      valorUnitarioComercial: valorUnitario,
      unidadeTributavel: '',
      quantidadeTributavel: 0,
      valorUnitarioTributavel: 0,
      valorProduto: Number(item.valorTotal) || quantidade * valorUnitario,
      desconto: Number(item.desconto) || 0,
      frete: 0,
      seguro: 0,
      outrasDespesas: 0,

      valorIPI: Number(item.valorIPI) || 0,
      valorICMS: 0,
      aliquotaICMS: 0,
      valorICMSST: Number(item.valorICMSST) || 0,
      valorFCPST: 0,
      cst: '',

      quantidadeUnidades,
      custoUnitario,
      unidadesPorCaixa: porCaixa,
      unidadeOriginal: String(item.unidade || 'UN').trim(),
      convertido: converteu,
      confianca,
      explicacao,
      observacaoIA: String(item.observacao || '').trim(),
    };
  });

  return {
    origem: 'ia',
    modeloUsado: modelo,
    chave: String(bruto.chaveAcesso || '').replace(/\D/g, ''),
    numero: String(bruto.numeroNota || '').trim(),
    serie: String(bruto.serie || '').trim(),
    emissao: String(bruto.dataEmissao || '').trim(),
    fornecedor: {
      cnpj: String(bruto.fornecedorCnpj || '').replace(/\D/g, ''),
      nome: String(bruto.fornecedorNome || '').trim(),
      fantasia: '',
      uf: '',
    },
    destinatario: { cnpj: '', nome: '' },
    totais: {
      produtos: Number(bruto.totalProdutos) || 0,
      nota: Number(bruto.totalNota) || 0,
      frete: Number(bruto.totalFrete) || 0,
      seguro: 0,
      outras: 0,
      desconto: 0,
      ipi: Number(bruto.totalIPI) || 0,
      icmsST: Number(bruto.totalICMSST) || 0,
      fcpST: 0,
    },
    observacoesDaNota: String(bruto.observacoesDaNota || '').trim(),
    itens,
  };
}

/** Lista os modelos disponiveis para a chave configurada (usado na tela de config). */
export async function listarModelos() {
  const cfg = carregarConfig();
  const chave = cfg.ia?.chave?.trim();
  if (!chave) throw new Error('Configure a chave da IA primeiro.');
  if (provedorDaIA(cfg) === 'openai') return listarModelosOpenAI();

  const resposta = await fetch(`${ENDERECO_BASE}/models`, {
    headers: { 'x-goog-api-key': chave },
  });
  if (!resposta.ok) throw new Error(await traduzErroDaIA(resposta));

  const dados = await resposta.json();
  return (dados.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace('models/', ''))
    .filter((nome) => nome.startsWith('gemini'));
}

/** Testa se a chave funciona, sem gastar leitura de documento. */
export async function testarChave() {
  const modelos = await listarModelos();
  const provedor = provedorDaIA();
  if (provedor === 'openai' && !modelos.includes(MODELO_PRINCIPAL_OPENAI)) {
    throw new Error(`A chave funciona, mas a conta não tem o modelo ${MODELO_PRINCIPAL_OPENAI}.`);
  }
  return {
    ok: true,
    provedor,
    nomeDaIA: provedor === 'openai' ? 'ChatGPT (OpenAI)' : 'Gemini (Google)',
    modelosDisponiveis: modelos.length,
    exemplos: modelos.slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Leitura de LISTA DE COMPRAS do cliente (para montar orcamento)
// ---------------------------------------------------------------------------

const FORMATO_LISTA = {
  type: 'object',
  properties: {
    clienteCitado: { type: 'string' },
    observacoes: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          textoOriginal: { type: 'string' },
          descricao: { type: 'string' },
          quantidade: { type: 'number' },
          unidade: { type: 'string' },
          marca: { type: 'string' },
          tamanho: { type: 'string' },
          observacao: { type: 'string' },
          confianca: { type: 'string' },
        },
        required: ['descricao', 'quantidade'],
      },
    },
  },
  required: ['itens'],
};

const INSTRUCOES_LISTA = `Voce esta lendo um PEDIDO DE CLIENTE de uma loja no Brasil.
Pode ser uma lista escrita a mao, um print de conversa de WhatsApp, uma foto de papel,
uma planilha ou um texto digitado.

Sua tarefa e transformar isso numa lista de itens. REGRAS:

1) Copie em "textoOriginal" exatamente como o item aparece escrito, sem corrigir nada.
   Em "descricao" coloque a sua melhor leitura do que o cliente quer, ja em letras
   normais (ex.: "copo d agua" -> "copo de agua").

2) QUANTIDADE: se nao estiver escrita, coloque 1 e avise em "observacao" que a
   quantidade nao estava na lista. Nunca invente quantidade.

3) NAO TENTE ADIVINHAR o produto exato do catalogo da loja. Isso quem faz e o sistema.
   Separe o que voce conseguir: "marca" (ex.: Ype, Bombril), "tamanho" (ex.: 5L, 500ml,
   tamanho M) e "unidade" (ex.: caixa, pacote, duzia, kg) em campos separados.

4) CONFIANCA por item: "alta" se esta claro, "media" se a letra esta ruim mas da para
   entender, "baixa" se voce nao tem certeza do que esta escrito. Quando for baixa,
   escreva em "observacao" o que voce acha que pode ser.

5) Se aparecer o nome do cliente ou da empresa no documento, coloque em "clienteCitado".

6) Nao invente itens. Se algo estiver ilegivel, coloque em "observacoes" em vez de
   inventar uma linha.`;

/**
 * Le a lista de compras do cliente (foto, PDF ou texto digitado).
 * Devolve os itens "crus" - quem procura no estoque e o modulo de orcamento.
 */
export async function lerListaDeCompras(arquivos = [], textoDigitado = '', observacao = '') {
  let instrucoes = INSTRUCOES_LISTA;
  if (observacao?.trim()) {
    instrucoes += `\n\nOBSERVACAO DE QUEM ENVIOU:\n"""\n${observacao.trim()}\n"""`;
  }
  if (textoDigitado?.trim()) {
    instrucoes += `\n\nLISTA DIGITADA:\n"""\n${textoDigitado.trim()}\n"""`;
  }

  const partes = [{ text: instrucoes }];
  for (const arquivo of arquivos) {
    partes.push({ inline_data: { mime_type: arquivo.tipo, data: arquivo.base64 } });
  }

  const dados = await chamarGemini({
    contents: [{ parts: partes }],
    generationConfig: configEconomica({
      maximoDeResposta: 4096,
      responseMimeType: 'application/json',
      responseSchema: FORMATO_LISTA,
    }),
  });
  const texto = textoDaResposta(dados);
  if (!texto.trim()) {
    throw new Error('A IA nao conseguiu ler a lista. Tente uma foto mais nitida.');
  }

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new Error('A IA respondeu num formato inesperado. Tente novamente.');
  }

  return {
    clienteCitado: String(bruto.clienteCitado || '').trim(),
    observacoes: String(bruto.observacoes || '').trim(),
    itens: (bruto.itens || []).map((item, indice) => ({
      numero: indice + 1,
      textoOriginal: String(item.textoOriginal || item.descricao || '').trim(),
      descricao: String(item.descricao || '').trim(),
      quantidade: Number(item.quantidade) > 0 ? Number(item.quantidade) : 1,
      unidade: String(item.unidade || '').trim(),
      marca: String(item.marca || '').trim(),
      tamanho: String(item.tamanho || '').trim(),
      observacao: String(item.observacao || '').trim(),
      confianca: String(item.confianca || 'media').trim(),
    })),
  };
}

// ---------------------------------------------------------------------------
// A observacao do operador vira AJUSTE DE CALCULO
// ---------------------------------------------------------------------------
//
// Divisao de trabalho, de proposito:
//   - a IA ENTENDE o que foi escrito ("tem 50 reais a mais de taxa nessa nota");
//   - o SISTEMA faz a conta (rateia os 50 reais entre os itens, na proporcao).
// A IA nunca devolve um custo pronto: ela devolve o que entendeu, e a conta sai
// sempre igual. E a tela mostra o que ela entendeu, para a pessoa conferir antes.

const FORMATO_AJUSTE = {
  type: 'object',
  properties: {
    entendi: { type: 'string' },
    acrescimoNaNota: { type: 'number' },
    descontoNaNota: { type: 'number' },
    percentualNaNota: { type: 'number' },
    nomeDoPercentual: { type: 'string' },
    porItem: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          descricao: { type: 'string' },
          unidadesPorCaixa: { type: 'integer' },
          acrescimo: { type: 'number' },
          desconto: { type: 'number' },
          percentual: { type: 'number' },
          motivo: { type: 'string' },
        },
      },
    },
    naoEntendi: { type: 'string' },
  },
  required: ['entendi'],
};

/**
 * Le a observacao escrita pelo operador e devolve AJUSTES estruturados.
 * Nada de valor final: so o que a IA entendeu, para o sistema calcular.
 */
export async function interpretarObservacao(observacao, nota) {
  const texto = String(observacao || '').trim();
  if (!texto) return null;

  const itens = (nota.itens || []).slice(0, 60).map((i) => ({
    numero: i.numero,
    descricao: i.descricao,
    unidade: i.unidadeComercial,
    quantidade: i.quantidadeUnidades,
    valorTotal: i.valorProduto,
  }));

  const instrucoes = `Uma pessoa da loja escreveu uma observacao sobre esta nota de compra.
Sua tarefa e so ENTENDER o que ela quis dizer e devolver de forma organizada.
NAO calcule custo, NAO calcule preco, NAO invente valor.

O que voce pode devolver:
- acrescimoNaNota: valor em reais que deve ser somado ao custo da nota inteira
  (taxa, imposto a mais, despesa que nao veio na nota). O sistema rateia sozinho.
- descontoNaNota: valor em reais a diminuir da nota inteira.
- percentualNaNota: quando a pessoa falar em PORCENTAGEM que vale para todos os
  itens (ex.: "calcular DIFAL de 6%", "diferencial de aliquota 6%", "mais 4% de
  imposto", "veio de outro estado, soma 6%"). Devolva SO o numero (6), nunca o valor
  em reais - o sistema aplica em cada produto.
- nomeDoPercentual: o nome do que a porcentagem e ("DIFAL", "imposto", "taxa").
- porItem: ajustes de um item especifico. Use o "numero" do item da lista abaixo.
    unidadesPorCaixa -> quando a pessoa disser quantas unidades vem na caixa
    acrescimo/desconto -> valor em reais so daquele item
    percentual -> porcentagem so daquele item (o numero, ex.: 6)
- entendi: uma frase curta, em portugues simples, dizendo o que voce entendeu.
- naoEntendi: se parte do texto nao virou ajuste nenhum, escreva aqui.

Se a observacao nao falar de valor nem de quantidade (ex.: "conferir validade"),
devolva os valores em 0 e explique em "entendi" que era so um recado.

ITENS DESTA NOTA:
${JSON.stringify(itens)}

OBSERVACAO ESCRITA:
"""
${texto}
"""`;

  // "DIFAL 6%" e tao comum que nem precisa de IA: o codigo le sozinho.
  // Serve tambem de rede de seguranca quando a IA falha ou bate o limite do dia -
  // foi assim que a observacao do DIFAL passou batida e a nota entrou sem ele.
  const porcentagemLida = percentualEscrito(texto);

  let bruto = null;
  try {
    const dados = await chamarGemini({
      contents: [{ parts: [{ text: instrucoes }] }],
      generationConfig: configEconomica({
        maximoDeResposta: 1024,
        responseMimeType: 'application/json',
        responseSchema: FORMATO_AJUSTE,
      }),
    // o modelo principal, nao o economico: entender "DIFAL de 6% so nos itens
    // de fora" errado vira custo errado no cadastro inteiro. Texto curto custa pouco.
    });
    const resposta = textoDaResposta(dados);
    bruto = resposta ? JSON.parse(resposta) : null;
  } catch (erro) {
    if (!porcentagemLida) throw erro;
    bruto = null;               // sem IA, mas o percentual o codigo ja leu
  }
  if (!bruto && !porcentagemLida) return null;
  bruto = bruto || {};

  const valido = (p) => (Number(p) > 0 && Number(p) <= 100 ? Number(p) : 0);

  const porItem = (bruto.porItem || [])
    .map((a) => ({
      numero: Number(a.numero) || 0,
      descricao: String(a.descricao || '').trim(),
      unidadesPorCaixa: Number(a.unidadesPorCaixa) || 0,
      acrescimo: Number(a.acrescimo) || 0,
      desconto: Number(a.desconto) || 0,
      percentual: valido(a.percentual),
      motivo: String(a.motivo || '').trim(),
    }))
    .filter((a) => a.numero > 0
      && (a.unidadesPorCaixa > 0 || a.acrescimo || a.desconto || a.percentual));

  const acrescimoNaNota = Number(bruto.acrescimoNaNota) || 0;
  const descontoNaNota = Number(bruto.descontoNaNota) || 0;

  // o percentual da nota inteira: o que a IA entendeu ou, se ela nao pegou, o que o codigo leu
  let percentualNaNota = valido(bruto.percentualNaNota);
  let nomeDoPercentual = String(bruto.nomeDoPercentual || '').trim();
  const ninguemNoItem = !porItem.some((a) => a.percentual);
  if (!percentualNaNota && porcentagemLida && ninguemNoItem) {
    percentualNaNota = porcentagemLida.percentual;
    nomeDoPercentual = porcentagemLida.nome;
  }
  if (percentualNaNota && !nomeDoPercentual) nomeDoPercentual = porcentagemLida?.nome || 'acréscimo';

  let entendi = String(bruto.entendi || '').trim();
  if (!entendi && percentualNaNota) {
    entendi = `${nomeDoPercentual} de ${String(percentualNaNota).replace('.', ',')}% em cima de cada produto.`;
  }

  return {
    entendi,
    naoEntendi: String(bruto.naoEntendi || '').trim(),
    acrescimoNaNota,
    descontoNaNota,
    percentualNaNota,
    nomeDoPercentual,
    porItem,
    temAjuste: Boolean(acrescimoNaNota || descontoNaNota || percentualNaNota || porItem.length),
  };
}

/**
 * Le "DIFAL 6%", "diferencial de aliquota de 6 %", "soma 4,5% de imposto".
 * So aceita quando ha UMA porcentagem e o texto fala de acrescimo/imposto -
 * "desconto de 5%" ou duas porcentagens diferentes ficam para a IA entender.
 */
export function percentualEscrito(texto) {
  const minusculo = String(texto || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const achados = [...minusculo.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|por\s*cento)/g)]
    .map((m) => Number(m[1].replace(',', '.')));
  const diferentes = [...new Set(achados)];
  if (diferentes.length !== 1) return null;

  const percentual = diferentes[0];
  if (!(percentual > 0 && percentual <= 100)) return null;
  if (/desconto|abatimento|diminui|tirar|menos/.test(minusculo)) return null;

  if (/difal|diferencial/.test(minusculo)) return { percentual, nome: 'DIFAL' };
  if (/outro estado|interestadual|fora do estado/.test(minusculo)) return { percentual, nome: 'DIFAL' };
  if (/icms/.test(minusculo)) return { percentual, nome: 'ICMS' };
  if (/imposto|aliquota|tributo/.test(minusculo)) return { percentual, nome: 'imposto' };
  if (/acrescimo|acrescentar|somar|soma|mais|adicional|adicionar|taxa|calcular/.test(minusculo)) {
    return { percentual, nome: 'acréscimo' };
  }
  return null;
}
