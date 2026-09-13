/* Tela de entrada. Usa o mesmo usuario e senha do Solus da loja escolhida. */

import { $, api, sessao, escapar, avisar } from './comum.js';
import { icone } from './icones.js';

const tela = $('#tela-login');
const telaLojas = $('#tela-lojas');
const CHAVE_LOJA = 'solus-ultima-loja';

let lojas = [];
let lojaEscolhida = null;
let podeConfigurar = false;

export function estaLogado() {
  return Boolean(sessao.token && sessao.operador);
}

export async function abrirLogin() {
  telaLojas.classList.add('escondido');
  tela.classList.remove('escondido');
  document.body.classList.add('travado');
  await carregarLojas();
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
  area.textContent = operador
    ? `${operador.nome}${operador.loja?.nome ? ' · ' + operador.loja.nome : ''}`
    : '';
  area.title = operador?.gerente ? 'Gerente' : 'Operador';
}

// ---------------------------------------------------------------------------
// Lojas no login
// ---------------------------------------------------------------------------

function lembrarLoja(id) {
  try { localStorage.setItem(CHAVE_LOJA, id); } catch { /* sem armazenamento: tudo bem */ }
}

function ultimaLoja() {
  try { return localStorage.getItem(CHAVE_LOJA); } catch { return null; }
}

async function carregarLojas() {
  try {
    const resposta = await fetch('/api/lojas').then((r) => r.json());
    lojas = resposta.lojas || [];
    podeConfigurar = Boolean(resposta.podeConfigurar);
  } catch {
    lojas = [];
  }

  $('#btn-configurar-lojas').classList.toggle('escondido', !podeConfigurar);

  const aviso = $('#aviso-sem-loja');
  if (!lojas.length) {
    aviso.innerHTML = podeConfigurar
      ? 'O Plugin ainda não sabe qual Solus usar. Toque em <strong>Configurar lojas</strong> aqui embaixo.'
      : 'O Plugin ainda não foi configurado. Abra o Plugin <strong>no PC servidor</strong> para escolher o Solus.';
    aviso.classList.remove('escondido');
    $('#escolha-loja').classList.add('escondido');
    return;
  }
  aviso.classList.add('escondido');

  // uma loja so: nem precisa escolher
  const lembrada = lojas.find((l) => l.id === ultimaLoja());
  lojaEscolhida = lembrada?.id || lojas[0].id;

  $('#escolha-loja').classList.toggle('escondido', lojas.length < 2);
  desenharLojasDoLogin();
  carregarOperadores();
}

function desenharLojasDoLogin() {
  $('#lista-lojas-login').innerHTML = lojas.map((l) => `
    <button type="button" class="loja-opcao ${l.id === lojaEscolhida ? 'escolhida' : ''}" data-loja="${escapar(l.id)}">
      <strong>${escapar(l.nome)}</strong>
      ${l.cnpj ? `<span>${escapar(l.cnpj)}</span>` : ''}
    </button>`).join('');

  document.querySelectorAll('[data-loja]').forEach((botao) => {
    botao.addEventListener('click', () => {
      lojaEscolhida = botao.dataset.loja;
      lembrarLoja(lojaEscolhida);
      desenharLojasDoLogin();
      carregarOperadores();
      $('#erro-login').classList.add('escondido');
    });
  });
}

async function carregarOperadores() {
  try {
    const { operadores } = await fetch('/api/operadores?loja=' + encodeURIComponent(lojaEscolhida || ''))
      .then((r) => r.json());
    const unicos = [...new Set(operadores || [])];
    $('#lista-usuarios').innerHTML = unicos.map((nome) => `<option value="${escapar(nome)}">`).join('');
  } catch { /* sem lista, a pessoa digita o nome */ }
}

