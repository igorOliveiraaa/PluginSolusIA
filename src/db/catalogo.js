// Indice do catalogo em memoria - o cerebro da busca de produto.
//
// Por que existe: a busca antiga era feita com LIKE no banco e "FIRST 8" sem
// nenhuma ordem. Resultado pratico: quem procurava "agua sanitaria 5l" recebia os
// oito primeiros da ordem fisica da tabela (quase todos CANCELADOS de anos atras)
// e a AGUA SANITARIA RENDE MAIS 5LT, que e a que a loja vende toda semana, nem
// aparecia. Fora isso, o LIKE nao ignorava acento nem cedilha, entao "SANITARIA"
// nunca achava "SANITARIA" escrito com acento.
//
// Aqui o catalogo inteiro (12 mil produtos, 70ms) fica na memoria, ja convertido
// para um texto "canonico" sem acento, sem cedilha e com as medidas padronizadas
// ("5LT", "5 L" e "5 LITROS" viram todos "5L"). A busca compara palavra a palavra,
// aceita erro de digitacao, e a nota final leva em conta o que a loja MAIS VENDEU
// e o que saiu POR ULTIMO - que e como a pessoa do balcao pensa.
//
// O indice guarda so o que serve para procurar. Preco e estoque sao lidos frescos
// do banco depois, para nunca mostrar valor velho.

import { consultar, campoTexto, lerTexto, paraNumero } from './firebird.js';
import { carregarConfig } from '../config.js';

const TEMPO_DO_INDICE = 10 * 60 * 1000;   // 10 minutos
const DIAS_DE_VENDA = 180;                // "o que sai hoje" = ultimos 6 meses

const indices = new Map();   // lojaId -> indice pronto

// ---------------------------------------------------------------------------
// Texto canonico
// ---------------------------------------------------------------------------

// medida escrita de todo jeito -> uma forma so
const UNIDADES = {
  L: 'L', LT: 'L', LTS: 'L', LITRO: 'L', LITROS: 'L',
  ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
  KG: 'KG', QUILO: 'KG', QUILOS: 'KG', KILO: 'KG', KILOS: 'KG',
  QUILOGRAMA: 'KG', QUILOGRAMAS: 'KG',
  G: 'G', GR: 'G', GRAMA: 'G', GRAMAS: 'G',
  M: 'M', MT: 'M', MTS: 'M', METRO: 'M', METROS: 'M',
  CM: 'CM', CENTIMETRO: 'CM', CENTIMETROS: 'CM',
  UN: 'UN', UND: 'UN', UNID: 'UN', UNIDADE: 'UN', UNIDADES: 'UN',
  PCT: 'PCT', PC: 'PCT', PCTE: 'PCT', PACOTE: 'PCT', PACOTES: 'PCT',
  CX: 'CX', CXA: 'CX', CAIXA: 'CX', CAIXAS: 'CX',
  FD: 'FD', FARDO: 'FD', FARDOS: 'FD',
  RL: 'RL', ROLO: 'RL', ROLOS: 'RL',
};

// palavras que nao identificam produto nenhum: nao contam para acertar a busca
const FRACAS = new Set([
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'SEM', 'PARA', 'POR', 'QUE', 'NAO',
  'UM', 'UMA', 'E', 'O', 'A', 'AO', 'NO', 'NA', 'EM', 'C', 'P', 'X',
  'UN', 'PCT', 'CX', 'FD', 'RL', 'L', 'ML', 'KG', 'G', 'M', 'CM',
  'TIPO', 'MARCA', 'PRODUTO', 'PRODUTOS', 'ITEM', 'ITENS', 'TAMANHO',
  'GRANDE', 'PEQUENO', 'MEDIO', 'NOVO', 'CADA', 'KIT', 'QUALQUER',
]);

const MARCA_VIRGULA = String.fromCharCode(1);

/**
 * Quebra o texto em palavras comparaveis.
 * Tira acento e cedilha, separa numero de letra e junta a medida no numero:
 * "Agua Sanitaria 5LT" e "agua sanitaria 5 litros" viram a MESMA lista.
 */
export function palavrasCanonicas(texto) {
  const base = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // acento e cedilha saem aqui
    .toUpperCase()
    .replace(/(\d)[.,](\d)/g, `$1${MARCA_VIRGULA}$2`)
    .replace(new RegExp(`[^A-Z0-9${MARCA_VIRGULA}]+`, 'g'), ' ')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .split(' ')
    .filter(Boolean);

  const saida = [];
  for (const bruto of base) {
    const palavra = bruto.split(MARCA_VIRGULA).join('.');
    const medida = UNIDADES[palavra];
    const anterior = saida[saida.length - 1];
    // "5" + "LT" vira "5L"; assim 5LT, 5 L e 5 litros ficam iguais
    if (medida && anterior && /^[\d.]+$/.test(anterior)) {
      saida[saida.length - 1] = anterior + medida;
      continue;
    }
    saida.push(medida || palavra);
  }
  return saida;
}

