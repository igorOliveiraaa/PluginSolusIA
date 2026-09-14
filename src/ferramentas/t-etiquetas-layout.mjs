// Confere o DESENHO da etiqueta abrindo o PDF por dentro.
//
// Nao da para "olhar" um PDF pelo terminal, entao aqui a gente descomprime o
// conteudo da pagina e le onde cada texto foi parar e de que tamanho. E o que
// responde as perguntas que importam: o preco ficou grande? o nome coube? as
// etiquetas estao alinhadas em grade? da para cortar reto?

import zlib from 'node:zlib';
import { gerarPdfEtiquetas, TAMANHOS } from '../etiquetas.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 90) : ''}`);
  if (!ok) falhas += 1;
};

/** Tira o conteudo de desenho de dentro do PDF. */
function conteudoDoPdf(pdf) {
  const partes = [];
  let posicao = 0;
  while (true) {
    const inicio = pdf.indexOf('stream', posicao);
    if (inicio < 0) break;
    let comeco = inicio + 6;
    if (pdf[comeco] === 0x0d) comeco += 1;
    if (pdf[comeco] === 0x0a) comeco += 1;
    const fim = pdf.indexOf('endstream', comeco);
    if (fim < 0) break;
    const bruto = pdf.slice(comeco, fim);
    try {
      partes.push(zlib.inflateSync(bruto).toString('latin1'));
    } catch { /* stream que nao e texto (fonte, imagem) */ }
    posicao = fim + 9;
  }
  return partes.join('\n');
}

/**
 * Le os textos desenhados: o que diz, onde esta e de que tamanho.
 *
 * O PDFKit nao escreve "(texto) Tj": ele usa "[<hex> espacamento <hex>] TJ",
 * com as letras em hexadecimal e os ajustes de espaco entre elas. Por isso e
 * preciso juntar so os pedacos <...> e converter de hex para letra.
 */
