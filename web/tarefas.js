/* O selo (o numerozinho) da aba Tarefas.
   A aba e so dos afazeres que a equipe escreve (afazeres.js). Os avisos automaticos
   que vinham do Solus (orcamento a enviar, nota a gerar, nota rejeitada...) foram
   tirados a pedido da loja em 10/2026 - a parte do servidor (src/tarefas.js e as
   rotas /api/tarefas) ficou parada, sem ninguem chamando. */

/** O afazeres.js informa quantos estao pendentes e quantos sao para hoje/atrasados. */
export function definirContagemDeAfazeres(quantidade, urgentes) {
  const aba = document.querySelector('[data-tela="tarefas"]');
  if (!aba) return;
  let selo = aba.querySelector('.selo');
  if (!quantidade) {
    selo?.remove();
    return;
  }
  if (!selo) {
    selo = document.createElement('span');
    selo.className = 'selo';
    aba.appendChild(selo);
  }
  selo.textContent = quantidade;
  selo.classList.toggle('urgente', urgentes > 0);
}
