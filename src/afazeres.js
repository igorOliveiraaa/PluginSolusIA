// Afazeres da loja: a lista que a equipe escreve (aba Tarefas).
//
// Cada loja tem a sua lista em dados/.../afazeres.json - todo mundo da loja ve a
// mesma. A pessoa escreve do jeito dela ("ligar pra Aylag amanha as 10h pedir
// desinfetante e conferir o boleto da Quimiart sexta") e a IA monta as tarefas:
// titulo curto, detalhe, data, hora e se e urgente - separando quando sao duas.
// Sem IA (ou se ela falhar) a tarefa entra do jeito que foi escrita.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { carregarConfig, pastaDaLoja } from './config.js';
import { chamarGemini, configEconomica, textoDaResposta, MODELO_ECONOMICO } from './leitura/gemini.js';

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
const arquivo = () => path.join(pastaDaLoja(), 'afazeres.json');

function lerTodas() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8')).tarefas || [];
  } catch {
    return [];
  }
}

function salvarTodas(tarefas) {
  // feita ha mais de 30 dias sai da lista (nao precisa ficar para sempre)
  const limite = Date.now() - TRINTA_DIAS;
  const ficam = tarefas.filter((t) => !t.feita || Date.parse(t.feitaEm || t.criadaEm) > limite);
  const destino = arquivo();
  fs.writeFileSync(`${destino}.novo`, JSON.stringify({ tarefas: ficam }, null, 2), 'utf8');
  fs.renameSync(`${destino}.novo`, destino);
}

const dataValida = (texto) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''))) return '';
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return d.getDate() === dia && d.getMonth() === mes - 1 ? texto : '';
};
const horaValida = (texto) => {
  const t = String(texto || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '';
};

/** Os campos que a tela pode mandar, ja limpos. */
function limpar(dados = {}) {
  const titulo = String(dados.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!titulo) throw new Error('Escreva o que precisa ser feito.');
  return {
    titulo,
    detalhe: String(dados.detalhe || '').trim().slice(0, 500),
    data: dataValida(dados.data),
    hora: horaValida(dados.hora),
    prioridade: dados.prioridade === 'alta' ? 'alta' : 'normal',
  };
}

export function listarAfazeres() {
  return lerTodas();
}

export function criarAfazer(dados, operador = '') {
  const tarefas = lerTodas();
  const nova = {
    id: crypto.randomUUID(),
    ...limpar(dados),
    feita: false,
    criadaPor: String(operador || '').slice(0, 40),
    criadaEm: new Date().toISOString(),
  };
  tarefas.push(nova);
  salvarTodas(tarefas);
  return nova;
}

function mexer(id, mudanca) {
  const tarefas = lerTodas();
  const tarefa = tarefas.find((t) => t.id === id);
  if (!tarefa) throw new Error('Essa tarefa nao existe mais (alguem pode ter excluido).');
  mudanca(tarefa);
  tarefa.alteradaEm = new Date().toISOString();
  salvarTodas(tarefas);
  return tarefa;
}

export function editarAfazer(id, dados, operador = '') {
  return mexer(id, (tarefa) => Object.assign(tarefa, limpar(dados), { alteradaPor: String(operador || '').slice(0, 40) }));
}

export function concluirAfazer(id, feita = true, operador = '') {
  return mexer(id, (tarefa) => {
    tarefa.feita = Boolean(feita);
    tarefa.feitaEm = feita ? new Date().toISOString() : null;
    tarefa.feitaPor = feita ? String(operador || '').slice(0, 40) : '';
  });
}

export function excluirAfazer(id) {
  const tarefas = lerTodas();
  const ficam = tarefas.filter((t) => t.id !== id);
  if (ficam.length === tarefas.length) throw new Error('Essa tarefa nao existe mais.');
  salvarTodas(ficam);
}

// ---------------------------------------------------------------------------
// A IA montando as tarefas a partir do texto livre
// ---------------------------------------------------------------------------

export const temIA = () => Boolean(String(carregarConfig().ia?.chave || '').trim());

const FORMATO = {
  type: 'object',
  properties: {
    tarefas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          detalhe: { type: 'string' },
          data: { type: 'string' },
          hora: { type: 'string' },
          prioridade: { type: 'string', enum: ['normal', 'alta'] },
        },
        required: ['titulo', 'detalhe', 'data', 'hora', 'prioridade'],
      },
    },
  },
  required: ['tarefas'],
};