export const textoCanonico = (texto) => palavrasCanonicas(texto).join(' ');

const ehForte = (palavra) => palavra.length >= 2 && !FRACAS.has(palavra);

/** Diferenca de digitacao entre duas palavras (ate o limite pedido). */
function pertoDeEscrever(a, b, limite = 1) {
  if (Math.abs(a.length - b.length) > limite) return false;
  let i = 0;
  let j = 0;
  let erros = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    erros += 1;
    if (erros > limite) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return erros + (a.length - i) + (b.length - j) <= limite;
}

/** Quanto a palavra procurada casa com uma palavra do produto (0 a 1). */
function casarPalavra(procurada, doProduto) {
  if (procurada === doProduto) return 1;
  if (procurada.length >= 4 && doProduto.startsWith(procurada)) return 0.86;
  if (doProduto.length >= 4 && procurada.startsWith(doProduto)) return 0.8;
  if (procurada.length >= 5 && doProduto.length >= 5
    && procurada[0] === doProduto[0] && pertoDeEscrever(procurada, doProduto)) return 0.74;
  return 0;
}

// ---------------------------------------------------------------------------
// Chaves: como a venda aponta para o produto
// ---------------------------------------------------------------------------

const semZeros = (valor) => String(valor || '').replace(/^0+/, '') || String(valor || '');

/**
 * Todas as formas com que ITEMPEDIDO.PRODUTO pode se referir a este produto.
 * No banco real aparecem os tres jeitos: codigo de barras, codigo curto e
 * codigo com zeros na frente ("000000012743").
 */
