// Notas que chegam pela Sefaz - tudo, menos a conversa de verdade com a Sefaz.
//
//   node src/ferramentas/t-sefaz.mjs
//
// A Sefaz aqui e de mentira (mesmas respostas oficiais: 137, 138, 656, gzip/base64),
// porque testar de verdade a cada rodada gastaria a cota de consultas da loja e
// registraria "ciencia" em notas reais. Confere:
//   1. o pedido e o evento no formato oficial;
//   2. a leitura da resposta (documentos compactados) e de cada tipo de documento;
//   3. a regra de 1 hora (a Sefaz bloqueia quem pergunta antes), lote em varias
//      voltas, bloqueio 656 e falta de internet;
//   4. nota cancelada pelo fornecedor nao pode ser aberta;
//   5. baixar o XML: ciencia uma vez so, XML guardado, e os erros explicados;
//   6. a lista marca o que ja foi lancado no Plugin e no Solus.
// Usa uma loja de teste (dados/lojas/teste-sefaz) e apaga tudo no fim.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { comLoja } from '../loja-atual.js';
import { pastaDaLoja } from '../config.js';
import {
  pedidoDeDistribuicao, lerDistribuicao, lerDocumento, eventoDeCiencia, dataHoraDaSefaz,
  lerRetornoDoEvento, codigoDaUf,
} from '../sefaz/sefaz.js';
import {
  usarSefazDeTeste, buscarNotasNovas, listarNotasRecebidas, xmlDaNota, situacaoDaSefaz,
} from '../sefaz/notas-recebidas.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};
const deuErro = async (promessa) => {
  try { await promessa; return ''; } catch (e) { return e.message; }
};

// ---- documentos de mentira, no formato da Sefaz -------------------------------
const NFE = 'http://www.portalfiscal.inf.br/nfe';
const chave = (n) => `352610112223330001815500100000${String(n).padStart(4, '0')}1000001011`.slice(0, 44);
const [A, B, C, E, F] = [101, 102, 103, 105, 106].map(chave);
const hoje = new Date().toISOString().slice(0, 10);
const resumo = (ch, valor) => `<resNFe xmlns="${NFE}" versao="1.01"><chNFe>${ch}</chNFe><CNPJ>11222333000181</CNPJ>`
  + `<xNome>FORNECEDOR DE TESTE LTDA</xNome><IE>123</IE><dhEmi>${hoje}T10:00:00-03:00</dhEmi><tpNF>1</tpNF>`
  + `<vNF>${valor}</vNF><digVal>x</digVal><dhRecbto>${hoje}T10:01:00-03:00</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>`;
const exemplo = fs.readFileSync('exemplos/nota-teste-entrada.xml', 'utf8').replace(/<dhEmi>[^<]+</, `<dhEmi>${hoje}T10:15:00-03:00<`);
const completa = (ch) => exemplo.replace(/Id="NFe\d{44}"/, `Id="NFe${ch}"`);
const cancelamento = (ch) => `<resEvento xmlns="${NFE}" versao="1.01"><cOrgao>35</cOrgao><CNPJ>11222333000181</CNPJ>`
  + `<chNFe>${ch}</chNFe><dhEvento>${hoje}T11:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>`
  + '<xEvento>Cancelamento</xEvento><dhRecbto>x</dhRecbto><nProt>2</nProt></resEvento>';
const resposta = (cStat, ultNSU, maxNSU, docs = []) => '<?xml version="1.0" encoding="utf-8"?>'
  + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
  + '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>'
  + `<retDistDFeInt xmlns="${NFE}" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic><cStat>${cStat}</cStat>`
  + `<xMotivo>motivo ${cStat}</xMotivo><dhResp>x</dhResp><ultNSU>${String(ultNSU).padStart(15, '0')}</ultNSU>`
  + `<maxNSU>${String(maxNSU).padStart(15, '0')}</maxNSU>`
  + (docs.length ? `<loteDistDFeInt>${docs.map(([nsu, xml], i) => `<docZip NSU="${String(nsu).padStart(15, '0')}" schema="s${i}.xsd">`
    + `${zlib.gzipSync(Buffer.from(xml)).toString('base64')}</docZip>`).join('')}</loteDistDFeInt>` : '')
  + '</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';

