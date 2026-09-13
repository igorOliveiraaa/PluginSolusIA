/* Ponto de partida: carrega as telas na ordem certa e cuida do login. */

import { $, $$, mostrarTela } from './comum.js';
import { conferirSessao, mostrarQuemEntrou } from './login.js';
import './orcamento.js';
import { iniciarTelaDeNota } from './app.js';

// navegacao das abas
$$('.aba').forEach((aba) => {
  aba.addEventListener('click', () => {
    const tela = aba.dataset.tela;
    mostrarTela(tela);
    document.dispatchEvent(new CustomEvent('abriu-tela', { detail: tela }));
  });
});

mostrarQuemEntrou();
iniciarTelaDeNota();

// se a sessao ainda valer, entra direto; senao a tela de login aparece
conferirSessao();

document.addEventListener('entrou', () => {
  mostrarTela('enviar');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem PWA, funciona igual */ });
}
