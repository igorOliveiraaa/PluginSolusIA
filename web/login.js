/* Tela de entrada. Usa o mesmo usuario e senha do Solus. */

import { $, api, sessao, escapar, avisar } from './comum.js';

const tela = $('#tela-login');

export function estaLogado() {
  return Boolean(sessao.token && sessao.operador);
}

export function abrirLogin() {
  tela.classList.remove('escondido');
  document.body.classList.add('travado');
  carregarOperadores();
  setTimeout(() => $('#login-usuario')?.focus(), 100);
}

export function fecharLogin() {
  tela.classList.add('escondido');
  document.body.classList.remove('travado');
  mostrarQuemEntrou();
}

export function mostrarQuemEntrou() {
  const operador = sessao.operador;
  const area = $('#quem-entrou');
  if (!area) return;
  area.textContent = operador ? operador.nome : '';
  area.title = operador?.gerente ? 'Gerente' : 'Operador';
}

async function carregarOperadores() {
  try {
    const { operadores } = await fetch('/api/operadores').then((r) => r.json());
    const lista = $('#lista-usuarios');
    // tira repetidos que existem no cadastro do Solus
    const unicos = [...new Set(operadores)];
    lista.innerHTML = unicos.map((nome) => `<option value="${escapar(nome)}">`).join('');
  } catch { /* sem lista, o usuario digita o nome na mao */ }
}

async function entrar() {
  const usuario = $('#login-usuario').value.trim();
  const senha = $('#login-senha').value;
  const botao = $('#btn-entrar');

  if (!usuario || !senha) {
    $('#erro-login').textContent = 'Preencha usuario e senha.';
    $('#erro-login').classList.remove('escondido');
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Entrando...';
  $('#erro-login').classList.add('escondido');

  try {
    const resposta = await fetch('/api/entrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    const dados = await resposta.json();
    if (!dados.ok) throw new Error(dados.erro);

    sessao.guardar(dados.token, dados.operador);
    $('#login-senha').value = '';
    fecharLogin();
    avisar(`Bem-vindo, ${dados.operador.nome}!`);
    document.dispatchEvent(new CustomEvent('entrou'));
  } catch (erro) {
    $('#erro-login').textContent = erro.message;
    $('#erro-login').classList.remove('escondido');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

export async function sair() {
  try { await api('/api/sair', { method: 'POST' }); } catch { /* ja estava fora */ }
  sessao.limpar();
  abrirLogin();
}

/** Confere se a sessao guardada ainda vale. */
export async function conferirSessao() {
  if (!sessao.token) { abrirLogin(); return false; }
  try {
    const { operador } = await api('/api/eu');
    sessao.guardar(sessao.token, operador);
    mostrarQuemEntrou();
    return true;
  } catch {
    abrirLogin();
    return false;
  }
}

$('#btn-entrar').addEventListener('click', entrar);
$('#login-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
$('#login-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-senha').focus(); });
$('#btn-sair')?.addEventListener('click', sair);

document.addEventListener('precisa-login', () => abrirLogin());
