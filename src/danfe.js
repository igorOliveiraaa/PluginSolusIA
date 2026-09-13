// DANFE em PDF a partir do XML autorizado da NF-e.
//
// Quando existe o PDF que o proprio Solus/ACBr gerou, o Plugin usa esse.
// Este gerador serve para quando so o XML esta ao alcance (o caso comum: o ACBr
// salva o XML na pasta do PC do certificado, e o PDF nem sempre).
//
// Os blocos seguem a ordem do DANFE retrato: canhoto, emitente + chave com codigo
// de barras, destinatario, fatura, calculo do imposto, transportador, produtos e
// dados adicionais. Os valores saem do XML exatamente como foram autorizados.

import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { XMLParser } from 'fast-xml-parser';

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// leitura do XML
// ---------------------------------------------------------------------------

const lista = (valor) => (valor === undefined || valor === null ? [] : Array.isArray(valor) ? valor : [valor]);
const txt = (valor) => (valor === undefined || valor === null || typeof valor === 'object' ? '' : String(valor).trim());
const num = (valor) => {
  const n = Number.parseFloat(txt(valor));
  return Number.isFinite(n) ? n : 0;
};

function achar(objeto, chave) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  if (objeto[chave] !== undefined) return objeto[chave];
  for (const valor of Object.values(objeto)) {
    if (valor && typeof valor === 'object') {
      const achado = achar(valor, chave);
      if (achado !== undefined) return achado;
    }
  }
  return undefined;
}

/** Transforma o XML da NF-e nos dados que o DANFE mostra. */
export function lerNotaParaDanfe(conteudoXml) {
  const arvore = leitor.parse(String(conteudoXml));
  const inf = achar(arvore, 'infNFe');
  if (!inf) throw new Error('Esse arquivo nao e um XML de NF-e.');

  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const total = achar(inf, 'ICMSTot') || {};
  const transp = inf.transp || {};
  const transporta = transp.transporta || {};
  const infProt = achar(arvore, 'infProt') || {};

  const endereco = (e = {}) => ({
    logradouro: [txt(e.xLgr), txt(e.nro), txt(e.xCpl)].filter(Boolean).join(', '),
    bairro: txt(e.xBairro),
    municipio: txt(e.xMun),
    uf: txt(e.UF),
    cep: txt(e.CEP),
    fone: txt(e.fone),
  });

  const itens = lista(inf.det).map((det) => {
    const prod = det.prod || {};
    const imposto = det.imposto || {};
    const icms = Object.values(imposto.ICMS || {})[0] || {};
    const ipi = imposto.IPI?.IPITrib || {};
    return {
      codigo: txt(prod.cProd),
      descricao: txt(prod.xProd),
      ncm: txt(prod.NCM),
      cst: `${txt(icms.orig)}${txt(icms.CST) || txt(icms.CSOSN)}`,
      cfop: txt(prod.CFOP),
      unidade: txt(prod.uCom),
      quantidade: num(prod.qCom),
      valorUnitario: num(prod.vUnCom),
      valorTotal: num(prod.vProd),
      baseIcms: num(icms.vBC),
      valorIcms: num(icms.vICMS),
      valorIpi: num(ipi.vIPI),
      aliquotaIcms: num(icms.pICMS),
    };
  });

  const cobr = inf.cobr || {};
  const volumes = lista(transp.vol);

  return {
    chave: txt(inf['@Id']).replace(/\D/g, ''),
    numero: txt(ide.nNF),
    serie: txt(ide.serie),
    naturezaOperacao: txt(ide.natOp),
    tipo: txt(ide.tpNF),                    // 0 entrada, 1 saida
    homologacao: txt(ide.tpAmb) === '2',
    emissao: txt(ide.dhEmi || ide.dEmi),
    saida: txt(ide.dhSaiEnt || ide.dSaiEnt),
    protocolo: txt(infProt.nProt),
    dataProtocolo: txt(infProt.dhRecbto),
    emitente: {
      nome: txt(emit.xNome),
      fantasia: txt(emit.xFant),
      documento: txt(emit.CNPJ) || txt(emit.CPF),
      ie: txt(emit.IE),
      iest: txt(emit.IEST),
      ...endereco(emit.enderEmit),
    },
    destinatario: {
      nome: txt(dest.xNome),
      documento: txt(dest.CNPJ) || txt(dest.CPF) || txt(dest.idEstrangeiro),
      ie: txt(dest.IE),
      ...endereco(dest.enderDest),
    },
    totais: {
      baseIcms: num(total.vBC),
      icms: num(total.vICMS),
      baseSt: num(total.vBCST),
      st: num(total.vST),
      produtos: num(total.vProd),
      frete: num(total.vFrete),
      seguro: num(total.vSeg),
      desconto: num(total.vDesc),
      outras: num(total.vOutro),
      ipi: num(total.vIPI),
      nota: num(total.vNF),
    },
    duplicatas: lista(cobr.dup).map((d) => ({
      numero: txt(d.nDup),
      vencimento: txt(d.dVenc),
      valor: num(d.vDup),
    })),
    transporte: {
      modalidade: txt(transp.modFrete),
      nome: txt(transporta.xNome),
      documento: txt(transporta.CNPJ) || txt(transporta.CPF),
      ie: txt(transporta.IE),
      endereco: txt(transporta.xEnder),
      municipio: txt(transporta.xMun),
      uf: txt(transporta.UF),
      placa: txt(transp.veicTransp?.placa),
      placaUf: txt(transp.veicTransp?.UF),
      antt: txt(transp.veicTransp?.RNTC),
      quantidade: volumes.reduce((s, v) => s + num(v.qVol), 0),
      especie: txt(volumes[0]?.esp),
      marca: txt(volumes[0]?.marca),
      numeracao: txt(volumes[0]?.nVol),
      pesoBruto: volumes.reduce((s, v) => s + num(v.pesoB), 0),
      pesoLiquido: volumes.reduce((s, v) => s + num(v.pesoL), 0),
    },
    informacoesComplementares: [txt(inf.infAdic?.infCpl), txt(inf.infAdic?.infAdFisco)]
      .filter(Boolean).join(' '),
    itens,
  };
}

