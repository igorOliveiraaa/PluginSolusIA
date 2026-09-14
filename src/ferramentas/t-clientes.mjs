import { buscarClientePorNome, buscarClientePorCodigo, ultimasCompras, ultimoPrecoDoCliente } from '../db/clientes.js';

import { clienteParaTeste, termoDeBusca } from './dados-de-teste.mjs';

const doBanco = await clienteParaTeste({ comVariosCadastros: true });
const procurado = termoDeBusca(doBanco?.nome);
const achados = await buscarClientePorNome(procurado);
console.log(`Busca por nome "${procurado}":`, achados.length, 'clientes');
achados.slice(0, 3).forEach(c => console.log(`  [${c.codigo}] ${c.nome} | ${c.cpfCnpj} | ${c.cidade}/${c.uf}`));

const cliente = await buscarClientePorCodigo('861');
console.log('\nCliente 861:', cliente?.nome, '|', cliente?.cpfCnpj);

const compras = await ultimasCompras('861', 5);
console.log('\nUltimas compras desse cliente:', compras.length);
compras.forEach(c => console.log(`  ${new Date(c.data).toLocaleDateString('pt-BR')} | ${c.descricao.slice(0,38).padEnd(38)} | qtd ${c.quantidade} | R$ ${c.preco.toFixed(2)}`));

if (compras.length) {
  const ultimo = await ultimoPrecoDoCliente('861', compras[0].produto);
  console.log('\nUltimo preco desse item para esse cliente: R$', ultimo?.preco, 'em', new Date(ultimo?.data).toLocaleDateString('pt-BR'));
}
process.exit(0);
