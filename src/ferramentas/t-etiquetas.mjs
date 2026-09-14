// Etiquetas de prateleira: gera as folhas de verdade e confere o essencial.
//
// A regra que importa: UMA etiqueta por PRODUTO, nunca por unidade. Se a nota
// trouxe 20 aguas sanitarias de 5L, sai uma etiqueta da de 5L - e outra,
// diferente, para a de 1L.
//
// Os PDFs ficam em dados/etiquetas-teste/ para olhar e imprimir de verdade.

import fs from 'node:fs';
import path from 'node:path';
import { gerarPdfEtiquetas, contarFolhas, TAMANHOS } from '../etiquetas.js';
import { buscarPorDescricao } from '../db/produtos.js';

const SAIDA = path.join('dados', 'etiquetas-teste');
let falhas = 0;

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 90) : ''}`);
  if (!ok) falhas += 1;
};

fs.mkdirSync(SAIDA, { recursive: true });

// ---------------------------------------------------------------------------
console.log('\n=== 1. Uma etiqueta por PRODUTO, nao por unidade ===');

// e isto que a tela manda: os produtos da nota, sem repetir pela quantidade
const comoAEntradaDeNotaManda = [
  { codigo: '11467', descricao: 'AGUA SANITARIA RENDE MAIS 5LT', preco: 10, barras: '', quantidadeQueEntrou: 20 },
  { codigo: '32', descricao: 'AGUA SANITÁRIA FLOPS 1 LT', preco: 2.79, barras: '7896284801016', quantidadeQueEntrou: 48 },
  { codigo: '2763', descricao: 'AGUA SANITARIA FLOPS 2LT', preco: 4.99, barras: '', quantidadeQueEntrou: 12 },
];

const conta = contarFolhas(comoAEntradaDeNotaManda, 'padrao');
conferir('3 produtos = 3 etiquetas (e nao 80)', conta.etiquetas === 3,
  `${conta.etiquetas} etiquetas · ${conta.folhas} folha`);
conferir('cabe tudo em uma folha so', conta.folhas === 1, `${conta.porFolha} por folha`);

const copias = contarFolhas([{ codigo: '1', descricao: 'X', preco: 1, copias: 3 }], 'padrao');
conferir('quem pede copia de proposito recebe', copias.etiquetas === 3);
const exagero = contarFolhas([{ codigo: '1', descricao: 'X', preco: 1, copias: 9999 }], 'padrao');
conferir('copia absurda tem teto', exagero.etiquetas === 20, `${exagero.etiquetas}`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. As folhas saem ===');

for (const [chave, estilo] of Object.entries(TAMANHOS)) {
  const pdf = await gerarPdfEtiquetas({ produtos: comoAEntradaDeNotaManda, tamanho: chave });
  const arquivo = path.join(SAIDA, `etiquetas-${chave}.pdf`);
  fs.writeFileSync(arquivo, pdf);
  conferir(`${estilo.nome}`, pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 800,
    `${(pdf.length / 1024).toFixed(1)} KB · ${arquivo}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Com produtos de verdade do banco ===');

const doBanco = [
  ...(await buscarPorDescricao('agua sanitaria', 6)),
  ...(await buscarPorDescricao('detergente', 6)),
  ...(await buscarPorDescricao('saco de lixo', 6)),
  ...(await buscarPorDescricao('papel higienico', 6)),
  ...(await buscarPorDescricao('tapete', 6)),
].map((p) => ({ codigo: p.codigo, descricao: p.descricao, preco: p.vendaAtual, barras: p.barras }));

conferir('peguei produtos de verdade', doBanco.length > 20, `${doBanco.length} produtos`);
console.log('     nomes mais longos (o teste real da etiqueta):');
[...doBanco].sort((a, b) => b.descricao.length - a.descricao.length).slice(0, 3)
  .forEach((p) => console.log(`       ${p.descricao.length} letras: ${p.descricao}`));

for (const chave of Object.keys(TAMANHOS)) {
  const pdf = await gerarPdfEtiquetas({ produtos: doBanco, tamanho: chave });
  const arquivo = path.join(SAIDA, `etiquetas-reais-${chave}.pdf`);
  fs.writeFileSync(arquivo, pdf);
  const conta2 = contarFolhas(doBanco, chave);
  conferir(`${doBanco.length} produtos em ${chave}`, pdf.length > 2000,
    `${conta2.folhas} folhas · ${(pdf.length / 1024).toFixed(1)} KB · ${arquivo}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. O que pode dar errado ===');

try {
  await gerarPdfEtiquetas({ produtos: [] });
  conferir('lista vazia e recusada', false, 'deixou passar');
} catch (erro) {
  conferir('lista vazia e recusada', true, erro.message);
}

const semNome = await gerarPdfEtiquetas({
  produtos: [{ codigo: '1', descricao: '', preco: 0 }],
});
conferir('produto sem nome e sem preco nao quebra', semNome.length > 800);

const nomeGigante = await gerarPdfEtiquetas({
  produtos: [{ codigo: '1', descricao: 'A'.repeat(200), preco: 1234.56 }],
});
conferir('nome gigante nao quebra a etiqueta', nomeGigante.length > 800);

const precoAlto = await gerarPdfEtiquetas({
  produtos: [{ codigo: '1', descricao: 'TAPETE PERSONALIZADO KAPAZI M2', preco: 13125 }],
});
conferir('preco de R$ 13.125,00 cabe', precoAlto.length > 800);

console.log(`\n(abra os PDFs em ${SAIDA} para conferir o corte e a leitura)`);
console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
