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
import { VENDA_VALIDA } from './venda-valida.js';

const TEMPO_DO_INDICE = 10 * 60 * 1000;   // 10 minutos
const DIAS_DE_VENDA = 180;                // "o que sai hoje" = ultimos 6 meses
const DIA = 24 * 3600 * 1000;
// Produto sem venda, sem entrada e sem mudanca de preco ha mais que isso e
// PARADO: nao e sugerido no orcamento (so aparece se a pessoa procurar) e entra
// na lista de marcar " - DESATIVADO". A loja escolhe o prazo em Ajustes.
const MESES_PARA_PARADO = 12;

export function diasParaParado() {
  const meses = Number(carregarConfig().regras?.mesesParaParado);
  const usar = Number.isFinite(meses) && meses >= 1 && meses <= 120 ? meses : MESES_PARA_PARADO;
  return Math.round(usar * 30.44);
}

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

/**
 * "AGUA SANITARIA 1L Q.BOA": quem pede escreve "qboa". O ponto vira espaço nas
 * palavras canônicas, sobra "Q" + "BOA", e o pedido nunca achava o produto (no
 * teste, a IA acabou escolhendo QUEROSENE 1L). Aqui sai a forma JUNTA ("QBOA"),
 * que o índice guarda A MAIS - trocar estragaria "F.DUPLA", que precisa continuar
 * achando quem pede "folha dupla".
 */
