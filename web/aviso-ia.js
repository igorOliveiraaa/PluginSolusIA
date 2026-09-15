/* Faixa "acabou o credito da IA".
 *
 * Conta paga sem saldo nao volta sozinha: alguem precisa colocar credito no
 * site da OpenAI. Sem um aviso claro, a loja passa o dia achando que "a IA
 * esta com defeito". A faixa aparece no alto de todas as telas, diz o que
 * fazer e lembra o que continua funcionando sem IA.
 */

import { $, api, sessao, escapar } from './comum.js';

let verificando = null;

function mostrar(mensagem) {
  const faixa = $('#faixa-credito');
  if (!faixa) return;
  faixa.innerHTML = `
    <div class="faixa-credito-texto">
      <strong>A IA está sem crédito</strong>
      <span>${escapar(mensagem)}</span>
    </div>
    <a class="botao principal" href="https://platform.openai.com/settings/organization/billing/overview"
       target="_blank" rel="noopener">Colocar crédito</a>
    <button class="botao secundario" id="btn-ja-coloquei">Já coloquei</button>`;
  faixa.classList.remove('escondido');
  $('#btn-ja-coloquei').addEventListener('click', () => {
    // o servidor so descobre que voltou na proxima chamada que der certo
    faixa.classList.add('escondido');
  });
}

async function verificar() {
  if (!sessao.token) return;
  try {
    const situacao = await api('/api/ia/situacao');
    if (situacao.creditoAcabou) mostrar(situacao.mensagem);
    else $('#faixa-credito')?.classList.add('escondido');
  } catch { /* sem resposta: nao inventa aviso */ }
}

document.addEventListener('ia-falhou', (evento) => {
  if (/cr[eé]dito/i.test(evento.detail || '')) mostrar(evento.detail);
});

document.addEventListener('entrou', verificar);

export function acompanharCreditoDaIA() {
  verificar();
  clearInterval(verificando);
  verificando = setInterval(verificar, 90000);
}
