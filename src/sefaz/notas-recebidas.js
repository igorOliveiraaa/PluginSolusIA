// As notas que chegaram para a loja pela Sefaz.
//
// Cada loja guarda o seu estado em dados/.../sefaz/notas-recebidas.json:
//   ultNSU (ate onde ja buscou), quando pode buscar de novo e as notas (resumo).
// Os XMLs inteiros ficam em sefaz/xml/<chave>.xml.
//
// A regra que nao pode quebrar: quando a Sefaz diz que nao ha nada novo, so
// pode perguntar de novo depois de 1 hora (senao ela bloqueia com 656). Vale
// para a busca automatica E para o botao "Buscar agora".

import fs from 'node:fs';
import path from 'node:path';

import { pastaDaLoja } from '../config.js';
import { lojaAtualId } from '../loja-atual.js';
import { consultar } from '../db/firebird.js';
import { listarHistorico } from '../historico.js';
import { rascunhosAbertos, apagarRascunho } from '../rascunhos.js';
import { certificadoDaLoja } from './certificado.js';
import { consultarDistribuicao, enviarCiencia, lerDocumento } from './sefaz.js';

// o teste (t-sefaz.mjs) troca estes tres por uma Sefaz de mentira: testar de
// verdade a cada rodada gastaria a cota de consultas e registraria ciencia
const servicos = { certificadoDaLoja, consultarDistribuicao, enviarCiencia };
export function usarSefazDeTeste(trocas) {
  Object.assign(servicos, trocas);
}

const UMA_HORA = 61 * 60 * 1000;          // a Sefaz pede 1 hora; 1 minuto de folga
const QUINZE_MINUTOS = 15 * 60 * 1000;    // sem internet: tenta de novo antes
const GUARDAR_DIAS = 180;

const digitos = (valor) => String(valor || '').replace(/\D/g, '');
const agora = () => new Date().toISOString();
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Uma coisa de cada vez por loja: a busca automatica e o botao juntos perguntariam
// em dobro a Sefaz (bloqueio 656) e um apagaria o que o outro acabou de salvar.
const filas = new Map();
function naFila(trabalho) {
  const loja = lojaAtualId() || 'principal';
  const vez = (filas.get(loja) || Promise.resolve()).then(trabalho);
  filas.set(loja, vez.catch(() => {}));
  return vez;
}

// ---------------------------------------------------------------------------
// O estado guardado em arquivo
// ---------------------------------------------------------------------------

const arquivoDoEstado = () => path.join(pastaDaLoja('sefaz'), 'notas-recebidas.json');
const arquivoDoXml = (chave) => path.join(pastaDaLoja(path.join('sefaz', 'xml')), `${digitos(chave)}.xml`);

function lerEstado() {
  try {
    const estado = JSON.parse(fs.readFileSync(arquivoDoEstado(), 'utf8'));
    return { ultNSU: '0', notas: {}, ...estado };
  } catch {
    return { ultNSU: '0', notas: {} };
  }
}

function salvarEstado(estado) {
  // nota velha sai da lista (o XML ja baixado continua na pasta)
  const limite = Date.now() - GUARDAR_DIAS * 24 * 60 * 60 * 1000;
  for (const [chave, nota] of Object.entries(estado.notas)) {
    if (Date.parse(nota.emissao || nota.recebidaEm) < limite) delete estado.notas[chave];
  }
  // grava num arquivo ao lado e troca: luz que cai no meio nao estraga o estado
  const destino = arquivoDoEstado();
  fs.writeFileSync(`${destino}.novo`, JSON.stringify(estado, null, 2), 'utf8');
  fs.renameSync(`${destino}.novo`, destino);
}

/** Numero e serie saem da propria chave (posicoes fixas da NF-e). */
function numeroDaChave(chave) {
  const c = digitos(chave);
  return { serie: String(Number(c.slice(22, 25))), numero: String(Number(c.slice(25, 34))), modelo: c.slice(20, 22) };
}

/** Guarda um documento da Sefaz no estado. Devolve true quando e nota nova. */
function guardar(estado, documento) {
  const info = lerDocumento(documento);
  if (!info.chave || info.chave.length !== 44) return false;

  if (info.tipo === 'evento') {
    // o fornecedor cancelou a nota: nao pode mais ser lancada
    if (info.evento === '110111' && estado.notas[info.chave]) estado.notas[info.chave].situacao = 'cancelada';
    return false;
  }
  if (info.tipo !== 'resumo' && info.tipo !== 'completa') return false;

  const nova = !estado.notas[info.chave];
  const antes = estado.notas[info.chave] || { recebidaEm: agora(), ciencia: false, temXml: false };
  estado.notas[info.chave] = {
    ...antes,
    chave: info.chave,
    ...numeroDaChave(info.chave),
    emitente: info.emitente,
    emissao: info.emissao || antes.emissao,
    valor: info.valor || antes.valor || 0,
    // cancelada continua cancelada, mesmo que um resumo velho chegue depois
    situacao: antes.situacao === 'cancelada' ? 'cancelada' : info.situacao,
    entrada: info.entrada,
    nsu: documento.nsu || antes.nsu,
  };
  if (info.tipo === 'completa') {
    fs.writeFileSync(arquivoDoXml(info.chave), info.xml, 'utf8');
    estado.notas[info.chave].temXml = true;
  }
  return nova;
}

