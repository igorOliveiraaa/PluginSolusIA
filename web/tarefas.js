/* Aba de Tarefas: o que esta pendente e o que ja se resolveu sozinho. */

import { $, api, escapar, avisar, sessao } from './comum.js';
import { icone } from './icones.js';

let tarefas = [];
let jaVistas = new Set();
let relogio = null;

const ICONE_POR_TIPO = {
  'enviar-orcamento': 'compartilhar',
  finalizar: 'caixa',
  'gerar-nota': 'documento',
  'enviar-nota': 'compartilhar',
  'nota-rejeitada': 'aviso',
  'nota-cancelada': 'aviso',
  'nota-aguardando': 'relogio',
  resumo: 'grafico',
};

export async function carregarTarefas({ avisarNovidade = false } = {}) {
  try {
    const resposta = await api('/api/tarefas');
    const novas = resposta.tarefas || [];

    // avisa quando aparece algo novo e importante (a nota saiu, por exemplo)
    if (avisarNovidade) {
      for (const t of novas) {
        if (t.novidade && !jaVistas.has(t.id)) avisar(t.titulo);
      }
    }
    jaVistas = new Set(novas.map((t) => t.id));

    tarefas = novas;
    atualizarSelo(resposta.quantidade, resposta.urgentes);
    desenhar();
  } catch {
    // sem conexao agora: mantem o que estava na tela
  }
}

function atualizarSelo(quantidade, urgentes) {
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

function desenhar() {
  const area = $('#lista-tarefas');
  if (!area) return;

  if (!tarefas.length) {
    area.innerHTML = `
      <div class="cartao" style="text-align:center">
        <div style="color:var(--sucesso);display:flex;justify-content:center">${icone('certo', 38)}</div>
        <h3 style="margin:10px 0 4px">Tudo em dia</h3>
        <p class="ajuda" style="margin:0">Nenhuma tarefa pendente por aqui.</p>
      </div>`;
    return;
  }

  area.innerHTML = tarefas.map((t) => {
    const acoes = [];

    if (t.acao === 'enviar-orcamento') {
      acoes.push(`<button class="botao principal" data-enviar-orcamento="${t.numero}">${icone('compartilhar', 17)}<span>Enviar ao cliente</span></button>`);
    }
    if (t.acao === 'enviar-nota') {
      acoes.push(`<button class="botao principal" data-enviar-nota="${t.numeroNota}" data-pedido="${t.numero}">${icone('compartilhar', 17)}<span>Enviar a nota</span></button>`);
      acoes.push(`<button class="botao secundario" data-ver-nota="${t.numeroNota}">${icone('pdf', 17)}<span>Ver PDF</span></button>`);
    }
    if (t.numeroNota && t.acao !== 'enviar-nota') {
      acoes.push(`<button class="botao secundario" data-ver-nota="${t.numeroNota}">${icone('pdf', 17)}<span>Ver a nota</span></button>`);
    }
    if (t.acao !== 'nenhuma') {
      acoes.push(`<button class="botao secundario" data-dispensar="${escapar(t.id)}">Já resolvi</button>`);
    }

    return `
      <div class="tarefa ${escapar(t.prioridade)}">
        <div class="tarefa-icone">${icone(ICONE_POR_TIPO[t.tipo] || 'lista', 20)}</div>
        <div class="tarefa-texto">
          <div class="tarefa-titulo">${escapar(t.titulo)}</div>
          <div class="tarefa-detalhe">${escapar(t.detalhe || '')}</div>
          ${t.acao === 'abrir-no-solus'
            ? '<div class="tarefa-dica">Isso se faz no Solus. Assim que for feito, some daqui sozinho.</div>'
            : ''}
          ${acoes.length ? `<div class="tarefa-acoes">${acoes.join('')}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  ligarEventos();
}

function ligarEventos() {
  document.querySelectorAll('[data-dispensar]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      try {
        await api('/api/tarefas/dispensar', {
          method: 'POST',
          body: JSON.stringify({ id: botao.dataset.dispensar }),
        });
        carregarTarefas();
      } catch (erro) { avisar(erro.message, 'erro'); }
    });
  });

  document.querySelectorAll('[data-ver-nota]').forEach((botao) => {
    botao.addEventListener('click', () => abrirNota(botao.dataset.verNota));
  });

  document.querySelectorAll('[data-enviar-nota]').forEach((botao) => {
    botao.addEventListener('click', () => enviarNota(botao.dataset.enviarNota, botao.dataset.pedido));
  });

  document.querySelectorAll('[data-enviar-orcamento]').forEach((botao) => {
    botao.addEventListener('click', () => marcarEnviado(botao.dataset.enviarOrcamento, 'orcamento'));
  });
}

async function pegarPdfDaNota(numeroNota) {
  const resposta = await fetch(`/api/notas/${numeroNota}/pdf`, { headers: { 'x-sessao': sessao.token } });
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || 'Nao consegui abrir a nota.');
  }
  return resposta.blob();
}

async function abrirNota(numeroNota) {
  try {
    const blob = await pegarPdfDaNota(numeroNota);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

async function enviarNota(numeroNota, numeroPedido) {
  try {
    const blob = await pegarPdfDaNota(numeroNota);
    const arquivo = new File([blob], `nota-${numeroNota}.pdf`, { type: 'application/pdf' });
    const { texto } = await api(`/api/notas/${numeroNota}/texto`);

    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], text: texto, title: `Nota ${numeroNota}` });
    } else {
      // no PC: baixa o PDF e abre o WhatsApp com o texto pronto
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nota-${numeroNota}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
      avisar('PDF baixado. Anexe na conversa do WhatsApp que abriu.');
    }

    await marcarEnviado(numeroPedido, 'nota');
  } catch (erro) {
    if (erro.name === 'AbortError') return;
    avisar(erro.message, 'erro');
  }
}

async function marcarEnviado(numero, oQue) {
  try {
    await api('/api/tarefas/enviado', {
      method: 'POST',
      body: JSON.stringify({ numero: Number(numero), oQue }),
    });
    carregarTarefas();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

/** Fica conferindo de tempos em tempos, para a tarefa sumir sozinha quando o Solus resolver. */
export function acompanharDeFundo() {
  clearInterval(relogio);
  relogio = setInterval(() => {
    if (sessao.token && document.visibilityState === 'visible') {
      carregarTarefas({ avisarNovidade: true });
    }
  }, 45000);
}

document.addEventListener('abriu-tela', (evento) => {
  if (evento.detail === 'tarefas') carregarTarefas();
});

$('#btn-atualizar-tarefas')?.addEventListener('click', () => carregarTarefas());
