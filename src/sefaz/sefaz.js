// Os dois servicos OFICIAIS da Sefaz (Ambiente Nacional, nfe.fazenda.gov.br):
//
//  - Distribuicao de DF-e: a lista de todas as NF-e emitidas CONTRA o CNPJ da loja.
//    Primeiro vem o RESUMO (fornecedor, valor, data). O XML inteiro so e liberado
//    depois da "Ciencia da Operacao".
//  - Recepcao de Evento: a "Ciencia da Operacao" (210210). Diz so que a loja sabe
//    que a nota existe - nao e aceite nem recusa. E o que todo sistema faz para baixar.
//
// Regras da Sefaz que importam (Nota Tecnica 2014.002):
//  - cStat 137 = nada novo; 138 = tem documento; 656 = "consumo indevido";
//  - quando nao ha nada novo (ultNSU = maxNSU), so pode consultar de novo depois de 1 HORA,
//    senao a Sefaz bloqueia (656). Quem cuida disso e o notas-recebidas.js.

import zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { rodarPowerShell } from './certificado.js';

const URL_DISTRIBUICAO = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const ACAO_DISTRIBUICAO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
const URL_EVENTO = 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
const ACAO_EVENTO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento';
const NFE = 'http://www.portalfiscal.inf.br/nfe';

const CODIGO_DA_UF = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22',
  CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32',
  RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,          // NSU "000000000000123" e chave ficam como texto
  trimValues: true,
});

const digitos = (valor) => String(valor || '').replace(/\D/g, '');
const lista = (valor) => (valor === undefined || valor === null ? [] : Array.isArray(valor) ? valor : [valor]);
const texto = (valor) => (valor === undefined || valor === null || typeof valor === 'object' ? '' : String(valor).trim());

function achar(objeto, chave) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  if (objeto[chave] !== undefined) return objeto[chave];
  for (const valor of Object.values(objeto)) {
    const achado = achar(valor, chave);
    if (achado !== undefined) return achado;
  }
  return undefined;
}