async function lojaNoSolus() {
  const linha = (await consultar('SELECT FIRST 1 CPFCNPJ, UF FROM PARAMETRO'))[0] || {};
  return { cnpj: digitos(linha.CPFCNPJ), uf: String(linha.UF || '').trim().toUpperCase() };
}

async function prepararCertificado() {
  const loja = await lojaNoSolus();
  const { certificado, motivo } = await servicos.certificadoDaLoja(loja.cnpj);
  return { loja, certificado, motivo };
}

// ---------------------------------------------------------------------------
// Buscar as notas novas (automatico de hora em hora, ou no botao)
// ---------------------------------------------------------------------------

export function buscarNotasNovas() {
  return naFila(buscar);
}

async function buscar() {
  const estado = lerEstado();
  if (estado.proximaPermitida && Date.now() < Date.parse(estado.proximaPermitida)) {
    return { esperar: true, novas: 0, proximaPermitida: estado.proximaPermitida };
  }

  const { loja, certificado, motivo } = await prepararCertificado();
  if (!certificado) throw new Error(motivo);
  // outro banco/loja nesta pasta (trocou o Solus): comeca do zero
  if (estado.cnpj && estado.cnpj !== loja.cnpj) Object.assign(estado, { ultNSU: '0', maxNSU: '', notas: {} });
  estado.cnpj = loja.cnpj;

  let novas = 0;
  try {
    for (let volta = 0; volta < 30; volta += 1) {
      const resposta = await servicos.consultarDistribuicao({ certificado, cnpj: loja.cnpj, uf: loja.uf, ultNSU: estado.ultNSU });
      estado.ultimaConsulta = agora();

      if (resposta.cStat === '656') {
        estado.ultimoErro = 'A Sefaz pediu para esperar 1 hora (muitas consultas seguidas).';
        estado.proximaPermitida = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }
      if (resposta.cStat === '137') {           // nada novo
        if (resposta.ultNSU) estado.ultNSU = resposta.ultNSU;
        estado.maxNSU = resposta.maxNSU || estado.maxNSU;
        estado.ultimoErro = '';
        estado.proximaPermitida = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }
      if (resposta.cStat !== '138') {
        estado.ultimoErro = `A Sefaz respondeu: ${resposta.cStat} - ${resposta.motivo}`;
        estado.proximaPermitida = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }

      for (const documento of resposta.documentos) if (guardar(estado, documento)) novas += 1;
      estado.ultNSU = resposta.ultNSU || estado.ultNSU;
      estado.maxNSU = resposta.maxNSU || estado.maxNSU;
      estado.ultimoErro = '';
      // pegou tudo: a proxima so daqui a 1 hora (regra da Sefaz)
      if (Number(estado.ultNSU) >= Number(estado.maxNSU || 0)) {
        estado.proximaPermitida = new Date(Date.now() + UMA_HORA).toISOString();
        break;
      }
      await esperar(1500);        // ainda tem mais: busca o proximo lote com calma
    }
  } catch (erro) {
    // sem internet ou Sefaz fora do ar nao e "consulta": tenta de novo em 15 minutos
    estado.ultimoErro = erro.message;
    estado.proximaPermitida = new Date(Date.now() + QUINZE_MINUTOS).toISOString();
    salvarEstado(estado);
    throw erro;
  }

  salvarEstado(estado);
  return { esperar: false, novas, proximaPermitida: estado.proximaPermitida };
}

// ---------------------------------------------------------------------------
// A lista para a tela: com "ja lancada no Plugin / no Solus"
// ---------------------------------------------------------------------------

async function chavesNoSolus(chaves) {
  const achadas = new Map();
  for (let i = 0; i < chaves.length; i += 100) {
    const pedaco = chaves.slice(i, i + 100);
    try {
      const linhas = await consultar(
        `SELECT TRIM(CHAVENFE) AS CHAVE, MAX(DATA) AS DATA FROM CENTRADA
          WHERE TRIM(CHAVENFE) IN (${pedaco.map(() => '?').join(', ')}) GROUP BY 1`, pedaco);
      for (const linha of linhas) achadas.set(String(linha.CHAVE), linha.DATA);
    } catch { /* banco sem CENTRADA.CHAVENFE: so o historico do Plugin conta */ }
  }
  return achadas;
}

