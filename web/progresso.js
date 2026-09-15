/* "Trabalhando nisso": etapas que ganham tique, relogio, barra correndo e dicas.
 *
 * Usado em tudo que demora - ler a nota, montar o orcamento, perguntar no chat.
 * Antes cada tela tinha um circulo girando (que parava de girar com as animacoes
 * do Windows desligadas) num cartao que abria ABAIXO do botao, fora da vista:
 * quem clicava via a tela parada e achava que tinha travado.
 *
 * As etapas andam por TEMPO - o servidor nao manda o progresso - e a ultima
 * nunca "termina" sozinha: fica ativa ate a resposta chegar.
 */

import { escapar } from './comum.js';

/** O HTML do bloco. `classeExtra` deixa o chat usar o formato de balao. */
export function htmlDoProgresso({ titulo = 'Trabalhando nisso', etapas = [], classeExtra = '' }) {
  return `
    <div class="progresso ${classeExtra}" role="status" aria-live="polite">
      <div class="pensando-topo">
        <span class="pensando-orbita" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <strong class="pensando-titulo">${escapar(titulo)}</strong>
          <span class="pensando-tempo">agora mesmo</span>
        </div>
      </div>
      <ol class="pensando-etapas">
        ${etapas.map((etapa, i) => `<li class="${i === 0 ? 'atual' : ''}">${escapar(etapa)}</li>`).join('')}
      </ol>
      <div class="pensando-barra" aria-hidden="true"><span></span></div>
      <p class="pensando-dica"></p>
    </div>`;
}

/**
 * Faz o bloco andar. Devolve a funcao que para (chame no `finally`).
 *  segundosPorEtapa: quanto cada etapa fica antes de passar para a proxima
 *  dicas: frases que aparecem depois de `dicasDepoisDe` segundos
 */
export function animarProgresso(raiz, {
  segundosPorEtapa = 4,
  dicas = [],
  dicasDepoisDe = 10,
  avisoDeDemora = 'Está demorando mais que o normal — continuo tentando.',
  demoraDepoisDe = 45,
} = {}) {
  const bloco = raiz?.classList?.contains('progresso') ? raiz : raiz?.querySelector('.progresso');
  if (!bloco) return () => {};
  const inicio = Date.now();

  const passo = () => {
    if (!bloco.isConnected) return;
    const decorrido = (Date.now() - inicio) / 1000;
    const segundos = Math.floor(decorrido);

    const itens = bloco.querySelectorAll('.pensando-etapas li');
    const atual = Math.min(Math.floor(decorrido / segundosPorEtapa), itens.length - 1);
    itens.forEach((li, i) => {
      li.classList.toggle('feita', i < atual);
      li.classList.toggle('atual', i === atual);
    });

    bloco.querySelector('.pensando-tempo').textContent =
      segundos < 3 ? 'agora mesmo' : `${segundos} segundos`;

    const dica = bloco.querySelector('.pensando-dica');
    let texto = '';
    if (segundos >= demoraDepoisDe) texto = avisoDeDemora;
    else if (segundos >= dicasDepoisDe && dicas.length) {
      texto = dicas[Math.floor((segundos - dicasDepoisDe) / 7) % dicas.length];
    }
    if (texto && dica.textContent !== texto) {
      dica.classList.remove('trocando');
      void dica.offsetWidth;                // reinicia a transicao
      dica.textContent = texto;
      dica.classList.add('trocando');
    }
  };

  passo();
  const relogio = setInterval(passo, 400);
  return () => clearInterval(relogio);
}

/**
 * O jeito comum de usar numa tela: mostra o bloco dentro de `cartao`, rola a
 * tela ate ele e devolve a funcao que esconde e para.
 */
export function mostrarProgressoNoCartao(cartao, opcoes) {
  cartao.innerHTML = htmlDoProgresso(opcoes);
  cartao.classList.remove('escondido');
  // o cartao abre abaixo do formulario: sem rolar, ninguem ve que comecou
  requestAnimationFrame(() => cartao.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  const parar = animarProgresso(cartao, opcoes);
  return () => {
    parar();
    cartao.classList.add('escondido');
  };
}
