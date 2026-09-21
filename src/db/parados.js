// Produtos parados ha mais de 2 anos: marcar " - DESATIVADO" no nome.
//
// Parado = sem venda, sem entrada de nota e sem mudanca de preco ha mais de
// 2 anos (a mesma regra que tira o produto da sugestao do orcamento, ver
// db/catalogo.js). Marcar no NOME e o que a loja pediu: quem olha a lista do
// Solus, a etiqueta ou o orcamento sabe na hora que aquilo nao e mais trabalhado.
//
// O STATUS do produto NAO muda: ele continua vendavel no Solus. Quando chegar
// nota dele, o Plugin tira a marca sozinho ao gravar (ver db/gravacao.js).
//
// Tudo passa pelo historico: da para desfazer pela aba Historico como uma nota.

import { emTransacao, gravarTexto } from './firebird.js';
import { indiceDoCatalogo, invalidarCatalogo, DIAS_PARA_PARADO } from './catalogo.js';
import { estruturaDe } from './produtos.js';
import { MARCA_DESATIVADO_REGEX } from './gravacao.js';

export const MARCA = ' - DESATIVADO';

/** Os produtos ativos que estao parados e ainda nao tem a marca. */
export async function listarParados() {
  const indice = await indiceDoCatalogo();
  const lista = indice.produtos
    .filter((p) => p.parado && !p.cancelado && !MARCA_DESATIVADO_REGEX.test(p.descricao))
    .map((p) => ({
      codigo: p.codigo,
      descricao: p.descricao,
      estoque: p.estoque,
      ultimaAtividade: p.ultimaAtividade || null,
    }))
    .sort((a, b) => (a.ultimaAtividade || 0) - (b.ultimaAtividade || 0));

  return {
    dias: DIAS_PARA_PARADO,
    referencia: indice.referencia,
    total: lista.length,
    comEstoque: lista.filter((p) => p.estoque > 0).length,
    produtos: lista,
  };
}

/** O nome com a marca, sem estourar o tamanho da coluna (o fim do nome encurta). */
export function nomeComMarca(descricao, tamanho = 70) {
  const base = String(descricao || '').replace(MARCA_DESATIVADO_REGEX, '').trim();
  return (base.slice(0, Math.max(0, tamanho - MARCA.length)).trim() + MARCA).slice(0, tamanho);
}

/**
 * Escreve " - DESATIVADO" no nome dos parados.
 * `codigos` (opcional) limita a quais; sem ele, marca todos da lista.
 * Devolve os registros no formato do historico (com o nome de antes para desfazer).
 */
export async function marcarParados(codigos = null) {
  const { produtos } = await listarParados();
  const escolhidos = codigos?.length
    ? produtos.filter((p) => codigos.includes(p.codigo))
    : produtos;
  if (!escolhidos.length) return [];

  const tamanho = (await estruturaDe('PRODUTO')).tamanhos.get('DESCRICAO') || 70;

  const registros = await emTransacao(async (executar) => {
    const feitos = [];
    for (const produto of escolhidos) {
      const novoNome = nomeComMarca(produto.descricao, tamanho);
      await executar('UPDATE PRODUTO SET DESCRICAO = ? WHERE TRIM(CODIGO) = ?',
        [gravarTexto(novoNome), produto.codigo]);
      feitos.push({
        acao: 'desativado',
        codigo: produto.codigo,
        descricao: novoNome,
        motivo: 'parado',
        antes: { DESCRICAO: produto.descricao },    // texto legivel: o desfazer converte
        depois: { estoque: produto.estoque },
      });
    }
    return feitos;
  });

  invalidarCatalogo();
  return registros;
}
