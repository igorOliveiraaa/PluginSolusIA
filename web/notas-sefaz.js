/* Notas que chegaram para a loja pela Sefaz (aba Nota).
   A lista vem sozinha (o Plugin consulta a Sefaz de hora em hora com o certificado
   digital da loja). Cada nota diz em que pe esta: falta lancar, em conferencia
   (parou no meio), lancada (no Plugin ou no Solus) ou cancelada. Um clique abre
   a conferencia - ou continua de onde parou. Filtros: numero, fornecedor/CNPJ,
   periodo e situacao. */

import { $, api, escapar, dinheiro, avisar } from './comum.js';

const POR_PAGINA = 15;
let mostrarTodas = false;
let ultimaResposta = null;
const filtro = { texto: '', periodo: 'tudo', de: '', ate: '', situacao: 'todas' };

const dataCurta = (texto) => {
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};
const horaCurta = (texto) => {
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
const quando = (texto) => {
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return '';
  return new Date().toDateString() === d.toDateString() ? `hoje às ${horaCurta(texto)}` : `${dataCurta(texto)} às ${horaCurta(texto)}`;
};
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const digitos = (t) => String(t || '').replace(/\D/g, '');

export async function carregarNotasDaSefaz() {
  const area = $('#notas-sefaz');
  if (!area) return;
  try {
    desenhar(await api('/api/sefaz/notas'));
  } catch (erro) {
    area.innerHTML = `<h2>Notas que chegaram pela Sefaz</h2>
      <div class="item-aviso erro">${escapar(erro.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Em que pe esta cada nota
// ---------------------------------------------------------------------------

function situacaoDe(nota) {
  if (nota.situacao === 'cancelada' || nota.situacao === 'denegada') return 'cancelada';
  if (nota.lancadaNoPlugin || nota.lancadaNoSolus) return 'lancada';
  if (nota.emConferencia) return 'conferencia';
  return 'falta';
}

function etiquetaDe(nota) {
  switch (situacaoDe(nota)) {
    case 'cancelada':
      return `<span class="etiqueta erro">${nota.situacao === 'denegada' ? 'denegada' : 'cancelada pelo fornecedor'}</span>`;
    case 'lancada':
      return nota.lancadaNoPlugin
        ? `<span class="etiqueta ok">lançada no Plugin ${escapar(dataCurta(nota.lancadaNoPlugin.quando))}</span>`
        : '<span class="etiqueta ok">já lançada no Solus</span>';
    case 'conferencia':
      return `<span class="etiqueta info">em conferência — parou ${escapar(quando(nota.emConferencia.atualizadoEm))}${
        nota.emConferencia.operador ? ` (${escapar(nota.emConferencia.operador)})` : ''}</span>`;
    default:
      return '<span class="etiqueta aviso">falta lançar</span>';
  }
}

function botoesDe(nota) {
  const chave = escapar(nota.chave);
  switch (situacaoDe(nota)) {
    case 'cancelada': return '';
    case 'conferencia':
      return `<div class="nota-sefaz-botoes">
        <button class="botao principal" data-continuar-sefaz="${chave}">Continuar de onde parou</button>
        <button class="link-acao" data-recomecar-sefaz="${chave}">recomeçar do zero</button></div>`;
    case 'lancada':
      return `<button class="botao secundario" data-abrir-sefaz="${chave}">Abrir de novo</button>`;
    default:
      return `<button class="botao principal" data-abrir-sefaz="${chave}">Abrir na conferência</button>`;
  }
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function noPeriodo(nota) {
  if (filtro.periodo === 'tudo') return true;
  const emissao = new Date(nota.emissao);
  if (Number.isNaN(emissao.getTime())) return true;
  const hoje = new Date();
  const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = (n) => new Date(inicioDoDia(hoje).getTime() - n * 86400000);
  switch (filtro.periodo) {
    case 'hoje': return emissao >= inicioDoDia(hoje);
    case '7': return emissao >= dias(6);
    case '30': return emissao >= dias(29);
    case 'mes': return emissao >= new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    case 'mespassado':
      return emissao >= new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1) && emissao < new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    case 'datas': {
      const de = filtro.de ? new Date(`${filtro.de}T00:00:00`) : null;
      const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59`) : null;
      return (!de || emissao >= de) && (!ate || emissao <= ate);
    }
    default: return true;
  }
}

function casaComTexto(nota) {
  const procurado = filtro.texto.trim();
  if (!procurado) return true;
  const numeros = digitos(procurado);
  // so numeros: numero da nota, CNPJ do fornecedor ou pedaco da chave
  if (numeros && numeros.length === procurado.replace(/[\s./-]/g, '').length) {
    return String(nota.numero || '').includes(String(Number(numeros)))
      || digitos(nota.emitente?.cnpj).includes(numeros) || String(nota.chave).includes(numeros);
  }
  return semAcento(nota.emitente?.nome).includes(semAcento(procurado));
}

const filtrar = (notas) => notas.filter((n) => noPeriodo(n) && casaComTexto(n));

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