async function entrar() {
  const usuario = $('#login-usuario').value.trim();
  const senha = $('#login-senha').value;
  const botao = $('#btn-entrar');

  if (!lojas.length) {
    mostrarErro('Primeiro é preciso configurar qual Solus o Plugin usa.');
    return;
  }
  if (!usuario || !senha) {
    mostrarErro('Preencha usuário e senha.');
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Entrando...';
  $('#erro-login').classList.add('escondido');

  try {
    const resposta = await fetch('/api/entrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha, loja: lojaEscolhida }),
    });
    const dados = await resposta.json();
    if (!dados.ok) throw new Error(dados.erro);

    lembrarLoja(lojaEscolhida);
    sessao.guardar(dados.token, dados.operador);
    $('#login-senha').value = '';
    fecharLogin();
    avisar(`Bem-vindo, ${dados.operador.nome}!`);
    document.dispatchEvent(new CustomEvent('entrou'));
  } catch (erro) {
    mostrarErro(erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

function mostrarErro(texto) {
  $('#erro-login').textContent = texto;
  $('#erro-login').classList.remove('escondido');
}

export async function sair() {
  try { await api('/api/sair', { method: 'POST' }); } catch { /* ja estava fora */ }
  sessao.limpar();
  abrirLogin();
}

/** Confere se a sessao guardada ainda vale. */
export async function conferirSessao() {
  if (!sessao.token) { await abrirLogin(); return false; }
  try {
    const { operador } = await api('/api/eu');
    sessao.guardar(sessao.token, operador);
    mostrarQuemEntrou();
    return true;
  } catch {
    await abrirLogin();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Configurar lojas (qual Solus o Plugin usa)
// ---------------------------------------------------------------------------

let encontrados = [];          // o que a busca achou
const marcados = new Map();    // caminho -> { nome, cnpj, caminho, host }

async function abrirConfiguracaoDeLojas() {
  tela.classList.add('escondido');
  telaLojas.classList.remove('escondido');
  document.body.classList.add('travado');
  $('#erro-lojas').classList.add('escondido');
  $('#usuario-procurado').value = $('#login-usuario').value.trim();

  // ja marca o que esta configurado hoje
  marcados.clear();
  try {
    const { lojas: atuais } = await fetch('/api/instalacao/lojas', {
      headers: sessao.token ? { 'x-sessao': sessao.token } : {},
    }).then((r) => r.json());
    for (const l of atuais || []) {
      marcados.set(chaveDoCaminho(l.caminho), { id: l.id, nome: l.nome, cnpj: l.cnpj, caminho: l.caminho, host: l.host });
    }
  } catch { /* primeira configuracao */ }

  desenharInstalacoes();
}

const chaveDoCaminho = (caminho) => String(caminho || '').replace(/\\/g, '/').toLowerCase();

async function procurarSolus() {
  const botao = $('#btn-procurar-solus');
  botao.disabled = true;
  $('#procurando-solus').classList.remove('escondido');
  $('#erro-lojas').classList.add('escondido');

  try {
    const usuario = $('#usuario-procurado').value.trim();
    const resposta = await fetch('/api/instalacao/procurar?usuario=' + encodeURIComponent(usuario), {
      headers: sessao.token ? { 'x-sessao': sessao.token } : {},
    }).then((r) => r.json());
    if (!resposta.ok) throw new Error(resposta.erro);

    encontrados = resposta.instalacoes || [];

    // se so ha um Solus com o usuario digitado, ja deixa ele marcado
    if (usuario && !marcados.size) {
      const comUsuario = encontrados.filter((i) => i.temUsuarioProcurado);
      if (comUsuario.length === 1) marcar(comUsuario[0], true);
    }

    desenharInstalacoes();
    if (!encontrados.length) {
      mostrarErroLojas('Não achei nenhum Solus neste PC. Informe o caminho na mão, logo abaixo.');
    }
  } catch (erro) {
    mostrarErroLojas(erro.message);
  } finally {
    botao.disabled = false;
    $('#procurando-solus').classList.add('escondido');
  }
}

function marcar(instalacao, ligado) {
  const chave = chaveDoCaminho(instalacao.caminho);
  if (ligado) {
    const anterior = marcados.get(chave);
    marcados.set(chave, {
      id: anterior?.id,
      nome: anterior?.nome || instalacao.empresa?.fantasia || instalacao.empresa?.razao || 'Loja',
      cnpj: instalacao.empresa?.cnpj || anterior?.cnpj || '',
      caminho: instalacao.caminho,
      host: instalacao.host || 'localhost',
    });
  } else {
    marcados.delete(chave);
  }
}

function formatarData(valor) {
  return valor ? new Date(valor).toLocaleDateString('pt-BR') : '—';
}

function desenharInstalacoes() {
  const area = $('#lista-instalacoes');

  // o que ja estava configurado mas a busca ainda nao rodou (ou nao achou)
  const listados = [...encontrados];
  for (const [chave, item] of marcados) {
    if (!listados.some((i) => chaveDoCaminho(i.caminho) === chave)) {
      listados.push({ caminho: item.caminho, host: item.host, empresa: { fantasia: item.nome, cnpj: item.cnpj }, jaConfigurado: true });
    }
  }

  area.innerHTML = listados.map((i, indice) => {
    const chave = chaveDoCaminho(i.caminho);
    const marcado = marcados.has(chave);
    const nome = marcados.get(chave)?.nome || i.empresa?.fantasia || i.empresa?.razao || 'Solus';

    const etiquetas = [];
    if (i.temUsuarioProcurado === true) etiquetas.push(`<span class="etiqueta ok">${icone('certo', 12)} tem o usuário ${escapar($('#usuario-procurado').value.trim().toUpperCase())}</span>`);
    if (i.temUsuarioProcurado === false) etiquetas.push('<span class="etiqueta">usuário não existe aqui</span>');
    if (i.pareceCopia) etiquetas.push('<span class="etiqueta aviso">parece cópia ou backup</span>');
    if (i.jaConfigurado) etiquetas.push('<span class="etiqueta info">configurado hoje</span>');

    return `
      <div class="instalacao ${marcado ? 'marcada' : ''}">
        <label class="instalacao-topo">
          <input type="checkbox" data-marcar="${indice}" ${marcado ? 'checked' : ''}>
          <div>
            <strong>${escapar(i.empresa?.fantasia || i.empresa?.razao || 'Banco do Solus')}</strong>
            ${i.empresa?.razao && i.empresa?.fantasia ? `<br><span class="ajuda">${escapar(i.empresa.razao)}</span>` : ''}
            ${i.empresa?.cnpj ? `<br><span class="ajuda">CNPJ ${escapar(i.empresa.cnpj)}</span>` : ''}
          </div>
        </label>
        <div class="instalacao-detalhes">
          ${i.produtos !== undefined ? `<span>${Number(i.produtos).toLocaleString('pt-BR')} produtos</span>` : ''}
          ${i.clientes !== undefined ? `<span>${Number(i.clientes).toLocaleString('pt-BR')} clientes</span>` : ''}
          ${i.ultimoMovimento !== undefined ? `<span>última venda ${formatarData(i.ultimoMovimento)}</span>` : ''}
        </div>
        <div class="instalacao-caminho">${escapar(i.caminho)}${i.pastasDoSolus?.length ? ` · usado pelo Solus em ${escapar(i.pastasDoSolus.join(', '))}` : ''}</div>
        ${etiquetas.length ? `<div class="item-etiquetas">${etiquetas.join('')}</div>` : ''}
        ${marcado ? `
          <label class="campo" style="margin:10px 0 0">
            <span>Nome que aparece no login</span>
            <input type="text" data-nome="${escapar(chave)}" value="${escapar(nome)}">
          </label>` : ''}
      </div>`;
  }).join('');

  area.querySelectorAll('[data-marcar]').forEach((caixa) => {
    caixa.addEventListener('change', () => {
      marcar(listados[Number(caixa.dataset.marcar)], caixa.checked);
      desenharInstalacoes();
    });
  });

  area.querySelectorAll('[data-nome]').forEach((campo) => {
    campo.addEventListener('input', () => {
      const item = marcados.get(campo.dataset.nome);
      if (item) item.nome = campo.value;
    });
  });

  $('#btn-salvar-lojas').disabled = marcados.size === 0;
}

async function testarCaminhoManual() {
  const caminho = $('#caminho-manual').value.trim();
  if (!caminho) return;
  $('#erro-lojas').classList.add('escondido');

  try {
    const resposta = await fetch('/api/instalacao/testar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sessao.token ? { 'x-sessao': sessao.token } : {}) },
      body: JSON.stringify({ caminho, usuario: $('#usuario-procurado').value.trim() }),
    }).then((r) => r.json());
    if (!resposta.ok) throw new Error(resposta.erro);

    const banco = resposta.banco;
    const instalacao = {
      caminho: banco.caminho,
      host: banco.host,
      empresa: banco.empresa,
      produtos: banco.produtos,
      clientes: banco.clientes,
      ultimoMovimento: banco.ultimoMovimento,
      temUsuarioProcurado: banco.temUsuarioProcurado,
      pastasDoSolus: [],
    };
    if (!encontrados.some((i) => chaveDoCaminho(i.caminho) === chaveDoCaminho(instalacao.caminho))) {
      encontrados.unshift(instalacao);
    }
    marcar(instalacao, true);
    desenharInstalacoes();
    avisar('Banco encontrado: ' + (banco.empresa?.fantasia || banco.empresa?.razao || 'Solus'));
  } catch (erro) {
    mostrarErroLojas(erro.message);
  }
}

async function salvarLojas() {
  const botao = $('#btn-salvar-lojas');
  botao.disabled = true;
  botao.textContent = 'Testando e salvando...';
  $('#erro-lojas').classList.add('escondido');

  try {
    const resposta = await fetch('/api/instalacao/lojas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sessao.token ? { 'x-sessao': sessao.token } : {}) },
      body: JSON.stringify({ lojas: [...marcados.values()] }),
    }).then((r) => r.json());
    if (!resposta.ok) throw new Error(resposta.erro);

    avisar(resposta.lojas.length === 1 ? 'Loja configurada.' : `${resposta.lojas.length} lojas configuradas.`);
    // quem estava logado precisa entrar de novo, na loja certa
    sessao.limpar();
    await abrirLogin();
  } catch (erro) {
    mostrarErroLojas(erro.message);
  } finally {
    botao.textContent = 'Salvar e usar essas lojas';
    botao.disabled = marcados.size === 0;
  }
}

function mostrarErroLojas(texto) {
  $('#erro-lojas').textContent = texto;
  $('#erro-lojas').classList.remove('escondido');
}

// ---------------------------------------------------------------------------

$('#btn-entrar').addEventListener('click', entrar);
$('#login-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
$('#login-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-senha').focus(); });
$('#btn-sair')?.addEventListener('click', sair);

$('#btn-configurar-lojas').addEventListener('click', abrirConfiguracaoDeLojas);
$('#btn-procurar-solus').addEventListener('click', procurarSolus);
$('#btn-testar-caminho').addEventListener('click', testarCaminhoManual);
$('#btn-salvar-lojas').addEventListener('click', salvarLojas);
$('#btn-voltar-login').addEventListener('click', () => abrirLogin());

document.addEventListener('precisa-login', () => abrirLogin());

/** Para o gerente abrir a configuracao das lojas pela aba Ajustes. */
export { abrirConfiguracaoDeLojas };
