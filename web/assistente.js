/* Tela de conversa com o assistente. */

import { $, api, escapar, avisar, sessao } from './comum.js';
import { icone } from './icones.js';
import { abrirOrcamentoMontado } from './orcamento.js';
import { htmlDoProgresso, animarProgresso } from './progresso.js';

const conversa = [];       // { papel: 'pessoa' | 'ia', texto }
let pensando = false;
let temExportacao = false;
let jaDesenhadas = 0;      // so a fala nova anima; as antigas ficam quietas
let pararProgresso = () => {};   // o que faz a animacao de "pesquisando" andar

/*
 * Enquanto a IA pesquisa (10 a 50 segundos), a tela mostra em que parte ela
 * esta. As etapas andam pelo tempo - o servidor nao manda o progresso -, entao
 * a ultima nunca "termina" sozinha: ela fica ativa ate a resposta chegar.
 * Sem isso, tres pontinhos parados por 30 segundos parecem programa travado.
 */
const ETAPAS = {
  orcamento: ['Lendo os itens do pedido', 'Procurando cada produto no cadastro',
    'Vendo o que esse cliente já pagou', 'Montando o orçamento'],
  lucro: ['Separando as vendas do período', 'Somando o que foi faturado',
    'Comparando com o custo de cada item', 'Fechando a conta'],
  relatorio: ['Entendendo o que entra no relatório', 'Buscando os dados no sistema',
    'Organizando as linhas', 'Preparando o resultado'],
  cliente: ['Procurando o cliente', 'Olhando todos os cadastros com esse nome',
    'Separando as compras', 'Conferindo os preços'],
  estoque: ['Abrindo o estoque', 'Conferindo produto por produto',
    'Separando o que chama atenção', 'Escrevendo a resposta'],
  padrao: ['Entendendo a pergunta', 'Procurando no sistema da loja',
    'Conferindo os números', 'Escrevendo a resposta'],
};

const DICAS_DE_ESPERA = [
  'O sistema da loja tem milhares de pedidos — estou olhando um por um.',
  'Respondo só com número que veio do sistema, nunca de cabeça.',
  'Pergunta com período ("no mês passado") costuma vir mais rápido.',
  'Depois dá pra baixar a resposta como planilha ou PDF.',
];

function etapasDaPergunta(pergunta) {
  const p = String(pergunta).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/orcamento|orcar|cotacao/.test(p)) return ETAPAS.orcamento;
  if (/lucro|faturamento|faturei|faturou|margem/.test(p)) return ETAPAS.lucro;
  if (/relatorio|planilha|listar|lista de/.test(p)) return ETAPAS.relatorio;
  if (/cliente|vendemos|vendi|pagou|comprou/.test(p)) return ETAPAS.cliente;
  if (/estoque|parado|negativo|zerado/.test(p)) return ETAPAS.estoque;
  return ETAPAS.padrao;
}

function animacaoPensando(etapas) {
  return `
    <div class="fala ia nova" id="fala-pensando">
      ${htmlDoProgresso({ titulo: 'Pesquisando no sistema', etapas, classeExtra: 'balao pensando' })}
    </div>`;
}

/** Faz as etapas andarem, o relogio contar e as dicas trocarem. */
function comecarAnimacao() {
  pararAnimacao();
  pararProgresso = animarProgresso($('#fala-pensando'), {
    segundosPorEtapa: 4,
    dicas: DICAS_DE_ESPERA,
    dicasDepoisDe: 12,
    avisoDeDemora: 'Está demorando mais que o normal — continuo tentando.',
  });
}

function pararAnimacao() {
  pararProgresso();
  pararProgresso = () => {};
}

