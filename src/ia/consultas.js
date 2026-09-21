// As perguntas que o assistente sabe responder sobre a loja.
//
// Regra de ouro deste arquivo: SO LEITURA. Nenhuma funcao aqui grava, apaga ou
// altera qualquer coisa. A IA escolhe qual chamar, mas os numeros saem do banco
// do Solus - ela nao inventa nada.
//
// Todas as consultas tem limite, para nunca travar o banco no meio do expediente.

import { consultar, paraNumero, campoTexto, lerTexto } from '../db/firebird.js';
import { buscarPorBarras, buscarPorDescricao, buscarPorCodigo, semelhanca } from '../db/produtos.js';
import { chavesDoProduto } from '../db/catalogo.js';
import { porMetroQuadrado } from '../logica/medidas.js';
import { VENDA_VALIDA, PEDIDO_FATURADO, ITEM_NAO_ESTORNADO } from '../db/venda-valida.js';

const TETO = 50;

function limitar(valor, padrao = 10) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(Math.trunc(n), TETO);
}

function dataBR(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toLocaleDateString('pt-BR');
}

/** Acha o produto pelo jeito que a pessoa falou (nome, codigo ou barras). */
async function acharProduto(termo) {
  const texto = String(termo || '').trim();
  if (!texto) return null;

  const digitos = texto.replace(/\D/g, '');
  if (digitos.length >= 8) {
    const porBarras = await buscarPorBarras(digitos);
    if (porBarras) return porBarras;
  }
  if (/^\d{1,6}$/.test(texto)) {
    const porCodigo = await buscarPorCodigo(texto);
    if (porCodigo) return porCodigo;
  }

  // Pega varios e fica com o MAIS parecido, nao com o primeiro que aparecer.
  // Sem isso, perguntar de "sabao em pedra ype" responde sobre "sabao em po surf"
  // - e a resposta sai confiante e errada, que e o pior tipo de erro.
  const achados = await buscarPorDescricao(texto, 10);
  if (!achados.length) return null;

  const ordenados = achados
    .map((produto) => ({ produto, nota: semelhanca(texto, produto.descricao) }))
    .sort((a, b) => b.nota - a.nota);

  return ordenados[0].produto;
}

/**
 * As chaves que o Solus usa nos itens de venda.
 * Nao e uma so: ora o codigo de barras, ora o codigo curto, ora com zeros na
 * frente. Procurar por uma forma so fazia a resposta ser "nunca comprou" mesmo
 * com a venda gravada.
 */
function chavesDaVenda(produto) {
  const chaves = chavesDoProduto(produto);
  return chaves.length ? chaves.slice(0, 8) : [produto.barras || produto.codigo];
}

const marcadores = (lista) => lista.map(() => '?').join(', ');

/**
 * Acha TODOS os cadastros de cliente com aquele nome.
 *
 * A loja tem uma rede grande com 18 cadastros do mesmo nome, um por CNPJ/cidade.
 * Antes a consulta pegava so o primeiro e respondia "nunca comprou" com toda a
 * confianca - a resposta errada mais perigosa que existe. Agora olha em todos e
 * diz de qual loja foi cada compra.
 */
async function acharClientes(texto) {
  const procurado = String(texto || '').trim();
  if (!procurado) return [];

  const { buscarClientePorCodigo, buscarClientePorNome } = await import('../db/clientes.js');

  if (/^\d{1,5}$/.test(procurado)) {
    const porCodigo = await buscarClientePorCodigo(procurado);
    if (porCodigo) return [porCodigo];
  }
  return buscarClientePorNome(procurado, 25);
}

/** Como o cliente aparece na resposta: nome + cidade, para dar para diferenciar. */
const resumirCliente = (c) => ({
  codigo: c.codigo,
  nome: c.nome,
  cidade: [c.cidade, c.uf].filter(Boolean).join('/') || null,
  cnpj: c.cpfCnpj || null,
});

/**
 * Acrescenta o valor do metro quadrado quando faz sentido.
 * Tapete personalizado e vendido por m2, mas gravado como a peca inteira.
 */
