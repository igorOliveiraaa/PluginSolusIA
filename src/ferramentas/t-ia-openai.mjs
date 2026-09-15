// Testa a IA configurada (ChatGPT) em tudo que o Plugin usa: leitura de nota em
// PDF, observacao da nota, lista de compras e o chat com ferramentas.
// A chave vem de dados/config.json - nunca do codigo.
//
//   node src/ferramentas/t-ia-openai.mjs

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { lerDocumentoComIA, interpretarObservacao, lerListaDeCompras, testarChave } from '../leitura/ia.js';
import { aplicarAjustes } from '../logica/custo.js';
import { perguntar } from '../ia/assistente.js';
import { esquecerRespostasDaIA } from '../leitura/gemini.js';
import { provedorDaIA } from '../leitura/openai.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};
const cronometro = () => { const t = Date.now(); return () => `${((Date.now() - t) / 1000).toFixed(1)}s`; };

esquecerRespostasDaIA();
console.log(`\nIA configurada: ${provedorDaIA()}`);

// ---------------------------------------------------------------------------
console.log('\n=== 1. Chave ===');
try {
  const teste = await testarChave();
  conferir('chave funciona', teste.ok, `${teste.nomeDaIA}, ${teste.modelosDisponiveis} modelos`);
} catch (erro) {
  conferir('chave funciona', false, erro.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Nota em PDF ===');
const pdfNota = 'dados/exportados/danfe-1-item.pdf';
if (fs.existsSync(pdfNota)) {
  const tempo = cronometro();
  try {
    const nota = await lerDocumentoComIA([{ base64: fs.readFileSync(pdfNota).toString('base64'), tipo: 'application/pdf' }]);
    conferir('leu os itens da nota', nota.itens.length === 1, `${nota.itens.length} item em ${tempo()}`);
    const item = nota.itens[0] || {};
    conferir('valor do item certo', Math.abs((item.valorUnitarioComercial || 0) - 42.9) < 0.01,
      `${item.descricao} R$ ${item.valorUnitarioComercial}`);
  } catch (erro) {
    conferir('leu a nota', false, erro.message);
  }
} else {
  console.log('  (sem PDF de nota de exemplo em dados/exportados)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Observacao da nota vira conta certa ===');
const notaFalsa = {
  itens: [
    { numero: 1, descricao: 'DETERGENTE YPE 500ML', unidadeComercial: 'CX', quantidadeUnidades: 2, quantidadeComercial: 2, valorProduto: 100 },
    { numero: 2, descricao: 'AGUA SANITARIA 5L', unidadeComercial: 'UN', quantidadeUnidades: 10, quantidadeComercial: 10, valorProduto: 50 },
  ],
};
const itensComCusto = [
  { numero: 1, quantidadeUnidades: 2, quantidadeComercial: 2, unidadeOriginal: 'CX', custoTotalItem: 100, custoUnitario: 50,
    composicaoCusto: { produtos: 100, desconto: 0, frete: 0, outrasDespesas: 0, ipi: 0 } },
  { numero: 2, quantidadeUnidades: 10, quantidadeComercial: 10, custoTotalItem: 50, custoUnitario: 5,
    composicaoCusto: { produtos: 50, desconto: 0, frete: 0, outrasDespesas: 0, ipi: 0 } },
];
const casos = [
  { texto: 'calcular DIFAL de 6% porque veio de outro estado', total: 159 },
  { texto: 'veio uma taxa de 30 reais que nao esta na nota', total: 180 },
  { texto: 'a caixa do detergente vem com 24 unidades', total: 150, unidadesItem1: 48 },
  { texto: 'desconto de 15 reais na nota', total: 135 },
  { texto: 'somar 10% so na agua sanitaria', total: 155 },
  { texto: 'conferir a validade do detergente', total: 150 },
];
for (const caso of casos) {
  const tempo = cronometro();
  try {
    const ajustes = await interpretarObservacao(caso.texto, notaFalsa);
    const itens = aplicarAjustes(itensComCusto, ajustes);
    const total = Math.round(itens.reduce((s, i) => s + i.custoTotalItem, 0) * 100) / 100;
    let ok = Math.abs(total - caso.total) < 0.01;
    if (caso.unidadesItem1) ok = ok && itens[0].quantidadeUnidades === caso.unidadesItem1;
    conferir(`"${caso.texto}"`, ok,
      `total R$ ${total} (esperado ${caso.total})${caso.unidadesItem1 ? `, item 1 com ${itens[0].quantidadeUnidades} un` : ''} em ${tempo()} · "${ajustes?.entendi}"`);
  } catch (erro) {
    conferir(`"${caso.texto}"`, false, erro.message);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Lista de compras em PDF ===');
const lista = await new Promise((pronto) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  doc.on('end', () => pronto(Buffer.concat(pedacos)));
  doc.fontSize(16).text('PEDIDO', { align: 'center' }).moveDown().fontSize(12);
  ['10 detergente ype 500ml', '2 agua sanitaria 5l', '5 saco de lixo 100 litros', '1 vassoura'].forEach((l) => doc.text(l));
  doc.end();
});
{
  const tempo = cronometro();
  try {
    const lida = await lerListaDeCompras([{ base64: lista.toString('base64'), tipo: 'application/pdf' }]);
    const quantidades = lida.itens.map((i) => i.quantidade).join(',');
    conferir('leu os 4 itens com as quantidades', lida.itens.length === 4 && quantidades === '10,2,5,1',
      `${lida.itens.length} itens [${quantidades}] em ${tempo()}`);
  } catch (erro) {
    conferir('leu a lista', false, erro.message);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Chat com ferramentas e contexto ===');
const operador = { nome: 'Teste', codigo: 'T', permissoes: { verCusto: true, fazerOrcamento: true } };
{
  const tempo = cronometro();
  try {
    const r1 = await perguntar({ pergunta: 'Quanto tenho em estoque de agua sanitaria rende mais 5 litros?', historico: [], operador });
    const usouFerramenta = r1.consultas.length > 0;
    conferir('respondeu consultando o sistema', usouFerramenta && r1.resposta.length > 10,
      `${r1.consultas.map((c) => c.ferramenta).join(', ')} em ${tempo()}`);
    console.log('       resposta:', r1.resposta.replace(/\s+/g, ' ').slice(0, 200));

    const tempo2 = cronometro();
    const r2 = await perguntar({
      pergunta: 'e qual o preco dela?',
      historico: [
        { papel: 'pessoa', texto: 'Quanto tenho em estoque de agua sanitaria rende mais 5 litros?' },
        { papel: 'ia', texto: r1.resposta },
      ],
      operador,
    });
    conferir('entendeu "dela" pela conversa anterior', /R\$\s?\d/.test(r2.resposta),
      `em ${tempo2()}: ${r2.resposta.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (erro) {
    conferir('chat', false, erro.message);
  }
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
