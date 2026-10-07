// O caixa vende ENQUANTO a nota esta sendo conferida: a venda nao pode sumir.
//
//   node src/ferramentas/t-estoque-na-hora.mjs
//
// Antes o Plugin gravava "estoque de quando a nota abriu + quantidade da nota".
// Uma nota grande leva 20 minutos para conferir; o que o caixa vendeu nesse meio
// tempo voltava para o estoque. Agora o estoque (e custo/preco do "antes") e
// lido de novo no momento de gravar. Usa a copia do banco e devolve como estava.
import { consultar, paraNumero, paraTextoBR } from '../db/firebird.js';
import { aplicarNota, desfazer } from '../db/gravacao.js';
import { buscarPorBarras } from '../db/produtos.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};
const estoqueNoBanco = async (codigo) => paraNumero((await consultar(
  'SELECT ESTOQUEATUAL FROM PRODUTO WHERE TRIM(CODIGO) = ?', [codigo]))[0].ESTOQUEATUAL);
const mudarEstoque = (codigo, valor) => consultar(
  'UPDATE PRODUTO SET ESTOQUEATUAL = ?, ESTOQUETOTAL = ? WHERE TRIM(CODIGO) = ?',
  [paraTextoBR(valor, 2), paraTextoBR(valor, 2), codigo]);

// a conferencia abre: o produto e lido COM o estoque daquele momento
const naConferencia = await buscarPorBarras('7891051015210');
const codigo = naConferencia.codigo;
const original = await estoqueNoBanco(codigo);
console.log(`\nProduto ${naConferencia.descricao}: estoque ao abrir a nota = ${original}`);

let registros = null;
try {
  // ...e enquanto a pessoa confere, o caixa vende 7
  await mudarEstoque(codigo, original - 7);

  registros = await aplicarNota({
    itens: [{
      acao: 'atualizar', produto: naConferencia, quantidadeUnidades: 20,
      custoUnitario: naConferencia.custoAtual || 1, precoVenda: naConferencia.vendaAtual || 2,
    }],
  });
  const depois = await estoqueNoBanco(codigo);
  conferir('a nota soma em cima do estoque de AGORA (a venda do caixa nao some)',
    depois === original - 7 + 20, `${original} - 7 vendidos + 20 da nota = ${depois}`);
  conferir('o historico mostra o estoque de quando gravou',
    registros[0].antesValores.estoque === original - 7, `antes ${registros[0].antesValores.estoque}`);

  // depois de gravar o caixa vende mais 3; desfazer horas depois so tira os 20 da nota
  await mudarEstoque(codigo, original - 7 + 20 - 3);
  await desfazer(JSON.parse(JSON.stringify(registros)));
  registros = null;
  conferir('desfazer tira so o que a nota somou (as vendas de depois ficam)',
    (await estoqueNoBanco(codigo)) === original - 7 - 3, `${original - 7 + 20 - 3} - 20 = ${await estoqueNoBanco(codigo)}`);
} finally {
  if (registros) await desfazer(registros);
  await mudarEstoque(codigo, original);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
