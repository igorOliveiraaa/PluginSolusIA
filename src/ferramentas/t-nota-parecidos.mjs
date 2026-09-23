// O caso que deu errado na loja: nota lancada e "os produtos novos nao entraram".
//
//   node src/ferramentas/t-nota-parecidos.mjs     (o Plugin precisa estar ligado)
//
// Vai pelo caminho de verdade (servidor + banco de TESTE) e confere:
//   1. produto que nao existe no Solus vem marcado para CADASTRAR;
//   2. todo item traz os cadastros PARECIDOS, para escolher um por um;
//   3. "Cadastrar como novo" funciona num item que ja estava vinculado;
//   4. gravar cria o produto novo E desativa os repetidos marcados;
//   5. o historico mostra item a item o que foi feito (inclusive o que NAO entrou);
//   6. tentativa que da erro tambem fica no historico, em vermelho;
//   7. desfazer devolve tudo.
//
// No fim apaga do historico as duas entradas que ele mesmo criou.
//
// NAO rode com "| head": cortar a saida mata o node antes de desfazer, e os
// produtos de teste ficam no banco (o teste limpa isso sozinho na rodada
// seguinte, mas o resultado daquela rodada sai errado).

import fs from 'node:fs';
import path from 'node:path';
import { entrarComoTeste } from './login-teste.mjs';
import { pastaDaLoja } from '../config.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};

const chamar = await entrarComoTeste();
const json = async (caminho, opcoes) => {
  const resposta = await chamar(caminho, opcoes);
  return resposta.json();
};

