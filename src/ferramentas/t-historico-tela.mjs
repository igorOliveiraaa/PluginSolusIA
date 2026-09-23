// O que a pessoa VE no historico quando clica para abrir um lancamento.
//
//   node src/ferramentas/t-historico-tela.mjs        (nao precisa de banco)
//
// Confere o HTML que o Plugin monta, item a item: "de X para Y" so quando
// mudou, o motivo de um item nao ter entrado, o erro em vermelho da nota que
// nao gravou, e nada de "undefined" na tela.

import { cartaoDoHistorico, corpoDoDetalhe, linhaDoRegistro, prazoEmPalavras }
  from '../../web/historico-visual.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

// ===========================================================================
console.log('\n=== 1. O prazo escrito como a gente fala ===');
conferir('365 dias = 1 ano', prazoEmPalavras(365) === '1 ano', prazoEmPalavras(365));
conferir('731 dias = 2 anos', prazoEmPalavras(731) === '2 anos', prazoEmPalavras(731));
conferir('182 dias = 6 meses', prazoEmPalavras(182) === '6 meses', prazoEmPalavras(182));
conferir('548 dias = 1 ano e meio', prazoEmPalavras(548) === '1 ano e meio', prazoEmPalavras(548));

// ===========================================================================
console.log('\n=== 2. Produto atualizado: mostra de quanto para quanto ===');
const atualizado = linhaDoRegistro({
  acao: 'atualizado',
  codigo: '123',
  descricao: 'DETERGENTE YPE 500ML',
  descricaoNaNota: 'DETERG YPE 500 ML CX C/24',
  quantidade: 24,
  antesValores: { estoque: 10, custo: 2, venda: 3.5 },
  depois: { estoque: 34, custo: 2.2, venda: 3.9 },
  atualizadoPelaNota: ['NCM', 'CEST'],
  fiscalPreenchido: ['CST', 'CSTCBS'],
  reativado: true,
  precoMudou: true,
  vinculoCriado: { novo: true },
});
conferir('diz o estoque de antes e o de agora', atualizado.includes('34') && atualizado.includes('10'));
conferir('mostra o custo em dinheiro', atualizado.includes('R$ 2,20'), 'custo novo');
conferir('mostra a venda em dinheiro', atualizado.includes('R$ 3,90'), 'venda nova');
conferir('conta que o produto voltou a ser ativo', atualizado.includes('voltou a ser ativo'));
conferir('conta o que a nota preencheu', atualizado.includes('NCM, CEST'));
conferir('conta quantos campos fiscais entraram', atualizado.includes('2 campos fiscais'));
conferir('avisa que a etiqueta mudou', atualizado.includes('etiqueta nova'));
conferir('mostra o nome que veio na nota', atualizado.includes('DETERG YPE 500 ML CX C/24'));
conferir('nao sobra "undefined" na tela', !/undefined|NaN/.test(atualizado), atualizado.match(/undefined|NaN/)?.[0]);

console.log('\n=== 3. So aparece o que MUDOU ===');
const soEstoque = linhaDoRegistro({
  acao: 'atualizado', codigo: '5', descricao: 'AGUA SANITARIA 5L',
  antesValores: { estoque: 4, custo: 8, venda: 12 },
  depois: { estoque: 16, custo: 8, venda: 12 },
});
conferir('estoque mudou: aparece', soEstoque.includes('estoque'));
conferir('custo igual: nao aparece', !soEstoque.includes('custo'));
conferir('venda igual: nao aparece', !soEstoque.includes('venda'));

console.log('\n=== 4. Produto novo ===');
const criado = linhaDoRegistro({
  acao: 'criado', codigo: '9001', descricao: 'RODO DE MADEIRA 40CM',
  antesValores: null, depois: { estoque: 12, custo: 7.5, venda: 14.9 },
  fiscalPreenchido: ['CST', 'CSTCBS', 'CLASSFISCAL'], precoMudou: true,
});
conferir('diz "cadastrado novo"', criado.includes('cadastrado novo'));
conferir('mostra estoque, custo e preco de venda',
  criado.includes('12') && criado.includes('R$ 7,50') && criado.includes('R$ 14,90'));
conferir('nao tenta mostrar "de X para Y" (nao havia antes)', !criado.includes('seta'));

