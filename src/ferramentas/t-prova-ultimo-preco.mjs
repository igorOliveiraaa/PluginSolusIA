// Prova, com dados reais do banco, que o "esse cliente pagou" e mesmo o ultimo
// preco DAQUELE cliente naquele produto.
//
// Como prova: pega uma venda de verdade no banco (cliente X levou o produto Y
// por R$ Z no dia D), monta um orcamento para o cliente X com o produto Y, e
// confere se a tela mostra exatamente R$ Z e a data D.

import { consultar, campoTexto, lerTexto, paraNumero } from '../db/firebird.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { buscarPorCodigo, buscarPorBarras } from '../db/produtos.js';
import { montarOrcamento } from '../logica/orcamento.js';

let falhas = 0;
const conferir = (t, ok, d = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${t}${d ? ' -> ' + String(d).slice(0, 95) : ''}`);
  if (!ok) falhas += 1;
};
const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
const dia = (d) => new Date(d).toLocaleDateString('pt-BR');

// ---------------------------------------------------------------------------
console.log('\n=== 1. Procurando vendas de verdade no banco ===');

const vendas = await consultar(
  `SELECT FIRST 60 TRIM(P.CODCLIENTE) AS CLIENTE, TRIM(I.PRODUTO) AS CHAVE,
          ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}, I.PRECO, I.DATA
     FROM ITEMPEDIDO I
     JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
    WHERE P.CODCLIENTE IS NOT NULL AND TRIM(P.CODCLIENTE) NOT IN ('', '1')
      AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
      AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
      AND I.PRECO IS NOT NULL
    ORDER BY I.DATA DESC`
);
conferir('achei vendas', vendas.length > 0, `${vendas.length} linhas`);

// pega 3 casos diferentes (cliente + produto que existem no cadastro de hoje)
const casos = [];
const jaVistos = new Set();

for (const v of vendas) {
  if (casos.length >= 3) break;
  const par = `${v.CLIENTE}|${v.CHAVE}`;
  if (jaVistos.has(par)) continue;
  jaVistos.add(par);

  const cliente = await buscarClientePorCodigo(v.CLIENTE);
  if (!cliente) continue;
  const produto = (await buscarPorBarras(v.CHAVE)) || (await buscarPorCodigo(v.CHAVE));
  if (!produto) continue;

  // qual foi MESMO a ultima venda desse produto para esse cliente?
  const [ultima] = await consultar(
    `SELECT FIRST 1 I.PRECO, I.DATA
       FROM ITEMPEDIDO I JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ? AND TRIM(I.PRODUTO) = ?
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
        AND (I.STATUS IS NULL OR I.STATUS <> 'EXTORNADO')
      ORDER BY I.DATA DESC`,
    [v.CLIENTE, v.CHAVE]
  );
  if (!ultima) continue;

  casos.push({
    cliente,
    produto,
    precoDeVerdade: paraNumero(ultima.PRECO),
    dataDeVerdade: ultima.DATA,
    comoFoiVendido: lerTexto(v.DESCRICAO),
  });
}

conferir('separei casos para provar', casos.length > 0, `${casos.length} casos`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. Montando o orcamento e conferindo numero por numero ===');

for (const caso of casos) {
  console.log(`\n  --- ${caso.cliente.nome} (cod. ${caso.cliente.codigo}) ---`);
  console.log(`      produto: ${caso.produto.descricao}`);
  console.log(`      no banco: ${brl(caso.precoDeVerdade)} em ${dia(caso.dataDeVerdade)}`);

  const orcamento = await montarOrcamento({
    lista: { itens: [{ descricao: caso.produto.descricao, quantidade: 1, textoOriginal: caso.produto.descricao }] },
    cliente: caso.cliente,
    mostrarCusto: true,
  });

  const item = orcamento.itens[0];
  const mostrado = item.ultimoPrecoCliente;

  console.log(`      na tela : ${mostrado ? brl(mostrado.preco) + ' em ' + dia(mostrado.data) : 'NADA'}`);

  conferir('    achou o mesmo produto',
    item.produto?.codigo === caso.produto.codigo || !item.produto,
    item.produto?.descricao || 'ficou em duvida (a pessoa escolhe)');

  // se a busca escolheu outro produto parecido, o preco e de outro item mesmo
  if (item.produto?.codigo !== caso.produto.codigo) {
    console.log('      (a busca trouxe outro produto parecido; nao da para comparar o preco)');
    continue;
  }

  conferir('    mostrou o "esse cliente pagou"', Boolean(mostrado));
  if (!mostrado) continue;

  conferir('    o VALOR e exatamente o do banco',
    Math.abs(mostrado.preco - caso.precoDeVerdade) < 0.005,
    `${brl(mostrado.preco)} x ${brl(caso.precoDeVerdade)}`);
  conferir('    a DATA e exatamente a do banco',
    dia(mostrado.data) === dia(caso.dataDeVerdade),
    `${dia(mostrado.data)} x ${dia(caso.dataDeVerdade)}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. O preco e DAQUELE cliente, nao de qualquer um ===');

if (casos.length) {
  const caso = casos[0];

  // um cliente diferente, que nunca levou esse produto
  const [outro] = await consultar(
    `SELECT FIRST 1 TRIM(CODIGO) AS CODIGO FROM CLIENTES
      WHERE TRIM(CODIGO) <> ? AND CODIGO SIMILAR TO '[0-9]+'
        AND TRIM(CODIGO) NOT IN (
          SELECT TRIM(P.CODCLIENTE) FROM PEDIDOS P
          JOIN ITEMPEDIDO I ON I.NUMERO = P.NUMERO
          WHERE TRIM(I.PRODUTO) = ?)`,
    [caso.cliente.codigo, caso.produto.barras || caso.produto.codigo]
  );

  if (outro) {
    const clienteOutro = await buscarClientePorCodigo(outro.CODIGO);
    const orcamento = await montarOrcamento({
      lista: { itens: [{ descricao: caso.produto.descricao, quantidade: 1, textoOriginal: caso.produto.descricao }] },
      cliente: clienteOutro,
      mostrarCusto: true,
    });
    const item = orcamento.itens[0];
    conferir('cliente que nunca levou NAO mostra preco de outro',
      !item.ultimoPrecoCliente,
      item.ultimoPrecoCliente ? 'mostrou ' + brl(item.ultimoPrecoCliente.preco) + ' (ERRADO)' : 'nao mostrou (certo)');
    conferir('mas mostra a ultima venda da LOJA (que e outra informacao)',
      item.ultimoPrecoLoja !== undefined,
      item.ultimoPrecoLoja ? brl(item.ultimoPrecoLoja.preco) : 'sem venda registrada');
  }
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> CONFERE COM O BANCO'));
process.exit(falhas ? 1 : 0);