function comMetroQuadrado(linha, descricaoDaVenda, nomeDoCadastro) {
  const conta = porMetroQuadrado(paraNumero(linha.PRECO), descricaoDaVenda, nomeDoCadastro);
  if (!conta) return {};
  return {
    medida: conta.escrito,
    metrosQuadrados: conta.area,
    precoPorMetroQuadrado: conta.metroQuadrado,
  };
}

// ---------------------------------------------------------------------------

export async function procurarProduto({ termo, quantos = 5 }, contexto = {}) {
  // custo e margem so para quem pode ver no Solus. Antes o dado vinha sempre e a
  // IA e que deveria "nao mostrar" - confiar nisso e pedir vazamento.
  const podeVerCusto = !contexto.operador || Boolean(contexto.operador.permissoes?.verCusto);
  const lista = await buscarPorDescricao(String(termo || ''), limitar(quantos, 5));

  const digitos = String(termo || '').replace(/\D/g, '');
  if (digitos.length >= 8) {
    const porBarras = await buscarPorBarras(digitos);
    if (porBarras && !lista.some((p) => p.codigo === porBarras.codigo)) lista.unshift(porBarras);
  }

  if (!lista.length) return { encontrou: false, mensagem: `Nao achei nenhum produto com "${termo}".` };

  return {
    encontrou: true,
    produtos: lista.map((p) => ({
      codigo: p.codigo,
      descricao: p.descricao,
      codigoBarras: p.barras || null,
      estoque: p.estoque,
      precoVenda: p.vendaAtual,
      precoCusto: podeVerCusto ? p.custoAtual : undefined,
      margem: podeVerCusto ? Number(p.margemAtual.toFixed(1)) : undefined,
      unidade: p.unidade,
      desativado: p.cancelado,
    })),
  };
}

/** Ultimas vendas de um produto: para quem, quando e por quanto. */
export async function ultimasVendasDoProduto({ termo, quantos = 10 }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const chaves = chavesDaVenda(produto);
  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)}
            I.DATA, I.QTD, I.PRECO, P.NUMERO, P.CODCLIENTE,
            ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')},
            ${campoTexto('P.NOMECLI', 50, 'NOMECLI')}, P.STATUS
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(I.PRODUTO) IN (${marcadores(chaves)})
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    chaves
  );

  return {
    encontrou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao, estoque: produto.estoque },
    totalDeVendasListadas: linhas.length,
    vendas: linhas.map((l) => {
      const comoFoiVendido = lerTexto(l.DESCRICAO) || produto.descricao;
      return {
        data: dataBR(l.DATA),
        cliente: lerTexto(l.NOMECLI) || 'CONSUMIDOR',
        codigoCliente: String(l.CODCLIENTE || '').trim() || null,
        // na venda o nome pode vir com a medida daquela peca
        comoFoiVendido: comoFoiVendido !== produto.descricao ? comoFoiVendido : undefined,
        quantidade: paraNumero(l.QTD),
        precoUnitario: paraNumero(l.PRECO),
        ...comMetroQuadrado(l, comoFoiVendido, produto.descricao),
        pedido: Number(l.NUMERO),
        situacao: String(l.STATUS || '').trim() || 'aberto',
      };
    }),
  };
}

