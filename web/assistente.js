/* Tela de conversa com o assistente. */

import { $, api, escapar, avisar, sessao } from './comum.js';
import { icone } from './icones.js';
import { abrirOrcamentoMontado } from './orcamento.js';

const conversa = [];       // { papel: 'pessoa' | 'ia', texto }
let pensando = false;
let temExportacao = false;

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

  area.innerHTML = conversa.map((m) => {
    if (m.papel === 'pessoa') {
      return `<div class="fala pessoa"><div class="balao">${escapar(m.texto)}</div></div>`;
    }
    return `
      <div class="fala ia">
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
    + (pensando ? '<div class="fala ia"><div class="balao pensando"><span></span><span></span><span></span></div></div>' : '');

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
  pensando = true;
  temExportacao = false;
  atualizarBotoes();
  desenhar();

  try {
    const resposta = await api('/api/perguntar', {
      method: 'POST',
      body: JSON.stringify({
        pergunta,
        // manda a conversa anterior para ela entender "e no mes passado?"
        historico: conversa.slice(0, -1).slice(-10).map((m) => ({ papel: m.papel, texto: m.texto })),
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
    conversa.push({ papel: 'ia', texto: `Não consegui responder: ${erro.message}` });
  } finally {
    pensando = false;
    atualizarBotoes();
    desenhar();
  }
}

function atualizarBotoes() {
  $('#btn-perguntar').disabled = pensando;
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
  conversa.length = 0;
  temExportacao = false;
  atualizarBotoes();
  desenhar();
});

desenhar();
