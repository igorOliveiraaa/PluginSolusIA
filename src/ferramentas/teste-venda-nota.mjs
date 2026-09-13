// Teste do caminho inteiro do orcamento ate a nota, na COPIA do banco:
//
//   1. Plugin grava o orcamento (com pagamento e frete)
//   2. aparece a tarefa "finalizar no Solus"
//   3. SIMULA o Solus finalizando a venda      -> tarefa vira "gerar a nota"
//   4. SIMULA o Solus gerando a nota autorizada -> tarefa vira "enviar a nota"
//   5. baixa o PDF da nota (DANFE) pelo servidor
//   6. marca como enviada -> a tarefa some
//   7. limpa tudo o que o teste criou

import fs from 'node:fs';
import { entrarComoTeste } from './login-teste.mjs';
import { consultar, emTransacao, paraNumero } from '../db/firebird.js';
import { listarTarefas } from '../tarefas.js';

const chamar = await entrarComoTeste();
let falhas = 0;

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

const tarefasDoPedido = async (numero) =>
  (await listarTarefas()).tarefas.filter((t) => t.numero === numero);

// ---- 1. monta e grava o orcamento ----------------------------------------
console.log('\n=== 1. Plugin monta o orcamento ===');
const formulario = new FormData();
formulario.append('texto', '4 saco de lixo 100 litros\n12 detergente ype 500ml');
formulario.append('cliente', '861');
formulario.append('observacao', 'Entrega em 3 dias uteis. Frete 45. Pagamento em boleto.');

const leitura = await (await chamar('/api/orcamento/montar', { method: 'POST', body: formulario })).json();
if (!leitura.ok) { console.error('FALHOU ao montar:', leitura.erro); process.exit(1); }

// escolhe o produto dos itens em duvida
for (let i = 0; i < leitura.orcamento.itens.length; i += 1) {
  const item = leitura.orcamento.itens[i];
  if (item.precisaEscolher && item.opcoes.length) {
    await chamar('/api/orcamento/escolher', {
      method: 'POST',
      body: JSON.stringify({ id: leitura.id, indice: i, codigoProduto: item.opcoes[0].codigo }),
    });
  }
}

const gravado = await (await chamar('/api/orcamento/gravar', {
  method: 'POST',
  body: JSON.stringify({
    id: leitura.id,
    observacao: 'Entrega em 3 dias uteis.',
    pagamento: {
      formaDePagamento: 'BOLETO', frete: 45, modalidadeFrete: '0',
      entrega: '3 dias uteis', validadeDias: 7, vendedor: 'TESTE',
    },
  }),
})).json();

if (!gravado.ok) { console.error('FALHOU ao gravar:', gravado.erro); process.exit(1); }
const numero = gravado.numero;
conferir('orcamento gravado', Boolean(numero), 'no ' + numero);
conferir('frete somado ao total', Math.abs(gravado.total - (gravado.totalItens + 45)) < 0.01,
  `itens ${gravado.totalItens} + frete 45 = ${gravado.total}`);

const [pedidoNoBanco] = await consultar(
  'SELECT TIPOVENDA, FRETE, MODALIDADEFRETE, ENTREGA, STATUS, TOTALPEDIDO FROM PEDIDOS WHERE NUMERO = ?', [numero]
);
conferir('forma de pagamento gravada no Solus', String(pedidoNoBanco.TIPOVENDA).trim() === 'BOLETO');
conferir('frete gravado no Solus', paraNumero(pedidoNoBanco.FRETE) === 45);
conferir('entrega gravada', String(pedidoNoBanco.ENTREGA).trim() === '3 dias uteis');

// ---- 2. tarefas do orcamento ---------------------------------------------
console.log('\n=== 2. Tarefas logo depois de gravar ===');
let lista = await tarefasDoPedido(numero);
lista.forEach((t) => console.log(`     - [${t.prioridade}] ${t.titulo}`));
conferir('tem tarefa de enviar ao cliente', lista.some((t) => t.tipo === 'enviar-orcamento'));
conferir('tem tarefa de finalizar no Solus', lista.some((t) => t.tipo === 'finalizar'));