/** Ultimas compras do produto no fornecedor: quanto a loja pagou e quando. */
export async function ultimasComprasDoProduto({ termo, quantos = 10 }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)}
            E.DATA, E.QTD, E.PC, E.NOTA, E.CODFORNECEDOR,
            ${campoTexto('F.NOME', 50, 'FORNECEDOR')}
       FROM ENTRADA E
       LEFT JOIN FORNECEDOR F ON TRIM(F.CODIGO) = TRIM(E.CODFORNECEDOR)
      WHERE TRIM(E.PRODUTO) = ?
      ORDER BY E.DATA DESC`,
    [chaveDoProduto(produto)]
  );

  return {
    encontrou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao },
    custoAtual: produto.custoAtual,
    compras: linhas.map((l) => ({
      data: dataBR(l.DATA),
      fornecedor: lerTexto(l.FORNECEDOR) || String(l.CODFORNECEDOR || '').trim() || 'nao informado',
      quantidade: paraNumero(l.QTD),
      custoUnitario: paraNumero(l.PC),
      nota: String(l.NOTA || '').trim(),
    })),
  };
}

/**
 * Desde quando o produto existe na loja.
 * O cadastro do Solus nao guarda data de cadastro, entao a gente descobre pela
 * primeira compra e pela primeira venda registradas.
 */
export async function desdeQuandoTemOProduto({ termo }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const chave = chaveDoProduto(produto);

  const [primeiraCompra] = await consultar(
    'SELECT MIN(DATA) AS QUANDO FROM ENTRADA WHERE TRIM(PRODUTO) = ?', [chave]
  );
  const [primeiraVenda] = await consultar(
    `SELECT MIN(I.DATA) AS QUANDO FROM ITEMPEDIDO I WHERE TRIM(I.PRODUTO) = ?`, [chave]
  );

  return {
    encontrou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao },
    primeiraCompraRegistrada: dataBR(primeiraCompra?.QUANDO),
    primeiraVendaRegistrada: dataBR(primeiraVenda?.QUANDO),
    ultimaCompra: produto.ultimaCompra || null,
    observacao: 'O Solus nao guarda a data de cadastro do produto. Estas sao as datas'
      + ' da primeira compra e da primeira venda registradas no sistema.',
  };
}

/** Produtos com estoque zerado ou negativo (o negativo indica erro de lancamento). */
export async function produtosComEstoqueRuim({ quantos = 15, apenasNegativo = false }) {
  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 15)}
            CODIGO, ${campoTexto('DESCRICAO', 70)}, ESTOQUEATUAL, PRECOVENDA, PRECOCUSTO
       FROM PRODUTO
      WHERE (STATUS IS NULL OR STATUS <> 'CANCELADO')
        AND ESTOQUEATUAL IS NOT NULL
        AND CAST(REPLACE(ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION) ${apenasNegativo ? '< 0' : '<= 0'}
      ORDER BY CAST(REPLACE(ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION)`
  );

  return {
    quantidade: linhas.length,
    produtos: linhas.map((l) => ({
      codigo: String(l.CODIGO).trim(),
      descricao: lerTexto(l.DESCRICAO),
      estoque: paraNumero(l.ESTOQUEATUAL),
      precoVenda: paraNumero(l.PRECOVENDA),
    })),
    observacao: apenasNegativo
      ? 'Estoque negativo quase sempre significa que a venda saiu por um cadastro e a entrada foi lancada em outro.'
      : undefined,
  };
}

