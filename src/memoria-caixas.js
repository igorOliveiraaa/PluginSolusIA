// O que o Plugin ja aprendeu sobre caixa de cada produto.
//
// Quando uma nota e gravada com "1 CX = 12 unidades" (vindo do XML, da conta ou
// corrigido na tela), isso fica guardado por produto e por unidade da nota.
// Na proxima nota do mesmo produto em caixa, a conversao sai sozinha e certa -
// mesmo que o fornecedor nao escreva "C/12" na descricao.
//
// Fica em dados/ (fora do Git), um arquivo por loja.

import fs from 'node:fs';
import path from 'node:path';
import { pastaDaLoja } from './config.js';

const arquivo = () => path.join(pastaDaLoja(), 'memoria-caixas.json');

function ler() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch {
    return {};
  }
}

const chave = (codigoProduto, unidadeDaNota) =>
  `${String(codigoProduto || '').trim()}|${String(unidadeDaNota || '').trim().toUpperCase()}`;

/** Quantas unidades vieram, da ultima vez, numa "unidadeDaNota" deste produto. */
export function lembrarCaixa(codigoProduto, unidadeDaNota) {
  if (!codigoProduto) return null;
  return ler()[chave(codigoProduto, unidadeDaNota)] || null;
}

/** Guarda o que foi decidido nesta nota (so vale caixa de 2 ou mais). */
export function guardarCaixas(decisoes) {
  const memoria = ler();
  let mudou = false;
  for (const d of decisoes || []) {
    const porCaixa = Math.round(Number(d.porCaixa) || 0);
    if (!d.codigoProduto || !d.unidadeDaNota || porCaixa < 2 || porCaixa > 10000) continue;
    memoria[chave(d.codigoProduto, d.unidadeDaNota)] = {
      porCaixa,
      fornecedor: d.fornecedor || '',
      descricaoNaNota: String(d.descricaoNaNota || '').slice(0, 80),
      quando: new Date().toISOString(),
    };
    mudou = true;
  }
  if (!mudou) return;
  try {
    fs.writeFileSync(arquivo(), JSON.stringify(memoria, null, 1));
  } catch { /* sem permissao de escrita: so nao aprende desta vez */ }
}
