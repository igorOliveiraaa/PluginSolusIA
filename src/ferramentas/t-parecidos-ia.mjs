// A IA conferindo os cadastros parecidos (gasta uma pitada de credito da IA).
//
//   node src/ferramentas/t-parecidos-ia.mjs
//
// Sao os casos que a busca por TEXTO erra: abreviacao e erro de digitacao (que
// ela acha pouco parecido, mas e o mesmo produto) e tamanho diferente (que ela
// acha 100% parecido, mas e outro produto). E o que decide se a mercadoria entra
// no cadastro certo.

import { classificarParecidos, podeUsarIAnosParecidos, esquecerPareceres } from '../leitura/parecidos-ia.js';
import { conferirParecidosComIA } from '../logica/conferencia.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 140) : ''}`);
  if (!ok) falhas += 1;
};

if (!podeUsarIAnosParecidos()) {
  console.log('\n  Sem chave de IA (ou desligado em Ajustes): nada a testar.');
  process.exit(0);
}

// ===========================================================================
console.log('\n=== 1. Os casos que o texto erra ===');

const casos = [
  {
    nota: 'DET. YPE 500', unidade: 'UN',
    cadastros: [
      { codigo: 'A1', descricao: 'DETERGENTE YPE 500ML NEUTRO', esperado: 'mesmo' },
      { codigo: 'A2', descricao: 'DETERGENTE YPE 5 LITROS', esperado: 'variacao' },
    ],
  },
  {
    nota: 'AGUA SANITARIA BRILUX 1L', unidade: 'UN',
    cadastros: [
      { codigo: 'B1', descricao: 'AGUA SANITARIA BRILUX 1 LT', esperado: 'mesmo' },
      { codigo: 'B2', descricao: 'AGUA SANITARIA BRILUX 5 LT', esperado: 'variacao' },
      { codigo: 'B3', descricao: 'VASSOURA PIACAVA CABO MADEIRA', esperado: 'outro' },
    ],
  },
  {
    nota: 'RODO DE MADEIRA 40CM', unidade: 'UN',
    cadastros: [
      { codigo: 'C1', descricao: 'RODO MADEIRA 40 CM', esperado: 'mesmo' },
      { codigo: 'C2', descricao: 'RODO DE MADEIRA 60CM', esperado: 'variacao' },
      // material diferente e "variacao": o repetido velho costuma estar aqui,
      // e chamar de "outro" jogaria ele para o fim da lista sem necessidade
      { codigo: 'C3', descricao: 'RODO PLASTICO 40CM', esperado: 'variacao' },
    ],
  },
  {
    nota: 'SABAO EM PEDRA YPE 5X180G', unidade: 'PCT',
    cadastros: [
      { codigo: 'D1', descricao: 'SABÃO EM PEDRA YPE 180 GR', esperado: 'variacao' },
      { codigo: 'D2', descricao: 'SABÃO EM PEDRA YPE 5 X 180 GR', esperado: 'mesmo' },
    ],
  },
  {
    nota: 'LUVA LATEX TAM M', unidade: 'PAR',
    cadastros: [
      { codigo: 'E1', descricao: 'LUVA LATEX MEDIA', esperado: 'mesmo' },
      { codigo: 'E2', descricao: 'LUVA LATEX GRANDE', esperado: 'variacao' },
    ],
  },
  {
    // o erro que apareceu no teste do orcamento: tamanho igual, produto outro.
    // Se passar como "mesmo", o cliente recebe alcool no lugar de agua sanitaria.
    nota: 'QBOA 1 LITRO', unidade: 'UN',
    cadastros: [
      { codigo: 'G1', descricao: 'ALCOOL LIQ. SULMAR 70 ANTISSEPTICO 1LT', esperado: 'outro' },
      { codigo: 'G2', descricao: 'AGUA SANITARIA AYLAG 1 LT', esperado: 'mesmo' },
      { codigo: 'G3', descricao: 'GARRAFA TERMICA 1LT PT ROSCA TERMOLAR', esperado: 'outro' },
    ],
  },
  {
    nota: 'PAPEL HIGIENICO NEVE 30M FD C/64', unidade: 'FD',
    cadastros: [
      { codigo: 'F1', descricao: 'PAPEL HIGIENICO NEVE 30 MTS FARDO C/ 64', esperado: 'mesmo' },
      { codigo: 'F2', descricao: 'PAPEL HIGIENICO NEVE 30M FARDO C/ 16', esperado: 'variacao' },
    ],
  },
];

const comecou = Date.now();
const respostas = await classificarParecidos(casos.map((c) => ({
  descricaoNaNota: c.nota,
  unidadeDaNota: c.unidade,
  candidatos: c.cadastros.map((x) => ({ codigo: x.codigo, descricao: x.descricao })),
})));
const segundos = (Date.now() - comecou) / 1000;

let acertos = 0;
let total = 0;
for (const [i, caso] of casos.entries()) {
  console.log(`\n  "${caso.nota}"`);
  for (const cadastro of caso.cadastros) {
    total += 1;
    const resposta = respostas[i]?.get(cadastro.codigo);
    const acertou = resposta?.relacao === cadastro.esperado;
    if (acertou) acertos += 1;
    console.log(`    ${acertou ? 'OK    ' : 'ERROU '} ${cadastro.descricao.padEnd(42)} `
      + `esperado ${cadastro.esperado.padEnd(9)} veio ${resposta?.relacao || '(nada)'}`
      + (resposta?.motivo ? ` (${resposta.motivo})` : ''));
  }
}

console.log(`\n  ${acertos}/${total} certos em ${segundos.toFixed(1)}s`);
conferir('acertou pelo menos 90% dos casos', acertos / total >= 0.9, `${acertos}/${total}`);