// ===========================================================================
console.log('\n=== 1. O pedido e o evento no formato oficial ===');
const pedido = pedidoDeDistribuicao({ cnpj: '07.132.154/0001-86', uf: 'sp', ultNSU: '123' });
conferir('pedido da lista: UF, CNPJ e ultimo NSU com 15 numeros',
  pedido.includes('<cUFAutor>35</cUFAutor>') && pedido.includes('<CNPJ>07132154000186</CNPJ>')
  && pedido.includes('<ultNSU>000000000000123</ultNSU>') && pedido.includes('versao="1.01"'));
conferir('pedido de uma nota so: pela chave', pedidoDeDistribuicao({ cnpj: '1', uf: 'SP', chave: A }).includes(`<consChNFe><chNFe>${A}</chNFe>`));
conferir('UF desconhecida explica o problema', /UF/.test((() => { try { codigoDaUf('XX'); return ''; } catch (e) { return e.message; } })()));
const evento = eventoDeCiencia({ cnpj: '07132154000186', chave: A });
conferir('ciencia: Id, orgao nacional (91) e codigo 210210',
  evento.includes(`Id="ID210210${A}01"`) && evento.includes('<cOrgao>91</cOrgao>') && evento.includes('<tpEvento>210210</tpEvento>'));
conferir('data e hora com o fuso (-03:00)', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(dataHoraDaSefaz()), dataHoraDaSefaz());
const retorno = (cStat) => lerRetornoDoEvento(`<retEnvEvento xmlns="${NFE}"><cStat>128</cStat><retEvento><infEvento>`
  + `<cStat>${cStat}</cStat><xMotivo>m${cStat}</xMotivo></infEvento></retEvento></retEnvEvento>`);
conferir('ciencia registrada (135) e ja registrada antes (573) servem; recusa (650) nao',
  retorno('135').ok && retorno('573').ok && !retorno('650').ok);

console.log('\n=== 2. Ler a resposta da Sefaz ===');
const lida = lerDistribuicao(resposta('138', 2, 5, [[1, resumo(A, '150.00')], [2, completa(B)]]));
conferir('situacao, NSU e os 2 documentos descompactados', lida.cStat === '138' && lida.ultNSU === '000000000000002'
  && lida.documentos.length === 2 && lida.documentos[0].xml.startsWith('<resNFe'), `${lida.cStat} ${lida.ultNSU}`);
const r = lerDocumento(lida.documentos[0]);
conferir('resumo: fornecedor, valor e situacao', r.tipo === 'resumo' && r.chave === A && r.valor === 150
  && r.emitente.nome === 'FORNECEDOR DE TESTE LTDA' && r.situacao === 'autorizada');
const c = lerDocumento(lida.documentos[1]);
conferir('nota completa: chave tirada do XML', c.tipo === 'completa' && c.chave === B && c.valor > 0, `${c.chave} ${c.valor}`);
conferir('cancelamento pelo fornecedor e reconhecido', lerDocumento({ xml: cancelamento(A) }).evento === '110111');
conferir('resposta estranha da Sefaz vira erro em portugues', /inesperado/.test((() => { try { lerDistribuicao('<html>erro</html>'); return ''; } catch (e) { return e.message; } })()));

// ===========================================================================
const fila = [];            // respostas que a Sefaz de mentira vai dar, em ordem
let consultas = 0;
let ciencias = 0;
let respostaDaCiencia = { ok: true, cStat: '135', motivo: 'registrado' };
let temCertificado = false;
usarSefazDeTeste({
  certificadoDaLoja: async () => (temCertificado
    ? { certificado: { impressao: 'X', nome: 'LOJA TESTE', cnpj: '07132154000186', validoAte: '2030-01-01T00:00:00' }, motivo: '' }
    : { certificado: null, motivo: 'O certificado digital da loja nao esta instalado NESTE PC.' }),
  consultarDistribuicao: async () => {
    consultas += 1;
    const proxima = fila.shift();
    if (!proxima) throw new Error('a Sefaz de mentira nao esperava essa consulta');
    if (proxima instanceof Error) throw proxima;
    return lerDistribuicao(proxima);
  },
  enviarCiencia: async () => { ciencias += 1; return respostaDaCiencia; },
});

