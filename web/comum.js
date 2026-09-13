/* Coisas usadas por todas as telas: sessao, chamadas ao servidor e atalhos. */

export const $ = (selecao) => document.querySelector(selecao);
export const $$ = (selecao) => [...document.querySelectorAll(selecao)];

export const dinheiro = (valor) =>
  'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');

export const escapar = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const numeroBR = (valor) =>
  String(Number(valor) || 0).replace('.', ',');

export const dataBR = (data) =>
  data ? new Date(data).toLocaleDateString('pt-BR') : '';

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------

const CHAVE_SESSAO = 'solus-sessao';
const CHAVE_OPERADOR = 'solus-operador';

export const sessao = {
  get token() {
    try { return localStorage.getItem(CHAVE_SESSAO) || ''; } catch { return ''; }
  },
  get operador() {
    try { return JSON.parse(localStorage.getItem(CHAVE_OPERADOR) || 'null'); } catch { return null; }
  },
  guardar(token, operador) {
    try {
      localStorage.setItem(CHAVE_SESSAO, token);
      localStorage.setItem(CHAVE_OPERADOR, JSON.stringify(operador));
    } catch { /* navegador sem localStorage: a sessao vale so nesta aba */ }
  },
  limpar() {
    try {
      localStorage.removeItem(CHAVE_SESSAO);
      localStorage.removeItem(CHAVE_OPERADOR);
    } catch { /* nada a limpar */ }
  },
};

/**
 * Chamada ao servidor ja com a sessao.
 * Quando a sessao expira, volta para a tela de login em vez de dar erro estranho.
 */
export async function api(caminho, opcoes = {}) {
  const cabecalhos = { ...(opcoes.headers || {}) };
  if (sessao.token) cabecalhos['x-sessao'] = sessao.token;

  // FormData nao pode levar Content-Type na mao (o navegador monta sozinho)
  const ehFormulario = opcoes.body instanceof FormData;
  if (!ehFormulario && opcoes.body && !cabecalhos['Content-Type']) {
    cabecalhos['Content-Type'] = 'application/json';
  }

  const resposta = await fetch(caminho, { ...opcoes, headers: cabecalhos });

  let dados;
  try {
    dados = await resposta.json();
  } catch {
    throw new Error('O servidor respondeu de um jeito inesperado.');
  }

  if (dados?.precisaLogin || resposta.status === 401) {
    sessao.limpar();
    document.dispatchEvent(new CustomEvent('precisa-login'));
    throw new Error(dados?.erro || 'Sessao expirada. Entre de novo.');
  }
  if (!resposta.ok || dados?.ok === false) {
    throw new Error(dados?.erro || `Erro ${resposta.status}`);
  }
  return dados;
}

// Todas as chamadas para /api/ levam a sessao automaticamente, mesmo as telas
// que usam fetch direto. Assim nenhuma tela esquece de mandar o login.
const fetchOriginal = window.fetch.bind(window);
window.fetch = (recurso, opcoes = {}) => {
  const caminho = typeof recurso === 'string' ? recurso : recurso?.url || '';
  if (caminho.includes('/api/') && sessao.token) {
    const cabecalhos = new Headers(opcoes.headers || {});
    if (!cabecalhos.has('x-sessao')) cabecalhos.set('x-sessao', sessao.token);
    return fetchOriginal(recurso, { ...opcoes, headers: cabecalhos });
  }
  return fetchOriginal(recurso, opcoes);
};

/** Aviso rapido no rodape da tela. */
export function avisar(texto, tipo = 'ok') {
  let caixa = $('#aviso-flutuante');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'aviso-flutuante';
    document.body.appendChild(caixa);
  }
  caixa.className = 'aviso-flutuante ' + tipo;
  caixa.textContent = texto;
  caixa.classList.add('mostrando');
  clearTimeout(caixa.temporizador);
  caixa.temporizador = setTimeout(() => caixa.classList.remove('mostrando'), 4000);
}

/** Troca de tela. */
export function mostrarTela(nome) {
  $$('.tela').forEach((t) => t.classList.remove('ativa'));
  $(`#tela-${nome}`)?.classList.add('ativa');
  $$('.aba').forEach((a) => a.classList.toggle('ativa', a.dataset.tela === nome));
  window.scrollTo(0, 0);
}

/**
 * Anima a entrada dos filhos, mas so na primeira vez que a lista e montada.
 *
 * Sem isso, cada redesenho (mudar uma quantidade, escolher um produto) fazia a
 * lista inteira piscar do transparente para o opaco - de longe parece a tela
 * "apagando". Depois da primeira vez, a troca e instantanea.
 */
export function animarSeForAPrimeiraVez(elemento) {
  if (!elemento || elemento.dataset.jaAnimou === 'sim') return;
  elemento.dataset.jaAnimou = 'sim';
  elemento.classList.add('entrando');
  setTimeout(() => elemento.classList.remove('entrando'), 900);
}

/** Faz a lista animar de novo (usado quando se comeca do zero). */
export function permitirAnimarDeNovo(elemento) {
  if (elemento) delete elemento.dataset.jaAnimou;
}

/** Caixa de busca com espera, para nao consultar a cada tecla digitada. */
export function aoDigitar(elemento, acao, espera = 350) {
  let temporizador;
  elemento.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(acao, espera);
  });
}
