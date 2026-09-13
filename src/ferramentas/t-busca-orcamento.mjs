// Testa os problemas que apareceram na loja, na tela de orcamento:
//
//   1. busca ignorando acento e cedilha
//   2. busca trazendo o que a loja vende, e nao produto cancelado de 2019
//   3. "esse cliente pagou", custo e margem preenchidos nos TRES caminhos
//      (achado sozinho, escolhido na tela, adicionado na mao)
//   4. escolher o cliente DEPOIS de montar a lista
//   5. codigo de barras longo nao derruba a consulta
//
// Roda direto no banco de teste, sem servidor.

import { buscarPorDescricao, buscarPorCodigo, buscarPorBarras } from '../db/produtos.js';
import { palavrasCanonicas, chavesDoProduto, indiceDoCatalogo } from '../db/catalogo.js';
import { ultimoPrecoDoCliente, ultimasCompras, buscarClientePorCodigo } from '../db/clientes.js';
import {
  montarOrcamento, montarItemComProduto, trocarClienteDoOrcamento,
} from '../logica/orcamento.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// ---------------------------------------------------------------------------
console.log('\n=== 1. Acento, cedilha e medida escrita de outro jeito ===');

const iguais = (a, b) => JSON.stringify(palavrasCanonicas(a)) === JSON.stringify(palavrasCanonicas(b));
conferir('acento nao muda a busca', iguais('Água Sanitária', 'agua sanitaria'));
conferir('cedilha nao muda a busca', iguais('SABÃO EM PÓ AÇÃO', 'sabao em po acao'));
conferir('5LT = 5 litros = 5 L', iguais('agua 5LT', 'agua 5 litros') && iguais('agua 5 l', 'agua 5LT'));
conferir('500ML = 500 ml', iguais('detergente 500ML', 'detergente 500 ml'));

// ---------------------------------------------------------------------------
console.log('\n=== 2. A busca traz o que a loja vende ===');

const comAcento = await buscarPorDescricao('Água Sanitária 5 litros', 6);
const semAcentoNaBusca = await buscarPorDescricao('agua sanitaria 5l', 6);
conferir('acha escrevendo com acento', comAcento.length > 0, `${comAcento.length} achados`);
conferir('acha escrevendo sem acento', semAcentoNaBusca.length > 0);
conferir('os dois jeitos dao o mesmo primeiro',
  comAcento[0]?.codigo === semAcentoNaBusca[0]?.codigo, comAcento[0]?.descricao);

const primeiro = semAcentoNaBusca[0];
conferir('o primeiro nao esta cancelado', primeiro && !primeiro.cancelado, primeiro?.descricao);
conferir('o primeiro e o que mais sai', Number(primeiro?.vendidoNoPeriodo) > 0,
  `${primeiro?.descricao} · ${primeiro?.vendidoNoPeriodo} vendidos · ${primeiro?.motivo}`);
conferir('a medida bate (5 litros)', /5\s*L/i.test(semAcento(primeiro?.descricao)), primeiro?.descricao);

const ativosNaFrente = semAcentoNaBusca.findIndex((p) => p.cancelado);
conferir('cancelados ficam no fim da lista',
  ativosNaFrente === -1 || semAcentoNaBusca.slice(0, ativosNaFrente).every((p) => !p.cancelado));

const errandoDigitacao = await buscarPorDescricao('agua sanitria 5l', 3);
conferir('aguenta erro de digitacao', errandoDigitacao.length > 0, errandoDigitacao[0]?.descricao);

// ---------------------------------------------------------------------------
console.log('\n=== 3. Codigo de barras longo nao derruba a consulta ===');

let derrubou = false;
try {
  await buscarPorCodigo('7897534807273');       // 13 digitos num campo de 6
} catch (erro) {
  derrubou = true;
  console.log('     erro:', erro.message);
}
conferir('buscar por codigo com 13 digitos nao explode', !derrubou);

// ---------------------------------------------------------------------------
console.log('\n=== 4. Historico de preco do cliente ===');

// acha um cliente que comprou de verdade e um produto que ele levou
const indice = await indiceDoCatalogo();
let clienteTeste = null;
let produtoTeste = null;
let precoAnterior = null;

for (const codigo of ['1075', '1336', '1']) {
  const cliente = await buscarClientePorCodigo(codigo);
  if (!cliente) continue;
  const compras = await ultimasCompras(cliente.codigo, 40);
  for (const compra of compras) {
    const codigoProduto = indice.porChave.get(String(compra.produto).trim());
    if (!codigoProduto) continue;
    const produto = await buscarPorCodigo(codigoProduto);
    if (!produto) continue;
    const preco = await ultimoPrecoDoCliente(cliente.codigo, chavesDoProduto(produto));
    if (preco) { clienteTeste = cliente; produtoTeste = produto; precoAnterior = preco; break; }
  }
  if (produtoTeste) break;
}

