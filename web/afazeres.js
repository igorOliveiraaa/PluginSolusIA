/* Afazeres da loja (aba Tarefas): a lista que a equipe escreve.
   Escreve do seu jeito; com a IA ligada ela monta a tarefa (titulo, data, hora,
   urgente) e separa quando sao varias. Da para editar, concluir, desfazer e
   excluir. Na hora marcada aparece o lembrete na tela. */

import { $, api, escapar, avisar, sessao } from './comum.js';
import { definirContagemDeAfazeres } from './tarefas.js';

let tarefas = [];
let comIA = false;
let editando = null;                 // id da tarefa aberta para editar
const lembradas = new Set();         // lembretes ja mostrados nesta sessao

const dois = (n) => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`; };
const somarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${dois(x.getMonth() + 1)}-${dois(x.getDate())}`; };

/** "hoje às 10:00", "amanhã", "sexta, 09/10", "atrasada desde ontem" */
function quandoEscrito(t) {
  if (!t.data) return '';
  const hoje = hojeISO();
  const [a, m, d] = t.data.split('-').map(Number);
  const data = new Date(a, m - 1, d);
  let dia;
  if (t.data === hoje) dia = 'hoje';
  else if (t.data === somarDias(hoje, 1)) dia = 'amanhã';
  else if (t.data === somarDias(hoje, -1)) dia = 'ontem';
  else {
    const semana = data.toLocaleDateString('pt-BR', { weekday: 'long' }).replace('-feira', '');
    dia = `${semana}, ${dois(d)}/${dois(m)}`;
  }
  return t.hora ? `${dia} às ${t.hora}` : dia;
}

const momento = (t) => (t.data ? new Date(`${t.data}T${t.hora || '23:59'}:00`).getTime() : Infinity);
const atrasada = (t) => !t.feita && t.data && (t.data < hojeISO() || (t.data === hojeISO() && t.hora && momento(t) < Date.now()));

// ---------------------------------------------------------------------------

export async function carregarAfazeres() {
  try {
    const resposta = await api('/api/afazeres');
    tarefas = resposta.tarefas || [];
    comIA = Boolean(resposta.comIA);
    desenhar();
    lembrar();
  } catch {
    /* sem conexao agora: fica o que estava */
  }
}

function contar() {
  const pendentes = tarefas.filter((t) => !t.feita);
  const urgentes = pendentes.filter((t) => atrasada(t) || t.data === hojeISO() || t.prioridade === 'alta');
  definirContagemDeAfazeres(pendentes.length, urgentes.length);
}

function desenhar() {
  const area = $('#afazeres');
  if (!area) return;
  contar();
  const pendentes = tarefas.filter((t) => !t.feita);
  const feitas = tarefas.filter((t) => t.feita).sort((a, b) => String(b.feitaEm).localeCompare(String(a.feitaEm)));
  const hoje = hojeISO();
  const ordem = (lista) => [...lista].sort((a, b) => momento(a) - momento(b)
    || (a.prioridade === 'alta' ? -1 : 0) - (b.prioridade === 'alta' ? -1 : 0)
    || String(a.criadaEm).localeCompare(String(b.criadaEm)));
  const grupos = [
    ['Atrasadas', ordem(pendentes.filter(atrasada)), 'atrasada'],
    ['Hoje', ordem(pendentes.filter((t) => t.data === hoje && !atrasada(t))), 'hoje'],
    ['Próximos dias', ordem(pendentes.filter((t) => t.data && t.data > hoje)), ''],
    ['Sem data', ordem(pendentes.filter((t) => !t.data)), ''],
  ].filter(([, lista]) => lista.length);

  area.innerHTML = `
    <h2>Afazeres</h2>
    <p class="ajuda" style="margin:0 0 8px">Escreva do seu jeito. Ex.: <em>ligar pra Aylag amanhã às 10h pedir
      desinfetante e conferir o boleto da Quimiart sexta</em>.</p>
    <textarea id="afazer-texto" rows="2" placeholder="O que precisa ser feito?"></textarea>
    <div class="afazer-enviar">
      <label class="chave-ia">
        <input type="checkbox" id="afazer-ia" ${comIA ? 'checked' : 'disabled'}>
        <span>${comIA ? 'Montar com a IA (entende data, hora e separa as tarefas)' : 'IA não configurada: a tarefa entra como foi escrita'}</span>
      </label>
      <button class="botao principal" id="btn-afazer-adicionar">Adicionar</button>
    </div>
    ${grupos.length ? grupos.map(([titulo, lista, classe]) => `
      <h3 class="afazer-grupo ${classe}">${titulo} <span>(${lista.length})</span></h3>
      <div class="lista-afazeres">${lista.map(itemHtml).join('')}</div>`).join('')
    : '<p class="ajuda afazer-vazio">Nada pendente. Escreva acima o que precisa ser feito.</p>'}
    ${feitas.length ? `
      <details class="afazeres-feitas">
        <summary>Feitas (${feitas.length})</summary>
        <div class="lista-afazeres">${feitas.slice(0, 30).map(itemHtml).join('')}</div>
      </details>` : ''}`;

  ligar();
}

