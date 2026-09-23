// A limpa do cadastro: desativar repetidos lançando nota, em massa e sem susto.
//
//   node src/ferramentas/t-limpa-cadastro.mjs      (banco de TESTE, desfaz tudo)
//
// O que precisa estar travado, porque vai ser usado MUITO:
//   1. cadastro que está RECEBENDO a mercadoria nesta nota nunca é desativado
//      (seria atualizar o estoque e cancelar o produto em seguida);
//   2. o mesmo cadastro marcado em dois itens da nota é desativado UMA vez;
//   3. quem já estava desativado não é mexido de novo;
//   4. desfazer devolve todos ao que eram.

import { aplicarNota, desfazer } from '../db/gravacao.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { buscarPorDescricao } from '../db/produtos.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

const noBanco = async (codigo) => {
  const linhas = await consultar(
    `SELECT ${campoTexto('DESCRICAO', 70)}, TRIM(STATUS) AS STATUS, ESTOQUEATUAL
       FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
  );
  return {
    nome: lerTexto(linhas[0]?.DESCRICAO || '').trim(),
    status: String(linhas[0]?.STATUS || '').trim(),
    estoque: String(linhas[0]?.ESTOQUEATUAL || ''),
  };
};

// três cadastros parecidos de verdade do banco de teste
const candidatos = await buscarPorDescricao('detergente', 6);
if (candidatos.length < 4) {
  console.log('\n  Banco de teste sem cadastros parecidos suficientes.');
  process.exit(0);
}
const [principal, velho1, velho2, outroItem] = candidatos;
const antes = {
  principal: await noBanco(principal.codigo),
  velho1: await noBanco(velho1.codigo),
  velho2: await noBanco(velho2.codigo),
  outroItem: await noBanco(outroItem.codigo),
};

console.log('\n=== O cenário ===');
console.log(`  recebe a nota: ${principal.descricao} (cód. ${principal.codigo})`);
console.log(`  repetidos:     ${velho1.descricao} / ${velho2.descricao}`);

// dois itens da mesma nota, os dois "vendo" os mesmos cadastros parecidos -
// e o item 2 tentando desativar justamente o cadastro que recebe a mercadoria
const itens = [
  {
    acao: 'atualizar',
    descricao: principal.descricao,
    produto: principal,
    quantidadeUnidades: 6,
    custoUnitario: principal.custoAtual || 1,
    precoVenda: principal.vendaAtual || 2,
    irmaos: [velho1, velho2],
    desativarIrmaos: [velho1.codigo, velho2.codigo],
  },
  {
    acao: 'atualizar',
    descricao: outroItem.descricao,
    produto: outroItem,
    quantidadeUnidades: 3,
    custoUnitario: outroItem.custoAtual || 1,
    precoVenda: outroItem.vendaAtual || 2,
    irmaos: [principal, velho2],
    // de propósito: o MESMO velho2 de novo, e o principal (que recebe a nota
    // no item 1) - as duas coisas têm que ser barradas
    desativarIrmaos: [velho2.codigo, principal.codigo],
  },
];

console.log('\n=== Gravando ===');
const registros = await aplicarNota({ itens, atualizarEstoque: true, fornecedor: null });
const desativados = registros.filter((r) => r.acao === 'desativado');

conferir('desativou só 2 cadastros (não 4)', desativados.length === 2,
  desativados.map((d) => d.descricao).join(' | '));
conferir('NÃO desativou quem está recebendo a mercadoria',
  !desativados.some((d) => d.codigo === principal.codigo)
    && (await noBanco(principal.codigo)).status !== 'CANCELADO',
  `${principal.descricao}: status "${(await noBanco(principal.codigo)).status || '(ativo)'}"`);
conferir('o mesmo cadastro marcado em 2 itens foi desativado UMA vez',
  desativados.filter((d) => d.codigo === velho2.codigo).length === 1);

const depoisVelho1 = await noBanco(velho1.codigo);
conferir('o repetido ficou com " - DESATIVADO" no nome',
  depoisVelho1.nome.toUpperCase().includes('DESATIVADO'), depoisVelho1.nome);
conferir('  e com STATUS CANCELADO', depoisVelho1.status === 'CANCELADO');
conferir('o nome não ganhou a marca duas vezes',
  (depoisVelho1.nome.match(/DESATIVADO/g) || []).length === 1, depoisVelho1.nome);

const depoisPrincipal = await noBanco(principal.codigo);
conferir('o principal recebeu o estoque da nota', depoisPrincipal.estoque !== antes.principal.estoque,
  `${antes.principal.estoque} -> ${depoisPrincipal.estoque}`);

console.log('\n=== Desfazendo ===');
await desfazer(registros);
for (const [nome, valor] of Object.entries(antes)) {
  const codigos = { principal: principal.codigo, velho1: velho1.codigo, velho2: velho2.codigo, outroItem: outroItem.codigo };
  const agora = await noBanco(codigos[nome]);
  conferir(`${nome} voltou ao nome de antes`, agora.nome === valor.nome, `${agora.nome}`);
  conferir(`  e ao status de antes`, agora.status === valor.status, `"${agora.status}"`);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
