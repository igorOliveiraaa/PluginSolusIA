/* Como número, dinheiro e texto aparecem na tela.
 *
 * Fica separado de `comum.js` de propósito: aqui não se toca em tela nenhuma,
 * então estas funções também rodam fora do navegador (é o que deixa os testes
 * conferirem o HTML que o Plugin monta, sem precisar abrir o Chrome).
 */

export const dinheiro = (valor) =>
  'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');

export const escapar = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const numeroBR = (valor) =>
  String(Number(valor) || 0).replace('.', ',');

export const dataBR = (data) =>
  data ? new Date(data).toLocaleDateString('pt-BR') : '';