function itemHtml(t) {
  if (editando === t.id) return formularioHtml(t);
  const quando = quandoEscrito(t);
  return `
    <div class="afazer${t.feita ? ' feita' : ''}${atrasada(t) ? ' atrasada' : ''}" data-afazer="${escapar(t.id)}">
      <input type="checkbox" class="afazer-check" data-concluir="${escapar(t.id)}" ${t.feita ? 'checked' : ''}
        aria-label="${t.feita ? 'Desfazer' : 'Concluir'}" title="${t.feita ? 'Marcar como não feita' : 'Concluir'}">
      <div class="afazer-texto">
        <div class="afazer-titulo">${escapar(t.titulo)}
          ${t.prioridade === 'alta' && !t.feita ? '<span class="etiqueta erro">urgente</span>' : ''}</div>
        ${t.detalhe ? `<div class="afazer-detalhe">${escapar(t.detalhe)}</div>` : ''}
        <div class="afazer-meta">
          ${quando ? `<span class="${atrasada(t) ? 'atrasada' : ''}">${escapar(atrasada(t) ? `atrasada · ${quando}` : quando)}</span>` : ''}
          ${t.feita ? `<span>feita${t.feitaPor ? ` por ${escapar(t.feitaPor)}` : ''}</span>`
            : t.criadaPor ? `<span>por ${escapar(t.criadaPor)}</span>` : ''}
        </div>
      </div>
      <div class="afazer-botoes">
        ${t.feita ? '' : `<button class="link-acao" data-editar="${escapar(t.id)}">editar</button>`}
        <button class="link-acao perigo" data-excluir="${escapar(t.id)}">excluir</button>
      </div>
    </div>`;
}

function formularioHtml(t) {
  return `
    <div class="afazer editando" data-afazer="${escapar(t.id)}">
      <div class="afazer-form">
        <label class="campo"><span>O que fazer</span><input id="ed-titulo" value="${escapar(t.titulo)}" maxlength="120"></label>
        <label class="campo"><span>Detalhe <em>(opcional)</em></span><textarea id="ed-detalhe" rows="2">${escapar(t.detalhe || '')}</textarea></label>
        <div class="linha-dupla">
          <label class="campo"><span>Dia</span><input type="date" id="ed-data" value="${escapar(t.data || '')}"></label>
          <label class="campo"><span>Hora</span><input type="time" id="ed-hora" value="${escapar(t.hora || '')}"></label>
        </div>
        <label class="chave-ia"><input type="checkbox" id="ed-urgente" ${t.prioridade === 'alta' ? 'checked' : ''}><span>Urgente</span></label>
        <div class="afazer-enviar">
          <button class="botao secundario" data-cancelar-edicao>Cancelar</button>
          <button class="botao principal" data-salvar="${escapar(t.id)}">Salvar</button>
        </div>
      </div>
    </div>`;
}

