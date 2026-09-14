// Orcamentos montados e ainda NAO gravados no Solus.
//
// Ficam aqui, e nao dentro das rotas, porque agora ha dois caminhos que montam
// orcamento: a aba Orcamento (foto/lista) e o assistente da aba Perguntar
// ("monta um orcamento para o Jad de 10 detergente"). Os dois precisam guardar
// no mesmo lugar, senao o que o chat monta a tela de conferencia nao acha.
//
// Some sozinho depois de 2 horas. E guarda de qual loja e: um orcamento montado
// na ECS nunca pode ser gravado no banco da Editora.

import { lojaAtualId } from './loja-atual.js';

const abertos = new Map();
const DUAS_HORAS = 2 * 60 * 60 * 1000;

function limparAntigos() {
  for (const [chave, valor] of abertos) {
    if (Date.now() - valor.criadoEm > DUAS_HORAS) abertos.delete(chave);
  }
}

/** Guarda o orcamento e devolve o codigo para achar de volta. */
export function guardarOrcamento(dados) {
  const id = Math.random().toString(36).slice(2, 10);
  abertos.set(id, { dados, lojaId: lojaAtualId(), criadoEm: Date.now() });
  limparAntigos();
  return id;
}

/** Pega o orcamento guardado. Explode com mensagem clara quando nao da. */
export function pegarOrcamento(id) {
  const guardado = abertos.get(id);
  if (!guardado) throw new Error('Esse orcamento expirou. Monte de novo.');
  if (guardado.lojaId !== lojaAtualId()) throw new Error('Esse orcamento e de outra loja.');
  return guardado.dados;
}

/** Existe e e desta loja? (sem explodir - para quem so quer conferir) */
export function temOrcamento(id) {
  const guardado = abertos.get(id);
  return Boolean(guardado) && guardado.lojaId === lojaAtualId();
}
