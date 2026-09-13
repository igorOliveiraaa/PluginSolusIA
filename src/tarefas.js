// A lista de tarefas pendentes.
//
// A ideia: o Plugin monta o orcamento, mas quem finaliza a venda e gera a nota e o
// Solus. Entao o Plugin fica de olho no banco e mostra o que falta fazer, e some da
// lista sozinho quando a coisa foi feita la.
//
// O caminho de um orcamento:
//   1. gravado aqui            -> "enviar ao cliente" + "finalizar no Solus"
//   2. finalizado no Solus     -> "gerar a nota no Solus"
//   3. nota autorizada         -> "enviar a nota ao cliente"  (com o PDF pronto)
//   4. enviada                 -> sai da lista
//
// O que o Plugin acompanha fica em dados/acompanhamento.json. O resto (venda para
// empresa sem nota, por exemplo) e lido direto do banco na hora.

import fs from 'node:fs';
import path from 'node:path';
import { PASTAS, garantirPastas } from './config.js';
import {
  situacaoDosPedidos, vendasParaEmpresaSemNota, orcamentosEmAberto,
} from './db/vendas.js';

const ARQUIVO = path.join(PASTAS.dados, 'acompanhamento.json');
const DIAS_QUE_ACOMPANHA = 60;

// ---------------------------------------------------------------------------
// o que o Plugin esta acompanhando
// ---------------------------------------------------------------------------

function ler() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return Array.isArray(dados.orcamentos) ? dados : { orcamentos: [], dispensadas: {} };
  } catch {
    return { orcamentos: [], dispensadas: {} };
  }
}

function gravar(dados) {
  garantirPastas();
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), 'utf8');
}

/** Passa a acompanhar um orcamento que acabou de ser gravado. */
export function acompanharOrcamento({ numero, cliente, codigoCliente, celular, total, operador, validadeDias = 7 }) {
  const dados = ler();
  const jaTem = dados.orcamentos.find((o) => o.numero === Number(numero));
  if (jaTem) return jaTem;

  const novo = {
    numero: Number(numero),
    cliente: String(cliente || 'CONSUMIDOR'),
    codigoCliente: String(codigoCliente || ''),
    celular: String(celular || ''),
    total: Number(total) || 0,
    operador: String(operador || ''),
    criadoEm: new Date().toISOString(),
    validadeDias: Number(validadeDias) || 7,
    orcamentoEnviado: false,
    notaEnviada: false,
    arquivado: false,
  };

  dados.orcamentos.unshift(novo);
  gravar(dados);
  return novo;
}

/** Marca "ja enviei o orcamento" ou "ja enviei a nota". */
export function marcarEnvio(numero, oQue) {
  const dados = ler();
  const item = dados.orcamentos.find((o) => o.numero === Number(numero));
  if (!item) return null;

  if (oQue === 'orcamento') item.orcamentoEnviado = true;
  if (oQue === 'nota') item.notaEnviada = true;
  gravar(dados);
  return item;
}

/** Tira da lista (a pessoa decidiu que aquilo nao precisa mais). */
export function dispensarTarefa(id) {
  const dados = ler();
  dados.dispensadas = dados.dispensadas || {};
  dados.dispensadas[String(id)] = new Date().toISOString();
  gravar(dados);
  return true;
}

