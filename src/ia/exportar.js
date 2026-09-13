// Transforma qualquer resultado do assistente em arquivo: planilha ou PDF.
// A planilha sai em CSV, que o Excel e o Google Planilhas abrem direto.

import PDFDocument from 'pdfkit';
import { dadosDaLoja } from '../pdf-orcamento.js';

/** Descobre as colunas a partir das linhas (a IA pode trazer campos diferentes). */
function descobrirColunas(linhas) {
  const colunas = [];
  for (const linha of linhas) {
    for (const campo of Object.keys(linha || {})) {
      if (!colunas.includes(campo)) colunas.push(campo);
    }
  }
  return colunas;
}

function comoTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return String(valor).replace('.', ',');
  if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

/**
 * Planilha em CSV.
 * Detalhes que fazem diferenca no Excel brasileiro:
 *  - separador ponto e virgula (o Excel em portugues espera isso);
 *  - BOM no inicio, senao os acentos saem errados.
 */
export function gerarCsv(linhas, colunasPedidas = null) {
  const dados = Array.isArray(linhas) ? linhas : [];
  if (!dados.length) return Buffer.from('﻿sem dados\n', 'utf8');

  const colunas = colunasPedidas?.length ? colunasPedidas : descobrirColunas(dados);

  const escapar = (valor) => {
    const texto = comoTexto(valor);
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const linhasTexto = [
    colunas.join(';'),
    ...dados.map((linha) => colunas.map((c) => escapar(linha[c])).join(';')),
  ];

  return Buffer.from('﻿' + linhasTexto.join('\r\n') + '\r\n', 'utf8');
}

/** PDF com o resultado em forma de tabela. */
export async function gerarPdfTabela({ titulo, subtitulo, linhas, colunas: colunasPedidas, rodape }) {
  const loja = await dadosDaLoja();
  const dados = Array.isArray(linhas) ? linhas : [];
  const colunas = colunasPedidas?.length ? colunasPedidas : descobrirColunas(dados);

  // muitas colunas cabem melhor deitado
  const deitado = colunas.length > 5;
  const doc = new PDFDocument({ size: 'A4', layout: deitado ? 'landscape' : 'portrait', margin: 36 });

  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  const pronto = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(pedacos))));

  const largura = doc.page.width - 72;
  const ESCURO = '#0f172a';
  const CINZA = '#64748b';
  const DESTAQUE = '#0f766e';

  // cabecalho
  doc.fillColor(DESTAQUE).fontSize(15).font('Helvetica-Bold')
    .text(titulo || 'Relatório', 36, 36, { width: largura });
  if (subtitulo) {
    doc.fillColor(CINZA).fontSize(9.5).font('Helvetica')
      .text(subtitulo, 36, doc.y + 1, { width: largura });
  }
  doc.fillColor(CINZA).fontSize(8).font('Helvetica')
    .text(`${loja.nome || ''}${loja.nome ? ' · ' : ''}${new Date().toLocaleString('pt-BR')} · ${dados.length} ${dados.length === 1 ? 'linha' : 'linhas'}`,
      36, doc.y + 2, { width: largura });

  let y = doc.y + 10;

  if (!dados.length) {
    doc.fillColor(ESCURO).fontSize(11).text('Sem dados para mostrar.', 36, y);
    doc.end();
    return pronto;
  }

  // largura das colunas: reparte o espaco, dando mais para as de texto
  const pesos = colunas.map((coluna) => {
    const amostra = dados.slice(0, 30).map((l) => comoTexto(l[coluna]).length);
    const maior = Math.max(coluna.length, ...amostra, 4);
    return Math.min(maior, 40);
  });
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => Math.max((p / somaPesos) * largura, 42));

  const posicoes = [];
  let x = 36;
  for (const w of larguras) { posicoes.push(x); x += w; }

  const cabecalho = (posicaoY) => {
    doc.rect(36, posicaoY - 3, largura, 16).fill('#f1f5f9');
    doc.fillColor(CINZA).fontSize(7.5).font('Helvetica-Bold');
    colunas.forEach((coluna, i) => {
      doc.text(String(coluna).toUpperCase(), posicoes[i] + 2, posicaoY, {
        width: larguras[i] - 4, lineBreak: false, ellipsis: true,
      });
    });
    return posicaoY + 16;
  };

  y = cabecalho(y);
  doc.font('Helvetica').fontSize(8);

  for (const linha of dados) {
    if (y > doc.page.height - 60) {
      doc.addPage({ layout: deitado ? 'landscape' : 'portrait', margin: 36 });
      y = 40;
      y = cabecalho(y);
      doc.font('Helvetica').fontSize(8);
    }

    doc.fillColor(ESCURO);
    colunas.forEach((coluna, i) => {
      const valor = comoTexto(linha[coluna]);
      const numero = typeof linha[coluna] === 'number';
      doc.text(valor, posicoes[i] + 2, y, {
        width: larguras[i] - 4,
        lineBreak: false,
        ellipsis: true,
        align: numero ? 'right' : 'left',
      });
    });

    y += 13;
    doc.moveTo(36, y - 3).lineTo(doc.page.width - 36, y - 3).strokeColor('#e2e8f0').stroke();
  }

  if (rodape) {
    doc.fillColor(CINZA).fontSize(8).font('Helvetica')
      .text(rodape, 36, y + 8, { width: largura });
  }

  doc.end();
  return pronto;
}

/** Nome de arquivo sem acento e sem caractere proibido no Windows. */
export function nomeDeArquivo(titulo, extensao) {
  const limpo = String(titulo || 'relatorio')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .trim().replace(/\s+/g, '-').toLowerCase()
    .slice(0, 50) || 'relatorio';

  const agora = new Date();
  const carimbo = `${String(agora.getDate()).padStart(2, '0')}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  return `${limpo}-${carimbo}.${extensao}`;
}
