// O caso da loja (10/2026): pediram "desinfetante liquido aylag lavanda" e o
// orcamento sugeriu outra coisa - para quem compra muito o de ALGAS, vinha o de algas.
//
//   node src/ferramentas/t-palavra-que-distingue.mjs     (usa a IA de verdade)
//
// Confere a regra da PALAVRA QUE DISTINGUE: palavra pedida que outro candidato
// tem e este nao ("lavanda") tira o candidato da escolha automatica, mesmo sendo
// o que o cliente mais compra e mesmo com a IA dizendo "mesmo produto". E que a
// sugestao automatica fica so entre os produtos que estao valendo (desativado e
// cancelado nao entram).
const R = '../';
const { montarOrcamento } = await import(R + 'logica/orcamento.js');
const { lerListaDigitada } = await import(R + 'leitura/lista-texto.js');
const { buscarClientePorCodigo } = await import(R + 'db/clientes.js');
const { buscarPorDescricao } = await import(R + 'db/produtos.js');

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 170) : ''}`);
  if (!ok) falhas += 1;
};

console.log('\n=== Pediu lavanda: nunca outro perfume ===');
// 1336, 1075 e 930 compram MUITO o de algas/jasmim; 1199 ja levou o lavanda 5L
for (const codigo of [null, '1336', '1075', '930', '1199']) {
  const cliente = codigo ? await buscarClientePorCodigo(codigo) : null;
  for (const pedido of ['2 desinfetante liquido aylag lavanda', '2 desinfetante aylag lavanda']) {
    const { itens: [item] } = await montarOrcamento({ lista: lerListaDigitada(pedido), cliente, mostrarCusto: false });
    const escolhido = item.produto?.descricao || '';
    const primeiras = (item.opcoes || []).slice(0, 2).map((o) => o.descricao);
    conferir(`cliente ${codigo || 'sem cliente'} · "${pedido}"`,
      (!escolhido || /LAVANDA/.test(escolhido)) && primeiras.every((d) => /LAVANDA/.test(d)),
      escolhido ? `escolheu ${escolhido}` : `perguntou: ${primeiras.join(' / ')}`);
  }
}
const quemJaLevou = await montarOrcamento({
  lista: lerListaDigitada('2 desinfetante aylag lavanda'), cliente: await buscarClientePorCodigo('1199'), mostrarCusto: false,
});
conferir('quem ja levou o lavanda 5L recebe o lavanda 5L sozinho',
  /LAVANDA\s+AYLAG 5L/.test(quemJaLevou.itens[0].produto?.descricao || ''), quemJaLevou.itens[0].produto?.descricao);

console.log('\n=== A sugestao automatica fica so entre os que estao valendo ===');
const automatica = await buscarPorDescricao('agua sanitaria aylag', 8, { esconderParados: true });
conferir('cancelado nao entra na sugestao', automatica.every((p) => !p.cancelado),
  automatica.map((p) => p.descricao).join(' | '));
const naMao = await buscarPorDescricao('agua sanitaria aylag', 8);
conferir('na pesquisa feita na mao ele aparece (marcado, no fim)', naMao.some((p) => p.cancelado) && !naMao[0].cancelado,
  naMao.map((p) => `${p.descricao}${p.cancelado ? ' [cancelado]' : ''}`).join(' | '));

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
