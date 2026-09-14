// Leitura do XML da NF-e. Esta e a fonte mais confiavel que existe:
// nao tem chute de OCR, os numeros vem exatos do fornecedor.
//
// O detalhe que resolve o problema da caixa:
// a NF-e traz DOIS pares de quantidade/unidade por item --
//   uCom/qCom/vUnCom   -> unidade COMERCIAL (o que o fornecedor vendeu: CX, FD, DP...)
//   uTrib/qTrib/vUnTrib-> unidade TRIBUTAVEL (normalmente a unidade de verdade: UN)
// O Solus importa a comercial e por isso cadastra "1 caixa" em vez de "12 unidades".
// Aqui a gente usa a tributavel e calcula quantas unidades tem na caixa.

import { XMLParser } from 'fast-xml-parser';

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,       // manter tudo como texto e converter na mao (evita perder zeros)
  trimValues: true,
});

function num(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const n = Number.parseFloat(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function texto(valor) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor === 'object') return '';
  return String(valor).trim();
}

function lista(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/** Procura uma chave em qualquer profundidade (o XML muda de formato entre emissores). */
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

const EAN_INVALIDO = /^(SEM\s*GTIN|SEMGTIN|0+)$/i;

function limparEAN(valor) {
  const bruto = texto(valor);
  if (!bruto || EAN_INVALIDO.test(bruto)) return '';
  const digitos = bruto.replace(/\D/g, '');
  // EAN valido tem 8, 12, 13 ou 14 digitos
  return [8, 12, 13, 14].includes(digitos.length) ? digitos : '';
}

/** Descobre quantas unidades vem na caixa a partir da descricao do produto. */
export function unidadesNaDescricao(descricao) {
  const texto = String(descricao || '').toUpperCase();
  const padroes = [
    /C\s*\/\s*(\d{1,4})\b/,                    // "CX C/12"
    /\bC(\d{1,4})\b/,                          // "CX C12"
    /(\d{1,4})\s*X\s*\d+\s*(ML|L|G|KG|UN)/,    // "12X500ML"
    /\b(?:CX|CAIXA|FD|FARDO|PCT|PACOTE|DP|DISPLAY)\s*(?:COM)?\s*(\d{1,4})\b/,
    /\bCOM\s+(\d{1,4})\s*(?:UN|UNID|UNIDADES?)\b/,
    /\b(\d{1,4})\s*(?:UN|UNID|UNIDADES?)\b/,
  ];
  for (const padrao of padroes) {
    const achado = texto.match(padrao);
    if (achado) {
      const quantidade = Number.parseInt(achado[1], 10);
      if (quantidade > 1 && quantidade <= 9999) return quantidade;
    }
  }
  return 0;
}

const UNIDADES_DE_CAIXA = /^(CX|CAIXA|FD|FARDO|PCT|PACOTE|DP|DISPLAY|SC|SACO|EMB|CJ|CT|BD|BALDE|RS|RESMA)/i;

/** A unidade informada representa um agrupamento (caixa/fardo) e nao a unidade avulsa? */
export function ehUnidadeDeCaixa(unidade) {
  return UNIDADES_DE_CAIXA.test(String(unidade || '').trim());
}

/**
 * Decide a quantidade REAL em unidades e o custo por unidade.
 * Devolve tambem como chegou nessa conclusao, para a tela poder explicar ao usuario.
 */
export function resolverUnidades({ uCom, qCom, vUnCom, uTrib, qTrib, vUnTrib, descricao }) {
  const comercialEhCaixa = ehUnidadeDeCaixa(uCom);
  const tribEhCaixa = ehUnidadeDeCaixa(uTrib);
  const fatorTributavel = qCom > 0 ? qTrib / qCom : 0;

  // Caso 1: veio em caixa no comercial e a tributavel ja esta em unidade.
  // E o caso mais comum e o mais confiavel: o proprio XML diz quantas unidades sao.
  if (comercialEhCaixa && !tribEhCaixa && fatorTributavel > 1) {
    return {
      quantidadeUnidades: qTrib,
      custoUnitario: vUnTrib,
      unidadesPorCaixa: Math.round(fatorTributavel),
      unidadeOriginal: uCom,
      convertido: true,
      confianca: 'alta',
      explicacao: `A nota veio em ${uCom} (${qCom}), e o proprio XML informa ${qTrib} ${uTrib || 'UN'}. Convertido para unidade.`,
    };
  }

  // Caso 2: comercial e tributavel sao ambas caixa -> tenta achar na descricao
  if (comercialEhCaixa && tribEhCaixa) {
    const porCaixa = unidadesNaDescricao(descricao);
    if (porCaixa > 1) {
      return {
        quantidadeUnidades: qCom * porCaixa,
        custoUnitario: porCaixa > 0 ? vUnCom / porCaixa : vUnCom,
        unidadesPorCaixa: porCaixa,
        unidadeOriginal: uCom,
        convertido: true,
        confianca: 'media',
        explicacao: `A nota veio em ${uCom} e a descricao indica ${porCaixa} unidades por ${uCom}. Confira se esta certo.`,
      };
    }
    return {
      quantidadeUnidades: qCom,
      custoUnitario: vUnCom,
      unidadesPorCaixa: 0,
      unidadeOriginal: uCom,
      convertido: false,
      confianca: 'baixa',
      explicacao: `A nota veio em ${uCom} mas nao da para saber quantas unidades tem dentro. Informe a quantidade por ${uCom}.`,
    };
  }

  // Caso 3: ja esta em unidade - usa a tributavel quando ela for maior (mais detalhada)
  if (fatorTributavel > 1 && !tribEhCaixa) {
    return {
      quantidadeUnidades: qTrib,
      custoUnitario: vUnTrib,
      unidadesPorCaixa: Math.round(fatorTributavel),
      unidadeOriginal: uCom,
      convertido: true,
      confianca: 'alta',
      explicacao: `Convertido de ${qCom} ${uCom} para ${qTrib} ${uTrib}.`,
    };
  }

  return {
    quantidadeUnidades: qCom,
    custoUnitario: vUnCom,
    unidadesPorCaixa: 0,
    unidadeOriginal: uCom || 'UN',
    convertido: false,
    confianca: 'alta',
    explicacao: '',
  };
}

/** Le o XML da NF-e e devolve a nota no formato que o resto da ferramenta usa. */
export function lerXmlNfe(conteudoXml) {
  let arvore;
  try {
    arvore = leitor.parse(conteudoXml);
  } catch {
    // o leitor de XML reclama em ingles e com posicao de caractere; ninguem no
    // balcao entende isso - e quase sempre e arquivo trocado ou incompleto
    throw new Error(
      'Esse arquivo esta danificado ou nao e um XML de nota. '
      + 'Baixe o XML de novo do fornecedor, ou mande o PDF/foto da nota.'
    );
  }

  const infNFe = achar(arvore, 'infNFe');
  if (!infNFe) {
    throw new Error('Esse XML nao parece uma NF-e (nao achei a parte infNFe).');
  }

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const dest = infNFe.dest || {};
  const totalICMS = achar(infNFe, 'ICMSTot') || {};

  const itens = lista(infNFe.det).map((det, indice) => {
    const prod = det.prod || {};
    const imposto = det.imposto || {};

    const icms = Object.values(imposto.ICMS || {})[0] || {};
    const ipi = Object.values(imposto.IPI || {})[0] || {};
    const ipiTrib = ipi.IPITrib || ipi;

    const uCom = texto(prod.uCom);
    const uTrib = texto(prod.uTrib);
    const qCom = num(prod.qCom);
    const qTrib = num(prod.qTrib);
    const vUnCom = num(prod.vUnCom);
    const vUnTrib = num(prod.vUnTrib);
    const descricao = texto(prod.xProd);

    const unidades = resolverUnidades({ uCom, qCom, vUnCom, uTrib, qTrib, vUnTrib, descricao });

    return {
      numero: Number(det['@nItem'] || indice + 1),
      descricao,
      codigoFornecedor: texto(prod.cProd),
      codigoBarras: limparEAN(prod.cEAN) || limparEAN(prod.cEANTrib),
      ncm: texto(prod.NCM),
      cest: texto(prod.CEST),
      cfop: texto(prod.CFOP),

      // valores brutos da nota
      unidadeComercial: uCom,
      quantidadeComercial: qCom,
      valorUnitarioComercial: vUnCom,
      unidadeTributavel: uTrib,
      quantidadeTributavel: qTrib,
      valorUnitarioTributavel: vUnTrib,
      valorProduto: num(prod.vProd),
      desconto: num(prod.vDesc),
      frete: num(prod.vFrete),
      seguro: num(prod.vSeg),
      outrasDespesas: num(prod.vOutro),

      // impostos que entram (ou nao) no custo
      valorIPI: num(ipiTrib.vIPI),
      valorICMS: num(icms.vICMS),
      aliquotaICMS: num(icms.pICMS),
      valorICMSST: num(icms.vICMSST),
      valorFCPST: num(icms.vFCPST),
      cst: texto(icms.CST) || texto(icms.CSOSN),

      // ja convertido para unidade
      ...unidades,
    };
  });

  return {
    origem: 'xml',
    chave: texto(infNFe['@Id']).replace(/\D/g, ''),
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    emissao: texto(ide.dhEmi || ide.dEmi).slice(0, 10),
    fornecedor: {
      cnpj: texto(emit.CNPJ) || texto(emit.CPF),
      nome: texto(emit.xNome),
      fantasia: texto(emit.xFant),
      uf: texto(achar(emit, 'UF')),
    },
    destinatario: {
      cnpj: texto(dest.CNPJ) || texto(dest.CPF),
      nome: texto(dest.xNome),
    },
    totais: {
      produtos: num(totalICMS.vProd),
      nota: num(totalICMS.vNF),
      frete: num(totalICMS.vFrete),
      seguro: num(totalICMS.vSeg),
      outras: num(totalICMS.vOutro),
      desconto: num(totalICMS.vDesc),
      ipi: num(totalICMS.vIPI),
      icmsST: num(totalICMS.vST),
      fcpST: num(totalICMS.vFCPST),
    },
    itens,
  };
}

/** Confere rapidamente se o texto e um XML de NF-e. */
export function pareceXmlNfe(conteudo) {
  const inicio = String(conteudo).slice(0, 3000);
  return inicio.includes('<nfeProc') || inicio.includes('<NFe') || inicio.includes('infNFe');
}
