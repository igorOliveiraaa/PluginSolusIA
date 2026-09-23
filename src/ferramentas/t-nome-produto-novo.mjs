// O nome do produto NOVO, arrumado no padrao da loja.
//
//   node src/ferramentas/t-nome-produto-novo.mjs
//
// O fornecedor escreve "SAB.PO OMO LAV.PERF 1,6KG" e era esse nome que ia para o
// cadastro, para a etiqueta da prateleira e para o orcamento do cliente. O que
// NAO pode acontecer: perder marca, tamanho ou quantidade, ou a IA inventar
// detalhe que nao estava na nota.

import { nomePadraoDaLoja, manteveOsNumeros, podeUsarIAnosParecidos } from '../leitura/parecidos-ia.js';
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

// exemplos de verdade: como a loja nomeia os produtos dela
const exemplosDaLoja = (await buscarPorDescricao('detergente', 4)).map((p) => p.descricao)
  .concat((await buscarPorDescricao('sabao em po', 4)).map((p) => p.descricao));
console.log('\n=== Padrao da loja (exemplos mandados para a IA) ===');
for (const e of exemplosDaLoja) console.log('  ' + e);

const casos = [
  { nota: 'SAB.PO OMO LAV.PERF 1,6KG', precisaTer: ['OMO', '1,6'], naoPodeTer: ['500'] },
  { nota: 'DET.LIQ YPE NEUTRO 500ML CX C/24', precisaTer: ['YPE', '500', '24'] },
  { nota: 'AGUA SAN. BRILUX 5LT', precisaTer: ['BRILUX', '5'] },
  { nota: 'PAP.HIG.NEVE F.DUPLA 30M C/4', precisaTer: ['NEVE', '30', '4'] },
  { nota: 'LUVA LATEX MULTIUSO TAM.G', precisaTer: ['LATEX', 'G'] },
];

console.log('\n=== Nomes arrumados ===');
const nomes = await nomePadraoDaLoja(casos.map((c) => ({ nomeNaNota: c.nota, exemplos: exemplosDaLoja })));

console.log('\n=== A trava do codigo: nome que perde medida e descartado ===');
conferir('aceita quando manteve tudo',
  manteveOsNumeros('DET.LIQ YPE 500ML CX C/24', 'DETERGENTE LIQUIDO YPE 500ML CX C/24'));
conferir('RECUSA quando o volume sumiu',
  !manteveOsNumeros('DET.LIQ YPE 500ML CX C/24', 'DETERGENTE LIQUIDO YPE CX C/24'));
conferir('RECUSA quando a quantidade da caixa sumiu',
  !manteveOsNumeros('PAP.HIG 30M C/4', 'PAPEL HIGIENICO 30M'));
conferir('aceita virgula escrita de outro jeito',
  manteveOsNumeros('SAB.PO 1,6KG', 'SABAO EM PO 1.6KG'));
conferir('RECUSA nome vazio', !manteveOsNumeros('QUALQUER 5L', ''));

casos.forEach((caso, i) => {
  const nome = nomes[i] || '';
  if (!nome) {
    console.log(`\n  nota:  ${caso.nota}\n  vira:  (sem sugestao - a trava do codigo recusou)`);
    return;                    // sem sugestao e resultado valido: fica o nome da nota
  }
  console.log(`\n  nota:  ${caso.nota}`);
  console.log(`  vira:  ${nome || '(sem sugestao)'}`);

  conferir('  devolveu um nome', nome.length > 3, nome);
  conferir('  cabe na coluna do Solus (70 letras)', nome.length <= 70, `${nome.length} letras`);
  conferir('  esta em MAIUSCULA', nome === nome.toUpperCase());
  for (const parte of caso.precisaTer) {
    conferir(`  manteve "${parte}"`, nome.includes(parte), nome);
  }
  for (const parte of caso.naoPodeTer || []) {
    conferir(`  nao inventou "${parte}"`, !nome.includes(parte), nome);
  }
  // ponto so pode sobrar dentro de numero (1,6KG); depois de letra e abreviacao
  conferir('  abriu a abreviacao (nao sobrou ponto depois de letra)',
    !/[A-Za-z]\./.test(nome), nome);
});

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