function ligar() {
  const area = $('#afazeres');
  $('#btn-afazer-adicionar').addEventListener('click', adicionar);
  $('#afazer-texto').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); adicionar(); }
  });
  area.querySelectorAll('[data-concluir]').forEach((caixa) => {
    caixa.addEventListener('change', () => concluir(caixa.dataset.concluir, caixa.checked));
  });
  area.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => { editando = b.dataset.editar; desenhar(); $('#ed-titulo')?.focus(); }));
  area.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => excluir(b.dataset.excluir)));
  area.querySelector('[data-cancelar-edicao]')?.addEventListener('click', () => { editando = null; desenhar(); });
  area.querySelector('[data-salvar]')?.addEventListener('click', (e) => salvar(e.currentTarget.dataset.salvar));
}

// ---------------------------------------------------------------------------

async function adicionar() {
  const campo = $('#afazer-texto');
  const texto = campo.value.trim();
  if (!texto) { campo.focus(); return; }
  const usarIA = Boolean($('#afazer-ia')?.checked);
  const botao = $('#btn-afazer-adicionar');
  botao.disabled = true;
  botao.textContent = usarIA ? 'A IA está montando...' : 'Adicionando...';
  try {
    const r = await api('/api/afazeres', { method: 'POST', body: JSON.stringify({ texto, usarIA }) });
    tarefas.push(...r.criadas);
    desenhar();
    if (r.aviso) avisar(r.aviso, 'erro');
    else avisar(r.criadas.length > 1 ? `${r.criadas.length} tarefas adicionadas.` : 'Tarefa adicionada.');
    // destaca o que acabou de entrar: e onde a pessoa confere o que a IA entendeu
    for (const t of r.criadas) document.querySelector(`[data-afazer="${CSS.escape(t.id)}"]`)?.classList.add('nova');
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Adicionar';
  }
}

async function concluir(id, feita) {
  try {
    const { tarefa } = await api(`/api/afazeres/${id}/concluir`, { method: 'POST', body: JSON.stringify({ feita }) });
    tarefas = tarefas.map((t) => (t.id === id ? tarefa : t));
    desenhar();
  } catch (erro) {
    avisar(erro.message, 'erro');
    carregarAfazeres();
  }
}

async function salvar(id) {
  const dados = {
    titulo: $('#ed-titulo').value,
    detalhe: $('#ed-detalhe').value,
    data: $('#ed-data').value,
    hora: $('#ed-hora').value,
    prioridade: $('#ed-urgente').checked ? 'alta' : 'normal',
  };
  try {
    const { tarefa } = await api(`/api/afazeres/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
    tarefas = tarefas.map((t) => (t.id === id ? tarefa : t));
    editando = null;
    lembradas.delete(id);             // mudou a hora: o lembrete vale de novo
    desenhar();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

async function excluir(id) {
  const tarefa = tarefas.find((t) => t.id === id);
  if (!confirm(`Excluir "${tarefa?.titulo || 'esta tarefa'}"?`)) return;
  try {
    await api(`/api/afazeres/${id}`, { method: 'DELETE' });
    tarefas = tarefas.filter((t) => t.id !== id);
    desenhar();
  } catch (erro) {
    avisar(erro.message, 'erro');
    carregarAfazeres();
  }
}

/** Chegou a hora marcada: lembrete na tela (uma vez por tarefa nesta sessao). */
function lembrar() {
  for (const t of tarefas) {
    if (t.feita || !t.data || !t.hora || lembradas.has(t.id)) continue;
    if (momento(t) <= Date.now()) {
      lembradas.add(t.id);
      avisar(`Lembrete: ${t.titulo}`);
    }
  }
}

// a lista atualiza ao abrir a aba e a cada minuto (o que os outros da loja
// escreveram aparece; e o lembrete da hora marcada dispara)
document.addEventListener('abriu-tela', (e) => { if (e.detail === 'tarefas') carregarAfazeres(); });
setInterval(() => {
  if (!sessao.token || document.visibilityState !== 'visible') return;
  if (editando || document.activeElement?.id === 'afazer-texto') { lembrar(); return; }   // nao atrapalha quem esta digitando
  carregarAfazeres();
}, 60000);
