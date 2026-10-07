// Conferencia de nota que ficou no meio: continuar de onde parou.
//
// Uma nota grande nao se confere de uma vez (o balcao chama, o fornecedor liga).
// Cada conferencia aberta fica guardada pela CHAVE da nota, com tudo o que ja foi
// decidido na tela (vinculos, precos, "nao entrar", fornecedor). Abrir a mesma nota
// de novo - pela lista da Sefaz ou mandando o XML - oferece continuar dali.
// Grava no Solus: o rascunho some. 30 dias parado: some tambem.
//
// O estoque e o custo da conferencia guardada sao de quando ela foi aberta, mas
// isso nao estraga nada: a gravacao le tudo de novo na hora (gravacao.js).

import fs from 'node:fs';
import path from 'node:path';
import { pastaDaLoja } from './config.js';

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
const digitos = (valor) => String(valor || '').replace(/\D/g, '');
const pasta = () => pastaDaLoja('rascunhos');
const arquivo = (chave) => path.join(pasta(), `${digitos(chave)}.json`);
const temChave = (chave) => digitos(chave).length === 44;

export function lerRascunho(chave) {
  if (!temChave(chave)) return null;
  try {
    const rascunho = JSON.parse(fs.readFileSync(arquivo(chave), 'utf8'));
    if (Date.now() - Date.parse(rascunho.atualizadoEm) > TRINTA_DIAS) {
      apagarRascunho(chave);
      return null;
    }
    return rascunho;
  } catch {
    return null;
  }
}

/** Guarda (ou atualiza) a conferencia em andamento de uma nota. */
export function guardarRascunho({ conferencia, decisoes = null, operador = '' }) {
  const chave = digitos(conferencia?.chave);
  if (!temChave(chave)) return null;          // nota sem chave (foto sem a chave legivel): nao da
  const antes = lerRascunho(chave);
  const rascunho = {
    chave,
    comecadoEm: antes?.comecadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    operador: operador || antes?.operador || '',
    decisoes: decisoes || antes?.decisoes || null,
    conferencia,
  };
  const destino = arquivo(chave);
  fs.writeFileSync(`${destino}.novo`, JSON.stringify(rascunho), 'utf8');
  fs.renameSync(`${destino}.novo`, destino);
  return rascunho;
}

export function apagarRascunho(chave) {
  if (!temChave(chave)) return;
  try { fs.unlinkSync(arquivo(chave)); } catch { /* ja nao existia */ }
}

/** chave -> { comecadoEm, atualizadoEm, operador } das conferencias paradas no meio. */
export function rascunhosAbertos() {
  const abertos = new Map();
  let nomes = [];
  try { nomes = fs.readdirSync(pasta()).filter((n) => /^\d{44}\.json$/.test(n)); } catch { return abertos; }
  for (const nome of nomes) {
    const rascunho = lerRascunho(nome.slice(0, 44));
    if (rascunho) {
      abertos.set(rascunho.chave, {
        comecadoEm: rascunho.comecadoEm, atualizadoEm: rascunho.atualizadoEm, operador: rascunho.operador,
      });
    }
  }
  return abertos;
}