const envelope = (corpo) => '<?xml version="1.0" encoding="utf-8"?>'
  + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
  + 'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
  + `<soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;

export function codigoDaUf(uf) {
  const codigo = CODIGO_DA_UF[String(uf || '').trim().toUpperCase()];
  if (!codigo) throw new Error(`Estado da loja desconhecido ("${uf}"). Confira a UF no cadastro da empresa no Solus.`);
  return codigo;
}

// ---------------------------------------------------------------------------
// Distribuicao (a lista de notas)
// ---------------------------------------------------------------------------

/** Pedido de distribuicao: pelo ultimo NSU (lista) ou pela chave (uma nota). */
export function pedidoDeDistribuicao({ cnpj, uf, ultNSU = '0', chave = '' }) {
  const consulta = chave
    ? `<consChNFe><chNFe>${digitos(chave)}</chNFe></consChNFe>`
    : `<distNSU><ultNSU>${digitos(ultNSU).padStart(15, '0').slice(-15)}</ultNSU></distNSU>`;
  return envelope(
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>'
    + `<distDFeInt xmlns="${NFE}" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${codigoDaUf(uf)}</cUFAutor>`
    + `<CNPJ>${digitos(cnpj)}</CNPJ>${consulta}</distDFeInt>`
    + '</nfeDadosMsg></nfeDistDFeInteresse>');
}

/** Resposta da distribuicao: situacao + documentos ja descompactados (vem em gzip). */
export function lerDistribuicao(respostaXml) {
  const tudo = leitor.parse(String(respostaXml || ''));
  const retorno = achar(tudo, 'retDistDFeInt');
  if (!retorno) {
    const falha = texto(achar(tudo, 'Text')) || texto(achar(tudo, 'faultstring'));
    throw new Error(`A Sefaz respondeu algo inesperado${falha ? `: ${falha.slice(0, 200)}` : ''}.`);
  }
  const documentos = lista(retorno.loteDistDFeInt?.docZip).map((doc) => ({
    nsu: digitos(doc['@NSU']),
    schema: texto(doc['@schema']),
    xml: zlib.gunzipSync(Buffer.from(texto(doc['#text']), 'base64')).toString('utf8'),
  }));
  return {
    cStat: texto(retorno.cStat),
    motivo: texto(retorno.xMotivo),
    ultNSU: digitos(retorno.ultNSU),
    maxNSU: digitos(retorno.maxNSU),
    documentos,
  };
}

const SITUACAO = { 1: 'autorizada', 2: 'denegada', 3: 'cancelada' };

/**
 * O que e cada documento da lista:
 *  - resumo (resNFe): a nota existe, ainda sem o XML inteiro;
 *  - completa (nfeProc): o XML inteiro, ja pode ir para a conferencia;
 *  - evento: cancelamento pelo fornecedor (110111) e o que interessa.
 */
export function lerDocumento({ xml }) {
  const tudo = leitor.parse(xml);

  const resumo = tudo.resNFe;
  if (resumo) {
    return {
      tipo: 'resumo',
      chave: digitos(resumo.chNFe),
      emitente: { cnpj: digitos(resumo.CNPJ || resumo.CPF), nome: texto(resumo.xNome) },
      emissao: texto(resumo.dhEmi),
      valor: Number(texto(resumo.vNF)) || 0,
      situacao: SITUACAO[texto(resumo.cSitNFe)] || 'autorizada',
      entrada: texto(resumo.tpNF) === '0',
    };
  }

  const nfe = achar(tudo, 'infNFe');
  if (nfe) {
    const ide = nfe.ide || {};
    const emit = nfe.emit || {};
    return {
      tipo: 'completa',
      chave: digitos(nfe['@Id']),
      emitente: { cnpj: digitos(emit.CNPJ || emit.CPF), nome: texto(emit.xNome) },
      emissao: texto(ide.dhEmi || ide.dEmi),
      valor: Number(texto(achar(nfe.total, 'vNF'))) || 0,
      situacao: 'autorizada',
      entrada: texto(ide.tpNF) === '0',
      xml,
    };
  }

  const evento = tudo.resEvento || achar(tudo, 'infEvento');
  if (evento) {
    return { tipo: 'evento', chave: digitos(evento.chNFe), evento: texto(evento.tpEvento) };
  }
  return { tipo: 'outro' };
}

/** Pergunta a Sefaz (com o certificado da loja). */
export async function consultarDistribuicao({ certificado, cnpj, uf, ultNSU, chave }) {
  const resposta = await rodarPowerShell('postar', {
    impressao: certificado.impressao,
    url: URL_DISTRIBUICAO,
    acao: ACAO_DISTRIBUICAO,
    envelope: pedidoDeDistribuicao({ cnpj, uf, ultNSU, chave }),
  });
  return lerDistribuicao(resposta.corpo);
}

// ---------------------------------------------------------------------------
// Ciencia da Operacao (libera o XML inteiro)
// ---------------------------------------------------------------------------

/** "2026-10-07T14:03:00-03:00", um minuto para tras (relogio do PC adiantado da recusa) */
export function dataHoraDaSefaz(quando = new Date()) {
  const d = new Date(quando.getTime() - 60 * 1000);
  const dois = (n) => String(Math.abs(n)).padStart(2, '0');
  const fuso = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:`
    + `${dois(d.getMinutes())}:${dois(d.getSeconds())}${fuso < 0 ? '-' : '+'}${dois(Math.trunc(fuso / 60))}:${dois(fuso % 60)}`;
}

export function eventoDeCiencia({ cnpj, chave, quando = new Date() }) {
  const chNFe = digitos(chave);
  return `<envEvento xmlns="${NFE}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>`
    + `<evento versao="1.00"><infEvento Id="ID210210${chNFe}01"><cOrgao>91</cOrgao><tpAmb>1</tpAmb>`
    + `<CNPJ>${digitos(cnpj)}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dataHoraDaSefaz(quando)}</dhEvento>`
    + '<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>'
    + '<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>'
    + '</infEvento></evento></envEvento>';
}

/** 135/136 = registrada; 573 = ja tinha sido registrada antes (tambem serve). */
export function lerRetornoDoEvento(respostaXml) {
  const tudo = leitor.parse(String(respostaXml || ''));
  const lote = achar(tudo, 'retEnvEvento');
  if (!lote) throw new Error('A Sefaz respondeu algo inesperado ao registrar a ciencia.');
  const evento = achar(lote, 'retEvento')?.infEvento || {};
  const cStat = texto(evento.cStat) || texto(lote.cStat);
  return {
    ok: ['135', '136', '573'].includes(cStat),
    cStat,
    motivo: texto(evento.xMotivo) || texto(lote.xMotivo),
  };
}

export async function enviarCiencia({ certificado, cnpj, chave }) {
  const { xml } = await rodarPowerShell('assinar', {
    impressao: certificado.impressao,
    xml: eventoDeCiencia({ cnpj, chave }),
    tag: 'infEvento',
  });
  const resposta = await rodarPowerShell('postar', {
    impressao: certificado.impressao,
    url: URL_EVENTO,
    acao: ACAO_EVENTO,
    envelope: envelope(`<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${xml}</nfeDadosMsg>`),
  });
  return lerRetornoDoEvento(resposta.corpo);
}