console.log('\n=== 5. Item que NAO entrou ===');
const ignorado = linhaDoRegistro({
  acao: 'ignorado', codigo: '', descricao: 'LAMINA WILKINSON C/3',
  descricaoNaNota: 'LAMINA WILKINSON C/3', quantidade: 60,
  motivo: 'marcado como "nao entrar" na conferencia',
});
conferir('diz "nao entrou"', ignorado.includes('não entrou'));
conferir('e diz por que', ignorado.includes('marcado como'));

console.log('\n=== 6. Repetido desativado ===');
const desativado = linhaDoRegistro({
  acao: 'desativado', codigo: '77', descricao: 'RODO MADEIRA 40 - DESATIVADO',
  nomeAntes: 'RODO MADEIRA 40', motivo: 'sem movimento desde 02/03/2023',
  antesValores: { estoque: 3, custo: 6, venda: 11 },
  depois: { estoque: 3, custo: 6, venda: 11 },
});
conferir('mostra o nome de antes e o de agora',
  desativado.includes('RODO MADEIRA 40') && desativado.includes('DESATIVADO'));
conferir('mostra desde quando estava parado', desativado.includes('02/03/2023'));

console.log('\n=== 7. Historico ANTIGO (sem antesValores) continua abrindo ===');
const antigo = linhaDoRegistro({
  acao: 'atualizado', codigo: '31', descricao: 'SABAO EM BARRA',
  antes: { ESTOQUEATUAL: '1.234,00', PC: '2,50', PV: '4,20' },
  depois: { estoque: 1250, custo: 2.8, venda: 4.5 },
});
conferir('le o numero em formato brasileiro do registro velho',
  antigo.includes('1.234') && antigo.includes('R$ 2,50'), 'estoque e custo de antes');
conferir('sem "undefined"', !/undefined|NaN/.test(antigo));

console.log('\n=== 8. A nota que DEU ERRO ===');
const falhou = corpoDoDetalhe({
  falhou: true,
  erro: 'Nenhum item foi marcado para gravar.',
  registros: [
    { acao: 'nao-gravado', iaFazer: 'criar', descricao: 'RODO NOVO', descricaoNaNota: 'RODO NOVO', quantidade: 5 },
    { acao: 'nao-gravado', iaFazer: 'atualizar', codigo: '12', descricao: 'BALDE 20L' },
  ],
});
conferir('avisa em cima que NAO foi gravada', falhou.includes('NÃO foi gravada'));
conferir('mostra o erro que aconteceu', falhou.includes('Nenhum item foi marcado'));
conferir('e o que cada item ia fazer',
  falhou.includes('ia ser cadastrado') && falhou.includes('ia ser atualizado'));

console.log('\n=== 9. O cartao da lista ===');
const cartao = cartaoDoHistorico({
  id: '20260922120000-ab12',
  quando: '2026-09-22T12:00:00.000Z',
  operador: 'IGOR',
  nota: { numero: '1234', fornecedor: { nome: 'DISTRIBUIDORA TESTE' } },
  resumo: { produtosCriados: 2, produtosAtualizados: 3, precosIgualados: 0, produtosDesativados: 2, itensIgnorados: 1 },
});
conferir('mostra o numero da nota e o fornecedor',
  cartao.includes('Nota 1234') && cartao.includes('DISTRIBUIDORA TESTE'));
conferir('resume o que aconteceu, inclusive o que nao entrou',
  cartao.includes('2 cadastrados') && cartao.includes('1 não entraram'));
conferir('tem o botao de abrir e o de desfazer',
  cartao.includes('Ver o que foi feito') && cartao.includes('data-desfazer'));

const daFalha = cartaoDoHistorico({
  id: 'x1', quando: '2026-09-22T12:00:00.000Z', operador: 'IGOR', falhou: true,
  erro: 'Produto sem codigo de barras.', nota: { numero: '99' }, resumo: {},
});
conferir('o cartao da falha nao oferece desfazer', !daFalha.includes('data-desfazer'));
conferir('e mostra o erro no cartao', daFalha.includes('Produto sem codigo de barras'));

console.log('\n=== 10. Nome de produto com < > & nao quebra a tela ===');
const perigoso = linhaDoRegistro({
  acao: 'atualizado', codigo: '1', descricao: 'SABAO <b>P&G</b> "top"',
  antesValores: { estoque: 1, custo: 1, venda: 2 }, depois: { estoque: 2, custo: 1, venda: 2 },
});
conferir('o HTML do nome vem escapado',
  perigoso.includes('&lt;b&gt;') && perigoso.includes('P&amp;G') && !perigoso.includes('<b>'));

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