export async function listarNotasRecebidas() {
  const estado = lerEstado();
  const notas = Object.values(estado.notas)
    .sort((a, b) => String(b.emissao).localeCompare(String(a.emissao)));

  const noPlugin = new Map();
  for (const registro of listarHistorico(1000)) {
    if (registro.desfeita || registro.falhou || !registro.nota?.chave) continue;
    if (!noPlugin.has(registro.nota.chave)) noPlugin.set(registro.nota.chave, registro);
  }
  const noSolus = await chavesNoSolus(notas.map((n) => n.chave));
  const comecadas = rascunhosAbertos();

  return notas.map((nota) => {
    const doPlugin = noPlugin.get(nota.chave);
    // ja gravada: a conferencia que sobrou guardada nao serve mais
    if (doPlugin && comecadas.has(nota.chave)) apagarRascunho(nota.chave);
    return {
      ...nota,
      temXml: nota.temXml && fs.existsSync(arquivoDoXml(nota.chave)),
      lancadaNoPlugin: doPlugin ? { quando: doPlugin.quando, operador: doPlugin.operador } : null,
      lancadaNoSolus: noSolus.has(nota.chave) ? { quando: noSolus.get(nota.chave) } : null,
      emConferencia: !doPlugin ? comecadas.get(nota.chave) || null : null,
    };
  });
}

/** Situacao para a tela: certificado, ultima busca, quando libera a proxima. */
export async function situacaoDaSefaz() {
  const estado = lerEstado();
  let certificado = null;
  let motivo = '';
  try {
    ({ certificado, motivo } = await prepararCertificado());
  } catch (erro) {
    motivo = erro.message;
  }
  return {
    certificado: certificado ? { nome: certificado.nome, cnpj: certificado.cnpj, validoAte: certificado.validoAte } : null,
    motivo,
    ultimaConsulta: estado.ultimaConsulta || null,
    proximaPermitida: estado.proximaPermitida || null,
    ultimoErro: estado.ultimoErro || '',
  };
}

// ---------------------------------------------------------------------------
// Baixar o XML de uma nota (ciencia + consulta pela chave)
// ---------------------------------------------------------------------------

export function xmlDaNota(chave) {
  return naFila(() => baixarXml(chave));
}

async function baixarXml(chave) {
  const ch = digitos(chave);
  const estado = lerEstado();
  const nota = estado.notas[ch];
  if (!nota) throw new Error('Essa nota nao esta na lista da Sefaz. Atualize a lista e tente de novo.');
  if (nota.situacao === 'cancelada') throw new Error('Essa nota foi CANCELADA pelo fornecedor na Sefaz. Nao da para lancar.');
  if (nota.situacao === 'denegada') throw new Error('Essa nota foi DENEGADA pela Sefaz (nao vale). Nao da para lancar.');

  const arquivo = arquivoDoXml(ch);
  if (fs.existsSync(arquivo)) return { xml: fs.readFileSync(arquivo, 'utf8'), nota };

  const { loja, certificado, motivo } = await prepararCertificado();
  if (!certificado) throw new Error(motivo);

  // 1) a ciencia libera o XML inteiro (uma vez por nota)
  if (!nota.ciencia) {
    const ciencia = await servicos.enviarCiencia({ certificado, cnpj: loja.cnpj, chave: ch });
    if (!ciencia.ok) throw new Error(`A Sefaz nao registrou a ciencia: ${ciencia.cStat} - ${ciencia.motivo}`);
    nota.ciencia = true;
    nota.cienciaEm = agora();
    salvarEstado(estado);
  }

  // 2) pede o XML pela chave (logo depois da ciencia ele pode demorar um pouco)
  let ultima = null;
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    if (tentativa) await esperar(4000);
    ultima = await servicos.consultarDistribuicao({ certificado, cnpj: loja.cnpj, uf: loja.uf, chave: ch });
    if (ultima.cStat === '656') break;
    for (const documento of ultima.documentos) guardar(estado, documento);
    if (fs.existsSync(arquivo)) {
      salvarEstado(estado);
      return { xml: fs.readFileSync(arquivo, 'utf8'), nota: estado.notas[ch] };
    }
  }
  salvarEstado(estado);
  if (ultima?.cStat === '656') {
    throw new Error('A Sefaz pediu para esperar um pouco antes de baixar de novo (muitas consultas seguidas). Tente daqui a 1 hora.');
  }
  throw new Error('A ciencia foi registrada, mas a Sefaz ainda esta liberando o XML. Tente de novo em alguns minutos.');
}