// ===========================================================================
console.log('\n=== 2. O que a conferencia faz com a resposta ===');

const itens = [
  {
    // casado pelo NOME no produto ERRADO (5 litros) tendo o certo do lado
    descricao: 'AGUA SANITARIA BRILUX 1L',
    unidadeComercial: 'UN',
    comoAchou: 'nome parecido',
    produto: { codigo: '900', descricao: 'AGUA SANITARIA BRILUX 5 LT' },
    irmaos: [
      { codigo: '901', descricao: 'AGUA SANITARIA BRILUX 1 LT', parecenca: 0.9, motivo: 'nome parecido (90%)' },
      { codigo: '902', descricao: 'DESINFETANTE PINHO 1L', parecenca: 0.7, motivo: 'nome parecido (70%)' },
    ],
    precisaConfirmarVinculo: true,
    precisaAtencao: false,
  },
  {
    // casado pelo codigo de barras (vinculo certo), mas com repetidos na loja
    descricao: 'DETERGENTE YPE 500ML',
    unidadeComercial: 'UN',
    comoAchou: 'codigo de barras',
    produto: { codigo: '910', descricao: 'DETERGENTE YPE 500ML NEUTRO' },
    irmaos: [
      { codigo: '911', descricao: 'DET. YPE 500 ML', parecenca: 0.8, motivo: 'nome parecido (80%)' },
      { codigo: '912', descricao: 'DETERGENTE YPE 5 LITROS', parecenca: 0.75, motivo: 'nome parecido (75%)' },
    ],
    precisaAtencao: false,
  },
];

const resultado = await conferirParecidosComIA(itens);
conferir('a IA conferiu os dois itens', resultado.usou === true && resultado.itens === 2,
  JSON.stringify(resultado));

const [aguaSanitaria, detergente] = itens;

conferir('avisa que o cadastro vinculado NAO e o mesmo produto',
  aguaSanitaria.relacaoDoVinculoIA && aguaSanitaria.relacaoDoVinculoIA !== 'mesmo',
  `${aguaSanitaria.relacaoDoVinculoIA} — ${aguaSanitaria.motivoDoVinculoIA}`);
conferir('e sugere o cadastro certo para vincular',
  aguaSanitaria.sugestaoDaIA?.codigo === '901',
  aguaSanitaria.sugestaoDaIA ? `${aguaSanitaria.sugestaoDaIA.descricao} (${aguaSanitaria.sugestaoDaIA.motivo})` : 'nao sugeriu');
conferir('esse item passa a pedir atencao na tela', aguaSanitaria.precisaAtencao === true);
conferir('o mesmo produto vem em primeiro e o sem relacao no fim (nada some)',
  aguaSanitaria.irmaos[0]?.codigo === '901' && aguaSanitaria.irmaos.length === 2,
  aguaSanitaria.irmaos.map((i) => `${i.descricao} [${i.relacaoIA}]`).join(' | '));

conferir('no item casado por codigo de barras, o repetido de verdade vem primeiro',
  detergente.irmaos[0]?.relacaoIA === 'mesmo',
  detergente.irmaos.map((i) => `${i.descricao} [${i.relacaoIA}]`).join(' | '));
conferir('e o vinculo certo nao vira aviso a toa',
  !detergente.sugestaoDaIA && detergente.precisaConfirmarVinculo !== true,
  JSON.stringify(detergente.sugestaoDaIA || null));

// ===========================================================================
console.log('\n=== 3. Quando a IA nao pode ajudar, a nota continua entrando ===');

const { carregarConfig, salvarConfig } = await import('../config.js');
const configAntes = carregarConfig().ia || {};

const itemSozinho = () => ([{
  descricao: 'DETERGENTE YPE 500ML',
  unidadeComercial: 'UN',
  comoAchou: 'nome parecido',
  produto: { codigo: '910', descricao: 'DETERGENTE YPE 5 LITROS' },
  irmaos: [{ codigo: '911', descricao: 'DETERGENTE YPE 500ML NEUTRO', parecenca: 0.9, motivo: 'nome parecido (90%)' }],
  precisaConfirmarVinculo: true,
}]);

try {
  // sem pareceres lembrados: aqui o que se testa e a IA respondendo (ou nao)
  esquecerPareceres();
  // 3a. desligada em Ajustes
  salvarConfig({ ia: { conferirParecidos: false } });
  const desligada = itemSozinho();
  const semIA = await conferirParecidosComIA(desligada);
  conferir('desligada em Ajustes: nao chama a IA', semIA.usou === false, semIA.motivo);
  conferir('  e os parecidos continuam na tela, do jeito de antes',
    desligada[0].irmaos.length === 1 && !desligada[0].irmaos[0].relacaoIA);

  // 3b. chave errada (e o que acontece quando acaba o credito ou a chave vence)
  salvarConfig({ ia: { conferirParecidos: true, chave: 'sk-proj-chave-invalida-de-teste' } });
  const comChaveRuim = itemSozinho();
  const deuErro = await conferirParecidosComIA(comChaveRuim);
  conferir('chave invalida: avisa que falhou, sem derrubar a nota',
    deuErro.usou === false && deuErro.falhou === true, deuErro.motivo);
  conferir('  e os parecidos continuam na tela', comChaveRuim[0].irmaos.length === 1);
  conferir('  e o aviso de "confira o vinculo" continua de pe',
    comChaveRuim[0].precisaConfirmarVinculo === true);
} finally {
  salvarConfig({ ia: { ...configAntes } });
  const voltou = carregarConfig().ia || {};
  conferir('a configuracao da IA voltou ao que era',
    voltou.chave === configAntes.chave && voltou.conferirParecidos === configAntes.conferirParecidos);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