const SUGESTOES = [
  'Quanto tenho de saco de lixo 100 litros?',
  'Para quem vendemos detergente Ypê pela última vez?',
  'Quais produtos estão com estoque negativo?',
  'O que mais vendeu nos últimos 30 dias?',
  'Quanto um cliente pagou no último pedido dele?',
  'Quais produtos estão parados há mais de 6 meses?',
  'Como mudou o preço do sabão em pedra?',
  'Quais meus melhores clientes do ano?',
  'Monta um orçamento de 10 detergente ypê 500ml e 2 água sanitária 5L',
  'Qual foi meu lucro no mês passado?',
];

/** Markdown simples: negrito, lista, tabela e quebra de linha. */
function formatar(texto) {
  const seguro = escapar(texto);
  const linhas = seguro.split('\n');
  const saida = [];
  let tabela = null;
  let lista = null;

  const fecharTabela = () => {
    if (!tabela) return;
    const [cabecalho, ...corpo] = tabela;
    saida.push(
      '<div class="tabela-rolagem"><table><thead><tr>'
      + cabecalho.map((c) => `<th>${negrito(c)}</th>`).join('')
      + '</tr></thead><tbody>'
      + corpo.map((linha) => '<tr>' + linha.map((c) => `<td>${negrito(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>'
    );
    tabela = null;
  };

  const fecharLista = () => {
    if (!lista) return;
    saida.push('<ul>' + lista.map((i) => `<li>${negrito(i)}</li>`).join('') + '</ul>');
    lista = null;
  };

  for (const linha of linhas) {
    const limpa = linha.trim();

    // linha de tabela markdown
    if (limpa.startsWith('|') && limpa.endsWith('|')) {
      fecharLista();
      const celulas = limpa.slice(1, -1).split('|').map((c) => c.trim());
      // a linha de tracinhos que separa o cabecalho nao entra
      if (celulas.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      tabela = tabela || [];
      tabela.push(celulas);
      continue;
    }
    fecharTabela();

    if (/^[-*•]\s+/.test(limpa)) {
      lista = lista || [];
      lista.push(limpa.replace(/^[-*•]\s+/, ''));
      continue;
    }
    fecharLista();

    if (!limpa) continue;
    saida.push(`<p>${negrito(limpa)}</p>`);
  }

  fecharTabela();
  fecharLista();
  return saida.join('');
}

function negrito(texto) {
  return texto
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function desenhar() {
  const area = $('#conversa');

  if (!conversa.length) {
    area.innerHTML = `
      <div class="boas-vindas">
        <div class="boas-vindas-icone">${icone('conversa', 44)}</div>
        <h3>Pergunte qualquer coisa sobre a loja</h3>
        <p class="ajuda">
          Eu olho no sistema e respondo com os números de verdade.
          Depois dá pra baixar como planilha ou PDF.
        </p>
        <div class="sugestoes">
          ${SUGESTOES.map((s) => `<button class="sugestao" data-pergunta="${escapar(s)}">${escapar(s)}</button>`).join('')}
        </div>
      </div>`;

    area.querySelectorAll('[data-pergunta]').forEach((botao) => {
      botao.addEventListener('click', () => {
        $('#pergunta').value = botao.dataset.pergunta;
        enviar();
      });
    });
    return;
  }

  area.innerHTML = conversa.map((m, indice) => {
    // antes TODA a conversa refazia a entrada a cada pergunta: os baloes
    // sumiam e voltavam juntos, e parecia que a tela tinha bugado
    const nova = indice >= jaDesenhadas ? ' nova' : '';
    if (m.papel === 'pessoa') {
      return `<div class="fala pessoa${nova}"><div class="balao">${escapar(m.texto)}</div></div>`;
    }
    return `
      <div class="fala ia${nova}">
        <div class="balao">
          ${formatar(m.texto)}
          ${m.orcamento ? cartaoDoOrcamento(m.orcamento) : ''}
          ${m.consultou?.length
            ? `<details class="de-onde">
                 <summary>de onde veio esse número</summary>
                 <ul>${m.consultou.map((c) => `<li>${escapar(nomeAmigavel(c.ferramenta))}</li>`).join('')}</ul>
               </details>`
            : ''}
        </div>
      </div>`;
  }).join('')
    + (pensando ? animacaoPensando(pensando.etapas) : '');
  jaDesenhadas = conversa.length;

  area.querySelectorAll('[data-abrir-orcamento]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      botao.disabled = true;
      try {
        await abrirOrcamentoMontado(botao.dataset.abrirOrcamento);
      } catch (erro) {
        avisar(erro.message, 'erro');
        botao.disabled = false;
      }
    });
  });

  area.scrollTop = area.scrollHeight;
}

/**
 * O convite para conferir o orçamento que ela montou.
 * De propósito NÃO tem botão de gravar aqui: conferir preço item a item é na
 * tela de orçamento, com o produto, o estoque e o que o cliente pagou na frente.
 */
function cartaoDoOrcamento(orcamento) {
  const total = 'R$ ' + (Number(orcamento.total) || 0).toFixed(2).replace('.', ',');
  return `
    <div class="orcamento-do-chat">
      <div>
        <strong>Orçamento montado para ${escapar(orcamento.cliente || 'CONSUMIDOR')}</strong>
        <span class="ajuda" style="display:block;margin:2px 0 0">
          ${orcamento.quantidadeItens} ${orcamento.quantidadeItens === 1 ? 'item' : 'itens'} · ${total}
          ${orcamento.itensParaEscolher
            ? ` · <strong>${orcamento.itensParaEscolher} ${orcamento.itensParaEscolher === 1 ? 'espera' : 'esperam'} você escolher</strong>`
            : ''}
          <br>Nada foi gravado no Solus ainda.
        </span>
      </div>
      <button class="botao principal" data-abrir-orcamento="${escapar(orcamento.id)}">
        Abrir e conferir
      </button>
    </div>`;
}

function nomeAmigavel(ferramenta) {
  const nomes = {
    procurar_produto: 'busca de produto no cadastro',
    ultimas_vendas_do_produto: 'últimas vendas do produto',
    ultimas_compras_do_produto: 'últimas compras do fornecedor',
    historico_de_preco: 'histórico de alteração de preço',
    ultima_venda_para_cliente: 'venda desse produto para esse cliente',
    compras_do_cliente: 'compras do cliente',
    desde_quando_tem_o_produto: 'primeira compra e primeira venda',
    produtos_com_estoque_ruim: 'produtos zerados ou negativos',
    mais_vendidos: 'mais vendidos do período',
    melhores_clientes: 'clientes que mais compraram',
    produtos_parados: 'produtos parados no estoque',
    produtos_repetidos: 'produtos cadastrados repetidos',
    resumo_da_loja: 'números gerais da loja',
    lucro_do_periodo: 'faturamento e custo das vendas do período',
    consulta_livre: 'consulta montada na hora no sistema',
    montar_orcamento: 'montagem do orçamento com os preços do sistema',
  };
  return nomes[ferramenta] || ferramenta;
}

async function enviar() {
  const campo = $('#pergunta');
  const pergunta = campo.value.trim();
  if (!pergunta || pensando) return;

  conversa.push({ papel: 'pessoa', texto: pergunta });
  campo.value = '';
  campo.style.height = 'auto';
  pensando = { etapas: etapasDaPergunta(pergunta) };
  temExportacao = false;
  atualizarBotoes();
  desenhar();
  comecarAnimacao();

  try {
    const resposta = await api('/api/perguntar', {
      method: 'POST',
      body: JSON.stringify({
        pergunta,
        // a conversa INTEIRA vai junto (ate "Nova conversa"): e o que faz
        // "e no mes passado?" e "e o preco dela?" funcionarem. Mensagem de erro
        // nao entra - so confundiria a IA.
        historico: conversa.slice(0, -1)
          .filter((m) => !m.erro)
          .map((m) => ({ papel: m.papel, texto: m.texto })),
      }),
    });

    conversa.push({
      papel: 'ia',
      texto: resposta.resposta,
      consultou: resposta.consultou,
      orcamento: resposta.orcamentoMontado || null,
    });
    temExportacao = resposta.podeExportar;
    if (temExportacao) {
      $('#linhas-exportar').textContent = `${resposta.quantidadeLinhas} ${resposta.quantidadeLinhas === 1 ? 'linha' : 'linhas'}`;
    }
  } catch (erro) {
    conversa.push({ papel: 'ia', texto: `Não consegui responder: ${erro.message}`, erro: true });
    document.dispatchEvent(new CustomEvent('ia-falhou', { detail: erro.message }));
  } finally {
    pararAnimacao();
    pensando = false;
    atualizarBotoes();
    desenhar();
    guardarConversa();
  }
}

// ---------------------------------------------------------------------------
// A conversa sobrevive a trocar de aba e a recarregar a pagina
// ---------------------------------------------------------------------------
// Sem isso, ir na aba Orcamento e voltar apagava o contexto. Fica guardada so
// nesta janela do navegador e so para quem entrou (outro usuario nao ve).

const chaveDaConversa = () => `solus-conversa-${sessao.operador?.codigo || 'anonimo'}`;

function guardarConversa() {
  try {
    sessionStorage.setItem(chaveDaConversa(), JSON.stringify(conversa.slice(-60)));
  } catch { /* navegador sem armazenamento: segue so na memoria */ }
}

function recuperarConversa() {
  try {
    const guardada = JSON.parse(sessionStorage.getItem(chaveDaConversa()) || '[]');
    if (Array.isArray(guardada) && guardada.length && !conversa.length) {
      conversa.push(...guardada);
      jaDesenhadas = conversa.length;         // o que ja estava na tela nao anima de novo
      desenhar();
    }
  } catch { /* guardado quebrado: comeca do zero */ }
}

document.addEventListener('abriu-tela', (evento) => {
  if (evento.detail === 'assistente') recuperarConversa();
});
document.addEventListener('entrou', recuperarConversa);

function atualizarBotoes() {
  $('#btn-perguntar').disabled = Boolean(pensando);
  $('#exportacao').classList.toggle('escondido', !temExportacao);
}

async function baixar(formato) {
  try {
    const resposta = await fetch(`/api/exportar/${formato}`, {
      headers: { 'x-sessao': sessao.token },
    });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      throw new Error(erro.erro || 'Nao consegui gerar o arquivo.');
    }

    const blob = await resposta.blob();
    const nome = (resposta.headers.get('Content-Disposition') || '')
      .match(/filename="([^"]+)"/)?.[1] || `resultado.${formato === 'planilha' ? 'csv' : 'pdf'}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    avisar('Arquivo baixado: ' + nome);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

$('#btn-perguntar').addEventListener('click', enviar);

$('#pergunta').addEventListener('keydown', (evento) => {
  // Enter manda, Shift+Enter pula linha
  if (evento.key === 'Enter' && !evento.shiftKey) {
    evento.preventDefault();
    enviar();
  }
});

// o campo cresce conforme a pessoa escreve
$('#pergunta').addEventListener('input', (evento) => {
  evento.target.style.height = 'auto';
  evento.target.style.height = Math.min(evento.target.scrollHeight, 140) + 'px';
});

$('#btn-planilha').addEventListener('click', () => baixar('planilha'));
$('#btn-pdf-resultado').addEventListener('click', () => baixar('pdf'));

$('#btn-limpar-conversa').addEventListener('click', () => {
  if (pensando) return;      // limpar no meio da pesquisa perderia a resposta
  if (conversa.length > 2 && !confirm('Começar uma conversa nova? A IA esquece o que foi falado até aqui.')) return;
  conversa.length = 0;
  jaDesenhadas = 0;
  temExportacao = false;
  guardarConversa();
  atualizarBotoes();
  desenhar();
  $('#pergunta').focus();
});

desenhar();
recuperarConversa();
