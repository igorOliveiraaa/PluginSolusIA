/* Ponto de partida: carrega as telas na ordem certa e cuida do login. */

import { $$, mostrarTela } from './comum.js';
import { conferirSessao, mostrarQuemEntrou } from './login.js';
import { aplicarIcones } from './icones.js';
import './orcamento.js';
import './instalar.js';
import './assistente.js';
import { carregarTarefas, acompanharDeFundo } from './tarefas.js';
import { iniciarTelaDeNota } from './app.js';

// navegacao das abas
$$('.aba').forEach((aba) => {
  aba.addEventListener('click', () => {
    const tela = aba.dataset.tela;
    mostrarTela(tela);
    document.dispatchEvent(new CustomEvent('abriu-tela', { detail: tela }));
  });
});

aplicarIcones();
mostrarQuemEntrou();
iniciarTelaDeNota();

// se a sessao ainda valer, entra direto; senao a tela de login aparece
conferirSessao().then((entrou) => {
  if (entrou) {
    carregarTarefas();
    acompanharDeFundo();
  }
});

document.addEventListener('entrou', () => {
  mostrarTela('assistente');
  carregarTarefas();
  acompanharDeFundo();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem PWA, funciona igual */ });
}
