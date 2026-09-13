// Teste separado: igualar o preco dos cadastros repetidos (sem desativar ninguem).
import { consultar, paraNumero } from '../db/firebird.js';

import { entrarComoTeste } from './login-teste.mjs';

const chamar = await entrarComoTeste();
const ler = async (cods) => {
  const l = await consultar(
    `SELECT CODIGO, PRECOVENDA, ESTOQUEATUAL FROM PRODUTO WHERE TRIM(CODIGO) IN (${cods.map(() => '?').join(',')})`, cods);
  return Object.fromEntries(l.map((x) => [String(x.CODIGO).trim(),
    { venda: paraNumero(x.PRECOVENDA), estoque: paraNumero(x.ESTOQUEATUAL) }]));
};

const antes = await ler(['10877', '11015']);
console.log('antes  ->', JSON.stringify(antes));

const fd = new FormData();
const xml = (await import('node:fs')).readFileSync('exemplos/nota-teste-entrada.xml');
fd.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota.xml');
const leitura = await (await chamar('/api/ler-nota', { method: 'POST', body: fd })).json();

// so o AVENTAL entra; marca igualar preco, sem desativar nada
const decisoes = leitura.conferencia.itens.map((item) => ({
  acao: item.descricao === 'AVENTAL' ? item.acao : 'ignorar',
  quantidadeUnidades: item.quantidadeUnidades,
  custoUnitario: item.custoUnitario,
  precoVenda: item.analise.precoSugerido,
  igualarIrmaos: item.descricao === 'AVENTAL',
  desativarIrmaos: [],
}));

const gravou = await (await chamar('/api/aplicar', {
  method: 'POST',
  body: JSON.stringify({ id: leitura.id, decisoes, operador: 'TESTE-IGUALAR' }),
})).json();
console.log('gravado:', JSON.stringify(gravou.resumo));

const depois = await ler(['10877', '11015']);
console.log('depois ->', JSON.stringify(depois));

const igualou = Math.abs(depois['11015'].venda - depois['10877'].venda) < 0.015;
const estoqueIntacto = depois['11015'].estoque === antes['11015'].estoque;
console.log(igualou ? 'OK   precos ficaram iguais' : 'FALHOU precos diferentes');
console.log(estoqueIntacto ? 'OK   estoque do repetido intacto' : 'FALHOU estoque do repetido mudou');

// desfaz para o banco voltar ao que era
await chamar('/api/desfazer/' + gravou.historico, { method: 'POST' });
const final = await ler(['10877', '11015']);
const voltou = Math.abs(final['11015'].venda - antes['11015'].venda) < 0.015
  && Math.abs(final['10877'].venda - antes['10877'].venda) < 0.015;
console.log(voltou ? 'OK   desfazer restaurou os dois' : 'FALHOU desfazer nao restaurou');
process.exit(igualou && estoqueIntacto && voltou ? 0 : 1);
