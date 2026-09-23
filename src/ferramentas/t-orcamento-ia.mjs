// A IA conferindo a lista do cliente na montagem do orcamento.
//
//   node src/ferramentas/t-orcamento-ia.mjs      (usa o banco de TESTE e a IA)
//
// O que precisa acontecer:
//   1. cliente pede um tamanho e o texto escolhe outro -> a IA troca;
//   2. item que ficava "escolha o produto" com um candidato certo -> resolvido;
//   3. nome popular que a loja nao cadastra ("qboa") -> achado por outro nome;
//   4. sem IA (desligada, sem credito), o orcamento sai como antes.

import { montarOrcamento, conferirOpcoesComIA } from '../logica/orcamento.js';
import { podeUsarIAnosParecidos } from '../leitura/parecidos-ia.js';
import { buscarPorDescricao } from '../db/produtos.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

if (!podeUsarIAnosParecidos()) {
  console.log('\n  Sem chave de IA (ou desligado em Ajustes): nada a testar.');
  process.exit(0);
}

const lista = (...textos) => ({
  itens: textos.map((texto, i) => {
    const [, quantidade, descricao] = texto.match(/^(\d+)\s+(.*)$/) || [null, '1', texto];
    return {
      numero: i + 1,
      descricao,
      textoOriginal: texto,
      quantidade: Number(quantidade),
      unidade: '',
      confianca: 'alta',
    };
  }),
  observacoes: '',
});

// ===========================================================================
console.log('\n=== 1. O que a loja tem para estes pedidos ===');
for (const termo of ['agua sanitaria', 'detergente', 'papel higienico']) {
  const achados = await buscarPorDescricao(termo, 4, { esconderParados: true });
  console.log(`  "${termo}": ${achados.map((a) => a.descricao).join(' | ') || '(nada)'}`);
}

// ===========================================================================
console.log('\n=== 2. Lista do cliente com tamanho e nome popular ===');

const comecou = Date.now();
const orcamento = await montarOrcamento({
  lista: lista(
    '2 agua sanitaria 5 litros',
    '10 detergente',
    '3 qboa 1 litro',
    '5 papel higienico 30 metros',
  ),
  cliente: null,
  mostrarCusto: false,
});
const segundos = (Date.now() - comecou) / 1000;

const ia = orcamento.conferenciaIA;
conferir('a IA conferiu a lista', ia?.usou === true, JSON.stringify(ia));
console.log(`  (levou ${segundos.toFixed(1)}s a lista inteira)\n`);

for (const item of orcamento.itens) {
  const etiqueta = item.trocadoPelaIA ? 'TROCADO' : item.escolhidoPelaIA ? 'RESOLVIDO' : item.produto ? 'ja estava' : 'EM DUVIDA';
  console.log(`  "${item.textoOriginal}"`);
  console.log(`     ${etiqueta}: ${item.produto?.descricao || '(nenhum)'} · ${item.comoAchou || ''}`);
  if (item.trocadoPelaIA) console.log(`     trocou "${item.trocadoPelaIA.de}" porque ${item.trocadoPelaIA.motivo}`);
  if (item.nomeQueAIAsugeriu) console.log(`     a IA procurou por "${item.nomeQueAIAsugeriu}"`);
  const opcoes = (item.opcoes || []).slice(0, 3)
    .map((o) => `${o.descricao} [${o.relacaoIA || '-'}]`).join(' | ');
  if (opcoes) console.log(`     opcoes: ${opcoes}`);
}

const cincoLitros = orcamento.itens[0];
conferir('"agua sanitaria 5 litros" nao ficou com um produto de outro tamanho',
  !cincoLitros.produto || /5\s*(L|LT|LTS|LITRO)/i.test(cincoLitros.produto.descricao),
  cincoLitros.produto?.descricao || 'ficou em duvida (aceitavel)');

conferir('toda opcao mostrada tem o parecer da IA',
  orcamento.itens.every((i) => !(i.opcoes || []).length || i.opcoes.some((o) => o.relacaoIA)),
  orcamento.itens.map((i) => `${i.textoOriginal}: ${(i.opcoes || []).filter((o) => o.relacaoIA).length}/${(i.opcoes || []).length}`).join(' · '));

conferir('nenhum item ficou com produto que a IA disse ser "outro"',
  orcamento.itens.every((i) => {
    if (!i.produto) return true;
    const escolhido = (i.opcoes || []).find((o) => o.codigo === i.produto.codigo);
    return !escolhido || escolhido.relacaoIA !== 'outro';
  }));

