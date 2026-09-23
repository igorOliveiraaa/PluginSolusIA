// A IA olhando as ÚLTIMAS COMPRAS para decidir se vale sugerir reposição.
//
//   node src/ferramentas/t-repor-ia.mjs
//
// A conta sabe o ritmo, mas não sabe QUANTO ele levou. Estes são os casos em
// que a conta sozinha erraria — e é o que o Igor pediu para a IA olhar.

import { valeSugerirRepor } from '../leitura/repor-ia.js';
import { podeUsarIAnosParecidos } from '../leitura/parecidos-ia.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 140) : ''}`);
  if (!ok) falhas += 1;
};

if (!podeUsarIAnosParecidos()) {
  console.log('\n  Sem chave de IA (ou desligado em Ajustes): a conta decide sozinha.');
  process.exit(0);
}

const diasAtras = (dias) => new Date(Date.now() - dias * 24 * 3600 * 1000);

const casos = [
  {
    titulo: 'leva 2 toda semana e sumiu faz 23 dias',
    esperado: true,
    item: {
      nome: 'DETERGENTE NEUTRO 500ML',
      ritmoDias: 7,
      diasDesdeAUltima: 23,
      compras: [
        { data: diasAtras(23), quantidade: 2 },
        { data: diasAtras(30), quantidade: 2 },
        { data: diasAtras(37), quantidade: 3 },
        { data: diasAtras(45), quantidade: 2 },
      ],
    },
  },
  {
    titulo: 'SE ABASTECEU: levou 24 da última vez (sempre leva 2)',
    esperado: false,
    item: {
      nome: 'AGUA SANITARIA 5L',
      ritmoDias: 10,
      diasDesdeAUltima: 20,
      compras: [
        { data: diasAtras(20), quantidade: 24 },
        { data: diasAtras(30), quantidade: 2 },
        { data: diasAtras(40), quantidade: 2 },
        { data: diasAtras(52), quantidade: 3 },
      ],
    },
  },
  {
    titulo: 'ESTÁ SAINDO: vinha levando 10, depois 5, depois 1',
    esperado: false,
    item: {
      nome: 'PAPEL TOALHA INTERFOLHA',
      ritmoDias: 30,
      diasDesdeAUltima: 60,
      compras: [
        { data: diasAtras(60), quantidade: 1 },
        { data: diasAtras(95), quantidade: 5 },
        { data: diasAtras(125), quantidade: 10 },
        { data: diasAtras(155), quantidade: 10 },
      ],
    },
  },
  {
    titulo: 'IRREGULAR: comprou tudo numa semana e nunca mais',
    esperado: false,
    item: {
      nome: 'CERA LIQUIDA 5L',
      ritmoDias: 40,
      diasDesdeAUltima: 100,
      compras: [
        { data: diasAtras(100), quantidade: 1 },
        { data: diasAtras(103), quantidade: 1 },
        { data: diasAtras(106), quantidade: 2 },
      ],
    },
  },
  {
    titulo: 'ROTINA CERTINHA: 10 por mês, está há 38 dias',
    esperado: true,
    item: {
      nome: 'SACO DE LIXO 100L PCT C/100',
      ritmoDias: 30,
      diasDesdeAUltima: 38,
      compras: [
        { data: diasAtras(38), quantidade: 10 },
        { data: diasAtras(68), quantidade: 10 },
        { data: diasAtras(97), quantidade: 12 },
        { data: diasAtras(128), quantidade: 10 },
      ],
    },
  },
];

console.log('\n=== O que a IA acha de cada caso ===');
const decisoes = await valeSugerirRepor(casos.map((c) => c.item));
conferir('a IA respondeu todos os casos', decisoes.filter(Boolean).length === casos.length,
  `${decisoes.filter(Boolean).length}/${casos.length}`);

casos.forEach((caso, i) => {
  const decisao = decisoes[i];
  if (!decisao) return;
  console.log(`\n  ${caso.titulo}`);
  console.log(`     ${decisao.sugerir ? 'SUGERE' : 'não sugere'}: ${decisao.motivo}`);
  conferir(`     era para ${caso.esperado ? 'sugerir' : 'NÃO sugerir'}`,
    decisao.sugerir === caso.esperado);
  conferir('     o motivo é curto e em português', decisao.motivo.length > 5 && decisao.motivo.length <= 90,
    `${decisao.motivo.length} letras`);
});

console.log('\n=== Sem produto nenhum não chama a IA ===');
conferir('lista vazia devolve vazio', (await valeSugerirRepor([])).length === 0);

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
