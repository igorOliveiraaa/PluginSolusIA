// O certificado digital da loja, usado direto do Windows.
//
// Quem fala com a Sefaz e o sefaz.ps1 (PowerShell): ele usa o certificado A1
// INSTALADO no Windows - o mesmo que o navegador oferece no site da Sefaz - sem
// copiar o arquivo e sem guardar senha. Aqui fica a ponte Node -> PowerShell e a
// escolha do certificado certo para cada loja (pelo CNPJ).

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sefaz.ps1');
const digitos = (valor) => String(valor || '').replace(/\D/g, '');

/** Roda uma acao do sefaz.ps1. Entrada e saida vao por arquivo JSON temporario. */
export function rodarPowerShell(acao, dados = {}, tempoMaximo = 120000) {
  const base = path.join(os.tmpdir(), `plugin-sefaz-${crypto.randomUUID()}`);
  const entrada = `${base}-entrada.json`;
  const saida = `${base}-saida.json`;
  fs.writeFileSync(entrada, JSON.stringify(dados), 'utf8');

  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        '-Acao', acao, '-Entrada', entrada, '-Saida', saida],
      { timeout: tempoMaximo, windowsHide: true },
      (erro, _saidaPadrao, saidaDeErro) => {
        try {
          if (!fs.existsSync(saida)) {
            const motivo = erro?.killed ? 'a Sefaz demorou demais para responder' : (String(saidaDeErro || erro?.message || '').trim() || 'sem resposta');
            return reject(new Error(`Nao consegui falar com a Sefaz: ${motivo.slice(0, 300)}`));
          }
          const resposta = JSON.parse(fs.readFileSync(saida, 'utf8').replace(/^﻿/, ''));
          if (!resposta.ok) return reject(new Error(resposta.erro || 'erro sem mensagem'));
          resolve(resposta);
        } catch (falha) {
          reject(falha);
        } finally {
          for (const arquivo of [entrada, saida]) {
            try { fs.unlinkSync(arquivo); } catch { /* ja apagado */ }
          }
        }
      });
  });
}

let lembrados = null;      // { quando, lista } - abrir o PowerShell leva 1 a 2 segundos

/** Certificados de empresa (e-CNPJ) instalados no Windows deste PC. */
export async function listarCertificados({ deNovo = false } = {}) {
  if (!deNovo && lembrados && Date.now() - lembrados.quando < 10 * 60 * 1000) return lembrados.lista;
  const { certificados } = await rodarPowerShell('certificados', {}, 60000);
  const lista = (certificados || []).map((c) => ({
    impressao: c.impressao,
    nome: c.nome,
    cnpj: digitos(c.cnpj),
    validoAte: c.validoAte,
    vencido: new Date(c.validoAte) < new Date(),
    usavel: Boolean(c.usavel),
  }));
  lembrados = { quando: Date.now(), lista };
  return lista;
}

/**
 * O certificado que serve para a loja: mesmo CNPJ ou mesma raiz (os 8 primeiros
 * numeros - o da matriz vale para as filiais), com a chave usavel. Entre varios
 * (renovado), fica o que vence por ultimo. Devolve { certificado, motivo }.
 */
export async function certificadoDaLoja(cnpjDaLoja) {
  const cnpj = digitos(cnpjDaLoja);
  if (cnpj.length !== 14) return { certificado: null, motivo: 'Nao achei o CNPJ da loja no Solus (PARAMETRO).' };

  let lista;
  try {
    lista = await listarCertificados();
  } catch (erro) {
    return { certificado: null, motivo: `Nao consegui ler os certificados do Windows: ${erro.message}` };
  }
  const daLoja = lista
    .filter((c) => c.cnpj.slice(0, 8) === cnpj.slice(0, 8))
    .sort((a, b) => new Date(b.validoAte) - new Date(a.validoAte));
  const bom = daLoja.find((c) => c.usavel && !c.vencido);
  if (bom) return { certificado: bom, motivo: '' };
  if (daLoja.some((c) => c.usavel)) {
    return { certificado: null, motivo: `O certificado da loja venceu em ${new Date(daLoja[0].validoAte).toLocaleDateString('pt-BR')}. Instale o certificado novo neste PC.` };
  }
  if (daLoja.length) {
    return { certificado: null, motivo: 'O certificado da loja esta neste PC, mas sem a chave (instalado so para conferir). Instale de novo pelo arquivo .pfx.' };
  }
  return {
    certificado: null,
    motivo: 'O certificado digital da loja nao esta instalado NESTE PC (o servidor do Plugin). '
      + 'De dois cliques no arquivo .pfx do certificado e siga o assistente do Windows.',
  };
}

export function esquecerCertificados() {
  lembrados = null;
}
