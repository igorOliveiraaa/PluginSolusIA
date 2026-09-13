import * as c from '../ia/consultas.js';
console.log('--- produto certo agora? ---');
const v = await c.ultimasVendasDoProduto({ termo: 'SABAO EM PEDRA YPE', quantos: 2 });
console.log('  pedi: SABAO EM PEDRA YPE');
console.log('  achou:', v.produto?.descricao);

console.log('\n--- historico de preco ---');
const h = await c.historicoDePreco({ termo: 'SABAO EM PEDRA YPE', quantos: 5 });
console.log('  produto:', h.produto?.descricao, '| preco hoje R$', h.produto?.precoHoje);
(h.alteracoes || []).forEach(a =>
  console.log(`   ${a.data} | ${a.quemAlterou.padEnd(10)} | R$ ${a.precoAntes} -> R$ ${a.precoDepois} (${a.variacao > 0 ? '+' : ''}${a.variacao}%)`));
if (h.observacao) console.log('  ', h.observacao);

console.log('\n--- ultima venda desse produto para o cliente 861 ---');
const u = await c.ultimaVendaParaCliente({ termo: 'PEDESTAL ORGANIZADOR', cliente: '861' });
console.log('  produto:', u.produto?.descricao, '| cliente:', u.cliente?.nome);
console.log('  comprou?', u.comprou, '| preco de tabela hoje: R$', u.precoDeTabelaHoje);
(u.vezes || []).forEach(x => console.log(`   ${x.data} | qtd ${x.quantidade} | pagou R$ ${x.precoPago}`));
process.exit(0);