/** O que mais vendeu num periodo. */
export async function maisVendidos({ dias = 30, quantos = 10 }) {
  const desde = new Date();
  desde.setDate(desde.getDate() - Math.max(1, Number(dias) || 30));

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)}
            I.PRODUTO, ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')},
            SUM(CAST(REPLACE(I.QTD, ',', '.') AS DOUBLE PRECISION)) AS TOTALQTD,
            SUM(I.TOT) AS TOTALVALOR,
            COUNT(*) AS VEZES
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE I.DATA >= ?
        AND ${VENDA_VALIDA}
      GROUP BY I.PRODUTO, I.DESCRICAO
      ORDER BY 3 DESC`,
    [desde]
  );

  return {
    periodo: `ultimos ${dias} dias`,
    produtos: linhas.map((l) => ({
      descricao: lerTexto(l.DESCRICAO),
      codigoBarras: String(l.PRODUTO || '').trim(),
      quantidadeVendida: Number(paraNumero(l.TOTALQTD).toFixed(2)),
      valorTotal: Number(paraNumero(l.TOTALVALOR).toFixed(2)),
      numeroDeVendas: Number(l.VEZES),
    })),
  };
}

/** O que o cliente costuma comprar. */
export async function comprasDoCliente({ cliente, quantos = 15 }) {
  const texto = String(cliente || '').trim();
  if (!texto) return { encontrou: false, mensagem: 'Diga o nome ou o codigo do cliente.' };

  const cadastros = await acharClientes(texto);
  if (!cadastros.length) return { encontrou: false, mensagem: `Nao achei o cliente "${texto}".` };

  // mesma historia de antes: varios CNPJs com o mesmo nome, um por cidade
  const codigos = cadastros.map((c) => c.codigo).slice(0, 30);
  const porCodigo = new Map(cadastros.map((c) => [c.codigo, c]));

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 15)}
            I.DATA, ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}, I.QTD, I.PRECO,
            P.NUMERO, P.CODCLIENTE
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) IN (${marcadores(codigos)})
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    codigos
  );

  return {
    encontrou: true,
    cadastrosComEsseNome: cadastros.length,
    cadastros: cadastros.length > 1 ? cadastros.map(resumirCliente) : undefined,
    cliente: cadastros.length === 1 ? resumirCliente(cadastros[0]) : undefined,
    compras: linhas.map((l) => {
      const codigoCliente = String(l.CODCLIENTE || '').trim();
      const cadastro = porCodigo.get(codigoCliente);
      const descricao = lerTexto(l.DESCRICAO);
      return {
        data: dataBR(l.DATA),
        produto: descricao,
        // com varios cadastros, dizer de qual foi e o que responde a pergunta
        cliente: cadastros.length > 1
          ? (cadastro ? resumirCliente(cadastro) : { codigo: codigoCliente })
          : undefined,
        quantidade: paraNumero(l.QTD),
        precoPago: paraNumero(l.PRECO),
        ...comMetroQuadrado(l, descricao, descricao),
        pedido: Number(l.NUMERO),
      };
    }),
  };
}

/** Quem sao os clientes que mais compram. */
export async function melhoresClientes({ dias = 90, quantos = 10 }) {
  const desde = new Date();
  desde.setDate(desde.getDate() - Math.max(1, Number(dias) || 90));

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)}
            P.CODCLIENTE, ${campoTexto('P.NOMECLI', 50, 'NOMECLI')},
            SUM(P.TOTPEDIDO) AS TOTAL, COUNT(*) AS COMPRAS
       FROM PEDIDOS P
      WHERE P.EMISSAO >= ?
        AND ${PEDIDO_FATURADO}
        AND P.CODCLIENTE IS NOT NULL AND P.CODCLIENTE <> ''
      GROUP BY P.CODCLIENTE, P.NOMECLI
      ORDER BY 3 DESC`,
    [desde]
  );

  return {
    periodo: `ultimos ${dias} dias`,
    clientes: linhas.map((l) => ({
      codigo: String(l.CODCLIENTE || '').trim(),
      nome: lerTexto(l.NOMECLI),
      totalComprado: Number(paraNumero(l.TOTAL).toFixed(2)),
      numeroDeCompras: Number(l.COMPRAS),
    })),
  };
}

