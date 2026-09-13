import * as v from '../db/vendas.js';

console.log('--- formas de pagamento ---');
(await v.formasDePagamento()).forEach(f => console.log(`  "${f.nome}" | prazo: ${f.aPrazo} | parcelado: ${f.parcelado}`));

console.log('\n--- como o cliente 861 costuma comprar ---');
console.log(' ', JSON.stringify(await v.comoOClienteCompra('861')));

console.log('\n--- situacao de pedidos reais ---');
const mapa = await v.situacaoDosPedidos([156312, 156268, 154026]);
for (const p of Object.values(mapa)) {
  console.log(`  pedido ${p.numero} | ${p.status} | ${p.cliente.slice(0,26)} | R$ ${p.total} | pgto ${p.formaDePagamento}`);
  console.log(`     nota: ${p.numeroNota || '(sem nota)'} | etapa: ${p.nota.etapa} ${p.nota.situacao ? '| ' + p.nota.situacao : ''}`);
  if (p.nota.chave) console.log(`     chave: ${p.nota.chave}\n     xml:   ${p.nota.caminhoXml}`);
}

console.log('\n--- vendas para empresa sem nota (ultimos 400 dias, banco e de 2025) ---');
const semNota = await v.vendasParaEmpresaSemNota({ dias: 400, quantos: 3 });
semNota.forEach(x => console.log(`  pedido ${x.numero} | ${x.cliente.slice(0,30)} | ${x.documento} | R$ ${x.total}`));

console.log('\n--- orcamentos em aberto ---');
console.log(' ', JSON.stringify(await v.orcamentosEmAberto({ dias: 400 })));
console.log('\n--- vendedores ---');
console.log(' ', (await v.vendedores()).slice(0, 5).map(x => x.nome).join(', '));
process.exit(0);
