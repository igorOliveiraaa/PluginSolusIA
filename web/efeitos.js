/* Os toques de movimento que valem para o Plugin inteiro.
 *
 *  - Onda no clique: todo botao, aba e opcao responde ao dedo com uma onda que
 *    sai do ponto tocado. No balcao, com pressa, e o que confirma "cliquei".
 *  - Troca de tela: a tela que sai some rapido e a nova entra com os cartoes
 *    em cascata (o CSS faz a cascata; aqui so marca a saida).
 *
 * Tudo respeita "reduzir animacoes" do sistema.
 */

const reduzir = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CLICAVEIS = '.botao, .aba, .sugestao, .filtro, .resultado-busca button, .usar-so-nome,'
  + ' .loja-opcao, .botao-nova-conversa, .opcao-produto, .opcao-preco, .botao-sair';

document.addEventListener('pointerdown', (evento) => {
  if (reduzir()) return;
  const alvo = evento.target.closest(CLICAVEIS);
  if (!alvo || alvo.disabled) return;

  const caixa = alvo.getBoundingClientRect();
  const tamanho = Math.max(caixa.width, caixa.height) * 2.2;
  const onda = document.createElement('span');
  onda.className = 'onda';
  onda.style.width = onda.style.height = `${tamanho}px`;
  onda.style.left = `${evento.clientX - caixa.left - tamanho / 2}px`;
  onda.style.top = `${evento.clientY - caixa.top - tamanho / 2}px`;
  alvo.appendChild(onda);
  onda.addEventListener('animationend', () => onda.remove(), { once: true });
  setTimeout(() => onda.remove(), 900);        // garantia, se a animacao nao rodar
});

/**
 * Fecha a janela de escolha com animacao.
 *
 * `classList.add('escondido')` some com ela no susto (display: none nao anima).
 * Aqui ela desce e some em 200ms, e SO ENTAO fica escondida de verdade.
 */
export function fecharModal(modal) {
  if (!modal || modal.classList.contains('escondido')) return;
  if (reduzir()) { modal.classList.add('escondido'); return; }
  modal.classList.add('fechando');
  setTimeout(() => {
    modal.classList.remove('fechando');
    modal.classList.add('escondido');
  }, 200);
}

// fechar clicando fora da janela (alem do X) - vale para todas as telas
document.addEventListener('click', (evento) => {
  const modal = evento.target.closest?.('.modal');
  if (modal && evento.target === modal) fecharModal(modal);
});

// e com a tecla Esc
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return;
  document.querySelectorAll('.modal:not(.escondido)').forEach(fecharModal);
});
