// Fornecedor da nota -> fornecedor cadastrado no Solus.
//
// A nota traz o CNPJ do fornecedor; o Solus guarda o fornecedor com um CODIGO
// proprio (tabela FORNECEDOR) e o CNPJ escrito com pontuacao ("01.611.823/0001-16").
// Com o codigo em maos da para:
//   - achar o produto pelo codigo que o FORNECEDOR usa (tabela PRODUTOFORNE);
//   - gravar no produto quem foi o ultimo fornecedor (PRODUTO.FORNECEDOR/NOMEFOR);
//   - ensinar o Solus que "o codigo X desse fornecedor e o nosso produto Y".
//
// Antes o Plugin nunca descobria esse codigo, e a busca por codigo do fornecedor
// olhava de TODOS os fornecedores misturados.

import { consultar, campoTexto, lerTexto } from './firebird.js';
import { carregarConfig } from '../config.js';

const TEMPO = 10 * 60 * 1000;
const guardados = new Map();   // loja -> { quando, porCnpj }

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

async function todos() {
  const loja = carregarConfig().lojaId || 'principal';
  const guardado = guardados.get(loja);
  if (guardado && Date.now() - guardado.quando < TEMPO) return guardado.porCnpj;

  const linhas = await consultar(
    `SELECT CODIGO, ${campoTexto('NOME', 50)}, ${campoTexto('FANTASIA', 30)}, CPFCNPJ FROM FORNECEDOR`
  );
  const porCnpj = new Map();
  for (const linha of linhas) {
    const cnpj = digitos(linha.CPFCNPJ);
    if (!cnpj) continue;
    // cadastro repetido do mesmo CNPJ: fica o primeiro (o mais antigo)
    if (porCnpj.has(cnpj)) continue;
    porCnpj.set(cnpj, {
      codigo: String(linha.CODIGO || '').trim(),
      nome: lerTexto(linha.NOME) || lerTexto(linha.FANTASIA),
      cnpj,
    });
  }
  guardados.set(loja, { quando: Date.now(), porCnpj });
  return porCnpj;
}

/** Fornecedor do Solus com esse CNPJ, ou null. */
export async function buscarFornecedorPorCnpj(cnpj) {
  const procurado = digitos(cnpj);
  if (procurado.length < 11) return null;
  try {
    return (await todos()).get(procurado) || null;
  } catch {
    return null;       // banco sem a tabela: segue sem o codigo do fornecedor
  }
}

export function esquecerFornecedores() {
  guardados.clear();
}
