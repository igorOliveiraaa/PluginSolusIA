// Marcar produtos parados ha mais de 2 anos como " - DESATIVADO" (e desfazer).
//   node src/ferramentas/t-parados.mjs      (banco de TESTE; so mexe em 3 produtos)

import { listarParados, marcarParados, nomeComMarca } from '../db/parados.js';
import { desfazer } from '../db/gravacao.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { invalidarCatalogo } from '../db/catalogo.js';

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

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