await comLoja('teste-sefaz', async () => {
  const pasta = pastaDaLoja();
  fs.rmSync(pasta, { recursive: true, force: true });
  const estadoArquivo = () => path.join(pastaDaLoja('sefaz'), 'notas-recebidas.json');
  const liberarJa = () => {
    const e = JSON.parse(fs.readFileSync(estadoArquivo(), 'utf8'));
    e.proximaPermitida = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(estadoArquivo(), JSON.stringify(e));
  };
  const estado = () => JSON.parse(fs.readFileSync(estadoArquivo(), 'utf8'));
  const minutosAte = (iso) => Math.round((Date.parse(iso) - Date.now()) / 60000);

  try {
    console.log('\n=== 3. Buscar notas: certificado, regra de 1 hora, lotes, bloqueio ===');
    conferir('sem certificado: explica o que fazer', /NESTE PC/.test(await deuErro(buscarNotasNovas())));
    conferir('  e a tela mostra o motivo', /NESTE PC/.test((await situacaoDaSefaz()).motivo));
    temCertificado = true;

    fila.push(resposta('138', 2, 2, [[1, resumo(A, '150.00')], [2, completa(B)]]));
    const primeira = await buscarNotasNovas();
    conferir('primeira busca: 2 notas novas', primeira.novas === 2, `${primeira.novas} novas`);
    conferir('pegou tudo: a proxima so daqui a ~1 hora', Math.abs(minutosAte(primeira.proximaPermitida) - 61) <= 1,
      `${minutosAte(primeira.proximaPermitida)} min`);
    conferir('a nota completa ja tem o XML guardado', estado().notas[B].temXml
      && fs.existsSync(path.join(pastaDaLoja('sefaz/xml'), `${B}.xml`)));

    const antes = consultas;
    const cedo = await buscarNotasNovas();
    conferir('buscar de novo antes de 1 hora NAO pergunta a Sefaz', cedo.esperar && consultas === antes);

    const [juntaA, juntaB] = await Promise.all([buscarNotasNovas(), buscarNotasNovas()]);
    conferir('duas buscas ao mesmo tempo nao perguntam em dobro', juntaA.esperar && juntaB.esperar && consultas === antes);

    liberarJa();
    fila.push(resposta('138', 3, 4, [[3, resumo(C, '99.90')]]), resposta('138', 4, 4, [[4, cancelamento(A)]]));
    const lote = await buscarNotasNovas();
    conferir('lote grande: busca as voltas que faltam e para no fim', consultas === antes + 2 && lote.novas === 1,
      `${consultas - antes} consultas, ${lote.novas} nova`);
    conferir('o cancelamento do fornecedor marca a nota', estado().notas[A].situacao === 'cancelada');
    conferir('numero e serie saem da chave', estado().notas[C].numero === '103' && estado().notas[C].serie === '1',
      `${estado().notas[C].numero}/${estado().notas[C].serie}`);

    liberarJa();
    fila.push(resposta('137', 4, 4));
    await buscarNotasNovas();
    conferir('nada novo (137): espera 1 hora', Math.abs(minutosAte(estado().proximaPermitida) - 61) <= 1);

    liberarJa();
    fila.push(resposta('656', 4, 4));
    await buscarNotasNovas();
    conferir('bloqueio 656: espera 1 hora e avisa', /1 hora/.test(estado().ultimoErro) && minutosAte(estado().proximaPermitida) >= 60,
      estado().ultimoErro);

    liberarJa();
    fila.push(new Error('getaddrinfo ENOTFOUND www1.nfe.fazenda.gov.br'));
    const semInternet = await deuErro(buscarNotasNovas());
    conferir('sem internet: avisa e tenta de novo em 15 minutos (nao e consulta)', /ENOTFOUND/.test(semInternet)
      && Math.abs(minutosAte(estado().proximaPermitida) - 15) <= 1, `${minutosAte(estado().proximaPermitida)} min`);

    console.log('\n=== 4 e 5. Abrir uma nota (baixar o XML) ===');
    const cancelada = await deuErro(xmlDaNota(A));
    conferir('nota cancelada nao abre, e diz por que', /CANCELADA/.test(cancelada), cancelada);
    conferir('nota fora da lista nao abre', /nao esta na lista/.test(await deuErro(xmlDaNota(chave(999)))));

    const consultasAntes = consultas;
    fila.push(resposta('138', 4, 4, [[0, completa(C)]]));
    const baixada = await xmlDaNota(C);
    conferir('resumo: manda a ciencia e baixa o XML pela chave', ciencias === 1 && consultas === consultasAntes + 1
      && baixada.xml.includes(C));
    const deNovo = await xmlDaNota(C);
    conferir('abrir de novo usa o XML guardado (nem ciencia, nem consulta)', ciencias === 1
      && consultas === consultasAntes + 1 && deNovo.xml.includes(C));
    conferir('nota completa que ja veio inteira abre direto', (await xmlDaNota(B)).xml.includes(B) && ciencias === 1);

    // notas sem XML ainda, para os erros da ciencia
    const e = estado();
    for (const ch of [E, F]) {
      e.notas[ch] = { chave: ch, emissao: `${hoje}T09:00:00-03:00`, situacao: 'autorizada', ciencia: false, temXml: false,
        emitente: { cnpj: '1', nome: 'X' }, valor: 1, numero: '1', serie: '1' };
    }
    fs.writeFileSync(estadoArquivo(), JSON.stringify(e));
    respostaDaCiencia = { ok: false, cStat: '596', motivo: 'Rejeicao: evento apresentado apos o prazo' };
    const recusada = await deuErro(xmlDaNota(E));
    conferir('ciencia recusada: mostra o motivo da Sefaz', /596/.test(recusada) && !estado().notas[E].ciencia, recusada);

    respostaDaCiencia = { ok: true, cStat: '135', motivo: 'ok' };
    fila.push(resposta('137', 4, 4), resposta('137', 4, 4), resposta('137', 4, 4));
    const demorando = await deuErro(xmlDaNota(F));
    conferir('XML ainda nao liberado: avisa para tentar em alguns minutos', /alguns minutos/.test(demorando), demorando);
    conferir('  e a ciencia fica registrada (nao manda de novo)', estado().notas[F].ciencia === true);

    console.log('\n=== 6. A lista: o que ja foi lancado ===');
    const noSolus = '35250805955701000106550010066800321148125762';      // existe em CENTRADA na copia do banco
    const e2 = estado();
    e2.notas[noSolus] = { chave: noSolus, emissao: `${hoje}T08:00:00-03:00`, situacao: 'autorizada', emitente: { nome: 'COMPRE FACIL' }, valor: 10 };
    fs.writeFileSync(estadoArquivo(), JSON.stringify(e2));
    fs.writeFileSync(path.join(pastaDaLoja('historico'), '2026-teste-sefaz.json'),
      JSON.stringify({ id: '2026-teste-sefaz', quando: new Date().toISOString(), operador: 'TESTE', nota: { chave: B } }));
    const lista = await listarNotasRecebidas();
    const de = (ch) => lista.find((n) => n.chave === ch);
    conferir('lancada pelo Plugin aparece como lancada', Boolean(de(B)?.lancadaNoPlugin));
    conferir('lancada pelo proprio Solus (CENTRADA) aparece como lancada', Boolean(de(noSolus)?.lancadaNoSolus));
    conferir('a que falta lancar fica sem marca', !de(C)?.lancadaNoPlugin && !de(C)?.lancadaNoSolus);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
