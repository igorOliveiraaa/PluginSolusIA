// Etiquetas de prateleira em folha A4.
//
// Para que serve: toda vez que entra nota, os precos mudam - e a etiqueta da
// prateleira fica velha. Aqui sai uma folha pronta com os produtos daquela nota,
// para imprimir em papel adesivo A4 comum, cortar e trocar na gondola.
//
// Decisoes de desenho, pensando em quem vai usar:
//   - PRETO E BRANCO. Toner colorido custa caro e ninguem precisa de cor para
//     ler um preco.
//   - O PRECO e a maior coisa da etiqueta: e ele que o cliente le de longe.
//   - Cabe o maximo de etiqueta por folha sem apertar (24 na normal, 10 na
//     grande), porque papel adesivo A4 nao e barato.
//   - Linhas de corte cinza-claro atravessando a folha inteira: da para cortar
//     tudo reto na guilhotina ou na tesoura, sem ficar caçando marca.
//   - Os tamanhos batem com os adesivos picotados mais comuns (3x8 e 2x5), entao
//     se um dia comprar folha ja picotada, continua servindo.

import PDFDocument from 'pdfkit';

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 24;

export const TAMANHOS = {
  padrao: {
    nome: 'Normal (24 por folha)',
    colunas: 3,
    linhas: 8,
    descricao: { tamanho: 9, linhas: 2 },
    preco: 21,
    rodape: 6,
  },
  grande: {
    nome: 'Grande (10 por folha)',
    colunas: 2,
    linhas: 5,
    descricao: { tamanho: 13, linhas: 3 },
    preco: 34,
    rodape: 8,
  },
};

const CINZA_CORTE = '#c8c8c8';
const CINZA_TEXTO = '#666666';

const dinheiro = (valor) => (Number(valor) || 0).toFixed(2).replace('.', ',');

/**
 * Diminui a letra ate o nome caber nas linhas que a etiqueta tem.
 * Nome de produto do Solus as vezes tem 70 caracteres; em vez de cortar no meio
 * de uma palavra, primeiro tenta encolher.
 */
function tamanhoQueCabe(doc, texto, largura, altura, inicial) {
  for (let tamanho = inicial; tamanho >= inicial - 3; tamanho -= 0.5) {
    doc.fontSize(tamanho);
    if (doc.heightOfString(texto, { width: largura }) <= altura) return tamanho;
  }
  return inicial - 3;
}

/** Desenha uma etiqueta dentro da celula. */
function desenharEtiqueta(doc, produto, x, y, largura, altura, estilo) {
  const recuo = Math.min(10, largura * 0.06);
  const dentro = largura - recuo * 2;

  const alturaDoNome = estilo.descricao.tamanho * 1.25 * estilo.descricao.linhas;
  const nome = String(produto.descricao || '').trim() || '(sem nome)';

  // ---- nome do produto ----
  doc.font('Helvetica-Bold').fillColor('#000');
  const tamanhoDoNome = tamanhoQueCabe(doc, nome, dentro, alturaDoNome, estilo.descricao.tamanho);
  doc.fontSize(tamanhoDoNome).text(nome, x + recuo, y + recuo, {
    width: dentro,
    height: alturaDoNome,
    align: 'center',
    ellipsis: true,
    lineGap: -1,
  });

  // ---- preco (o que o cliente le de longe) ----
  const preco = Number(produto.preco) || 0;
  const alturaDoPreco = estilo.preco * 1.15;
  const topoDoPreco = y + altura - recuo - estilo.rodape * 1.6 - alturaDoPreco;

  doc.font('Helvetica').fontSize(estilo.preco * 0.42).fillColor('#000')
    .text('R$', x + recuo, topoDoPreco + estilo.preco * 0.42, { width: dentro, align: 'left' });

  doc.font('Helvetica-Bold').fontSize(estilo.preco)
    .text(dinheiro(preco), x + recuo, topoDoPreco, { width: dentro, align: 'center' });

  // ---- rodape: codigo e barras, para conferir na hora de repor ----
  const rodape = [
    produto.codigo ? `cod. ${produto.codigo}` : '',
    produto.barras || '',
  ].filter(Boolean).join('   ');

  if (rodape) {
    doc.font('Helvetica').fontSize(estilo.rodape).fillColor(CINZA_TEXTO)
      .text(rodape, x + recuo, y + altura - recuo - estilo.rodape * 1.2, {
        width: dentro, align: 'center', lineBreak: false, ellipsis: true,
      });
  }
}

/** As linhas de corte, atravessando a folha inteira. */
function linhasDeCorte(doc, colunas, linhas, celulaLargura, celulaAltura) {
  doc.save().lineWidth(0.4).strokeColor(CINZA_CORTE).dash(3, { space: 3 });

  for (let c = 0; c <= colunas; c += 1) {
    const x = MARGEM + c * celulaLargura;
    doc.moveTo(x, MARGEM).lineTo(x, A4.altura - MARGEM).stroke();
  }
  for (let l = 0; l <= linhas; l += 1) {
    const y = MARGEM + l * celulaAltura;
    doc.moveTo(MARGEM, y).lineTo(A4.largura - MARGEM, y).stroke();
  }

  doc.undash().restore();
}

/**
 * Monta o PDF das etiquetas.
 *
 * `produtos` = [{ descricao, preco, codigo, barras, copias }]
 *
 * E UMA ETIQUETA POR PRODUTO, nao por unidade: se entraram 20 aguas sanitarias
 * de 5L, sai UMA etiqueta da agua de 5L - e outra, diferente, para a de 1L.
 * `copias` so existe para o caso do mesmo produto estar em duas prateleiras.
 */
export function gerarPdfEtiquetas({ produtos, tamanho = 'padrao' }) {
  const estilo = TAMANHOS[tamanho] || TAMANHOS.padrao;

  // uma etiqueta por produto; so repete se pediram copias de proposito
  const lista = [];
  for (const produto of produtos || []) {
    const copias = Math.min(Math.max(Number(produto.copias) || 1, 1), 20);
    for (let i = 0; i < copias; i += 1) lista.push(produto);
  }
  if (!lista.length) throw new Error('Nenhum produto para imprimir etiqueta.');

  const celulaLargura = (A4.largura - MARGEM * 2) / estilo.colunas;
  const celulaAltura = (A4.altura - MARGEM * 2) / estilo.linhas;
  const porFolha = estilo.colunas * estilo.linhas;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  const pronto = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(pedacos))));

  lista.forEach((produto, indice) => {
    const posicao = indice % porFolha;
    if (indice > 0 && posicao === 0) doc.addPage();
    if (posicao === 0) linhasDeCorte(doc, estilo.colunas, estilo.linhas, celulaLargura, celulaAltura);

    const coluna = posicao % estilo.colunas;
    const linha = Math.floor(posicao / estilo.colunas);
    desenharEtiqueta(
      doc, produto,
      MARGEM + coluna * celulaLargura,
      MARGEM + linha * celulaAltura,
      celulaLargura, celulaAltura, estilo
    );
  });

  doc.end();
  return pronto;
}

/** Quantas folhas vao sair (a tela avisa antes de mandar imprimir). */
export function contarFolhas(produtos, tamanho = 'padrao') {
  const estilo = TAMANHOS[tamanho] || TAMANHOS.padrao;
  const total = (produtos || []).reduce(
    (soma, p) => soma + Math.min(Math.max(Number(p.copias) || 1, 1), 20), 0
  );
  const porFolha = estilo.colunas * estilo.linhas;
  return { etiquetas: total, folhas: Math.ceil(total / porFolha), porFolha };
}