function instrucoes(agora) {
  // a data LOCAL (toISOString e a de Greenwich: depois das 21h ja seria amanha)
  const dois = (n) => String(n).padStart(2, '0');
  const dia = (d) => `${d.toLocaleDateString('pt-BR', { weekday: 'long' })} `
    + `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
  return `Voce organiza a lista de afazeres de uma loja de material de limpeza.
Agora e ${dia(agora)}, ${agora.toTimeString().slice(0, 5)} (amanha e ${dia(amanha)}).
Transforme o texto da pessoa em tarefas:
- Uma tarefa para cada coisa diferente a fazer ("ligar pro fornecedor e pagar o boleto" = 2 tarefas).
- titulo: curto e direto, comecando pelo verbo, ate 60 letras ("Ligar para a Aylag").
- detalhe: o resto que ajuda a fazer (o que pedir, valor, telefone, nome). Vazio se nao houver.
- data: AAAA-MM-DD se o texto disser quando (hoje, amanha, sexta = a PROXIMA sexta,
  dia 15 = o proximo dia 15, semana que vem = a proxima segunda). Vazio se nao disser.
- hora: HH:MM se disser ("10h" = 10:00, "de manha" = 09:00, "a tarde" = 14:00,
  "fim do dia" = 17:00, "meio-dia" = 12:00). Vazio se nao disser.
- prioridade: "alta" so se o texto disser urgente, importante, sem falta, prioridade. Senao "normal".
- Nao invente nada que nao esteja no texto. Escreva em portugues, com acento.`;
}

/**
 * Texto livre -> tarefas. Devolve { tarefas: [{titulo, detalhe, data, hora, prioridade}], comIA, aviso }.
 * Sem IA ou com erro dela: uma tarefa com o texto como esta (nada se perde).
 */
export async function entenderTexto(texto, agora = new Date()) {
  const escrito = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!escrito) throw new Error('Escreva o que precisa ser feito.');
  const doJeitoQueVeio = (aviso) => ({
    tarefas: [{ titulo: escrito.slice(0, 120), detalhe: escrito.length > 120 ? escrito : '', data: '', hora: '', prioridade: 'normal' }],
    comIA: false,
    aviso,
  });
  if (!temIA()) return doJeitoQueVeio('Sem a IA configurada: a tarefa entrou do jeito que foi escrita.');

  try {
    const dados = await chamarGemini({
      contents: [{ parts: [{ text: `${instrucoes(agora)}\n\nTEXTO:\n${escrito.slice(0, 1500)}` }] }],
      generationConfig: configEconomica({
        maximoDeResposta: 1536,
        responseMimeType: 'application/json',
        responseSchema: FORMATO,
      }),
      preferir: MODELO_ECONOMICO,
    });
    const resposta = JSON.parse(textoDaResposta(dados) || '{}');
    const tarefas = (resposta.tarefas || [])
      .map((t) => ({ ...t, data: dataValida(t.data), hora: horaValida(t.hora) }))
      .filter((t) => String(t.titulo || '').trim())
      .slice(0, 10);
    if (!tarefas.length) return doJeitoQueVeio('A IA nao entendeu o texto: a tarefa entrou do jeito que foi escrita.');
    return { tarefas, comIA: true, aviso: '' };
  } catch (erro) {
    return doJeitoQueVeio(`A IA nao respondeu (${erro.message}): a tarefa entrou do jeito que foi escrita.`);
  }
}