export function palavrasJuntas(texto) {
  const limpo = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return [...limpo.matchAll(/\b([A-Z])\.([A-Z]{2,})\b/g)].map((m) => m[1] + m[2]);
}

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
  const cruas = [produto.barras, produto.barrasNoBanco, produto.codBarras, produto.codigo]
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
    const separadas = palavrasCanonicas(descricao);
    return {
      codigo: String(linha.CODIGO || '').trim(),
      descricao,
      // as juntas vão NO FIM e só aqui (não nas "fortes"): servem para casar o
      // pedido, sem mexer na primeira palavra nem na penalidade de nome comprido
      palavras: [...separadas, ...palavrasJuntas(descricao)],
      fortes: separadas.filter(ehForte),
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
         JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
        WHERE I.DATA >= ? AND ${VENDA_VALIDA}
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

/** "15/03/2023" (texto do Solus) ou Date do banco -> milissegundos. */
function quando(valor) {
  if (!valor) return 0;
  if (valor instanceof Date) return valor.getTime() || 0;
  const br = String(valor).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  const data = new Date(valor).getTime();
  return Number.isFinite(data) ? data : 0;
}

/**
 * A ultima vez que ALGUMA coisa aconteceu com cada produto: venda (de qualquer
 * epoca), entrada de nota, mudanca de preco, ou as datas que o proprio Solus
 * anota no cadastro. Custa ~0,6s a cada 10 minutos, no maximo.
 *
 * Cada fonte vai num try separado: banco sem uma das tabelas so perde aquela
 * informacao, nunca a busca inteira.
 */
async function carregarAtividade(produtos, porChave) {
  const ultima = new Map();   // codigo -> ms
  const marcar = (codigo, ms) => {
    if (codigo && ms > (ultima.get(codigo) || 0)) ultima.set(codigo, ms);
  };
  const pelaChave = (chave) => {
    const limpa = String(chave || '').trim();
    return porChave.get(limpa) || porChave.get(semZeros(limpa));
  };

  const fontes = [
    // venda que conta e so a FATURADA: orcamento que ninguem comprou nao e movimento
    [`SELECT TRIM(I.PRODUTO) AS CHAVE, MAX(I.DATA) AS ULTIMA FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO WHERE ${VENDA_VALIDA} GROUP BY 1`, pelaChave],
    ['SELECT TRIM(PRODUTO) AS CHAVE, MAX(DATA) AS ULTIMA FROM ENTRADA GROUP BY 1', pelaChave],
    ['SELECT TRIM(BARRAS) AS CHAVE, MAX(DATA) AS ULTIMA FROM ALTERAPRECO GROUP BY 1', pelaChave],
  ];
  for (const [sql, paraCodigo] of fontes) {
    try {
      for (const linha of await consultar(sql)) marcar(paraCodigo(linha.CHAVE), quando(linha.ULTIMA));
    } catch { /* tabela que esta versao do Solus nao tem */ }
  }

  try {
    const linhas = await consultar('SELECT CODIGO, ULTIMAVENDA, ULTIMACOMPRA FROM PRODUTO');
    for (const linha of linhas) {
      const codigo = String(linha.CODIGO || '').trim();
      marcar(codigo, quando(linha.ULTIMAVENDA));
      marcar(codigo, quando(linha.ULTIMACOMPRA));
    }
  } catch { /* colunas que esta versao do Solus nao tem */ }

  return ultima;
}

async function montarIndice() {
  const produtos = await carregarProdutos();
  const { vendas, referencia, porChave } = await carregarVendas(produtos);
  const atividade = await carregarAtividade(produtos, porChave);

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
    produto.ultimaAtividade = atividade.get(produto.codigo) || 0;
  }

  // Produto sem data nenhuma pode ser velho (anterior as tabelas de historico)
  // ou recem-cadastrado no Solus e ainda sem venda. O codigo e sequencial, entao
  // quem tem codigo MAIOR que o ultimo produto parado com data e novo: fica.
  const limiteParado = referencia - diasParaParado() * DIA;
  const numero = (codigo) => (/^\d+$/.test(codigo) ? Number(codigo) : 0);
  let maiorCodigoParado = 0;
  for (const produto of produtos) {
    if (produto.ultimaAtividade && produto.ultimaAtividade < limiteParado) {
      maiorCodigoParado = Math.max(maiorCodigoParado, numero(produto.codigo));
    }
  }
  for (const produto of produtos) {
    produto.parado = produto.ultimaAtividade
      ? produto.ultimaAtividade < limiteParado
      : numero(produto.codigo) > 0 && numero(produto.codigo) <= maiorCodigoParado;
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
export async function procurarNoCatalogo(texto, { limite = 12, preferir = [], esconderParados = false } = {}) {
  const indice = await indiceDoCatalogo();
  const procuradas = palavrasCanonicas(texto);
  const fortes = procuradas.filter(ehForte);
  const usadas = fortes.length ? fortes : procuradas;
  if (!usadas.length) return [];

  const medidasPedidas = procuradas.filter(ehMedida);
  // a ordem importa: o primeiro e o que o cliente comprou mais recentemente
  const preferidas = new Map((preferir || []).map((c) => String(c).trim()).filter(Boolean)
    .map((codigo, posicao, lista) => [codigo, posicao / Math.max(lista.length, 1)]));

  const notas = [];
  for (const produto of indice.produtos) {
    const doProduto = produto.palavras;
    if (!doProduto.length) continue;
    // na SUGESTAO automatica, produto morto ha mais que o prazo dos Ajustes nem entra
    // (na pesquisa que a pessoa faz na mao ele aparece, marcado como parado)
    if (esconderParados && produto.parado) continue;

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
    if (produto.parado) nota -= 0.12;

    // o que este cliente ja levou ganha de todo o resto
    // entre dois que ele ja comprou (Harmoniex x Coco), ganha o que ele levou por ultimo
    if (preferidas.has(produto.codigo)) nota += 0.35 + 0.1 * (1 - preferidas.get(produto.codigo));

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
    parado: produto.parado,
    ultimaAtividade: produto.ultimaAtividade || null,
  };
}

/** Um resumo curto do porque o produto apareceu (aparece na tela). */
export function motivoDaSugestao(achado, referencia = 0) {
  if (!achado) return '';
  referencia = referencia || achado.referencia || Date.now();
  if (achado.parado) {
    if (!achado.ultimaAtividade) return 'parado há anos';
    const anos = Math.floor((referencia - achado.ultimaAtividade) / (365 * DIA));
    return `parado há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  }
  if (!achado.ultimaVenda) return '';
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
/**
 * Chave da venda -> codigo do produto, SEM perder a ligacao entre as duas.
 *
 * `codigosDasChaves` devolve a lista limpa (sem repetido e sem o que nao achou),
 * o que serve para "quais produtos ele comprou" mas NAO para andar em paralelo
 * com a lista de entrada: a posicao 3 da resposta pode ser a chave 5. Isso ja
 * casou o ritmo de compra de um produto com o codigo de outro (ver
 * `logica/sugestoes.js`). Quando a ligacao importa, use este Map.
 */
export async function mapaDeChaves(chaves) {
  const indice = await indiceDoCatalogo();
  const mapa = new Map();
  for (const bruta of chaves || []) {
    const chave = String(bruta || '').trim();
    if (!chave || mapa.has(chave)) continue;
    const codigo = indice.porChave?.get(chave) || indice.porChave?.get(semZeros(chave));
    if (codigo) mapa.set(chave, codigo);
  }
  return mapa;
}

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
