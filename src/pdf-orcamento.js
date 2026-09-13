// Gera o PDF do orcamento para mandar ao cliente.
// Sem firula: o que o cliente precisa ver e o que ele vai levar, por quanto,
// e ate quando o preco vale.

import PDFDocument from 'pdfkit';
import { consultar, campoTexto, lerTexto } from './db/firebird.js';
import { carregarConfig } from './config.js';

const CINZA = '#64748b';
const ESCURO = '#0f172a';
const DESTAQUE = '#0f766e';
const LINHA = '#e2e8f0';

function dinheiro(valor) {
  return 'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');
}

function dataBR(data = new Date()) {
  return new Date(data).toLocaleDateString('pt-BR');
}

/** Dados da loja: primeiro o que estiver na configuracao, senao a tabela EMPRESAS. */
export async function dadosDaLoja() {
  const cfg = carregarConfig();
  const daConfig = cfg.loja || {};
  if (daConfig.nome) return daConfig;

  try {
    // o cadastro da empresa fica na tabela PARAMETRO (EMPRESAS costuma estar vazia)
    let linhas = await consultar(
      `SELECT FIRST 1 ${campoTexto('RAZAO', 50)}, ${campoTexto('FANTASIA', 50)},
              ${campoTexto('ENDERECO', 50)}, ${campoTexto('CIDADE', 30)}, CPFCNPJ
         FROM PARAMETRO`
    ).catch(() => []);
    if (!linhas.length || !lerTexto(linhas[0].RAZAO)) {
      linhas = await consultar(
        `SELECT FIRST 1 ${campoTexto('RAZAO', 50)}, ${campoTexto('FANTASIA', 50)},
                ${campoTexto('ENDERECO', 50)}, NUMERO, ${campoTexto('BAIRRO', 30)},
                ${campoTexto('CIDADE', 30)}, UF, CEP, CPFCNPJ, FONE, EMAIL
           FROM EMPRESAS`
      ).catch(() => []);
    }
    const e = linhas[0];
    if (!e) return daConfig;
    return {
      nome: lerTexto(e.FANTASIA) || lerTexto(e.RAZAO),
      razao: lerTexto(e.RAZAO),
      endereco: [lerTexto(e.ENDERECO), String(e.NUMERO || '').trim()].filter(Boolean).join(', '),
      bairro: lerTexto(e.BAIRRO),
      cidade: lerTexto(e.CIDADE),
      uf: String(e.UF || '').trim(),
      cep: String(e.CEP || '').trim(),
      cnpj: String(e.CPFCNPJ || '').trim(),
      telefone: String(e.FONE || '').trim(),
      email: String(e.EMAIL || '').trim(),
    };
  } catch {
    return daConfig;
  }
}

/**
 * Monta o PDF e devolve como Buffer.
 * `orcamento` ja vem conferido na tela; `numero` e o do Solus, quando ja gravado.
 */