// ---- 3. SIMULA o Solus finalizando a venda -------------------------------
console.log('\n=== 3. Alguem finaliza a venda no Solus ===');
await emTransacao((executar) => executar(
  "UPDATE PEDIDOS SET STATUS = 'FATURADO', DATAVENDA = ? WHERE NUMERO = ?", [new Date(), numero]
));
lista = await tarefasDoPedido(numero);
lista.forEach((t) => console.log(`     - [${t.prioridade}] ${t.titulo}`));
conferir('agora pede para gerar a nota', lista.some((t) => t.tipo === 'gerar-nota'));
conferir('sumiu a tarefa de finalizar', !lista.some((t) => t.tipo === 'finalizar'));

// ---- 4. SIMULA o Solus gerando a nota ------------------------------------
console.log('\n=== 4. O Solus gera a nota e a Sefaz autoriza ===');
const caminhoXml = fs.readdirSync('C:/Solus/nfe').map((n) => 'C:/Solus/nfe/' + n).find((n) => n.endsWith('.xml'));
const chave = caminhoXml.match(/(\d{44})/)[1];
const numeroNota = 999001;

await emTransacao(async (executar) => {
  await executar('DELETE FROM NF WHERE NUMERO = ?', [numeroNota]);
  await executar(
    `INSERT INTO NF (NUMERO, NOTA, SERIENF, STATUS, STATUSNFE, CHAVENFE, PROTOCOLONFE, XML, EMISSAO, CODCLIENTE, TOTALPEDIDO)
     VALUES (?, ?, '1', 'FATURADO', 'Autorizado o uso da NF-e', ?, '135260000000001', ?, ?, '861', ?)`,
    [numeroNota, String(numeroNota), chave, caminhoXml, new Date(), String(gravado.total).replace('.', ',')]
  );
  await executar('UPDATE PEDIDOS SET NOTA = ?, SERIENF = 1 WHERE NUMERO = ?', [String(numeroNota), numero]);
});

lista = await tarefasDoPedido(numero);
lista.forEach((t) => console.log(`     - [${t.prioridade}] ${t.titulo}`));
conferir('agora pede para enviar a nota', lista.some((t) => t.tipo === 'enviar-nota'));

// ---- 5. PDF da nota pelo servidor ----------------------------------------
console.log('\n=== 5. PDF da nota ===');
const respostaPdf = await chamar(`/api/notas/${numeroNota}/pdf`);
const pdf = Buffer.from(await respostaPdf.arrayBuffer());
const ehPdf = pdf.slice(0, 5).toString() === '%PDF-';
conferir('PDF da nota gerado', ehPdf, `${(pdf.length / 1024).toFixed(1)} KB`);
if (ehPdf) fs.writeFileSync('dados/exportados/nota-do-teste.pdf', pdf);

const textoWhats = await (await chamar(`/api/notas/${numeroNota}/texto`)).json();
conferir('texto do WhatsApp da nota', Boolean(textoWhats.texto?.includes(String(numeroNota))));

const xml = await chamar(`/api/notas/${numeroNota}/xml`);
conferir('XML da nota disponivel', xml.status === 200);

// ---- 6. marca como enviada ----------------------------------------------
console.log('\n=== 6. Depois de enviar ao cliente ===');
await chamar('/api/tarefas/enviado', { method: 'POST', body: JSON.stringify({ numero, oQue: 'nota' }) });
lista = await tarefasDoPedido(numero);
conferir('a tarefa sumiu da lista', lista.length === 0, lista.map((t) => t.tipo).join(', ') || 'nenhuma tarefa');

// ---- 7. limpa o que o teste criou ---------------------------------------
console.log('\n=== 7. Limpando o teste ===');
await emTransacao(async (executar) => {
  await executar('DELETE FROM ITEMPEDIDO WHERE NUMERO = ?', [numero]);
  await executar('DELETE FROM PEDIDOS WHERE NUMERO = ?', [numero]);
  await executar('DELETE FROM NF WHERE NUMERO = ?', [numeroNota]);
});
const [sobrou] = await consultar('SELECT COUNT(*) AS T FROM PEDIDOS WHERE NUMERO = ?', [numero]);
conferir('pedido de teste removido do banco', Number(sobrou.T) === 0);

const acompanhamento = JSON.parse(fs.readFileSync('dados/acompanhamento.json', 'utf8'));
acompanhamento.orcamentos = acompanhamento.orcamentos.filter((o) => o.numero !== numero);
fs.writeFileSync('dados/acompanhamento.json', JSON.stringify(acompanhamento, null, 2));

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
