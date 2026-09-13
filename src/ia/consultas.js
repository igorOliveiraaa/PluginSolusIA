// As perguntas que o assistente sabe responder sobre a loja.
//
// Regra de ouro deste arquivo: SO LEITURA. Nenhuma funcao aqui grava, apaga ou
// altera qualquer coisa. A IA escolhe qual chamar, mas os numeros saem do banco
// do Solus - ela nao inventa nada.
//
// Todas as consultas tem limite, para nunca travar o banco no meio do expediente.

import { consultar, paraNumero, campoTexto, lerTexto } from '../db/firebird.js';
import { buscarPorBarras, buscarPorDescricao, buscarPorCodigo, semelhanca } from '../db/produtos.js';

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

/** Chave que o Solus usa nos itens de venda: barras, ou o codigo quando nao tem. */
function chaveDoProduto(produto) {
  return produto.barras || produto.codigo;
}

// ---------------------------------------------------------------------------

export async function procurarProduto({ termo, quantos = 5 }) {
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
      precoCusto: p.custoAtual,
      margem: Number(p.margemAtual.toFixed(1)),
      unidade: p.unidade,
      desativado: p.cancelado,
    })),
  };
}

/** Ultimas vendas de um produto: para quem, quando e por quanto. */
export async function ultimasVendasDoProduto({ termo, quantos = 10 }) {
  const produto = await acharProduto(termo);
  if (!produto) return { encontrou: false, mensagem: `Nao achei o produto "${termo}".` };

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos)}
            I.DATA, I.QTD, I.PRECO, P.NUMERO, P.CODCLIENTE,
            ${campoTexto('P.NOMECLI', 50, 'NOMECLI')}, P.STATUS
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(I.PRODUTO) = ?
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
      ORDER BY I.DATA DESC`,
    [chaveDoProduto(produto)]
  );

  return {
    encontrou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao, estoque: produto.estoque },
    totalDeVendasListadas: linhas.length,
    vendas: linhas.map((l) => ({
      data: dataBR(l.DATA),
      cliente: lerTexto(l.NOMECLI) || 'CONSUMIDOR',
      codigoCliente: String(l.CODCLIENTE || '').trim() || null,
      quantidade: paraNumero(l.QTD),
      precoUnitario: paraNumero(l.PRECO),
      pedido: Number(l.NUMERO),
      situacao: String(l.STATUS || '').trim() || 'aberto',
    })),
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
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
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

  let codigo = /^\d{1,5}$/.test(texto) ? texto : null;
  let nome = texto;

  if (!codigo) {
    const { buscarClientePorNome } = await import('../db/clientes.js');
    const achados = await buscarClientePorNome(texto, 1);
    if (!achados.length) return { encontrou: false, mensagem: `Nao achei o cliente "${texto}".` };
    codigo = achados[0].codigo;
    nome = achados[0].nome;
  }

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 15)}
            I.DATA, ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}, I.QTD, I.PRECO, P.NUMERO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ?
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
      ORDER BY I.DATA DESC`,
    [codigo]
  );

  return {
    encontrou: true,
    cliente: { codigo, nome },
    compras: linhas.map((l) => ({
      data: dataBR(l.DATA),
      produto: lerTexto(l.DESCRICAO),
      quantidade: paraNumero(l.QTD),
      precoPago: paraNumero(l.PRECO),
      pedido: Number(l.NUMERO),
    })),
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
        AND (P.STATUS IS NULL OR P.STATUS = 'FATURADO')
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
      WHERE EMISSAO >= ? AND (STATUS IS NULL OR STATUS = 'FATURADO')`,
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
               WHERE TRIM(I.PRODUTO) = TRIM(P.BARRAS) AND I.DATA >= ?
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
  let codigo = /^\d{1,5}$/.test(texto) ? texto : null;
  let nome = texto;

  if (!codigo) {
    const { buscarClientePorNome } = await import('../db/clientes.js');
    const achados = await buscarClientePorNome(texto, 1);
    if (!achados.length) return { encontrou: false, mensagem: `Nao achei o cliente "${texto}".` };
    codigo = achados[0].codigo;
    nome = achados[0].nome;
  }

  const linhas = await consultar(
    `SELECT FIRST ${limitar(quantos, 5)} I.DATA, I.QTD, I.PRECO, P.NUMERO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(I.PRODUTO) = ? AND TRIM(P.CODCLIENTE) = ?
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
      ORDER BY I.DATA DESC`,
    [chaveDoProduto(produto), codigo]
  );

  if (!linhas.length) {
    return {
      encontrou: true,
      comprou: false,
      produto: { codigo: produto.codigo, descricao: produto.descricao },
      cliente: { codigo, nome },
      mensagem: 'Esse cliente nunca levou esse produto.',
      precoDeTabelaHoje: produto.vendaAtual,
    };
  }

  return {
    encontrou: true,
    comprou: true,
    produto: { codigo: produto.codigo, descricao: produto.descricao },
    cliente: { codigo, nome },
    precoDeTabelaHoje: produto.vendaAtual,
    vezes: linhas.map((l) => ({
      data: dataBR(l.DATA),
      quantidade: paraNumero(l.QTD),
      precoPago: paraNumero(l.PRECO),
      pedido: Number(l.NUMERO),
    })),
  };
}
