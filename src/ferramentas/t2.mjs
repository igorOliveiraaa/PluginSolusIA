import { buscarPorBarras, buscarPorDescricao, buscarPorCodigoDoFornecedor } from '../db/produtos.js';

const p = await buscarPorBarras('7896098905913');
console.log('Por barras:', p ? `[${p.codigo}] ${p.descricao} | estoque=${p.estoque} custo=${p.custoAtual} venda=${p.vendaAtual} margem=${p.margemAtual.toFixed(1)}%` : 'nao achou');

const lista = await buscarPorDescricao('SABAO EM PEDRA YPE');
console.log('Por descricao:', lista.length, 'achados');
lista.slice(0, 3).forEach(x => console.log('   -', x.descricao));

const semZero = await buscarPorBarras('070330909229');
console.log('EAN com zero a mais:', semZero ? semZero.descricao : 'nao achou');
process.exit(0);