/** Produtos cadastrados mais de uma vez (mesmo nome). */
export async function produtosRepetidos({ quantos = 10 }) {
  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)} ${campoTexto('DESCRICAO', 70)}, COUNT(*) AS QUANTOS
       FROM PRODUTO
      WHERE (STATUS IS NULL OR STATUS <> 'CANCELADO')
      GROUP BY DESCRICAO
     HAVING COUNT(*) > 1
      ORDER BY 2 DESC`
  );

  return {
    quantidade: linhas.length,
    repetidos: linhas.map((l) => ({
      descricao: lerTexto(l.DESCRICAO),
      cadastros: Number(l.QUANTOS),
    })),
    observacao: 'Cadastro repetido costuma causar estoque negativo, porque a venda sai'
      + ' por um codigo e a entrada entra em outro. Da para juntar pela tela de entrada de nota.',
  };
}

/**
 * Quanto a loja lucrou num periodo.
 *
 * Da para calcular de verdade porque o Solus grava, em CADA item vendido, o
 * custo que a mercadoria tinha NAQUELE dia (ITEMPEDIDO.PRECOCUSTO). Entao nao e
 * estimativa em cima do custo de hoje: e o custo real da venda.
 *
 * ATENCAO ao que este numero significa: e LUCRO BRUTO (o que vendeu menos o que
 * a mercadoria custou). Nao desconta imposto, aluguel, folha, cartao, frete nem
 * despesa nenhuma. Quem le precisa saber disso, senao acha que e o que sobrou.
 */
export async function lucroDoPeriodo({ dias = 30, mes = null, ano = null, quantos = 10 }, contexto = {}) {
  // Quem nao ve custo no Solus nao pode ver lucro nem margem - lucro E custo.
  // A checagem fica AQUI, e nao so na instrucao da IA: o dado nem chega perto
  // dela, entao nao tem como escapar numa resposta.
  if (contexto.operador && !contexto.operador.permissoes?.verCusto) {
    return {
      encontrou: false,
      semPermissao: true,
      mensagem: 'Esse usuario nao pode ver custo nem margem no Solus, e lucro depende do custo. '
        + 'Diga isso a pessoa, sem mostrar nenhum numero de lucro.',
    };
  }

  const doisDigitos = (n) => String(n).padStart(2, '0');

  let inicio;
  let fim;
  let comoChamar;

  if (mes) {
    const anoUsado = Number(ano) || new Date().getFullYear();
    const mesUsado = Math.min(Math.max(Number(mes), 1), 12);
    inicio = `${anoUsado}-${doisDigitos(mesUsado)}-01`;
    const proximo = mesUsado === 12
      ? `${anoUsado + 1}-01-01`
      : `${anoUsado}-${doisDigitos(mesUsado + 1)}-01`;
    fim = proximo;
    comoChamar = `${doisDigitos(mesUsado)}/${anoUsado}`;
  } else {
    const periodo = Math.min(Math.max(Number(dias) || 30, 1), 730);
    const de = new Date(Date.now() - periodo * 24 * 3600 * 1000);
    inicio = `${de.getFullYear()}-${doisDigitos(de.getMonth() + 1)}-${doisDigitos(de.getDate())}`;
    fim = '9999-12-31';
    comoChamar = `últimos ${periodo} dias`;
  }

  const filtro = `I.DATA >= ? AND I.DATA < ?
      AND ${VENDA_VALIDA}`;

  const [total] = await consultar(
    `SELECT COUNT(DISTINCT P.NUMERO) AS PEDIDOS, COUNT(*) AS ITENS,
            SUM(I.TOT) AS FATURADO,
            SUM(I.PRECOCUSTO * I.QTD1) AS CUSTO,
            SUM(CASE WHEN I.PRECOCUSTO > 0 THEN 0 ELSE 1 END) AS SEM_CUSTO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE ${filtro}`,
    [inicio, fim]
  );

  const faturado = Number(total?.FATURADO) || 0;
  const custo = Number(total?.CUSTO) || 0;
  const lucro = faturado - custo;
  const itens = Number(total?.ITENS) || 0;
  const semCusto = Number(total?.SEM_CUSTO) || 0;

  if (!faturado) {
    return { encontrou: false, periodo: comoChamar, mensagem: `Nao achei vendas em ${comoChamar}.` };
  }

  // o que puxou o lucro para cima
  const melhores = await consultar(
    `SELECT FIRST ${limitar(quantos, 10)}
            ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')},
            SUM(I.QTD1) AS QUANTIDADE, SUM(I.TOT) AS FATURADO,
            SUM(I.TOT - I.PRECOCUSTO * I.QTD1) AS LUCRO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE ${filtro} AND I.PRECOCUSTO > 0
      GROUP BY 1
      ORDER BY 4 DESC`,
    [inicio, fim]
  );

  // o que saiu abaixo do custo (isso a pessoa precisa ver)
  const prejuizo = await consultar(
    `SELECT FIRST 8 ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')},
            SUM(I.QTD1) AS QUANTIDADE, SUM(I.TOT) AS FATURADO,
            SUM(I.TOT - I.PRECOCUSTO * I.QTD1) AS LUCRO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE ${filtro} AND I.PRECOCUSTO > 0
      GROUP BY 1
      HAVING SUM(I.TOT - I.PRECOCUSTO * I.QTD1) < 0
      ORDER BY 4 ASC`,
    [inicio, fim]
  );

  const arredondar = (v) => Math.round((Number(v) || 0) * 100) / 100;

  return {
    encontrou: true,
    periodo: comoChamar,
    de: inicio,
    pedidos: Number(total?.PEDIDOS) || 0,
    itensVendidos: itens,
    faturado: arredondar(faturado),
    custoDaMercadoria: arredondar(custo),
    lucroBruto: arredondar(lucro),
    margemBruta: Number(((lucro / faturado) * 100).toFixed(1)),
    // dizer isso e obrigatorio: senao a pessoa acha que e o que sobrou no bolso
    oQueEsseNumeroE: 'LUCRO BRUTO: o que vendeu menos o que a mercadoria custou. '
      + 'NAO desconta imposto, aluguel, folha, taxa de cartao nem nenhuma despesa.',
    itensSemCustoGravado: semCusto,
    avisoDeConfianca: semCusto
      ? `${semCusto} de ${itens} itens nao tinham custo gravado na venda e ficaram de fora da conta do custo.`
      : null,
    maisLucrativos: melhores.map((l) => ({
      produto: lerTexto(l.DESCRICAO),
      quantidade: arredondar(l.QUANTIDADE),
      faturado: arredondar(l.FATURADO),
      lucro: arredondar(l.LUCRO),
    })),
    vendidosAbaixoDoCusto: prejuizo.map((l) => ({
      produto: lerTexto(l.DESCRICAO),
      quantidade: arredondar(l.QUANTIDADE),
      faturado: arredondar(l.FATURADO),
      prejuizo: arredondar(l.LUCRO),
    })),
  };
}

/** Numeros gerais da loja. */
export async function resumoDaLoja() {
  const [produtos] = await consultar(
    "SELECT COUNT(*) AS T FROM PRODUTO WHERE STATUS IS NULL OR STATUS <> 'CANCELADO'"
  );
  const [desativados] = await consultar("SELECT COUNT(*) AS T FROM PRODUTO WHERE STATUS = 'CANCELADO'");
  const [clientes] = await consultar('SELECT COUNT(*) AS T FROM CLIENTES');
  const [fornecedores] = await consultar('SELECT COUNT(*) AS T FROM FORNECEDOR');

  const trintaDias = new Date();
  trintaDias.setDate(trintaDias.getDate() - 30);
  const [vendas] = await consultar(
    `SELECT COUNT(*) AS QUANTAS, SUM(TOTPEDIDO) AS TOTAL FROM PEDIDOS
      WHERE EMISSAO >= ? AND TRIM(STATUS) = 'FATURADO'`,
    [trintaDias]
  );
  const [negativos] = await consultar(
    `SELECT COUNT(*) AS T FROM PRODUTO
      WHERE (STATUS IS NULL OR STATUS <> 'CANCELADO')
        AND CAST(REPLACE(ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION) < 0`
  );

  return {
    produtosAtivos: Number(produtos.T),
    produtosDesativados: Number(desativados.T),
    clientes: Number(clientes.T),
    fornecedores: Number(fornecedores.T),
    vendasUltimos30Dias: Number(vendas.QUANTAS || 0),
    valorVendidoUltimos30Dias: Number(paraNumero(vendas.TOTAL).toFixed(2)),
    produtosComEstoqueNegativo: Number(negativos.T),
  };
}

/** Produtos parados: tem estoque mas nao vendem ha um tempo. */
export async function produtosParados({ dias = 180, quantos = 15 }) {
  const desde = new Date();
  desde.setDate(desde.getDate() - Math.max(30, Number(dias) || 180));

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 15)}
            P.CODIGO, ${campoTexto('P.DESCRICAO', 70, 'DESCRICAO')},
            P.ESTOQUEATUAL, P.PRECOCUSTO, P.PRECOVENDA
       FROM PRODUTO P
      WHERE (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND CAST(REPLACE(P.ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION) > 0
        AND NOT EXISTS (
              SELECT 1 FROM ITEMPEDIDO I
                JOIN PEDIDOS PE ON PE.NUMERO = I.NUMERO
               WHERE TRIM(I.PRODUTO) IN (TRIM(P.BARRAS), TRIM(P.CODIGO)) AND I.DATA >= ?
                 AND TRIM(PE.STATUS) = 'FATURADO' AND ${ITEM_NAO_ESTORNADO}
            )
      ORDER BY CAST(REPLACE(P.ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION) * P.PRECOCUSTO DESC`,
    [desde]
  );

  return {
    periodo: `sem venda ha mais de ${dias} dias`,
    produtos: linhas.map((l) => ({
      codigo: String(l.CODIGO).trim(),
      descricao: lerTexto(l.DESCRICAO),
      estoque: paraNumero(l.ESTOQUEATUAL),
      custoUnitario: paraNumero(l.PRECOCUSTO),
      dinheiroParado: Number((paraNumero(l.ESTOQUEATUAL) * paraNumero(l.PRECOCUSTO)).toFixed(2)),
    })),
  };
}

