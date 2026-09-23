// A IA da OpenAI (ChatGPT) atras da mesma porta que o Plugin ja usava.
//
// Todo o Plugin monta os pedidos no formato do Gemini (contents, parts,
// functionCall...). Em vez de reescrever as cinco tarefas que usam IA - e
// arriscar quebrar o que ja estava testado -, aqui o pedido e TRADUZIDO para o
// formato da OpenAI e a resposta volta traduzida para o formato de antes.
//
// Escolha dos modelos (testados com nota real de 60 itens, 15/09/2026):
//   gpt-5.4-mini  - leu os 60 itens sem nenhuma conta errada em 16s. Principal.
//   gpt-4.1-mini  - mesma precisao, 29s. Reserva de OUTRA familia: se a 5.4
//                   tiver problema, a reserva nao cai junto.
//   gpt-5.4-nano  - mesma precisao, mais lento em nota grande. Tarefa pequena.

import { carregarConfig } from '../config.js';

const ENDERECO = 'https://api.openai.com/v1/chat/completions';

export const MODELO_PRINCIPAL_OPENAI = 'gpt-5.4-mini';
export const MODELO_ECONOMICO_OPENAI = 'gpt-5.4-nano';
// a mesma pergunta, a mesma resposta (tanto quanto a OpenAI consegue)
const SEMENTE = 7;
const RESERVAS = ['gpt-4.1-mini'];

const ESPERAS_MS = [1500, 4000];
const TEMPO_MAXIMO_MS = 90000;
const TEMPO_TOTAL_MS = 150000;

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------------------------------------------------------------------------
// Credito da conta
// ---------------------------------------------------------------------------
//
// Conta paga sem saldo responde 429 "insufficient_quota". Isso nao passa
// esperando: alguem precisa colocar credito no site da OpenAI. A tela mostra
// uma faixa avisando - senao a loja passa o dia achando que "a IA esta lenta".

let situacaoDoCredito = { acabou: false, quando: 0 };

export function situacaoDaIA() {
  return { ...situacaoDoCredito };
}

function marcarCreditoAcabou() {
  situacaoDoCredito = { acabou: true, quando: Date.now() };
}

function marcarCreditoOk() {
  if (situacaoDoCredito.acabou) situacaoDoCredito = { acabou: false, quando: Date.now() };
}

export const MENSAGEM_SEM_CREDITO = 'Acabou o crédito da conta do ChatGPT (OpenAI). '
  + 'Coloque crédito em platform.openai.com → Billing e tente de novo. '
  + 'Enquanto isso, lista digitada e nota em XML continuam funcionando, porque não usam IA.';

// ---------------------------------------------------------------------------
// Traducao do pedido
// ---------------------------------------------------------------------------

const ehFamiliaGpt5 = (modelo) => /^gpt-5|^o\d/.test(modelo);

/** O "raciocinio interno": quanto menos, mais barato e mais rapido. */
function esforcoDeRaciocinio(modelo, orcamentoDoGemini) {
  if (!ehFamiliaGpt5(modelo)) return undefined;
  const pouco = /^gpt-5\.\d/.test(modelo) ? 'none' : 'minimal';   // gpt-5 "puro" nao tem 'none'
  if (orcamentoDoGemini === undefined || orcamentoDoGemini <= 0) return pouco;
  return orcamentoDoGemini <= 1024 ? 'low' : 'medium';
}

/** Schema do Gemini -> JSON Schema (tira o que so o Gemini entende). */
function schemaParaOpenAI(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(schemaParaOpenAI);
  const saida = {};
  for (const [chave, valor] of Object.entries(schema)) {
    if (chave === 'propertyOrdering' || chave === 'nullable') continue;
    if (chave === 'type' && typeof valor === 'string') {
      const tipo = valor.toLowerCase();
      saida.type = schema.nullable ? [tipo, 'null'] : tipo;
      continue;
    }
    saida[chave] = typeof valor === 'object' ? schemaParaOpenAI(valor) : valor;
  }
  return saida;
}

