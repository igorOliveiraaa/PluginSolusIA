// Conferencia que ficou no meio: continuar de onde parou.
//
//   node src/ferramentas/t-rascunho.mjs     (o Plugin precisa estar ligado)
//
// Confere: abrir a nota guarda a conferencia; o que a pessoa decide e guardado;
// abrir a mesma nota de novo avisa e devolve tudo como estava (decisoes, fornecedor
// ligado); recomecar apaga; gravar no Solus apaga. Limpa tudo no fim.
import fs from 'node:fs';
import path from 'node:path';
import { entrarComoTeste } from './login-teste.mjs';
import { pastaDaLoja } from '../config.js';
import { lerRascunho, apagarRascunho } from '../rascunhos.js';
import { cadastrarFornecedorDaNota, apagarFornecedorDeTeste } from './fornecedor-de-teste.mjs';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

const chamar = await entrarComoTeste();
const json = async (caminho, opcoes) => (await chamar(caminho, opcoes)).json();
const post = (caminho, corpo) => json(caminho, { method: 'POST', body: JSON.stringify(corpo || {}) });
const lerNota = () => {
  const envio = new FormData();
  envio.append('arquivos', new Blob([fs.readFileSync('exemplos/nota-teste-entrada.xml')], { type: 'text/xml' }), 'nota.xml');
  return json('/api/ler-nota', { method: 'POST', body: envio });
};

const primeira = await lerNota();
const chave = primeira.conferencia?.chave;
apagarRascunho(chave);
await apagarFornecedorDeTeste();
const historicoParaApagar = [];

try {
  console.log('\n=== 1. Abrir a nota guarda a conferencia ===');
  const leitura = await lerNota();
  conferir('a nota foi lida (e nao havia conferencia comecada)', leitura.ok && !leitura.rascunho, leitura.erro);
  conferir('a conferencia ficou guardada', Boolean(lerRascunho(chave)));

  console.log('\n=== 2. O que a pessoa decide fica guardado ===');
  const decisoes = leitura.conferencia.itens.map((i) => ({ acao: i.acao, quantidadeUnidades: i.quantidadeUnidades,
    custoUnitario: i.custoUnitario, precoVenda: i.precoVenda, igualarIrmaos: false, desativarIrmaos: [] }));
  decisoes[0].precoVenda = 9.87;          // mudou o preco do 1o item
  decisoes[2].acao = 'ignorar';           // marcou o 3o como "nao entrar"
  await cadastrarFornecedorDaNota(chamar, leitura);   // e ligou o fornecedor
  const salvou = await post('/api/rascunho', { id: leitura.id, decisoes });
  conferir('guardou as decisoes', salvou.ok && salvou.salvo, salvou.erro);

  console.log('\n=== 3. Abrir a mesma nota de novo ===');
  const deNovo = await lerNota();
  conferir('avisa que a nota ja foi comecada (e quando)', Boolean(deNovo.rascunho?.atualizadoEm), deNovo.rascunho?.atualizadoEm);
  const continuou = await post(`/api/rascunho/${chave}/abrir`);
  conferir('continuar devolve as decisoes como estavam', continuou.ok && continuou.decisoes?.[0]?.precoVenda === 9.87
    && continuou.decisoes?.[2]?.acao === 'ignorar', continuou.erro);
  conferir('e o fornecedor que ja tinha sido ligado', Boolean(continuou.conferencia?.fornecedor?.codigoNoSolus),
    continuou.conferencia?.fornecedor?.codigoNoSolus);
  conferir('a conferencia continuada esta aberta (da para gravar)', typeof continuou.id === 'string' && continuou.id.length > 5);

  console.log('\n=== 4. Recomecar do zero ===');
  const apagou = await json(`/api/rascunho/${chave}`, { method: 'DELETE' });
  conferir('recomecar apaga o que estava guardado', apagou.ok && !lerRascunho(chave));
  const semNada = await post(`/api/rascunho/${chave}/abrir`);
  conferir('  e continuar depois disso explica que nao ha mais', semNada.ok !== true && /n[aã]o achei/i.test(semNada.erro), semNada.erro);

  console.log('\n=== 5. Gravar no Solus apaga a conferencia guardada ===');
  const outra = await lerNota();                     // fornecedor ja cadastrado: vem ligado sozinho
  conferir('abriu de novo e guardou', Boolean(lerRascunho(chave)));
  const soUm = outra.conferencia.itens.map((i, n) => ({ acao: n === 0 ? i.acao : 'ignorar', quantidadeUnidades: i.quantidadeUnidades,
    custoUnitario: i.custoUnitario, precoVenda: i.precoVenda }));
  const gravou = await post('/api/aplicar', { id: outra.id, decisoes: soUm, operador: 'teste' });
  conferir('gravou', gravou.ok, gravou.erro);
  if (gravou.ok) historicoParaApagar.push(gravou.historico);
  conferir('a conferencia guardada sumiu', !lerRascunho(chave));
  if (gravou.ok) {
    const desfez = await post(`/api/desfazer/${gravou.historico}`);
    conferir('(desfeito, para a copia do banco voltar)', desfez.ok, desfez.erro);
  }
} finally {
  apagarRascunho(chave);
  await apagarFornecedorDeTeste();
  for (const id of historicoParaApagar) {
    try { fs.unlinkSync(path.join(pastaDaLoja('historico'), `${id}.json`)); } catch { /* ja nao existe */ }
  }
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
