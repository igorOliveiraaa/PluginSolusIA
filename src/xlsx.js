// Planilha do Excel (.xlsx) montada na mao, sem biblioteca.
//
// Um .xlsx e so um arquivo ZIP com alguns XML dentro. Montar aqui evita
// instalar dependencia nova na loja (o ZIP baixado do GitHub nao traz
// node_modules atualizado) e o que o orcamento precisa e pouco: texto, numero,
// formula, negrito, cor de fundo, formato de dinheiro e largura de coluna.
//
// O arquivo abre no Excel, no LibreOffice, no Google Planilhas e no celular.

import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = TABELA_CRC[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function horaDos(data) {
  const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2);
  const dia = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  return { hora, dia };
}

/** Junta arquivos { nome, conteudo } num ZIP (comprimido). */
export function montarZip(arquivos) {
  const { hora, dia } = horaDos(new Date());
  const locais = [];
  const centrais = [];
  let posicao = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, 'utf8');
    const dados = Buffer.isBuffer(arquivo.conteudo) ? arquivo.conteudo : Buffer.from(arquivo.conteudo, 'utf8');
    const comprimido = zlib.deflateRawSync(dados);
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // versao necessaria
    local.writeUInt16LE(0x0800, 6);        // nomes em UTF-8
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(posicao, 42);
    centrais.push(central, nome);

    posicao += local.length + nome.length + comprimido.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(posicao, 16);

  return Buffer.concat([...locais, diretorio, fim]);
}

// ---------------------------------------------------------------------------
// Estilos (indices de cellXfs)
// ---------------------------------------------------------------------------

export const ESTILO = {
  normal: 0,
  negrito: 1,
  titulo: 2,
  cabecalho: 3,
  celula: 4,
  inteiro: 5,
  decimal: 6,
  dinheiro: 7,
  dinheiroNegrito: 8,
  cinza: 9,
  totalGrande: 10,
  celulaQuebra: 11,
  rotuloTotal: 12,
};

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00"/></numFmts>
  <fonts count="6">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF4F46E5"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
</styleSheet>`;

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

// caractere de controle (00-08, 0B, 0C, 0E-1F) quebra o arquivo inteiro no Excel.
// A lista e montada por codigo para nao gravar caractere invisivel no fonte.
const CONTROLE = new RegExp(
  '[' + [[0, 8], [11, 12], [14, 31]]
    .map(([de, ate]) => String.fromCharCode(de) + '-' + String.fromCharCode(ate)).join('') + ']',
  'g'
);

const escaparXml = (texto) => String(texto ?? '')
  .replace(CONTROLE, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 0 -> A, 25 -> Z, 26 -> AA */
export function letraDaColuna(indice) {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

function celulaXml(celula, referencia) {
  if (celula === null || celula === undefined) return '';
  const dados = typeof celula === 'object' ? celula : { v: celula };
  const estilo = dados.s ? ` s="${dados.s}"` : '';

  if (dados.f) {
    const valor = Number.isFinite(Number(dados.v)) ? `<v>${Number(dados.v)}</v>` : '';
    return `<c r="${referencia}"${estilo}><f>${escaparXml(dados.f)}</f>${valor}</c>`;
  }
  if (typeof dados.v === 'number' && Number.isFinite(dados.v)) {
    return `<c r="${referencia}"${estilo}><v>${dados.v}</v></c>`;
  }
  if (dados.v === '' || dados.v === null || dados.v === undefined) {
    return dados.s ? `<c r="${referencia}"${estilo}/>` : '';
  }
  return `<c r="${referencia}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escaparXml(dados.v)}</t></is></c>`;
}

/**
 * Monta o .xlsx.
 *  linhas:   [[celula, celula...], ...]   celula = valor | { v, s, f }
 *  larguras: [largura da coluna A, B, ...] (em caracteres)
 *  mesclar:  ['A1:G1', ...]
 *  alturas:  { numeroDaLinha(1..): altura em pontos }
 */
export function montarXlsx({ nomeDaAba = 'Planilha', linhas = [], larguras = [], mesclar = [], alturas = {} }) {
  const colunas = larguras.length
    ? `<cols>${larguras.map((largura, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${largura}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const dadosXml = linhas.map((linha, i) => {
    const numero = i + 1;
    const altura = alturas[numero] ? ` ht="${alturas[numero]}" customHeight="1"` : '';
    const celulas = (linha || []).map((celula, j) => celulaXml(celula, letraDaColuna(j) + numero)).join('');
    return `<row r="${numero}"${altura}>${celulas}</row>`;
  }).join('');

  const mesclas = mesclar.length
    ? `<mergeCells count="${mesclar.length}">${mesclar.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  const aba = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${colunas}
  <sheetData>${dadosXml}</sheetData>
  ${mesclas}
  <pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
  <pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  // nome de aba: ate 31 caracteres e sem : \ / ? * [ ]
  const nomeSeguro = escaparXml(String(nomeDaAba).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Planilha');

  return montarZip([
    {
      nome: '[Content_Types].xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      nome: '_rels/.rels',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      nome: 'xl/workbook.xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${nomeSeguro}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { nome: 'xl/styles.xml', conteudo: ESTILOS_XML },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: aba },
  ]);
}