function desenhar(resposta) {
  ultimaResposta = resposta;
  const { situacao } = resposta;
  const area = $('#notas-sefaz');

  if (!situacao.certificado) {
    area.innerHTML = `
      <h2>Notas que chegaram pela Sefaz</h2>
      <div class="item-aviso">${escapar(situacao.motivo || 'Sem certificado digital da loja neste PC.')}</div>
      <p class="ajuda" style="margin:8px 0 0">Com o certificado digital A1 da loja instalado no PC do Plugin,
        as notas dos fornecedores aparecem aqui sozinhas — sem pedir o XML nem tirar foto.</p>`;
    return;
  }

  const bloqueada = situacao.proximaPermitida && Date.parse(situacao.proximaPermitida) > Date.now();
  const venceEm = Math.ceil((Date.parse(situacao.certificado.validoAte) - Date.now()) / 86400000);

  area.innerHTML = `
    <div class="sefaz-topo">
      <h2>Notas que chegaram pela Sefaz</h2>
      <button class="botao secundario" id="btn-sefaz-buscar" ${bloqueada ? 'disabled' : ''}>
        ${bloqueada ? `Próxima busca às ${escapar(horaCurta(situacao.proximaPermitida))}` : 'Buscar agora'}
      </button>
    </div>
    <p class="ajuda" style="margin:0 0 10px">
      ${situacao.ultimaConsulta ? `Última busca ${escapar(quando(situacao.ultimaConsulta))}.` : 'Ainda não buscou.'}
      A Sefaz só deixa buscar de novo depois de 1 hora; o Plugin busca sozinho.
    </p>
    ${situacao.ultimoErro ? `<div class="item-aviso erro">${escapar(situacao.ultimoErro)}</div>` : ''}
    ${venceEm <= 30 ? `<div class="item-aviso">O certificado digital da loja vence em <strong>${venceEm} ${venceEm === 1 ? 'dia' : 'dias'}</strong>
      (${escapar(dataCurta(situacao.certificado.validoAte))}). Renove antes, senão as notas param de chegar — e a emissão de nota também.</div>` : ''}
    ${resposta.notas.length ? `
      <div class="sefaz-filtros">
        <input type="search" id="sefaz-texto" placeholder="Número, fornecedor ou CNPJ" value="${escapar(filtro.texto)}">
        <select id="sefaz-periodo">
          ${[['tudo', 'Todo o período'], ['hoje', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'],
    ['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['datas', 'Escolher as datas']]
    .map(([v, t]) => `<option value="${v}" ${filtro.periodo === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <span id="sefaz-datas" class="${filtro.periodo === 'datas' ? '' : 'escondido'}">
          <input type="date" id="sefaz-de" value="${escapar(filtro.de)}" aria-label="De">
          <input type="date" id="sefaz-ate" value="${escapar(filtro.ate)}" aria-label="Até">
        </span>
      </div>
      <div class="filtros sefaz-situacoes" id="sefaz-situacoes"></div>
      <div id="sefaz-itens"></div>
      <p class="ajuda" style="margin:10px 0 0">Precisa de observação (DIFAL, taxa)? Escreva no campo abaixo
        <strong>antes</strong> de abrir a nota.</p>`
    : `<p class="ajuda">${situacao.ultimaConsulta ? 'Nenhuma nota nova para a loja.' : 'A primeira busca acontece sozinha em alguns minutos.'}</p>`}`;

  $('#btn-sefaz-buscar')?.addEventListener('click', buscarAgora);
  if (!resposta.notas.length) return;

  $('#sefaz-texto').addEventListener('input', (e) => { filtro.texto = e.target.value; desenharItens(); });
  $('#sefaz-periodo').addEventListener('change', (e) => {
    filtro.periodo = e.target.value;
    $('#sefaz-datas').classList.toggle('escondido', filtro.periodo !== 'datas');
    desenharItens();
  });
  $('#sefaz-de').addEventListener('change', (e) => { filtro.de = e.target.value; desenharItens(); });
  $('#sefaz-ate').addEventListener('change', (e) => { filtro.ate = e.target.value; desenharItens(); });
  desenharItens();
}

/** So a lista (e as contagens): digitar no filtro nao redesenha o resto. */
function desenharItens() {
  const filtradas = filtrar(ultimaResposta.notas);
  const conta = (s) => filtradas.filter((n) => situacaoDe(n) === s).length;
  const situacoes = [['todas', 'Todas', filtradas.length], ['falta', 'Faltam lançar', conta('falta')],
    ['conferencia', 'Em conferência', conta('conferencia')], ['lancada', 'Lançadas', conta('lancada')],
    ['cancelada', 'Canceladas', conta('cancelada')]];
  $('#sefaz-situacoes').innerHTML = situacoes
    .filter(([v, , n]) => v === 'todas' || n > 0 || filtro.situacao === v)
    .map(([v, t, n]) => `<button class="filtro${filtro.situacao === v ? ' ativo' : ''}" data-situacao="${v}">${t} (${n})</button>`)
    .join('');
  $('#sefaz-situacoes').querySelectorAll('[data-situacao]').forEach((b) => b.addEventListener('click', () => {
    filtro.situacao = b.dataset.situacao;
    desenharItens();
  }));

  // o que precisa de acao primeiro: em conferencia, falta lancar; depois o resto
  const ordem = { conferencia: 0, falta: 1, lancada: 2, cancelada: 3 };
  const lista = filtradas
    .filter((n) => filtro.situacao === 'todas' || situacaoDe(n) === filtro.situacao)
    .sort((a, b) => ordem[situacaoDe(a)] - ordem[situacaoDe(b)] || String(b.emissao).localeCompare(String(a.emissao)));
  const visiveis = mostrarTodas ? lista : lista.slice(0, POR_PAGINA);

  $('#sefaz-itens').innerHTML = lista.length ? `
    <div class="lista-sefaz">${visiveis.map((nota) => `
      <div class="nota-sefaz ${situacaoDe(nota)}">
        <div class="nota-sefaz-dados">
          <strong>${escapar(nota.emitente?.nome || 'Fornecedor')}</strong>
          <div class="ajuda">Nota ${escapar(nota.numero)}${nota.serie && nota.serie !== '0' ? `/${escapar(nota.serie)}` : ''}
            · ${escapar(dataCurta(nota.emissao))} · ${dinheiro(nota.valor)}
            ${nota.emitente?.cnpj ? ` · ${escapar(nota.emitente.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'))}` : ''}</div>
          <div>${etiquetaDe(nota)}</div>
        </div>
        ${botoesDe(nota)}
      </div>`).join('')}
    </div>
    ${lista.length > POR_PAGINA ? `<button class="link-acao" id="btn-sefaz-todas">
      ${mostrarTodas ? 'Mostrar menos' : `Ver todas (${lista.length})`}</button>` : ''}`
    : '<p class="ajuda">Nenhuma nota com esse filtro.</p>';

  $('#btn-sefaz-todas')?.addEventListener('click', () => { mostrarTodas = !mostrarTodas; desenharItens(); });
  const acharNota = (chave) => ultimaResposta.notas.find((n) => n.chave === chave);
  $('#sefaz-itens').querySelectorAll('[data-abrir-sefaz]').forEach((botao) => {
    botao.addEventListener('click', () => abrir(botao, acharNota(botao.dataset.abrirSefaz)));
  });
  $('#sefaz-itens').querySelectorAll('[data-continuar-sefaz]').forEach((botao) => {
    botao.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('continuar-conferencia', { detail: botao.dataset.continuarSefaz }));
    });
  });
  $('#sefaz-itens').querySelectorAll('[data-recomecar-sefaz]').forEach((botao) => {
    botao.addEventListener('click', () => recomecar(botao, acharNota(botao.dataset.recomecarSefaz)));
  });
}

// ---------------------------------------------------------------------------
// Acoes
// ---------------------------------------------------------------------------

async function buscarAgora() {
  const botao = $('#btn-sefaz-buscar');
  botao.disabled = true;
  botao.textContent = 'Buscando na Sefaz...';
  try {
    const resposta = await api('/api/sefaz/buscar', { method: 'POST' });
    const { busca } = resposta;
    avisar(busca.esperar
      ? `A Sefaz só libera a próxima busca às ${horaCurta(busca.proximaPermitida)}.`
      : busca.novas ? `${busca.novas} ${busca.novas === 1 ? 'nota nova chegou' : 'notas novas chegaram'}.` : 'Nenhuma nota nova.');
    desenhar(resposta);
  } catch (erro) {
    avisar(erro.message, 'erro');
    carregarNotasDaSefaz();
  }
}

async function abrir(botao, nota) {
  if (!nota) return;
  if (situacaoDe(nota) === 'lancada') {
    const onde = nota.lancadaNoPlugin ? 'no Plugin' : 'no Solus';
    if (!confirm(`Essa nota já foi lançada ${onde}. Lançar de novo soma o estoque duas vezes.\n\nAbrir mesmo assim?`)) return;
  }
  const texto = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Baixando da Sefaz...';
  try {
    const { xml, nome } = await api(`/api/sefaz/notas/${nota.chave}/xml`, { method: 'POST' });
    const arquivo = new File([xml], nome, { type: 'text/xml' });
    // a tela da nota (app.js) recebe o arquivo como se a pessoa tivesse escolhido
    document.dispatchEvent(new CustomEvent('abrir-xml-da-sefaz', { detail: arquivo }));
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = texto;
  }
}

async function recomecar(botao, nota) {
  if (!nota) return;
  if (!confirm('Começar a conferência desta nota do zero? O que já tinha sido decidido nela será descartado.')) return;
  try {
    await api(`/api/rascunho/${nota.chave}`, { method: 'DELETE' });
    nota.emConferencia = null;
    await abrir(botao, nota);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

// a lista atualiza sempre que a aba Nota abre
document.addEventListener('abriu-tela', (e) => { if (e.detail === 'enviar') carregarNotasDaSefaz(); });