// ---------------------------------------------------------------------------
// formatacao
// ---------------------------------------------------------------------------

const brl = (n, casas = 2) => (Number(n) || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: casas, maximumFractionDigits: casas,
});

function formatarDocumento(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(doc || '');
}

function formatarData(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function formatarHora(iso) {
  const m = String(iso || '').match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

const formatarChave = (chave) => String(chave || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const formatarCep = (cep) => String(cep || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
const formatarNumeroNota = (n) => String(n || '').padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3');

const MODALIDADES_FRETE = {
  0: '0 - REMETENTE (CIF)',
  1: '1 - DESTINATARIO (FOB)',
  2: '2 - TERCEIROS',
  3: '3 - PROPRIO REMETENTE',
  4: '4 - PROPRIO DESTINATARIO',
  9: '9 - SEM FRETE',
};

// ---------------------------------------------------------------------------
// desenho
// ---------------------------------------------------------------------------

const M = 20;            // margem
const LARGURA = 555;     // A4 (595) menos as margens

/** Caixa com rotulo pequeno em cima e valor embaixo, como o DANFE usa. */
function caixa(doc, x, y, w, h, rotulo, valor = '', opcoes = {}) {
  doc.lineWidth(0.5).rect(x, y, w, h).stroke('#000');
  doc.font('Helvetica').fontSize(5).fillColor('#000')
    .text(rotulo, x + 2, y + 1.5, { width: w - 4, lineBreak: false, ellipsis: true });
  doc.font(opcoes.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(opcoes.tamanho || 7.5)
    .text(String(valor ?? ''), x + 2, y + (opcoes.topo ?? 8), {
      width: w - 4,
      align: opcoes.alinhar || 'left',
      lineBreak: Boolean(opcoes.quebrar),
      ellipsis: !opcoes.quebrar,
      height: h - (opcoes.topo ?? 8) - 1,
    });
}

function titulo(doc, y, texto) {
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#000').text(texto, M, y, { lineBreak: false });
  return y + 8;
}

async function codigoDeBarras(chave) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: chave,
    scale: 3,
    height: 12,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
}

/** Cabecalho (emitente + DANFE + chave). Repete em toda folha. */
function cabecalho(doc, nota, y, barras, folhas) {
  const e = nota.emitente;

  // emitente
  doc.lineWidth(0.5).rect(M, y, 225, 92).stroke('#000');
  doc.font('Helvetica').fontSize(5).text('IDENTIFICACAO DO EMITENTE', M + 2, y + 2);
  doc.font('Helvetica-Bold').fontSize(9).text(e.nome, M + 6, y + 14, { width: 213, align: 'center' });
  doc.font('Helvetica').fontSize(7).text(
    [e.logradouro, [e.bairro, formatarCep(e.cep)].filter(Boolean).join(' - '),
      [e.municipio, e.uf].filter(Boolean).join(' - '), e.fone ? `Fone: ${e.fone}` : '']
      .filter(Boolean).join('\n'),
    M + 6, doc.y + 4, { width: 213, align: 'center' }
  );

  // bloco DANFE
  const xd = M + 225;
  doc.rect(xd, y, 105, 92).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(12).text('DANFE', xd, y + 5, { width: 105, align: 'center' });
  doc.font('Helvetica').fontSize(6).text('DOCUMENTO AUXILIAR DA\nNOTA FISCAL ELETRONICA', xd, y + 20, { width: 105, align: 'center' });
  doc.fontSize(6.5).text('0 - ENTRADA\n1 - SAIDA', xd + 12, y + 40);
  doc.rect(xd + 72, y + 40, 16, 16).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(10).text(nota.tipo || '1', xd + 72, y + 43, { width: 16, align: 'center' });
  doc.fontSize(8).text(`No ${formatarNumeroNota(nota.numero)}`, xd, y + 62, { width: 105, align: 'center' });
  doc.text(`SERIE ${nota.serie}`, xd, y + 72, { width: 105, align: 'center' });
  // a numeracao "1/2" so e conhecida no fim: guarda a posicao e escreve depois
  folhas.push({ pagina: doc.bufferedPageRange().count - 1, x: xd, y: y + 82 });

  // chave
  const xc = M + 330;
  doc.rect(xc, y, 225, 38).stroke('#000');
  doc.image(barras, xc + 8, y + 5, { width: 209, height: 28 });
  caixa(doc, xc, y + 38, 225, 20, 'CHAVE DE ACESSO', formatarChave(nota.chave), { negrito: true, tamanho: 7.2, alinhar: 'center' });
  doc.rect(xc, y + 58, 225, 34).stroke('#000');
  doc.font('Helvetica').fontSize(6.5).text(
    'Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',
    xc + 6, y + 64, { width: 213, align: 'center' }
  );

  y += 92;
  caixa(doc, M, y, 330, 20, 'NATUREZA DA OPERACAO', nota.naturezaOperacao);
  caixa(doc, M + 330, y, 225, 20, 'PROTOCOLO DE AUTORIZACAO DE USO',
    nota.protocolo ? `${nota.protocolo} - ${formatarData(nota.dataProtocolo)} ${formatarHora(nota.dataProtocolo)}` : '',
    { alinhar: 'center' });
  y += 20;
  caixa(doc, M, y, 185, 20, 'INSCRICAO ESTADUAL', e.ie);
  caixa(doc, M + 185, y, 185, 20, 'INSCRICAO ESTADUAL DO SUBST. TRIBUT.', e.iest);
  caixa(doc, M + 370, y, 185, 20, 'CNPJ', formatarDocumento(e.documento));
  return y + 22;
}

// colunas da tabela de produtos (somam 555)
const COLUNAS = [
  { rotulo: 'CODIGO', w: 48, campo: (i) => i.codigo },
  { rotulo: 'DESCRICAO DO PRODUTO / SERVICO', w: 145, campo: (i) => i.descricao, quebra: true },
  { rotulo: 'NCM/SH', w: 42, campo: (i) => i.ncm },
  { rotulo: 'O/CST', w: 26, campo: (i) => i.cst },
  { rotulo: 'CFOP', w: 26, campo: (i) => i.cfop },
  { rotulo: 'UN', w: 22, campo: (i) => i.unidade },
  { rotulo: 'QUANT.', w: 38, campo: (i) => brl(i.quantidade, 4), direita: true },
  { rotulo: 'VALOR UNIT.', w: 44, campo: (i) => brl(i.valorUnitario, 4), direita: true },
  { rotulo: 'VALOR TOTAL', w: 44, campo: (i) => brl(i.valorTotal), direita: true },
  { rotulo: 'B.CALC ICMS', w: 38, campo: (i) => brl(i.baseIcms), direita: true },
  { rotulo: 'VALOR ICMS', w: 32, campo: (i) => brl(i.valorIcms), direita: true },
  { rotulo: 'VALOR IPI', w: 28, campo: (i) => brl(i.valorIpi), direita: true },
  { rotulo: 'ALIQ. ICMS', w: 22, campo: (i) => brl(i.aliquotaIcms), direita: true },
];

function cabecalhoProdutos(doc, y) {
  y = titulo(doc, y, 'DADOS DOS PRODUTOS / SERVICOS');
  let x = M;
  for (const c of COLUNAS) {
    doc.lineWidth(0.5).rect(x, y, c.w, 14).stroke('#000');
    doc.font('Helvetica').fontSize(4.8).text(c.rotulo, x + 1, y + 2, { width: c.w - 2, align: 'center' });
    x += c.w;
  }
  return y + 14;
}

function carimbo(doc, texto, cor) {
  doc.save();
  doc.rotate(-35, { origin: [297, 420] });
  doc.font('Helvetica-Bold').fontSize(46).fillColor(cor).opacity(0.28)
    .text(texto, 40, 390, { width: 520, align: 'center' });
  doc.restore();
  doc.opacity(1).fillColor('#000');
}

/**
 * Gera o PDF do DANFE.
 * `situacao` pode ser 'cancelada' para carimbar a nota.
 */
export async function gerarDanfe(conteudoXml, { situacao = '' } = {}) {
  const nota = lerNotaParaDanfe(conteudoXml);
  const barras = await codigoDeBarras(nota.chave);

  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  const pronto = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(pedacos))));

  const fimDaFolha = 842 - M;

  // ---- canhoto (so na primeira folha) ------------------------------------
  let y = M;
  caixa(doc, M, y, 455, 22,
    `RECEBEMOS DE ${nota.emitente.nome} OS PRODUTOS/SERVICOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`, '',
    { topo: 8 });
  doc.font('Helvetica').fontSize(6.5).text(
    `EMISSAO: ${formatarData(nota.emissao)}  -  DEST.: ${nota.destinatario.nome}  -  VALOR TOTAL: R$ ${brl(nota.totais.nota)}`,
    M + 2, y + 11, { width: 450, lineBreak: false, ellipsis: true }
  );
  caixa(doc, M, y + 22, 100, 24, 'DATA DE RECEBIMENTO', '');
  caixa(doc, M + 100, y + 22, 355, 24, 'IDENTIFICACAO E ASSINATURA DO RECEBEDOR', '');
  doc.rect(M + 455, y, 100, 46).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(11).text('NF-e', M + 455, y + 6, { width: 100, align: 'center' });
  doc.fontSize(8).text(`No ${formatarNumeroNota(nota.numero)}`, M + 455, y + 21, { width: 100, align: 'center' });
  doc.text(`SERIE ${nota.serie}`, M + 455, y + 32, { width: 100, align: 'center' });
  y += 50;
  doc.dash(2, { space: 2 }).moveTo(M, y).lineTo(M + LARGURA, y).stroke('#000').undash();
  y += 6;

  const folhas = [];
  y = cabecalho(doc, nota, y, barras, folhas);

  // ---- destinatario ------------------------------------------------------
  const d = nota.destinatario;
  y = titulo(doc, y, 'DESTINATARIO / REMETENTE');
  caixa(doc, M, y, 345, 20, 'NOME / RAZAO SOCIAL', d.nome);
  caixa(doc, M + 345, y, 120, 20, 'CNPJ / CPF', formatarDocumento(d.documento), { alinhar: 'center' });
  caixa(doc, M + 465, y, 90, 20, 'DATA DA EMISSAO', formatarData(nota.emissao), { alinhar: 'center' });
  y += 20;
  caixa(doc, M, y, 265, 20, 'ENDERECO', d.logradouro);
  caixa(doc, M + 265, y, 130, 20, 'BAIRRO / DISTRITO', d.bairro);
  caixa(doc, M + 395, y, 70, 20, 'CEP', formatarCep(d.cep), { alinhar: 'center' });
  caixa(doc, M + 465, y, 90, 20, 'DATA DA SAIDA / ENTRADA', formatarData(nota.saida), { alinhar: 'center' });
  y += 20;
  caixa(doc, M, y, 225, 20, 'MUNICIPIO', d.municipio);
  caixa(doc, M + 225, y, 110, 20, 'FONE / FAX', d.fone);
  caixa(doc, M + 335, y, 30, 20, 'UF', d.uf, { alinhar: 'center' });
  caixa(doc, M + 365, y, 100, 20, 'INSCRICAO ESTADUAL', d.ie);
  caixa(doc, M + 465, y, 90, 20, 'HORA DA SAIDA / ENTRADA', formatarHora(nota.saida), { alinhar: 'center' });
  y += 22;

  // ---- fatura / duplicatas -----------------------------------------------
  if (nota.duplicatas.length) {
    y = titulo(doc, y, 'FATURA / DUPLICATAS');
    const porLinha = 6;
    const w = LARGURA / porLinha;
    nota.duplicatas.forEach((dup, i) => {
      const linha = Math.floor(i / porLinha);
      const coluna = i % porLinha;
      const xd = M + coluna * w;
      const yd = y + linha * 24;
      doc.lineWidth(0.5).rect(xd, yd, w, 24).stroke('#000');
      doc.font('Helvetica').fontSize(6)
        .text(`Num.: ${dup.numero}`, xd + 3, yd + 3)
        .text(`Venc.: ${formatarData(dup.vencimento)}`, xd + 3, yd + 10)
        .text(`Valor: R$ ${brl(dup.valor)}`, xd + 3, yd + 17);
    });
    y += Math.ceil(nota.duplicatas.length / porLinha) * 24 + 2;
  }

  // ---- calculo do imposto -------------------------------------------------
  const t = nota.totais;
  y = titulo(doc, y, 'CALCULO DO IMPOSTO');
  const w5 = LARGURA / 5;
  [['BASE DE CALCULO DO ICMS', t.baseIcms], ['VALOR DO ICMS', t.icms], ['BASE DE CALC. ICMS SUBST.', t.baseSt],
    ['VALOR DO ICMS SUBST.', t.st], ['VALOR TOTAL DOS PRODUTOS', t.produtos]]
    .forEach(([r, v], i) => caixa(doc, M + i * w5, y, w5, 20, r, brl(v), { alinhar: 'right' }));
  y += 20;
  const w6 = LARGURA / 6;
  [['VALOR DO FRETE', t.frete], ['VALOR DO SEGURO', t.seguro], ['DESCONTO', t.desconto],
    ['OUTRAS DESPESAS', t.outras], ['VALOR TOTAL DO IPI', t.ipi], ['VALOR TOTAL DA NOTA', t.nota]]
    .forEach(([r, v], i) => caixa(doc, M + i * w6, y, w6, 20, r, brl(v), { alinhar: 'right', negrito: i === 5 }));
  y += 22;

  // ---- transportador -----------------------------------------------------
  const tr = nota.transporte;
  y = titulo(doc, y, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS');
  caixa(doc, M, y, 185, 20, 'RAZAO SOCIAL', tr.nome);
  caixa(doc, M + 185, y, 95, 20, 'FRETE POR CONTA', MODALIDADES_FRETE[tr.modalidade] || tr.modalidade, { tamanho: 6.5 });
  caixa(doc, M + 280, y, 60, 20, 'CODIGO ANTT', tr.antt);
  caixa(doc, M + 340, y, 60, 20, 'PLACA DO VEICULO', tr.placa);
  caixa(doc, M + 400, y, 25, 20, 'UF', tr.placaUf, { alinhar: 'center' });
  caixa(doc, M + 425, y, 130, 20, 'CNPJ / CPF', formatarDocumento(tr.documento));
  y += 20;
  caixa(doc, M, y, 240, 20, 'ENDERECO', tr.endereco);
  caixa(doc, M + 240, y, 160, 20, 'MUNICIPIO', tr.municipio);
  caixa(doc, M + 400, y, 25, 20, 'UF', tr.uf, { alinhar: 'center' });
  caixa(doc, M + 425, y, 130, 20, 'INSCRICAO ESTADUAL', tr.ie);
  y += 20;
  [['QUANTIDADE', tr.quantidade ? String(tr.quantidade) : ''], ['ESPECIE', tr.especie], ['MARCA', tr.marca],
    ['NUMERACAO', tr.numeracao], ['PESO BRUTO', tr.pesoBruto ? brl(tr.pesoBruto, 3) : ''],
    ['PESO LIQUIDO', tr.pesoLiquido ? brl(tr.pesoLiquido, 3) : '']]
    .forEach(([r, v], i) => caixa(doc, M + i * w6, y, w6, 20, r, v, { alinhar: i >= 4 ? 'right' : 'left' }));
  y += 22;

  // ---- produtos ----------------------------------------------------------
  const ALTURA_ADICIONAIS = 70;
  y = cabecalhoProdutos(doc, y);

  for (let indice = 0; indice < nota.itens.length; indice += 1) {
    const item = nota.itens[indice];
    doc.font('Helvetica').fontSize(6);
    const alturaTexto = doc.heightOfString(item.descricao, { width: COLUNAS[1].w - 4 });
    const altura = Math.max(11, alturaTexto + 4);

    // na ultima folha precisa sobrar lugar para os dados adicionais
    const ehUltimo = indice === nota.itens.length - 1;
    const limite = fimDaFolha - (ehUltimo ? ALTURA_ADICIONAIS : 0);
    if (y + altura > limite) {
      doc.addPage({ size: 'A4', margin: M });
      y = cabecalho(doc, nota, M, barras, folhas);
      y = cabecalhoProdutos(doc, y);
    }

    let x = M;
    for (const coluna of COLUNAS) {
      doc.lineWidth(0.3).rect(x, y, coluna.w, altura).stroke('#000');
      doc.font('Helvetica').fontSize(6).fillColor('#000').text(String(coluna.campo(item) ?? ''), x + 2, y + 2.5, {
        width: coluna.w - 4,
        align: coluna.direita ? 'right' : 'left',
        lineBreak: Boolean(coluna.quebra),
        ellipsis: !coluna.quebra,
      });
      x += coluna.w;
    }
    y += altura;
  }

  // ---- dados adicionais --------------------------------------------------
  if (y + ALTURA_ADICIONAIS > fimDaFolha) {
    doc.addPage({ size: 'A4', margin: M });
    y = cabecalho(doc, nota, M, barras, folhas);
  }
  y += 4;
  y = titulo(doc, y, 'DADOS ADICIONAIS');
  const alturaAdic = Math.max(50, fimDaFolha - y - 12);
  caixa(doc, M, y, 370, Math.min(alturaAdic, 120), 'INFORMACOES COMPLEMENTARES', nota.informacoesComplementares,
    { quebrar: true, tamanho: 6.5, topo: 9 });
  caixa(doc, M + 370, y, 185, Math.min(alturaAdic, 120), 'RESERVADO AO FISCO', '');

  // ---- numero das folhas e carimbos --------------------------------------
  const { count } = doc.bufferedPageRange();
  for (const folha of folhas) {
    doc.switchToPage(folha.pagina);
    doc.font('Helvetica').fontSize(7).fillColor('#000')
      .text(`FOLHA ${folha.pagina + 1}/${count}`, folha.x, folha.y, { width: 105, align: 'center', lineBreak: false });
  }
  for (let pagina = 0; pagina < count; pagina += 1) {
    doc.switchToPage(pagina);
    if (nota.homologacao) carimbo(doc, 'SEM VALOR FISCAL', '#d4183d');
    if (situacao === 'cancelada') carimbo(doc, 'NF-e CANCELADA', '#d4183d');
  }

  doc.end();
  return pronto;
}