/**
 * Historico de mudanca de preco do produto.
 * O Solus guarda isso na tabela ALTERAPRECO: data, quem mexeu, preco antes e depois.
 */
export async function historicoDePreco({ termo, quantos = 10 }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)} DATA, USUARIO, PVA, PVN
       FROM ALTERAPRECO
      WHERE TRIM(BARRAS) = ?
      ORDER BY DATA DESC`,
    [produto.barras || produto.codigo]
  );

  return {
    encontrou: true,
    produto: {
      codigo: produto.codigo,
      descricao: produto.descricao,
      precoHoje: produto.vendaAtual,
    },
    alteracoes: linhas.map((l) => {
      const antes = paraNumero(l.PVA);
      const depois = paraNumero(l.PVN);
      return {
        data: dataBR(l.DATA),
        quemAlterou: String(l.USUARIO || '').trim() || 'nao informado',
        precoAntes: antes,
        precoDepois: depois,
        variacao: antes > 0 ? Number((((depois - antes) / antes) * 100).toFixed(1)) : null,
      };
    }),
    observacao: linhas.length
      ? undefined
      : 'Esse produto nao tem alteracao de preco registrada no Solus.',
  };
}

/** Ultima vez que ESTE cliente levou ESTE produto, e por quanto. */
export async function ultimaVendaParaCliente({ termo, cliente, quantos = 5 }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const texto = String(cliente || '').trim();
  const cadastros = await acharClientes(texto);
  if (!cadastros.length) return { encontrou: false, mensagem: `Nao achei o cliente "${texto}".` };

  // a rede pode ter varios CNPJs com o mesmo nome: procura em TODOS
  const codigos = cadastros.map((c) => c.codigo).slice(0, 30);
  const chaves = chavesDaVenda(produto);

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 5)} I.DATA, I.QTD, I.PRECO, P.NUMERO, P.CODCLIENTE,
            ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(I.PRODUTO) IN (${marcadores(chaves)})
        AND TRIM(P.CODCLIENTE) IN (${marcadores(codigos)})
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    [...chaves, ...codigos]
  );

  const porCodigo = new Map(cadastros.map((c) => [c.codigo, c]));

  if (!linhas.length) {
    return {
      encontrou: true,
      comprou: false,
      produto: { codigo: produto.codigo, descricao: produto.descricao },
      cadastrosProcurados: cadastros.map(resumirCliente),
      mensagem: cadastros.length > 1
        ? `Procurei nos ${cadastros.length} cadastros com esse nome e nenhum levou esse produto.`
        : 'Esse cliente nunca levou esse produto.',
      precoDeTabelaHoje: produto.vendaAtual,
    };
  }

  return {
    encontrou: true,
    comprou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao },
    // quando o nome bate em varios CNPJs, a resposta diz de QUAL deles foi cada compra
    cadastrosComEsseNome: cadastros.length,
    precoDeTabelaHoje: produto.vendaAtual,
    vezes: linhas.map((l) => {
      const codigoCliente = String(l.CODCLIENTE || '').trim();
      const cadastro = porCodigo.get(codigoCliente);
      const comoFoiVendido = lerTexto(l.DESCRICAO) || produto.descricao;
      return {
        data: dataBR(l.DATA),
        cliente: cadastro ? resumirCliente(cadastro) : { codigo: codigoCliente },
        comoFoiVendido: comoFoiVendido !== produto.descricao ? comoFoiVendido : undefined,
        quantidade: paraNumero(l.QTD),
        precoPago: paraNumero(l.PRECO),
        ...comMetroQuadrado(l, comoFoiVendido, produto.descricao),
        pedido: Number(l.NUMERO),
      };
    }),
  };
}
