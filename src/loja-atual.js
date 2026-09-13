// Qual loja esta sendo atendida nesta requisicao.
//
// O PC servidor pode ter mais de um Solus (um por CNPJ), cada um com o seu banco
// e os seus usuarios. Quando alguem entra, escolhe a loja; dali em diante tudo o
// que acontece naquele pedido (consulta, gravacao, historico) usa a loja dele.
//
// O AsyncLocalStorage guarda essa escolha "grudada" na requisicao, entao o resto
// do codigo nao precisa passar a loja de funcao em funcao.

import { AsyncLocalStorage } from 'node:async_hooks';

const contexto = new AsyncLocalStorage();

/** Roda `trabalho` com a loja definida. Tudo que ele chamar enxerga essa loja. */
export function comLoja(lojaId, trabalho) {
  return contexto.run({ lojaId: lojaId ? String(lojaId) : null }, trabalho);
}

/** A loja da requisicao atual (ou null, quando ainda ninguem escolheu). */
export function lojaAtualId() {
  return contexto.getStore()?.lojaId || null;
}