export function chavesDoProduto(produto) {
  if (!produto) return [];
  const cruas = [produto.barras, produto.codBarras, produto.codigo]
    .filter(Boolean).map((v) => String(v).trim());
  const todas = new Set();
  for (const chave of cruas) {
    if (!chave) continue;
    todas.add(chave);
    todas.add(semZeros(chave));
    if (/^\d+$/.test(chave) && chave.length < 13) {
      todas.add(chave.padStart(13, '0'));
      todas.add(chave.padStart(14, '0'));
    }
  }
  return [...todas].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Montagem do indice
// ---------------------------------------------------------------------------

async function carregarProdutos() {
  const linhas = await consultar(
    `SELECT CODIGO, ${campoTexto('DESCRICAO', 70)}, BARRAS, CODBARRAS, REFERENCIA,
            ESTOQUEATUAL, PRECOVENDA, PC, PV, STATUS
       FROM PRODUTO`
  );

  return linhas.map((linha) => {
    const descricao = lerTexto(linha.DESCRICAO);
    const palavras = palavrasCanonicas(descricao);
    return {
      codigo: String(linha.CODIGO || '').trim(),
      descricao,
      palavras,
      fortes: palavras.filter(ehForte),
      barras: String(linha.BARRAS || '').trim(),
      codBarras: String(linha.CODBARRAS || '').trim(),
      referencia: String(linha.REFERENCIA || '').trim(),
      estoque: paraNumero(linha.ESTOQUEATUAL),
      venda: paraNumero(linha.PRECOVENDA ?? linha.PV),
      cancelado: String(linha.STATUS || '').trim().toUpperCase() === 'CANCELADO',
    };
  }).filter((p) => p.codigo && p.descricao);
}

/**
 * Quanto cada produto vendeu nos ultimos meses e quando saiu pela ultima vez.
 * E o que responde "me traz o que costuma sair", em vez de um produto morto.
 */
async function carregarVendas(produtos) {
  const porChave = new Map();
  for (const produto of produtos) {
    for (const chave of chavesDoProduto(produto)) {
      if (!porChave.has(chave)) porChave.set(chave, produto.codigo);
    }
  }

  // a referencia de tempo e a ultima venda do banco (uma copia de teste pode
  // estar parada; na loja isso e sempre "hoje")
  let fim = Date.now();
  try {
    const ultima = await consultar('SELECT MAX(DATA) AS FIM FROM ITEMPEDIDO');
    const data = ultima[0]?.FIM ? new Date(ultima[0].FIM).getTime() : 0;
    if (data > 0) fim = data;
  } catch { /* banco sem ITEMPEDIDO: segue sem ranking de venda */ }

  const inicio = new Date(fim - DIAS_DE_VENDA * 24 * 3600 * 1000);
  const corte = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`
    + `-${String(inicio.getDate()).padStart(2, '0')}`;

  const vendas = new Map();   // codigo do produto -> { quantidade, vezes, ultima }
  try {
    const linhas = await consultar(
      `SELECT TRIM(I.PRODUTO) AS CHAVE, SUM(I.QTD1) AS QUANTIDADE,
              COUNT(*) AS VEZES, MAX(I.DATA) AS ULTIMA
         FROM ITEMPEDIDO I
        WHERE I.DATA >= ? AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
        GROUP BY 1`,
      [corte]
    );

    for (const linha of linhas) {
      const chave = String(linha.CHAVE || '').trim();
      const codigo = porChave.get(chave) || porChave.get(semZeros(chave));
      if (!codigo) continue;
      const atual = vendas.get(codigo) || { quantidade: 0, vezes: 0, ultima: 0 };
      atual.quantidade += Math.abs(Number(linha.QUANTIDADE) || 0);
      atual.vezes += Number(linha.VEZES) || 0;
      const quando = linha.ULTIMA ? new Date(linha.ULTIMA).getTime() : 0;
      if (quando > atual.ultima) atual.ultima = quando;
      vendas.set(codigo, atual);
    }
  } catch { /* sem historico de venda a busca continua funcionando */ }

  return { vendas, referencia: fim, porChave };
}

async function montarIndice() {
  const produtos = await carregarProdutos();
  const { vendas, referencia, porChave } = await carregarVendas(produtos);

  // o "mais vendido" e relativo ao proprio catalogo da loja
  let maiorQuantidade = 1;
  for (const v of vendas.values()) maiorQuantidade = Math.max(maiorQuantidade, v.quantidade);

  for (const produto of produtos) {
    const venda = vendas.get(produto.codigo);
    produto.vendidoNoPeriodo = venda?.quantidade || 0;
    produto.vezesVendido = venda?.vezes || 0;
    produto.ultimaVenda = venda?.ultima || 0;
    produto.popularidade = venda
      ? Math.min(1, Math.log10(1 + venda.quantidade) / Math.log10(1 + maiorQuantidade))
      : 0;
    produto.referenciaDeTempo = referencia;
    produto.recencia = venda?.ultima
      ? Math.max(0, 1 - (referencia - venda.ultima) / (DIAS_DE_VENDA * 24 * 3600 * 1000))
      : 0;
  }

  const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));
  return { produtos, porCodigo, porChave, referencia, montadoEm: Date.now() };
}

/** Devolve o indice da loja atual, montando (ou remontando) quando precisa. */
export async function indiceDoCatalogo() {
  const loja = carregarConfig().lojaId || 'principal';
  const guardado = indices.get(loja);

  // ja tem alguem montando: espera a mesma montagem em vez de puxar o banco de novo
  if (guardado?.montando) return guardado.montando;
  if (guardado && Date.now() - guardado.montadoEm < TEMPO_DO_INDICE) return guardado;

  const promessa = montarIndice()
    .then((indice) => {
      indices.set(loja, indice);
      return indice;
    })
    .catch((erro) => {
      indices.delete(loja);
      // com o indice fora do ar, quem chamou cai na busca antiga por SQL
      throw erro;
    });

  indices.set(loja, { montando: promessa, montadoEm: Date.now(), produtos: [], porCodigo: new Map(), porChave: new Map() });
  return promessa;
}

/** Esquece o indice (depois de gravar nota, criar ou desativar produto). */
export function invalidarCatalogo() {
  indices.clear();
}

// ---------------------------------------------------------------------------
// A busca
// ---------------------------------------------------------------------------

const ehMedida = (palavra) => /^[\d.]+(L|ML|KG|G|M|CM)$/.test(palavra);

/**
 * Procura no catalogo e devolve os produtos em ordem de "provavelmente e esse".
 *
 * `preferir` sao codigos que este cliente ja comprou: quando a busca fica em
 * duvida, o que ele levou da outra vez ganha.
 */
export async function procurarNoCatalogo(texto, { limite = 12, preferir = [] } = {}) {
  const indice = await indiceDoCatalogo();
  const procuradas = palavrasCanonicas(texto);
  const fortes = procuradas.filter(ehForte);
  const usadas = fortes.length ? fortes : procuradas;
  if (!usadas.length) return [];

  const medidasPedidas = procuradas.filter(ehMedida);
  const preferidas = new Set((preferir || []).map((c) => String(c).trim()).filter(Boolean));

  const notas = [];
  for (const produto of indice.produtos) {
    const doProduto = produto.palavras;
    if (!doProduto.length) continue;

    let soma = 0;
    let exatas = 0;
    const casadas = new Set();
    for (const procurada of usadas) {
      let melhor = 0;
      let melhorIndice = -1;
      for (let i = 0; i < doProduto.length; i += 1) {
        const nota = casarPalavra(procurada, doProduto[i]);
        if (nota > melhor) { melhor = nota; melhorIndice = i; }
        if (melhor === 1) break;
      }
      if (melhor > 0) {
        soma += melhor;
        casadas.add(melhorIndice);
        if (melhor === 1) exatas += 1;
      }
    }

    const cobertura = soma / usadas.length;
    if (cobertura <= 0) continue;

    let nota = cobertura;

    // comeca com a palavra que a pessoa pediu: e o produto, nao um acessorio dele
    if (usadas[0] && doProduto[0] && casarPalavra(usadas[0], doProduto[0]) >= 0.8) nota += 0.10;
    if (exatas === usadas.length) nota += 0.08;

    // a medida tem que bater: 5L nao pode virar 1L
    if (medidasPedidas.length) {
      const bateu = medidasPedidas.every((m) => doProduto.includes(m));
      const temOutra = doProduto.some((p) => ehMedida(p) && !medidasPedidas.includes(p));
      if (bateu) nota += 0.14;
      else if (temOutra) nota -= 0.16;
    }

    // nome muito maior do que o pedido costuma ser outra coisa
    const sobrando = produto.fortes.length - casadas.size;
    if (sobrando > 0) nota -= Math.min(sobrando, 4) * 0.022;

    // o que a loja vende de verdade vem na frente do que esta parado ha anos
    nota += produto.popularidade * 0.16;
    nota += produto.recencia * 0.10;
    if (produto.estoque > 0) nota += 0.03;
    if (produto.cancelado) nota -= 0.40;

    // o que este cliente ja levou ganha de todo o resto
    if (preferidas.has(produto.codigo)) nota += 0.35;

    notas.push({ produto, nota, cobertura });
  }

  if (!notas.length) return [];

  // corte: primeiro so o que casou bem; se nao sobrar nada, vai afrouxando
  const ordenados = notas.sort((a, b) => b.nota - a.nota);
  for (const minimo of [0.62, 0.5, 0.34]) {
    const bons = ordenados.filter((x) => x.cobertura >= minimo);
    if (bons.length) return bons.slice(0, limite).map(formatar);
  }
  return ordenados.slice(0, limite).map(formatar);
}

function formatar({ produto, nota, cobertura }) {
  return {
    codigo: produto.codigo,
    descricao: produto.descricao,
    nota: Math.round(Math.min(Math.max(nota, 0), 1.6) * 100) / 100,
    cobertura: Math.round(cobertura * 100) / 100,
    cancelado: produto.cancelado,
    vendidoNoPeriodo: produto.vendidoNoPeriodo,
    vezesVendido: produto.vezesVendido,
    ultimaVenda: produto.ultimaVenda || null,
    popularidade: produto.popularidade,
    referencia: produto.referenciaDeTempo,
  };
}

/** Um resumo curto do porque o produto apareceu (aparece na tela). */
export function motivoDaSugestao(achado, referencia = 0) {
  if (!achado || !achado.ultimaVenda) return '';
  referencia = referencia || achado.referencia || Date.now();
  const dias = Math.floor((referencia - achado.ultimaVenda) / (24 * 3600 * 1000));
  if (dias <= 45 && achado.popularidade >= 0.5) return 'é o que mais sai';
  if (dias <= 7) return 'vendido nesta semana';
  if (dias <= 45) return 'vendido este mês';
  if (dias <= 120) return 'última venda há ' + Math.round(dias / 30) + ' meses';
  return 'sem venda recente';
}

/**
 * Converte as chaves que aparecem na venda (ITEMPEDIDO.PRODUTO) nos codigos de
 * produto de hoje. E o que liga "o que este cliente ja comprou" ao catalogo.
 */
export async function codigosDasChaves(chaves) {
  const indice = await indiceDoCatalogo();
  const codigos = [];
  for (const bruta of chaves || []) {
    const chave = String(bruta || '').trim();
    if (!chave) continue;
    const codigo = indice.porChave?.get(chave) || indice.porChave?.get(semZeros(chave));
    if (codigo) codigos.push(codigo);
  }
  return [...new Set(codigos)];
}
