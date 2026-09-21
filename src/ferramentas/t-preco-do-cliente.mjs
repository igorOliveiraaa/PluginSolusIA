// "O cliente pediu X -> o Plugin achou o produto que ELE compra e o preco que ELE pagou?"
//
// Simula de verdade: pega clientes reais com muitas compras FATURADAS, escolhe
// produtos que eles compraram e escreve o pedido do jeito solto que o cliente
// escreve (so as 2 ou 3 primeiras palavras + a medida). Depois confere:
//   1. o Plugin escolheu o produto que o cliente compra?
//   2. mostrou o preco que o cliente pagou - e e o da ultima venda FATURADA?
//   3. escolher o cliente DEPOIS de montar da o mesmo resultado?
//
//   node src/ferramentas/t-preco-do-cliente.mjs

import { consultar, lerTexto, campoTexto, paraNumero } from '../db/firebird.js';
import { montarOrcamento, trocarClienteDoOrcamento } from '../logica/orcamento.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { indiceDoCatalogo, codigosDasChaves, palavrasCanonicas } from '../db/catalogo.js';
import { VENDA_VALIDA } from '../db/venda-valida.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

/** Como o cliente escreveria: "AGUA SANITARIA RENDE MAIS 5LT" -> "agua sanitaria 5l". */
function comoOClienteEscreve(descricao) {
  const palavras = palavrasCanonicas(descricao);
  const medida = palavras.find((p) => /^[\d.]+(L|ML|KG|G|M|CM)$/.test(p));
  const nome = palavras.filter((p) => /^[A-Z]{3,}$/.test(p)).slice(0, 2);
  return [...nome, medida].filter(Boolean).join(' ').toLowerCase();
}

const clientes = await consultar(
  `SELECT FIRST 6 P.CODCLIENTE AS C, COUNT(*) AS N
     FROM ITEMPEDIDO I JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
    WHERE ${VENDA_VALIDA} AND P.CODCLIENTE IS NOT NULL AND TRIM(P.CODCLIENTE) <> ''
      AND I.DATA >= '2025-01-01'
    GROUP BY 1 ORDER BY 2 DESC`
);

const indice = await indiceDoCatalogo();
let pedidos = 0;
let acertouProduto = 0;
let mostrouPreco = 0;
let precoCerto = 0;
let depoisIgual = 0;

for (const linha of clientes) {
  const cliente = await buscarClientePorCodigo(String(linha.C).trim());
  if (!cliente) continue;

  // os produtos que ele mais comprou (faturado), um de cada
  const compras = await consultar(
    `SELECT FIRST 40 TRIM(I.PRODUTO) AS CHAVE, ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}, I.PRECO, I.DATA
       FROM ITEMPEDIDO I JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ? AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    [cliente.codigo]
  );
  const vistos = new Set();
  const escolhidos = [];
  for (const compra of compras) {
    const [codigo] = await codigosDasChaves([compra.CHAVE]);
    if (!codigo || vistos.has(codigo)) continue;
    const produto = indice.porCodigo.get(codigo);
    if (!produto || produto.cancelado) continue;
    const texto = comoOClienteEscreve(produto.descricao);
    if (texto.split(' ').length < 2) continue;
    vistos.add(codigo);
    // a ultima venda FATURADA desse produto para esse cliente (e o preco "certo")
    escolhidos.push({ codigo, texto, precoCerto: paraNumero(compra.PRECO), descricao: produto.descricao });
    if (escolhidos.length === 5) break;
  }
  if (!escolhidos.length) continue;

  console.log(`\n=== ${cliente.nome} (cod. ${cliente.codigo}) ===`);
  const lista = { itens: escolhidos.map((e) => ({ textoOriginal: e.texto, descricao: e.texto, quantidade: 1 })) };

  // com o cliente escolhido ANTES
  const comCliente = await montarOrcamento({ lista, cliente, mostrarCusto: true });
  // cliente escolhido DEPOIS de montar
  const semCliente = await montarOrcamento({ lista, cliente: null, mostrarCusto: true });
  await trocarClienteDoOrcamento(semCliente, cliente, true);

  comCliente.itens.forEach((item, i) => {
    const esperado = escolhidos[i];
    pedidos += 1;
    const achou = item.produto?.codigo === esperado.codigo
      || item.opcoes?.[0]?.codigo === esperado.codigo;
    if (achou) acertouProduto += 1;
    const preco = item.ultimoPrecoCliente?.preco;
    if (preco !== undefined && preco !== null) mostrouPreco += 1;
    if (item.produto?.codigo === esperado.codigo && Math.abs((preco ?? -1) - esperado.precoCerto) < 0.005) precoCerto += 1;
    const depois = semCliente.itens[i];
    const mesmo = (depois.produto?.codigo || depois.opcoes?.[0]?.codigo) === (item.produto?.codigo || item.opcoes?.[0]?.codigo);
    if (mesmo) depoisIgual += 1;

    const escolhido = item.produto?.descricao || `(em duvida) 1a opcao: ${item.opcoes?.[0]?.descricao || '-'}`;
    console.log(`  "${esperado.texto}" -> ${escolhido.slice(0, 44)}`
      + ` | pagou: ${preco != null ? 'R$ ' + preco.toFixed(2) : '---'} (certo R$ ${esperado.precoCerto.toFixed(2)})`
      + `${achou ? '' : '  << PRODUTO DIFERENTE: ' + esperado.descricao.slice(0, 30)}`
      + `${mesmo ? '' : '  << MUDOU AO ESCOLHER O CLIENTE DEPOIS'}`);
  });
}

console.log('\n=== Resultado ===');
const pct = (n) => `${n}/${pedidos} (${Math.round((n / Math.max(pedidos, 1)) * 100)}%)`;
conferir('achou o produto que o cliente compra (escolhido ou 1a opcao)', acertouProduto / pedidos >= 0.9, pct(acertouProduto));
conferir('quando escolheu o produto dele, mostrou o preco que ele pagou - e o certo', precoCerto >= acertouProduto * 0.9, pct(precoCerto));
conferir('escolher o cliente DEPOIS de montar da o mesmo resultado', depoisIgual === pedidos, pct(depoisIgual));

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