export async function gerarPdfOrcamento({ orcamento, numero, operador, validadeDias = 7, observacao = '' }) {
  const loja = await dadosDaLoja();
  const itens = (orcamento.itens || []).filter((i) => i.incluir && i.produto);
  const totalItens = itens.reduce((soma, i) => soma + (i.total || 0), 0);
  // o frete entra no total, igual o Solus faz (TOTALPEDIDO = itens + frete)
  const frete = Number(orcamento.pagamento?.frete) > 0 ? Number(orcamento.pagamento.frete) : 0;
  const total = totalItens + frete;

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  const pronto = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(pedacos))));

  const largura = doc.page.width - 80;

  // ---- cabecalho ----------------------------------------------------------
  doc.fillColor(ESCURO).fontSize(17).font('Helvetica-Bold')
    .text(loja.nome || 'ORCAMENTO', 40, 40);

  const linhasLoja = [
    loja.razao && loja.razao !== loja.nome ? loja.razao : '',
    [loja.endereco, loja.bairro].filter(Boolean).join(' - '),
    [loja.cidade, loja.uf, loja.cep].filter(Boolean).join(' - '),
    [loja.cnpj ? 'CNPJ: ' + loja.cnpj : '', loja.telefone].filter(Boolean).join('  ·  '),
  ].filter(Boolean);

  doc.fontSize(8.5).font('Helvetica').fillColor(CINZA);
  linhasLoja.forEach((linha) => doc.text(linha, 40, doc.y, { width: largura * 0.6 }));

  // caixa do numero do orcamento
  doc.fillColor(DESTAQUE).fontSize(13).font('Helvetica-Bold')
    .text('ORÇAMENTO', 40, 40, { width: largura, align: 'right' });
  doc.fillColor(ESCURO).fontSize(10).font('Helvetica')
    .text(numero ? `Nº ${numero}` : 'sem número', 40, 58, { width: largura, align: 'right' })
    .text(dataBR(), 40, 72, { width: largura, align: 'right' });

  doc.moveTo(40, 108).lineTo(doc.page.width - 40, 108).strokeColor(LINHA).stroke();

  // ---- cliente ------------------------------------------------------------
  let y = 120;
  const cliente = orcamento.cliente;
  doc.fontSize(8).fillColor(CINZA).font('Helvetica').text('CLIENTE', 40, y);
  y += 12;
  doc.fontSize(11).fillColor(ESCURO).font('Helvetica-Bold')
    .text(cliente?.nome || 'CONSUMIDOR', 40, y, { width: largura });
  y = doc.y + 2;

  const detalhesCliente = [
    cliente?.cpfCnpj ? `CNPJ/CPF: ${cliente.cpfCnpj}` : '',
    [cliente?.cidade, cliente?.uf].filter(Boolean).join('/'),
    cliente?.telefone || cliente?.celular || '',
  ].filter(Boolean).join('  ·  ');

  if (detalhesCliente) {
    doc.fontSize(8.5).fillColor(CINZA).font('Helvetica').text(detalhesCliente, 40, y);
    y = doc.y;
  }

  y += 14;

  // ---- tabela de itens ----------------------------------------------------
  const colunas = {
    item: 40,
    descricao: 70,
    qtd: 355,
    unitario: 410,
    total: 480,
  };

  const cabecalhoTabela = (posicaoY) => {
    doc.rect(40, posicaoY - 4, largura, 18).fill('#f1f5f9');
    doc.fillColor(CINZA).fontSize(8).font('Helvetica-Bold');
    doc.text('#', colunas.item + 4, posicaoY);
    doc.text('PRODUTO', colunas.descricao, posicaoY);
    doc.text('QTD', colunas.qtd, posicaoY, { width: 40, align: 'right' });
    doc.text('UNITÁRIO', colunas.unitario, posicaoY, { width: 60, align: 'right' });
    doc.text('TOTAL', colunas.total, posicaoY, { width: 75, align: 'right' });
    return posicaoY + 18;
  };

  y = cabecalhoTabela(y);

  doc.font('Helvetica').fontSize(9);
  itens.forEach((item, indice) => {
    // quebra de pagina
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = 50;
      y = cabecalhoTabela(y);
      doc.font('Helvetica').fontSize(9);
    }

    const descricao = item.produto.descricao;
    const alturaTexto = doc.heightOfString(descricao, { width: colunas.qtd - colunas.descricao - 10 });

    doc.fillColor(CINZA).fontSize(8).text(String(indice + 1), colunas.item + 4, y + 1);
    doc.fillColor(ESCURO).fontSize(9)
      .text(descricao, colunas.descricao, y, { width: colunas.qtd - colunas.descricao - 10 });
    doc.text(String(item.quantidade).replace('.', ','), colunas.qtd, y, { width: 40, align: 'right' });
    doc.text(dinheiro(item.precoUnitario), colunas.unitario, y, { width: 60, align: 'right' });
    doc.font('Helvetica-Bold').text(dinheiro(item.total), colunas.total, y, { width: 75, align: 'right' });
    doc.font('Helvetica');

    y += Math.max(alturaTexto, 12) + 7;
    doc.moveTo(40, y - 3).lineTo(doc.page.width - 40, y - 3).strokeColor(LINHA).stroke();
  });

  // ---- total --------------------------------------------------------------
  y += 8;
  doc.fontSize(10).fillColor(CINZA).font('Helvetica')
    .text(`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, 40, y + 4);
  // alinhado exatamente na borda direita da tabela (fim da coluna TOTAL)
  const direita = colunas.total + 75;
  const larguraTotal = direita - colunas.unitario;

  if (frete > 0) {
    doc.fontSize(9).fillColor(CINZA).font('Helvetica')
      .text(`Produtos ${dinheiro(totalItens)}   ·   Frete ${dinheiro(frete)}`, colunas.unitario - 120, y - 2,
        { width: larguraTotal + 120, align: 'right' });
    y += 14;
  }
  doc.fontSize(9).fillColor(CINZA).font('Helvetica')
    .text('TOTAL', colunas.unitario, y, { width: larguraTotal, align: 'right' });
  doc.fontSize(16).fillColor(DESTAQUE).font('Helvetica-Bold')
    .text(dinheiro(total), colunas.unitario, y + 11, { width: larguraTotal, align: 'right' });

  y = doc.y + 22;

  // ---- rodape -------------------------------------------------------------
  const condicoes = [
    orcamento.pagamento?.formaDePagamento ? `Pagamento: ${String(orcamento.pagamento.formaDePagamento).trim()}` : '',
    orcamento.pagamento?.entrega ? `Entrega: ${orcamento.pagamento.entrega}` : '',
  ].filter(Boolean).join('   ·   ');
  if (condicoes) {
    doc.fontSize(9).fillColor(ESCURO).font('Helvetica').text(condicoes, 40, y, { width: largura });
    y = doc.y + 10;
  }

  if (observacao?.trim()) {
    doc.fontSize(8).fillColor(CINZA).font('Helvetica-Bold').text('OBSERVAÇÕES', 40, y);
    doc.fontSize(9).fillColor(ESCURO).font('Helvetica')
      .text(observacao.trim(), 40, doc.y + 2, { width: largura });
    y = doc.y + 12;
  }

  const validade = new Date();
  validade.setDate(validade.getDate() + Number(validadeDias || 7));

  doc.fontSize(8.5).fillColor(CINZA).font('Helvetica')
    .text(`Orçamento válido até ${dataBR(validade)}. Preços sujeitos a alteração e à disponibilidade de estoque.`,
      40, y, { width: largura });

  if (operador?.nome) {
    doc.fontSize(8.5).fillColor(CINZA).text(`Atendimento: ${operador.nome}`, 40, doc.y + 4);
  }

  doc.end();
  return pronto;
}

/** Texto curto para mandar junto no WhatsApp. */
export function textoDoWhatsApp({ orcamento, numero, total, loja }) {
  const itens = (orcamento.itens || []).filter((i) => i.incluir && i.produto);
  const linhas = itens.slice(0, 12).map(
    (i) => `• ${i.produto.descricao} — ${String(i.quantidade).replace('.', ',')} x ${dinheiro(i.precoUnitario)}`
  );
  if (itens.length > 12) linhas.push(`• ...e mais ${itens.length - 12} itens`);

  return [
    `*Orçamento${numero ? ' nº ' + numero : ''}*${loja?.nome ? ' — ' + loja.nome : ''}`,
    '',
    ...linhas,
    '',
    `*Total: ${dinheiro(total)}*`,
    '',
    'Segue o orçamento em anexo. Qualquer dúvida estou à disposição!',
  ].join('\n');
}