function textosDoPdf(conteudo) {
  const textos = [];
  let tamanho = 0;
  let x = 0;
  let y = 0;

  for (const linha of conteudo.split(/[\r\n]+/)) {
    const fonte = linha.match(/\/F\d+\s+([\d.]+)\s+Tf/);
    if (fonte) tamanho = Number(fonte[1]);

    const posicao = linha.match(/1\s+0\s+0\s+1\s+([\d.-]+)\s+([\d.-]+)\s+Tm/);
    if (posicao) { x = Number(posicao[1]); y = Number(posicao[2]); }

    const bloco = linha.match(/\[(.*)\]\s*TJ/);
    if (bloco) {
      const texto = [...bloco[1].matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
        .join('');
      if (texto.trim()) {
        textos.push({
          texto,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          tamanho,
        });
      }
    }
  }
  return textos;
}

// ---------------------------------------------------------------------------
const PRODUTOS = [
  { codigo: '11467', descricao: 'AGUA SANITARIA RENDE MAIS 5LT', preco: 10, barras: '7899876543210' },
  { codigo: '32', descricao: 'AGUA SANITÁRIA FLOPS 1 LT', preco: 2.79, barras: '7896284801016' },
  { codigo: '9999', descricao: 'PAPEL HIGIENICO PERSONAL VIP 30M X 10CM 12 ROLOS', preco: 21.99, barras: '' },
  { codigo: '6558', descricao: 'TAPETE PERSONALIZADO KAPAZI M2', preco: 380, barras: '' },
];

for (const [chave, estilo] of Object.entries(TAMANHOS)) {
  console.log(`\n=== ${estilo.nome} ===`);
  const pdf = await gerarPdfEtiquetas({ produtos: PRODUTOS, tamanho: chave });
  const textos = textosDoPdf(conteudoDoPdf(pdf));

  conferir('achei os textos dentro do PDF', textos.length >= PRODUTOS.length * 2,
    `${textos.length} pedacos de texto`);

  // ---- cada produto aparece? ----
  for (const produto of PRODUTOS) {
    const preco = produto.preco.toFixed(2).replace('.', ',');
    const temPreco = textos.some((t) => t.texto === preco);
    // nome pode ter sido cortado com "..." se for gigante
    const inicioDoNome = produto.descricao.slice(0, 12);
    const temNome = textos.some((t) => t.texto.includes(inicioDoNome));
    conferir(`"${produto.descricao.slice(0, 30)}"`, temPreco && temNome,
      `preco ${temPreco ? 'ok' : 'SUMIU'} · nome ${temNome ? 'ok' : 'SUMIU'}`);
  }

  // ---- o preco e a maior coisa da etiqueta? ----
  const precos = textos.filter((t) => /^\d+,\d{2}$/.test(t.texto));
  const nomes = textos.filter((t) => /[A-Z]{4}/.test(t.texto) && !/^cod\./.test(t.texto));
  const maiorPreco = Math.max(...precos.map((t) => t.tamanho));
  const maiorNome = Math.max(...nomes.map((t) => t.tamanho));
  conferir('o preco e bem maior que o nome', maiorPreco >= maiorNome * 1.8,
    `preco ${maiorPreco}pt x nome ${maiorNome}pt`);
  conferir('o preco e grande de ler de longe', maiorPreco >= 18, `${maiorPreco}pt`);

  // ---- cada etiqueta ficou dentro da SUA casinha da grade? ----
  // (o preco e centralizado, entao o x dele muda conforme o tamanho do numero -
  //  o que interessa nao e o x cru, e em qual casa da grade ele caiu)
  const MARGEM = 24;
  const larguraCelula = (595.28 - MARGEM * 2) / estilo.colunas;
  const alturaCelula = (841.89 - MARGEM * 2) / estilo.linhas;

  const casas = precos.map((t) => {
    const doTopo = 841.89 - t.y;          // o PDF desenha de baixo para cima
    return {
      texto: t.texto,
      coluna: Math.floor((t.x - MARGEM) / larguraCelula),
      linha: Math.floor((doTopo - MARGEM) / alturaCelula),
      x: t.x,
    };
  });

  conferir('nenhuma etiqueta saiu da folha',
    casas.every((c) => c.coluna >= 0 && c.coluna < estilo.colunas
      && c.linha >= 0 && c.linha < estilo.linhas),
    casas.map((c) => `${c.texto}@col${c.coluna},lin${c.linha}`).join(' '));

  const ocupadas = new Set(casas.map((c) => `${c.coluna},${c.linha}`));
  conferir('uma etiqueta por casa (nenhuma em cima da outra)',
    ocupadas.size === casas.length, `${ocupadas.size} casas para ${casas.length} etiquetas`);

  conferir('elas preenchem da esquerda para a direita, de cima para baixo',
    casas.every((c, i) => c.coluna === i % estilo.colunas
      && c.linha === Math.floor(i / estilo.colunas)));

  // o preco nao pode encostar na linha de corte
  const folgaMinima = casas.map((c) => c.x - (MARGEM + c.coluna * larguraCelula));
  conferir('o preco tem folga da borda (da para cortar sem cortar o numero)',
    folgaMinima.every((f) => f >= 4), 'menor folga: ' + Math.min(...folgaMinima).toFixed(1) + ' pt');

  const linhasY = [...new Set(precos.map((t) => Math.round(t.y)))].sort((a, b) => b - a);
  if (linhasY.length > 1) {
    const distancias = linhasY.slice(1).map((y, i) => linhasY[i] - y);
    const iguais = distancias.every((d) => Math.abs(d - distancias[0]) < 2);
    conferir('o espaco entre linhas e sempre o mesmo', iguais, distancias.join(', ') + ' pt');
  }

  // ---- o tamanho de cada etiqueta em milimetros ----
  const larguraMm = ((595.28 - 48) / estilo.colunas / 72 * 25.4).toFixed(1);
  const alturaMm = ((841.89 - 48) / estilo.linhas / 72 * 25.4).toFixed(1);
  console.log(`     cada etiqueta: ${larguraMm} x ${alturaMm} mm  (${estilo.colunas} x ${estilo.linhas} por folha)`);

  // ---- linhas de corte ----
  const desenho = conteudoDoPdf(pdf);
  const temTracejado = /\[\s*3\s+3\s*\]\s*0\s*d/.test(desenho) || / d\b/.test(desenho);
  conferir('tem linha de corte tracejada', temTracejado);

  // ---- tudo em preto e branco? ----
  const cores = [...desenho.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(rg|RG)/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const temCor = cores.some(([r, g, b]) => Math.abs(r - g) > 0.02 || Math.abs(g - b) > 0.02);
  conferir('e preto e branco de verdade (sem cor)', !temCor,
    temCor ? 'achei cor!' : `${cores.length} tons de cinza`);
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