// ===========================================================================
console.log('\n=== 3. A regra da casa continua valendo: o produto DO CLIENTE ganha ===');
// dois cadastros servem ("mesmo") e o cliente ja levou um deles: e esse
const doCliente = await buscarPorDescricao('agua sanitaria', 4, { esconderParados: true });
if (doCliente.length >= 2) {
  const itens = [{
    numero: 1,
    descricao: 'agua sanitaria',
    textoOriginal: '2 agua sanitaria',
    quantidade: 2,
    produto: null,
    opcoes: doCliente.slice(0, 3),
    precisaEscolher: true,
    avisos: [],
  }];
  const historico = new Map([[doCliente[1].codigo, { ultima: Date.now(), vezes: 9 }]]);
  itens[0].opcoes[1].doCliente = { vezes: 9, ultima: Date.now() };

  const resultado = await conferirOpcoesComIA({ itens, cliente: null, historico });
  conferir('resolveu o item em duvida', resultado.usou === true, JSON.stringify(resultado));
  conferir('  e escolheu o que o CLIENTE ja comprou (nao o primeiro da lista)',
    !itens[0].produto || itens[0].produto.codigo === doCliente[1].codigo,
    `${itens[0].produto?.descricao} (cliente levou: ${doCliente[1].descricao})`);
} else {
  console.log('  (banco de teste sem dois cadastros para esse caso)');
}

// ===========================================================================
console.log('\n=== 3b. Opções fracas nunca são escolhidas sozinhas (o caso do QUEROSENE) ===');
// Foi o que o teste no navegador pegou: com um cliente cujo histórico mudava a
// busca, "qboa 1 litro" trouxe só coisas de 1 litro (tudo com 50% - só a
// medida bateu) e a IA escolheu QUEROSENE BUFALO 1LT sozinha.
{
  const fracas = (await buscarPorDescricao('1 litro', 6, { esconderParados: true }))
    .map((p) => ({ ...p, cobertura: 0.5 }));
  const querosene = (await buscarPorDescricao('querosene 1 litro', 1))[0];
  if (querosene) fracas.unshift({ ...querosene, cobertura: 0.5 });

  const itens = [{
    numero: 1, descricao: 'qboa 1 litro', textoOriginal: '3 qboa 1 litro', quantidade: 3,
    produto: null, opcoes: fracas.slice(0, 6), precisaEscolher: true, avisos: [], comoAchou: 'precisa escolher',
  }];
  await conferirOpcoesComIA({ itens, cliente: null, historico: new Map() });
  const escolhido = itens[0].produto?.descricao || '(ficou em dúvida)';
  conferir('NÃO escolheu querosene nem outra coisa só porque é de 1 litro',
    !/QUEROSENE|ALCOOL|GARRAFA|DESENGORD/i.test(escolhido), escolhido);
  conferir('  e buscou por outro nome (água sanitária) quando as opções eram fracas',
    Boolean(itens[0].nomeQueAIAsugeriu) || /SANIT/i.test(escolhido),
    itens[0].nomeQueAIAsugeriu || '');
  conferir('  e água sanitária aparece entre as opções agora',
    (itens[0].opcoes || []).some((o) => /SANIT/i.test(o.descricao)),
    (itens[0].opcoes || []).slice(0, 3).map((o) => o.descricao).join(' | '));
}

// ===========================================================================
console.log('\n=== 4. Sem IA, o orcamento sai como antes ===');
const { carregarConfig, salvarConfig } = await import('../config.js');
const antes = carregarConfig().ia || {};
try {
  salvarConfig({ ia: { conferirParecidos: false } });
  const semIA = await montarOrcamento({
    lista: lista('10 detergente', '2 agua sanitaria 5 litros'),
    cliente: null,
  });
  conferir('nao chamou a IA', semIA.conferenciaIA?.usou === false, semIA.conferenciaIA?.motivo);
  conferir('  e o orcamento continua montado', semIA.itens.length === 2);
  conferir('  com as opcoes do catalogo de sempre',
    semIA.itens.every((i) => i.produto || (i.opcoes || []).length),
    semIA.itens.map((i) => `${i.textoOriginal}: ${i.produto?.descricao || (i.opcoes || []).length + ' opcoes'}`).join(' · '));
} finally {
  salvarConfig({ ia: { ...antes } });
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