function estaDispensada(dados, id) {
  const quando = dados.dispensadas?.[String(id)];
  if (!quando) return false;
  // uma tarefa dispensada volta a aparecer depois de 30 dias, para nada sumir de vez
  return Date.now() - new Date(quando).getTime() < 30 * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// montagem da lista
// ---------------------------------------------------------------------------

const diasDesde = (data) => (Date.now() - new Date(data).getTime()) / (24 * 60 * 60 * 1000);

function tarefa(t) {
  return { prioridade: 'media', ...t };
}

/**
 * Monta a lista de tarefas.
 * `permissoes` decide o que aparece (quem nao mexe em cadastro nao ve tarefa disso).
 */
export async function listarTarefas() {
  const dados = ler();
  const tarefas = [];

  // ---- 1. o que o Plugin criou e esta em andamento ------------------------
  const acompanhados = dados.orcamentos
    .filter((o) => !o.arquivado && diasDesde(o.criadoEm) <= DIAS_QUE_ACOMPANHA);

  const situacoes = acompanhados.length
    ? await situacaoDosPedidos(acompanhados.map((o) => o.numero))
    : {};

  let mudou = false;

  for (const item of acompanhados) {
    const pedido = situacoes[item.numero];

    // sumiu do Solus (apagado por la): para de acompanhar
    if (!pedido) {
      item.arquivado = true;
      mudou = true;
      continue;
    }

    const idade = diasDesde(item.criadoEm);

    if (pedido.status === 'CANCELADO') {
      item.arquivado = true;
      mudou = true;
      continue;
    }

    // ---- ainda e orcamento ----
    if (pedido.status === 'ORCAMENTO') {
      if (!item.orcamentoEnviado) {
        tarefas.push(tarefa({
          id: `enviar-orcamento-${item.numero}`,
          tipo: 'enviar-orcamento',
          titulo: `Enviar o orçamento nº ${item.numero} para ${item.cliente}`,
          detalhe: `R$ ${item.total.toFixed(2).replace('.', ',')} · feito ${quandoTexto(item.criadoEm)}`,
          numero: item.numero,
          prioridade: 'alta',
          acao: 'enviar-orcamento',
        }));
      }

      const vencido = idade > item.validadeDias;
      tarefas.push(tarefa({
        id: `finalizar-${item.numero}`,
        tipo: 'finalizar',
        titulo: vencido
          ? `Orçamento nº ${item.numero} venceu — confirmar com ${item.cliente}`
          : `Finalizar a venda do orçamento nº ${item.numero} no Solus`,
        detalhe: vencido
          ? `Feito há ${Math.floor(idade)} dias e a validade era de ${item.validadeDias}. O cliente ainda quer?`
          : `${item.cliente} · R$ ${item.total.toFixed(2).replace('.', ',')} · ${pedido.formaDePagamento || 'sem forma de pagamento'}`,
        numero: item.numero,
        prioridade: vencido ? 'alta' : 'media',
        acao: 'abrir-no-solus',
      }));
      continue;
    }

    // ---- virou venda ----
    if (pedido.status === 'FATURADO') {
      if (!pedido.numeroNota) {
        tarefas.push(tarefa({
          id: `gerar-nota-${item.numero}`,
          tipo: 'gerar-nota',
          titulo: `Gerar a nota da venda nº ${item.numero} no Solus`,
          detalhe: `${item.cliente} · R$ ${pedido.total.toFixed(2).replace('.', ',')} · vendida ${quandoTexto(pedido.dataVenda || pedido.emissao)}`,
          numero: item.numero,
          prioridade: diasDesde(pedido.dataVenda || pedido.emissao) > 1 ? 'alta' : 'media',
          acao: 'abrir-no-solus',
        }));
        continue;
      }

      const nota = pedido.nota;

      if (nota.etapa === 'rejeitada' || nota.etapa === 'denegada') {
        tarefas.push(tarefa({
          id: `nota-rejeitada-${pedido.numeroNota}`,
          tipo: 'nota-rejeitada',
          titulo: `A nota nº ${pedido.numeroNota} foi rejeitada pela Sefaz`,
          detalhe: nota.situacao || 'Veja o motivo no Solus e emita de novo.',
          numero: item.numero,
          numeroNota: pedido.numeroNota,
          prioridade: 'alta',
          acao: 'abrir-no-solus',
        }));
        continue;
      }

      if (nota.etapa === 'aguardando') {
        tarefas.push(tarefa({
          id: `nota-aguardando-${pedido.numeroNota}`,
          tipo: 'nota-aguardando',
          titulo: `Nota nº ${pedido.numeroNota} esperando resposta da Sefaz`,
          detalhe: nota.situacao || 'Enviada, ainda sem autorização.',
          numero: item.numero,
          numeroNota: pedido.numeroNota,
          prioridade: 'baixa',
          acao: 'nenhuma',
        }));
        continue;
      }

      if (nota.etapa === 'cancelada') {
        tarefas.push(tarefa({
          id: `nota-cancelada-${pedido.numeroNota}`,
          tipo: 'nota-cancelada',
          titulo: `A nota nº ${pedido.numeroNota} de ${item.cliente} foi cancelada`,
          detalhe: 'Se a venda continua valendo, precisa emitir outra nota.',
          numero: item.numero,
          numeroNota: pedido.numeroNota,
          prioridade: 'media',
          acao: 'dispensar',
        }));
        continue;
      }

      if (nota.etapa === 'autorizada') {
        if (!item.notaEnviada) {
          tarefas.push(tarefa({
            id: `enviar-nota-${pedido.numeroNota}`,
            tipo: 'enviar-nota',
            titulo: `Nota nº ${pedido.numeroNota} autorizada — enviar para ${item.cliente}`,
            detalhe: `R$ ${pedido.total.toFixed(2).replace('.', ',')} · autorizada ${quandoTexto(nota.emissao)}`,
            numero: item.numero,
            numeroNota: pedido.numeroNota,
            prioridade: 'alta',
            acao: 'enviar-nota',
            novidade: true,
          }));
        } else {
          // tudo feito: para de acompanhar
          item.arquivado = true;
          mudou = true;
        }
      }
    }
  }

  if (mudou) gravar(dados);

  // ---- 2. o que vem do banco, independente do Plugin ---------------------
  try {
    const semNota = await vendasParaEmpresaSemNota({ dias: 3, quantos: 8 });
    for (const venda of semNota) {
      // se ja apareceu como tarefa do Plugin, nao repete
      if (tarefas.some((t) => t.numero === venda.numero)) continue;
      tarefas.push(tarefa({
        id: `venda-empresa-sem-nota-${venda.numero}`,
        tipo: 'gerar-nota',
        titulo: `Venda nº ${venda.numero} para empresa saiu sem nota`,
        detalhe: `${venda.cliente} · ${venda.documento} · R$ ${venda.total.toFixed(2).replace('.', ',')} · ${quandoTexto(venda.quando)}`,
        numero: venda.numero,
        prioridade: 'media',
        acao: 'abrir-no-solus',
      }));
    }
  } catch { /* se o banco nao responder, a lista do Plugin ainda aparece */ }

  // ---- 3. resumo dos orcamentos em aberto do Solus ------------------------
  try {
    const abertos = await orcamentosEmAberto({ dias: 15 });
    if (abertos.quantidade > 0) {
      tarefas.push(tarefa({
        id: 'resumo-orcamentos',
        tipo: 'resumo',
        titulo: `${abertos.quantidade} orçamentos em aberto no Solus`,
        detalhe: `Somam R$ ${abertos.total.toFixed(2).replace('.', ',')} nos últimos ${abertos.dias} dias.`,
        prioridade: 'baixa',
        acao: 'nenhuma',
      }));
    }
  } catch { /* idem */ }

  const visiveis = tarefas.filter((t) => !estaDispensada(dados, t.id));
  const ordem = { alta: 0, media: 1, baixa: 2 };
  visiveis.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade]);

  return {
    tarefas: visiveis,
    quantidade: visiveis.length,
    urgentes: visiveis.filter((t) => t.prioridade === 'alta').length,
  };
}

/** "hoje", "ontem", "há 3 dias" - fica mais facil de ler que a data seca. */
function quandoTexto(data) {
  if (!data) return '';
  const dias = Math.floor(diasDesde(data));
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(data).toLocaleDateString('pt-BR');
}

/** O que o Plugin esta acompanhando (para a tela do orcamento mostrar o andamento). */
export function acompanhamentoDoOrcamento(numero) {
  return ler().orcamentos.find((o) => o.numero === Number(numero)) || null;
}