const nomeNoBanco = async (codigo) => lerTexto((await consultar(
  `SELECT ${campoTexto('DESCRICAO', 70)} FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
))[0]?.DESCRICAO || '');

const criadosNoHistorico = [];

// Sobra de uma rodada que morreu no meio (o classico: rodar com "| head", que
// fecha a saida e mata o node antes do desfazer). Sem isso, o produto de teste
// fica no banco e a rodada seguinte acusa "nenhum item veio como criar".
const sobras = await consultar(
  `SELECT TRIM(CODIGO) AS CODIGO, ${campoTexto('DESCRICAO', 70)} FROM PRODUTO
    WHERE ${campoTexto('DESCRICAO', 70)} CONTAINING ?`, ['MULTIUSO TESTE']
).catch(() => []);
if (sobras.length) {
  const { emTransacao } = await import('../db/firebird.js');
  await emTransacao(async (executar) => {
    for (const linha of sobras) {
      await executar('DELETE FROM PRODUTO WHERE TRIM(CODIGO) = ?', [linha.CODIGO]);
    }
  });
  console.log(`  (apaguei ${sobras.length} produto(s) de teste que sobraram de uma rodada anterior)`);
}

// ===========================================================================
console.log('\n=== 1. Ler a nota de exemplo ===');

const xml = fs.readFileSync('exemplos/nota-teste-entrada.xml');
const envio = new FormData();
envio.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota-teste-entrada.xml');
const leitura = await json('/api/ler-nota', { method: 'POST', body: envio });
conferir('a nota foi lida', leitura.ok === true, leitura.erro);
if (!leitura.ok) process.exit(1);

const id = leitura.id;
const itens = leitura.conferencia.itens;
conferir('4 itens na nota', itens.length === 4, `${itens.length} itens`);

const novo = itens.find((i) => i.acao === 'criar');
conferir('o produto que nao existe vem marcado para CADASTRAR', Boolean(novo),
  novo ? novo.descricao : 'NENHUM item veio como criar');

console.log('\n=== 2. Os cadastros parecidos vem em todo item ===');
const comParecidos = itens.filter((i) => (i.irmaos || []).length);
conferir('pelo menos um item trouxe parecidos', comParecidos.length > 0,
  itens.map((i) => `${i.descricao.slice(0, 22)}: ${(i.irmaos || []).length}`).join(' | '));

if (novo) {
  conferir('ate o produto NOVO traz os parecidos (para poder desativar os velhos)',
    Array.isArray(novo.irmaos), `${(novo.irmaos || []).length} parecidos`);
}
for (const item of comParecidos) {
  const temMotivo = item.irmaos.every((irmao) => irmao.motivo && irmao.codigo && irmao.descricao);
  conferir(`  "${item.descricao.slice(0, 26)}" explica por que cada parecido apareceu`, temMotivo,
    item.irmaos.map((i) => `${i.descricao.slice(0, 18)} (${i.motivo})`).join(' | '));
}

console.log('\n=== 2b. A IA conferiu os parecidos? ===');
const ia = leitura.conferencia.conferenciaIA;
if (ia?.usou) {
  conferir('a IA classificou os parecidos', ia.itens > 0, `${ia.itens} itens conferidos`);
  for (const item of itens.filter((i) => (i.irmaos || []).length)) {
    const comNota = item.irmaos.filter((x) => x.relacaoIA).length;
    conferir(`  "${item.descricao.slice(0, 24)}": todo parecido tem o parecer da IA`,
      comNota === item.irmaos.length,
      item.irmaos.map((x) => `${x.descricao.slice(0, 20)} [${x.relacaoIA || '-'}${x.motivoIA ? ': ' + x.motivoIA : ''}]`).join(' | '));
    conferir('    e o "mesmo produto" vem antes do "outro"',
      item.irmaos.every((x, i, lista) => i === 0
        || ({ mesmo: 0, variacao: 1, outro: 3 }[lista[i - 1].relacaoIA] ?? 2)
        <= ({ mesmo: 0, variacao: 1, outro: 3 }[x.relacaoIA] ?? 2)));
  }
} else {
  console.log(`  (IA nao conferiu: ${ia?.motivo || 'sem resposta'} - o resto do teste nao depende dela)`);
}

console.log('\n=== 3. "Cadastrar como novo" num item que tinha varios parecidos ===');
// e o caso do "rodo de madeira": o produto e novo, mas ja existem 4 cadastros
// com nome parecido, e a pessoa escolhe um por um quais desativar
const vinculado = itens.findIndex((i) => i.acao === 'atualizar' && i.produto && (i.irmaos || []).length >= 2);
const produtoDeAntes = itens[vinculado].produto;
const virou = await json('/api/virar-novo', {
  method: 'POST',
  body: JSON.stringify({ id, indice: vinculado }),
});
conferir('virou cadastro novo', virou.ok === true && virou.item.acao === 'criar', virou.erro);
conferir('e continua mostrando os parecidos para desativar um por um',
  (virou.item.irmaos || []).length >= 2, `${(virou.item.irmaos || []).length} parecidos`);
conferir('o cadastro que estava vinculado tambem entra na lista (e o velho a desativar)',
  virou.item.irmaos?.[0]?.codigo === produtoDeAntes.codigo,
  `${virou.item.irmaos?.[0]?.descricao} (${virou.item.irmaos?.[0]?.motivo})`);
conferir('com preco de venda calculado', Number(virou.item.precoVenda) > 0, String(virou.item.precoVenda));

console.log('\n=== 4. Gravar: cria os novos, desativa os repetidos, ignora um item ===');
const paraDesativar = virou.item.irmaos.slice(0, 2);      // escolhe 2 dos parecidos
const nomesDeAntes = Object.fromEntries(await Promise.all(
  paraDesativar.map(async (p) => [p.codigo, await nomeNoBanco(p.codigo)])
));
// o item que vai ficar de fora e o primeiro que nao e nenhum dos dois novos
const indiceIgnorado = itens.findIndex((item, i) => i !== vinculado && item !== novo);

const decisoes = itens.map((item, indice) => {
  const base = {
    acao: indice === vinculado ? 'criar' : item.acao,
    quantidadeUnidades: item.quantidadeUnidades,
    custoUnitario: item.custoUnitario,
    precoVenda: indice === vinculado ? virou.item.precoVenda : item.precoVenda,
    igualarIrmaos: false,
    desativarIrmaos: indice === vinculado ? paraDesativar.map((p) => p.codigo) : [],
  };
  if (indice === indiceIgnorado) base.acao = 'ignorar';
  return base;
});

const gravou = await json('/api/aplicar', {
  method: 'POST',
  body: JSON.stringify({ id, decisoes, operador: 'teste', atualizarEstoque: true }),
});
conferir('gravou', gravou.ok === true, gravou.erro);
if (!gravou.ok) process.exit(1);
criadosNoHistorico.push(gravou.historico);

conferir('cadastrou os produtos novos', gravou.resumo.produtosCriados === 2,
  `${gravou.resumo.produtosCriados} criados`);
conferir('o item marcado como "nao entrar" ficou registrado', gravou.resumo.itensIgnorados === 1,
  `${gravou.resumo.itensIgnorados} ignorados`);
conferir('desativou os 2 repetidos escolhidos', gravou.resumo.produtosDesativados === 2,
  `${gravou.resumo.produtosDesativados} desativados`);
for (const velho of paraDesativar) {
  conferir(`  "${nomesDeAntes[velho.codigo].slice(0, 28)}" ficou DESATIVADO no banco`,
    (await nomeNoBanco(velho.codigo)).toUpperCase().includes('DESATIVADO'),
    await nomeNoBanco(velho.codigo));
}

const criados = gravou.registros.filter((r) => r.acao === 'criado');
const criado = criados[0];
for (const novoProduto of criados) {
  conferir('  o produto novo existe mesmo no banco',
    (await nomeNoBanco(novoProduto.codigo)).length > 0,
    `cod ${novoProduto.codigo}: ${await nomeNoBanco(novoProduto.codigo)}`);
}

console.log('\n=== 5. O historico mostra item a item ===');
const detalhe = await json('/api/historico/' + gravou.historico);
conferir('abre o lancamento', detalhe.ok === true, detalhe.erro);
const registros = detalhe.dados.registros;

const oCriado = registros.find((r) => r.acao === 'criado');
conferir('mostra o que foi CADASTRADO, com estoque/custo/venda',
  Boolean(oCriado?.depois?.estoque >= 0 && oCriado?.depois?.venda > 0),
  oCriado ? `${oCriado.descricao}: ${oCriado.depois.estoque} un, vende ${oCriado.depois.venda}` : '');

const oIgnorado = registros.find((r) => r.acao === 'ignorado');
conferir('mostra o item que NAO entrou, com o motivo', Boolean(oIgnorado?.motivo),
  oIgnorado ? `${oIgnorado.descricao}: ${oIgnorado.motivo}` : 'nao registrou o ignorado');

const oAtualizado = registros.find((r) => r.acao === 'atualizado');
conferir('mostra o "antes" de quem foi atualizado (para a tela escrever "de X para Y")',
  Boolean(oAtualizado?.antesValores),
  oAtualizado ? `estoque ${oAtualizado.antesValores?.estoque} -> ${oAtualizado.depois?.estoque}` : '');
conferir('  e o que a nota preencheu no cadastro',
  Array.isArray(oAtualizado?.atualizadoPelaNota),
  (oAtualizado?.atualizadoPelaNota || []).join(', ') || 'nada a preencher');

const desativados = registros.filter((r) => r.acao === 'desativado');
conferir('mostra os repetidos desativados, com o nome de antes',
  desativados.length === 2 && desativados.every((d) => d.nomeAntes === nomesDeAntes[d.codigo]),
  desativados.map((d) => `${d.nomeAntes} -> ${d.descricao}`).join(' | '));

console.log('\n=== 6. Tentativa que da erro tambem fica no historico ===');
const leitura2 = await json('/api/ler-nota', {
  method: 'POST',
  body: (() => {
    const f = new FormData();
    f.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota-teste-entrada.xml');
    return f;
  })(),
});
const tudoIgnorado = leitura2.conferencia.itens.map(() => ({ acao: 'ignorar' }));
const deuErro = await json('/api/aplicar', {
  method: 'POST',
  body: JSON.stringify({ id: leitura2.id, decisoes: tudoIgnorado, operador: 'teste' }),
});
conferir('a gravacao foi recusada', deuErro.ok !== true, deuErro.erro);

const lista = await json('/api/historico?limite=5');
const falhou = lista.historico.find((h) => h.falhou);
conferir('a tentativa que deu erro aparece no historico', Boolean(falhou),
  falhou ? falhou.erro : 'nao registrou a falha');
if (falhou) {
  criadosNoHistorico.push(falhou.id);
  const dela = await json('/api/historico/' + falhou.id);
  conferir('  e guarda o que cada item IA fazer', (dela.dados.registros || []).length > 0,
    `${dela.dados.registros.length} itens`);
  const naoDesfaz = await json('/api/desfazer/' + falhou.id, { method: 'POST' });
  conferir('  nao deixa "desfazer" o que nunca foi gravado', naoDesfaz.ok !== true, naoDesfaz.erro);
}

console.log('\n=== 7. Desfazer devolve tudo ===');
const desfez = await json('/api/desfazer/' + gravou.historico, { method: 'POST' });
conferir('desfez', desfez.ok === true, desfez.erro);
for (const novoProduto of criados) {
  conferir('  o produto criado foi removido', (await nomeNoBanco(novoProduto.codigo)) === '',
    novoProduto.codigo);
}
for (const velho of paraDesativar) {
  conferir('  o repetido voltou ao nome de antes',
    (await nomeNoBanco(velho.codigo)) === nomesDeAntes[velho.codigo],
    await nomeNoBanco(velho.codigo));
}

// limpa o historico deste teste
for (const idHistorico of criadosNoHistorico) {
  const arquivo = path.join(pastaDaLoja('historico'), `${idHistorico}.json`);
  try { fs.unlinkSync(arquivo); } catch { /* ja nao existe */ }
}
console.log(`  (${criadosNoHistorico.length} entradas de teste apagadas do historico)`);

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
