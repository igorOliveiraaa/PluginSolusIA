// Marcar produtos parados (prazo dos Ajustes) como " - DESATIVADO" (e desfazer).
//   node src/ferramentas/t-parados.mjs      (banco de TESTE; so mexe em 3 produtos)

import { listarParados, marcarParados, nomeComMarca } from '../db/parados.js';
import { desfazer } from '../db/gravacao.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { invalidarCatalogo, diasParaParado } from '../db/catalogo.js';
import { carregarConfig, salvarConfig } from '../config.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 140) : ''}`);
  if (!ok) falhas += 1;
};

const nomeNoBanco = async (codigo) => lerTexto((await consultar(
  `SELECT ${campoTexto('DESCRICAO', 70)}, STATUS FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
))[0]?.DESCRICAO);
const statusNoBanco = async (codigo) => String((await consultar(
  'SELECT STATUS FROM PRODUTO WHERE TRIM(CODIGO) = ?', [codigo]
))[0]?.STATUS || '').trim();

console.log('\n=== 1. A lista ===');
const lista = await listarParados();
conferir('achou produtos parados (ativos, sem a marca)', lista.total > 0,
  `${lista.total} parados, ${lista.comEstoque} com estoque`);
conferir('nenhum da lista esta CANCELADO nem ja marcado',
  lista.produtos.every((p) => !/DESATIVADO/i.test(p.descricao)));
conferir('os mais antigos vem primeiro',
  (lista.produtos[0]?.ultimaAtividade || 0) <= (lista.produtos.at(-1)?.ultimaAtividade || Infinity));

console.log('\n=== 2. O nome com a marca cabe na coluna ===');
conferir('nome curto ganha a marca inteira', nomeComMarca('DETERGENTE YPE 500ML') === 'DETERGENTE YPE 500ML - DESATIVADO');
const longo = nomeComMarca('X'.repeat(70));
conferir('nome de 70 letras encurta e mantem a marca', longo.length === 70 && longo.endsWith(' - DESATIVADO'), longo);
conferir('nao marca duas vezes', nomeComMarca('SABAO - DESATIVADO') === 'SABAO - DESATIVADO');

console.log('\n=== 3. Marcar 3 produtos de verdade e desfazer ===');
const alvos = lista.produtos.slice(0, 3);
const antes = await Promise.all(alvos.map(async (p) => ({ codigo: p.codigo, nome: await nomeNoBanco(p.codigo), status: await statusNoBanco(p.codigo) })));
const registros = await marcarParados(alvos.map((p) => p.codigo));
conferir('marcou exatamente os 3 pedidos', registros.length === 3, registros.map((r) => r.codigo).join(', '));

for (const produto of antes) {
  const depois = await nomeNoBanco(produto.codigo);
  conferir(`"${produto.nome.slice(0, 30)}" ganhou a marca`, depois.endsWith(' - DESATIVADO') && depois.startsWith(produto.nome.slice(0, 20)), depois);
  conferir('  e o STATUS nao mudou (continua vendavel)', (await statusNoBanco(produto.codigo)) === produto.status);
}

invalidarCatalogo();
const listaDepois = await listarParados();
conferir('os marcados saem da lista de "falta marcar"', listaDepois.total === lista.total - 3,
  `${lista.total} -> ${listaDepois.total}`);

await desfazer(registros);
for (const produto of antes) {
  conferir(`desfazer devolveu "${produto.nome.slice(0, 30)}"`, (await nomeNoBanco(produto.codigo)) === produto.nome);
}

console.log('\n=== 4. Mudar o prazo nos Ajustes (2 anos -> 1 ano) ===');
// E o caso da loja: ja marcou com 2 anos e agora quer 1 ano. O que vale e que
// produto JA MARCADO nao volta para a lista (nao ganha a marca duas vezes) e
// que encurtar o prazo so ACRESCENTA produtos novos na lista.
const mesesOriginal = carregarConfig().regras?.mesesParaParado ?? 12;
try {
  salvarConfig({ regras: { mesesParaParado: 24 } });
  invalidarCatalogo();
  const doisAnos = await listarParados();
  conferir('com 24 meses o prazo vira 2 anos', Math.round(diasParaParado() / 30.44) === 24, `${diasParaParado()} dias`);

  salvarConfig({ regras: { mesesParaParado: 12 } });
  invalidarCatalogo();
  const umAno = await listarParados();
  conferir('com 12 meses o prazo vira 1 ano', Math.round(diasParaParado() / 30.44) === 12, `${diasParaParado()} dias`);
  conferir('encurtar o prazo so aumenta a lista', umAno.total >= doisAnos.total,
    `2 anos: ${doisAnos.total} produtos · 1 ano: ${umAno.total} produtos`);

  const codigosDeDoisAnos = new Set(doisAnos.produtos.map((p) => p.codigo));
  conferir('todo parado de 2 anos continua na lista de 1 ano',
    doisAnos.produtos.every((p) => umAno.produtos.some((q) => q.codigo === p.codigo)));

  // marca um que so aparece com 1 ano, volta para 2 anos e confere que ele
  // nao reaparece como "falta marcar" (a marca no nome ja o tira da conta)
  const novoDoUmAno = umAno.produtos.find((p) => !codigosDeDoisAnos.has(p.codigo));
  if (novoDoUmAno) {
    const nomeAntes = await nomeNoBanco(novoDoUmAno.codigo);
    const marcados = await marcarParados([novoDoUmAno.codigo]);
    invalidarCatalogo();
    const depoisDeMarcar = await listarParados();
    conferir('produto ja marcado nao aparece de novo para marcar',
      !depoisDeMarcar.produtos.some((p) => p.codigo === novoDoUmAno.codigo),
      `${nomeAntes.slice(0, 30)} -> ${await nomeNoBanco(novoDoUmAno.codigo)}`);
    conferir('e o nome nao ganhou a marca duas vezes',
      (await nomeNoBanco(novoDoUmAno.codigo)).match(/DESATIVADO/g)?.length === 1);
    await desfazer(marcados);
    conferir('desfazer devolveu o nome', (await nomeNoBanco(novoDoUmAno.codigo)) === nomeAntes);
  } else {
    conferir('havia produto novo no prazo de 1 ano para testar', true, 'nenhum a mais neste banco');
  }
} finally {
  salvarConfig({ regras: { mesesParaParado: mesesOriginal } });
  invalidarCatalogo();
  console.log(`  (prazo devolvido para ${mesesOriginal} meses)`);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