/** Uma parte de arquivo (foto/PDF) no formato da OpenAI. */
function arquivoParaOpenAI(dados, indice) {
  const tipo = String(dados.mime_type || dados.mimeType || '').toLowerCase();
  const base64 = dados.data;
  if (tipo === 'application/pdf') {
    return {
      type: 'file',
      file: { filename: `documento-${indice + 1}.pdf`, file_data: `data:application/pdf;base64,${base64}` },
    };
  }
  if (/^image\/(png|jpe?g|webp|gif)$/.test(tipo)) {
    return { type: 'image_url', image_url: { url: `data:${tipo};base64,${base64}`, detail: 'high' } };
  }
  // HEIC (foto de iPhone) e outros: a OpenAI nao le
  throw new Error('Esse tipo de imagem não é aceito pela IA. Mande a foto em JPG/PNG, ou tire um print da tela.');
}

/** contents (Gemini) -> messages (OpenAI). */
function mensagensParaOpenAI(corpo) {
  const mensagens = [];
  const sistema = (corpo.systemInstruction?.parts || []).map((p) => p.text).filter(Boolean).join('\n');
  if (sistema) mensagens.push({ role: 'system', content: sistema });

  let pendentes = [];      // chamadas de ferramenta esperando resposta: { id, name }
  let contadorDeArquivo = 0;

  for (const conteudo of corpo.contents || []) {
    const partes = conteudo.parts || [];

    if (conteudo.role === 'model') {
      const texto = partes.map((p) => p.text).filter(Boolean).join('\n');
      const chamadas = partes.filter((p) => p.functionCall).map((p, i) => ({
        id: p.functionCall.id || `chamada_${mensagens.length}_${i}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
      }));
      const mensagem = { role: 'assistant', content: texto || null };
      if (chamadas.length) mensagem.tool_calls = chamadas;
      mensagens.push(mensagem);
      pendentes = chamadas.map((c) => ({ id: c.id, name: c.function.name }));
      continue;
    }

    // respostas das ferramentas: cada uma vira uma mensagem "tool" ligada a sua chamada
    for (const parte of partes.filter((p) => p.functionResponse)) {
      const nome = parte.functionResponse.name;
      let posicao = pendentes.findIndex((p) => p.name === nome);
      if (posicao < 0) posicao = 0;
      const ligada = pendentes.splice(posicao, 1)[0];
      mensagens.push({
        role: 'tool',
        tool_call_id: ligada?.id || `chamada_sem_par_${mensagens.length}`,
        content: JSON.stringify(parte.functionResponse.response ?? {}),
      });
    }

    const conteudoDaPessoa = [];
    for (const parte of partes) {
      if (parte.text) conteudoDaPessoa.push({ type: 'text', text: parte.text });
      const arquivo = parte.inline_data || parte.inlineData;
      if (arquivo) conteudoDaPessoa.push(arquivoParaOpenAI(arquivo, contadorDeArquivo++));
    }
    if (conteudoDaPessoa.length) {
      const soTexto = conteudoDaPessoa.every((c) => c.type === 'text');
      mensagens.push({
        role: 'user',
        content: soTexto ? conteudoDaPessoa.map((c) => c.text).join('\n') : conteudoDaPessoa,
      });
    }
  }
  return mensagens;
}

function pedidoParaOpenAI(corpo, modelo) {
  const config = corpo.generationConfig || {};
  const pedido = { model: modelo, messages: mensagensParaOpenAI(corpo) };

  const declaracoes = (corpo.tools || []).flatMap((t) => t.functionDeclarations || []);
  if (declaracoes.length) {
    pedido.tools = declaracoes.map((d) => ({
      type: 'function',
      function: { name: d.name, description: d.description, parameters: schemaParaOpenAI(d.parameters) },
    }));
  }

  if (config.responseSchema) {
    pedido.response_format = {
      type: 'json_schema',
      json_schema: { name: 'resposta', schema: schemaParaOpenAI(config.responseSchema), strict: false },
    };
  } else if (config.responseMimeType === 'application/json') {
    pedido.response_format = { type: 'json_object' };
  }

  if (config.maxOutputTokens) pedido.max_completion_tokens = config.maxOutputTokens;

  const esforco = esforcoDeRaciocinio(modelo, config.thinkingConfig?.thinkingBudget);
  if (esforco) pedido.reasoning_effort = esforco;
  // modelo de raciocinio so aceita a temperatura padrao
  if (!ehFamiliaGpt5(modelo) && config.temperature !== undefined) pedido.temperature = config.temperature;
  // Sem temperatura zero, a MESMA pergunta podia ter resposta diferente - no
  // teste, o mesmo orcamento saiu 27/30 em tres rodadas e 25/30 em uma. A semente
  // fixa deixa a IA bem mais constante (a OpenAI chama de "melhor esforco").
  pedido.seed = SEMENTE;

  return pedido;
}

// ---------------------------------------------------------------------------
// Traducao da resposta
// ---------------------------------------------------------------------------

function respostaNoFormatoDoGemini(dados, modelo) {
  const escolha = dados?.choices?.[0] || {};
  const mensagem = escolha.message || {};
  const partes = [];
  const texto = mensagem.content || mensagem.refusal || '';
  if (texto) partes.push({ text: texto });
  for (const chamada of mensagem.tool_calls || []) {
    let args = {};
    try { args = JSON.parse(chamada.function?.arguments || '{}'); } catch { args = {}; }
    partes.push({ functionCall: { id: chamada.id, name: chamada.function?.name, args } });
  }
  const motivos = { length: 'MAX_TOKENS', content_filter: 'SAFETY', stop: 'STOP', tool_calls: 'STOP' };
  return {
    candidates: [{
      content: { role: 'model', parts: partes },
      finishReason: motivos[escolha.finish_reason] || escolha.finish_reason || 'STOP',
    }],
    usageMetadata: dados?.usage,
    modeloUsado: modelo,
  };
}

// ---------------------------------------------------------------------------
// A chamada
// ---------------------------------------------------------------------------

function lerChave() {
  const cfg = carregarConfig();
  const chave = cfg.ia?.chave?.trim();
  if (!chave) throw new Error('Falta configurar a chave da IA (ChatGPT) na aba Ajustes.');
  return { chave, modelo: cfg.ia?.modelo?.trim() || MODELO_PRINCIPAL_OPENAI };
}

async function erroDaResposta(resposta) {
  try {
    const dados = await resposta.json();
    return { mensagem: dados?.error?.message || '', codigo: dados?.error?.code || '', parametro: dados?.error?.param || '' };
  } catch {
    return { mensagem: '', codigo: '', parametro: '' };
  }
}

/**
 * Faz o pedido (no formato Gemini) na OpenAI e devolve a resposta no formato Gemini.
 * `opcoes.preferir`: 'economico' ou o nome de um modelo.
 */
export async function chamarOpenAI(corpo, opcoes = {}) {
  const { chave, modelo } = lerChave();
  const primeiro = opcoes.preferir === 'economico' ? MODELO_ECONOMICO_OPENAI : (opcoes.preferir || modelo);
  const candidatos = [...new Set([primeiro, modelo, ...RESERVAS])];

  const comecou = Date.now();
  const passouDoTempo = () => Date.now() - comecou > TEMPO_TOTAL_MS;
  let ultimoErro = null;

  for (const candidato of candidatos) {
    if (passouDoTempo()) break;
    let pedido = pedidoParaOpenAI(corpo, candidato);

    for (let tentativa = 0; tentativa <= ESPERAS_MS.length + 2; tentativa += 1) {
      if (passouDoTempo()) break;
      let resposta;
      try {
        resposta = await fetch(ENDERECO, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
          body: JSON.stringify(pedido),
          signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
        });
      } catch (erro) {
        ultimoErro = erro.name === 'TimeoutError'
          ? 'A IA demorou demais para responder.'
          : 'Não consegui falar com a IA. O PC está com internet?';
        if (tentativa < ESPERAS_MS.length) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      if (resposta.ok) {
        marcarCreditoOk();
        return respostaNoFormatoDoGemini(await resposta.json(), candidato);
      }

      const { mensagem, codigo, parametro } = await erroDaResposta(resposta);

      if (resposta.status === 401) {
        throw new Error('A chave da IA (ChatGPT) é inválida ou foi apagada. Confira na aba Ajustes.');
      }
      if (codigo === 'insufficient_quota' || /insufficient_quota|exceeded your current quota|billing/i.test(mensagem)) {
        marcarCreditoAcabou();
        throw new Error(MENSAGEM_SEM_CREDITO);
      }

      // parametro que este modelo nao aceita: tira e repete (perde so a economia)
      if (resposta.status === 400 && /unsupported|not supported|does not support|invalid value/i.test(mensagem)) {
        const semParametro = { ...pedido };
        if (/reasoning_effort/.test(parametro + mensagem) && pedido.reasoning_effort) {
          if (pedido.reasoning_effort === 'none') semParametro.reasoning_effort = 'low';
          else delete semParametro.reasoning_effort;
        } else if (/temperature/.test(parametro + mensagem) && 'temperature' in pedido) {
          delete semParametro.temperature;
        } else if (/max_completion_tokens/.test(parametro + mensagem) && pedido.max_completion_tokens) {
          delete semParametro.max_completion_tokens;
          semParametro.max_tokens = pedido.max_completion_tokens;
        } else if (/seed/.test(parametro + mensagem) && 'seed' in pedido) {
          delete semParametro.seed;
        } else {
          ultimoErro = `A IA recusou o pedido: ${mensagem}`;
          break;
        }
        pedido = semParametro;
        continue;
      }

      if (resposta.status === 400 && /image|file|pdf/i.test(mensagem)) {
        throw new Error('A IA não conseguiu abrir o arquivo. Mande em JPG, PNG ou PDF (não protegido por senha).');
      }

      if (resposta.status === 404 || codigo === 'model_not_found') {
        ultimoErro = `O modelo ${candidato} não está disponível nesta conta.`;
        break;
      }

      if ([429, 500, 502, 503].includes(resposta.status)) {
        ultimoErro = resposta.status === 429
          ? 'A IA recebeu pedidos demais em pouco tempo. Espere um minuto e tente de novo.'
          : 'O serviço da IA está instável no momento. Tente de novo em instantes.';
        if (tentativa < ESPERAS_MS.length) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      ultimoErro = `A IA não respondeu (erro ${resposta.status}). ${mensagem}`.trim();
      break;
    }
  }

  throw new Error(ultimoErro || 'A IA não respondeu agora. Tente de novo em instantes.');
}

/** Lista os modelos de chat da conta (tela de Ajustes). */
export async function listarModelosOpenAI() {
  const { chave } = lerChave();
  const resposta = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${chave}` },
    signal: AbortSignal.timeout(20000),
  });
  if (resposta.status === 401) throw new Error('A chave da IA (ChatGPT) é inválida. Confira e cole de novo.');
  if (!resposta.ok) throw new Error(`Não consegui falar com a OpenAI (erro ${resposta.status}).`);
  const dados = await resposta.json();
  return (dados.data || [])
    .map((m) => m.id)
    .filter((id) => /^gpt-(4\.1|5)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|codex|pro)/.test(id))
    .sort();
}

/** Qual IA esta configurada: a chave da OpenAI comeca com "sk-". */
export function provedorDaIA(cfg = carregarConfig()) {
  const escolhido = String(cfg.ia?.provedor || '').toLowerCase();
  if (escolhido === 'openai' || escolhido === 'gemini') return escolhido;
  return String(cfg.ia?.chave || '').trim().startsWith('sk-') ? 'openai' : 'gemini';
}
