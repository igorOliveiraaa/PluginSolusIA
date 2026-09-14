import { montarOrcamento } from '../logica/orcamento.js';
import { buscarClientePorCodigo } from '../db/clientes.js';

// simula o que a IA devolveria de uma lista escrita a mao
const lista = {
  observacoes: '',
  clienteCitado: '',
  itens: [
    { numero: 1, textoOriginal: '2 saco de lixo grande', descricao: 'saco de lixo', quantidade: 2, unidade: 'pacote', marca: '', tamanho: '100 litros', confianca: 'alta' },
    { numero: 2, textoOriginal: 'detergente ype 500ml x10', descricao: 'detergente', quantidade: 10, unidade: '', marca: 'ype', tamanho: '500ml', confianca: 'alta' },
    { numero: 3, textoOriginal: 'mop umido', descricao: 'mop umido', quantidade: 3, unidade: '', marca: '', tamanho: '', confianca: 'media' },
    { numero: 4, textoOriginal: 'copo de agua', descricao: 'copo de agua', quantidade: 5, unidade: '', marca: '', tamanho: '', confianca: 'baixa' },
    { numero: 5, textoOriginal: 'xyzabc123', descricao: 'produto que nao existe', quantidade: 1, unidade: '', marca: '', tamanho: '', confianca: 'baixa' },
  ],
};

const cliente = await buscarClientePorCodigo('861');
const orc = await montarOrcamento({ lista, cliente, mostrarCusto: true });

console.log('Cliente:', cliente.nome, '\n');
for (const i of orc.itens) {
  console.log(`[${i.numero}] "${i.textoOriginal}" (qtd ${i.quantidade})`);
  if (i.produto) {
    console.log(`    -> ACHOU (${i.comoAchou}, ${i.certeza}): ${i.produto.descricao}`);
    console.log(`       preco R$ ${i.precoUnitario.toFixed(2)} | custo R$ ${(i.custo||0).toFixed(2)} | margem ${i.margem?.toFixed(0)}% | estoque ${i.produto.estoque}`);
    if (i.ultimoPrecoCliente) console.log(`       cliente ja pagou R$ ${i.ultimoPrecoCliente.preco.toFixed(2)}`);
  } else {
    console.log(`    -> PRECISA ESCOLHER (${i.certeza}) - ${i.opcoes.length} opcoes:`);
    i.opcoes.slice(0, 3).forEach(o => console.log(`         . ${o.descricao} (R$ ${o.vendaAtual.toFixed(2)}, est ${o.estoque})`));
  }
  i.avisos.forEach(a => console.log(`       ! ${a.texto}`));
}
console.log('\nResumo:', JSON.stringify(orc.resumo));
process.exit(0);
