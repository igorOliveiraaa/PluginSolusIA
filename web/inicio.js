/* Ponto de partida: carrega as telas na ordem certa e cuida do login. */

import { $$, mostrarTela } from './comum.js';
import { conferirSessao, mostrarQuemEntrou } from './login.js';
import { aplicarIcones } from './icones.js';
import './orcamento.js';
import './instalar.js';
import './assistente.js';
import { carregarAfazeres } from './afazeres.js';
import { iniciarTelaDeNota } from './app.js';
import { carregarMarca } from './marca.js';
import { acompanharCreditoDaIA } from './aviso-ia.js';
import './efeitos.js';
import { carregarNotasDaSefaz } from './notas-sefaz.js';

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
carregarMarca();            // as cores guardadas entram antes de qualquer coisa aparecer

// se a sessao ainda valer, entra direto; senao a tela de login aparece
conferirSessao().then((entrou) => {
  if (entrou) {
    carregarAfazeres();
    carregarMarca();
    acompanharCreditoDaIA();
    carregarNotasDaSefaz();
  }
});

document.addEventListener('entrou', () => {
  mostrarTela('assistente');
  carregarAfazeres();
  acompanharCreditoDaIA();
  carregarNotasDaSefaz();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem PWA, funciona igual */ });
}