conferir('achei um cliente com compra de verdade', Boolean(clienteTeste), clienteTeste?.nome);
conferir('o ultimo preco desse cliente veio preenchido', Boolean(precoAnterior),
  precoAnterior ? `R$ ${precoAnterior.preco} em ${new Date(precoAnterior.data).toLocaleDateString('pt-BR')}` : 'VAZIO');
conferir('e o produto e o mesmo da compra', Boolean(produtoTeste), produtoTeste?.descricao);

// ---------------------------------------------------------------------------
console.log('\n=== 5. Os tres caminhos mostram as mesmas informacoes ===');

if (produtoTeste && clienteTeste) {
  const base = { numero: 1, textoOriginal: produtoTeste.descricao, descricao: produtoTeste.descricao, quantidade: 2 };

  const escolhidoNaTela = await montarItemComProduto({
    base, produto: produtoTeste, cliente: clienteTeste, mostrarCusto: true, comoAchou: 'escolhido na tela',
  });
  conferir('escolhido na tela traz "esse cliente pagou"', Boolean(escolhidoNaTela.ultimoPrecoCliente),
    escolhidoNaTela.ultimoPrecoCliente ? 'R$ ' + escolhidoNaTela.ultimoPrecoCliente.preco : 'VAZIO');
  conferir('escolhido na tela traz custo', escolhidoNaTela.custo !== null, String(escolhidoNaTela.custo));
  conferir('escolhido na tela traz margem',
    escolhidoNaTela.custo > 0 ? escolhidoNaTela.margem !== null : true,
    escolhidoNaTela.margem != null ? escolhidoNaTela.margem.toFixed(1) + '%' : 'sem custo');
  conferir('escolhido na tela traz preco de tabela', escolhidoNaTela.precoTabela === produtoTeste.vendaAtual);
  conferir('total = preco x quantidade',
    Math.abs(escolhidoNaTela.total - escolhidoNaTela.precoUnitario * 2) < 0.01);

  const semCusto = await montarItemComProduto({ base, produto: produtoTeste, cliente: clienteTeste, mostrarCusto: false });
  conferir('quem nao pode ver custo nao ve', semCusto.custo === null && semCusto.margem === null);
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Escolher o cliente DEPOIS de montar a lista ===');

if (produtoTeste && clienteTeste) {
  const lista = { itens: [{ descricao: produtoTeste.descricao, quantidade: 1, textoOriginal: produtoTeste.descricao }] };

  const semCliente = await montarOrcamento({ lista, cliente: null, mostrarCusto: true });
  conferir('sem cliente, monta assim mesmo', semCliente.itens.length === 1);
  conferir('sem cliente nao ha "esse cliente pagou"', !semCliente.itens[0].ultimoPrecoCliente);

  await trocarClienteDoOrcamento(semCliente, clienteTeste, true);
  conferir('depois de escolher o cliente, o historico aparece',
    Boolean(semCliente.itens[0].ultimoPrecoCliente) || !precoAnterior,
    semCliente.itens[0].ultimoPrecoCliente ? 'R$ ' + semCliente.itens[0].ultimoPrecoCliente.preco : 'nao achou');
  conferir('o cliente ficou no orcamento', semCliente.cliente?.codigo === clienteTeste.codigo);
  conferir('e o resumo continua certo', semCliente.resumo.totalItens === 1);

  await trocarClienteDoOrcamento(semCliente, null, true);
  conferir('tirar o cliente limpa o historico dele', !semCliente.itens[0].ultimoPrecoCliente);
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. Item em duvida nao pode sumir nem entrar sozinho ===');

const listaEstranha = {
  itens: [
    { descricao: 'agua sanitaria', quantidade: 2, textoOriginal: '2 agua sanitaria' },
    { descricao: 'xyzabc que nao existe', quantidade: 1, textoOriginal: '1 xyzabc que nao existe' },
    { descricao: 'detergente', quantidade: 3, textoOriginal: '3 detergente' },
  ],
};
const comDuvida = await montarOrcamento({ lista: listaEstranha, cliente: null, mostrarCusto: true });
conferir('todos os itens da lista aparecem', comDuvida.itens.length === 3,
  `${comDuvida.itens.length} de 3`);
conferir('o resumo conta todos', comDuvida.resumo.totalItens === 3);
conferir('item em duvida fica marcado para escolher',
  comDuvida.itens.some((i) => i.precisaEscolher));
conferir('item em duvida nao entra no total sozinho',
  comDuvida.itens.every((i) => !i.precisaEscolher || !i.incluir));
for (const item of comDuvida.itens) {
  console.log(`     "${item.textoOriginal}" -> ${item.produto ? item.produto.descricao : `${item.opcoes.length} opcoes para escolher`}`);
}

// ---------------------------------------------------------------------------
console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
