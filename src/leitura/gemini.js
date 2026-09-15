// Uma unica porta de saida para o Google Gemini, usada por todo o Plugin.
//
// Por que existe: o Gemini as vezes responde "sobrecarregado, tente depois" (503)
// ou "limite por minuto" (429), e o Google tambem aposenta modelos (404 "no longer
// available"). Para a funcionaria no balcao isso nao pode virar erro na tela.
// Entao aqui a chamada:
//   1. tenta de novo sozinha, esperando um pouco mais a cada vez;
//   2. se o modelo continuar cheio ou tiver sido aposentado, passa para o reserva.

import crypto from 'node:crypto';
import { carregarConfig } from '../config.js';
import { chamarOpenAI, provedorDaIA } from './openai.js';

const ENDERECO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// reservas, na ordem: o "latest" sempre aponta para a versao atual de cada familia
const MODELOS_RESERVA = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

const ESPERAS_MS = [1500, 4000];          // entre as tentativas do mesmo modelo
const TEMPO_MAXIMO_MS = 60000;            // uma tentativa sozinha nunca passa disso
// Teto da chamada inteira. Sem ele, tres modelos x tres tentativas x 60s deixavam
// a pessoa olhando a tela girar por mais de dez minutos quando o Google estava
// cheio. Melhor dizer "tente de novo" em dois minutos do que prender o balcao.
const TEMPO_TOTAL_MS = 120000;

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

function lerChave() {
  const cfg = carregarConfig();
  const chave = cfg.ia?.chave?.trim();
  if (!chave) throw new Error('Falta configurar a chave da IA (Gemini) na aba Ajustes.');
  const modelo = cfg.ia?.modelo || MODELOS_RESERVA[0];
  return { chave, modelo };
}

// ---------------------------------------------------------------------------
// Economia: a mesma pergunta nao e paga duas vezes
// ---------------------------------------------------------------------------
//
// Acontece direto: a pessoa manda a foto da nota, olha a conferencia, volta e
// manda a MESMA foto de novo (ou o navegador repete o envio). Guardando a
// resposta por alguns minutos, a segunda vez sai de graca e na hora.

const TEMPO_DA_LEMBRANCA = 15 * 60 * 1000;
const MAXIMO_LEMBRADO = 30;
const lembranca = new Map();

function chaveDoPedido(corpo) {
  return crypto.createHash('sha256').update(JSON.stringify(corpo)).digest('hex');
}

function lembrar(chave, dados) {
  lembranca.set(chave, { dados, quando: Date.now() });
  // guarda pouca coisa: leitura de nota com foto ocupa memoria
  while (lembranca.size > MAXIMO_LEMBRADO) {
    lembranca.delete(lembranca.keys().next().value);
  }
}

function lembrado(chave) {
  const guardado = lembranca.get(chave);
  if (!guardado) return null;
  if (Date.now() - guardado.quando > TEMPO_DA_LEMBRANCA) {
    lembranca.delete(chave);
    return null;
  }
  return guardado.dados;
}

export function esquecerRespostasDaIA() {
  lembranca.clear();
}

async function detalheDoErro(resposta) {
  try {
    return (await resposta.json())?.error?.message || '';
  } catch {
    return '';
  }
}

/**
 * Manda o corpo para o generateContent e devolve o JSON da resposta.
 * `corpo` e exatamente o que o Gemini espera (contents, tools, generationConfig...).
 */
export async function chamarGemini(corpo, opcoes = {}) {
  const podeLembrar = opcoes.lembrar !== false;
  const provedor = provedorDaIA();
  const chaveDaLembranca = podeLembrar ? provedor + ':' + chaveDoPedido(corpo) : '';
  if (podeLembrar) {
    const guardado = lembrado(chaveDaLembranca);
    if (guardado) return { ...guardado, veioDaLembranca: true };
  }

  // Chave da OpenAI (ChatGPT): o mesmo pedido vai traduzido para la.
  // Todo o resto do Plugin nao precisa saber qual IA esta respondendo.
  if (provedor === 'openai') {
    const dados = await chamarOpenAI(corpo, opcoes);
    if (podeLembrar) lembrar(chaveDaLembranca, dados);
    return dados;
  }

  const { chave, modelo } = lerChave();
  // `preferir` deixa cada tarefa pedir o modelo mais barato que da conta dela
  const preferido = opcoes.preferir === MODELO_ECONOMICO ? 'gemini-flash-lite-latest' : opcoes.preferir;
  const primeiro = preferido || modelo;
  const candidatos = [primeiro, ...MODELOS_RESERVA.filter((m) => m !== primeiro)];

  let ultimoErro = null;
  let erroQueExplica = null;      // o erro que a pessoa precisa ler, se tudo falhar
  let corpoAtual = corpo;
  const comecou = Date.now();
  const passouDoTempo = () => Date.now() - comecou > TEMPO_TOTAL_MS;

  for (const candidato of candidatos) {
    if (passouDoTempo()) break;

    // Cada modelo aceita coisas diferentes. O "lite" nao tem raciocinio interno e
    // RECUSA o campo que manda desligar ele - com a mensagem generica "Request
    // contains an invalid argument". Era isso que quebrava o envio de PDF: o
    // modelo principal batia no limite do dia, caia para o lite, e o lite
    // recusava a configuracao. A pessoa via um erro tecnico sem pe nem cabeca.
    corpoAtual = semOQueOModeloNaoAceita(corpo, candidato);

    for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa += 1) {
      if (passouDoTempo()) break;
      let resposta;
      try {
        resposta = await fetch(
          `${ENDERECO_BASE}/models/${encodeURIComponent(candidato)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify(corpoAtual),
            signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
          }
        );
      } catch (erro) {
        ultimoErro = erro.name === 'TimeoutError'
          ? 'A IA demorou demais para responder.'
          : 'Nao consegui falar com a IA. O PC esta com internet?';
        if (tentativa < ESPERAS_MS.length && !passouDoTempo()) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      if (resposta.ok) {
        const dados = await resposta.json();
        dados.modeloUsado = candidato;
        if (podeLembrar) lembrar(chaveDaLembranca, dados);
        return dados;
      }

      const detalhe = await detalheDoErro(resposta);

      // chave errada: nao adianta tentar de novo nem trocar de modelo
      if (resposta.status === 400 && /API key/i.test(detalhe)) {
        throw new Error('A chave da IA parece invalida. Confira na aba Ajustes.');
      }

      // Modelo que nao aceita desligar o "raciocinio interno": tira essa parte e
      // repete. Nao da para confiar na mensagem: uns dizem "thinking", o lite so
      // diz "invalid argument". Entao qualquer 400 com esse campo presente tenta
      // de novo sem ele. Perde a economia, mas responde.
      if (resposta.status === 400 && corpoAtual.generationConfig?.thinkingConfig) {
        const { thinkingConfig, ...resto } = corpoAtual.generationConfig;
        corpoAtual = { ...corpoAtual, generationConfig: resto };
        continue;
      }
      if (resposta.status === 403) {
        throw new Error('A chave da IA nao tem permissao para usar o Gemini. Confira no Google AI Studio.');
      }

      // modelo aposentado ou inexistente: pula direto para o reserva
      if (resposta.status === 404) {
        ultimoErro = `O modelo ${candidato} nao esta disponivel.`;
        break;
      }

      // sobrecarga ou limite momentaneo: espera e tenta de novo
      if ([429, 500, 503].includes(resposta.status)) {
        // "exceeded your current quota" no plano gratuito costuma ser o limite do
        // DIA, nao do minuto. Mandar esperar um minuto seria mentira.
        const limiteDoDia = /quota|exceeded/i.test(detalhe);
        ultimoErro = resposta.status !== 429
          ? 'O servico da IA esta sobrecarregado no momento. Tente de novo em instantes.'
          : limiteDoDia
            ? 'A conta gratuita da IA bateu o limite de uso de hoje. Ela volta sozinha amanha. '
              + 'Enquanto isso, digite a lista em vez de mandar foto ou PDF - digitada nao gasta IA.'
            : 'A IA recebeu pedidos demais em pouco tempo. Espere um minuto e tente de novo.';
        // limite de uso e o tipo de erro que a pessoa PRECISA ver, mesmo que
        // depois o modelo reserva falhe por outro motivo qualquer
        if (resposta.status === 429) erroQueExplica = erroQueExplica || ultimoErro;
        if (tentativa < ESPERAS_MS.length && !passouDoTempo()) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      // erro que nao da para contornar neste modelo: tenta o reserva antes de desistir
      ultimoErro = `A IA nao respondeu (erro ${resposta.status}). ${detalhe}`.trim();
      break;
    }
  }

  throw new Error(erroQueExplica || ultimoErro || 'A IA nao respondeu agora. Tente de novo em instantes.');
}

/**
 * Tira da configuracao o que aquele modelo nao aceita.
 * Hoje e so um caso: os modelos "lite" nao tem raciocinio interno e recusam o
 * campo que manda desliga-lo. Como eles ja nao gastam com isso, tirar nao custa
 * nada - e evita a recusa.
 */
function semOQueOModeloNaoAceita(corpo, modelo) {
  if (!/lite/i.test(modelo) || !corpo.generationConfig?.thinkingConfig) return corpo;
  const { thinkingConfig, ...resto } = corpo.generationConfig;
  return { ...corpo, generationConfig: resto };
}

/**
 * Ajustes que deixam a chamada mais barata sem piorar o resultado.
 *
 * O maior gasto do Gemini nao e a resposta: e o "raciocinio interno" que ele faz
 * antes de responder, cobrado como texto gerado. Para arrancar dados de um
 * documento com formato fixo isso nao ajuda em nada - so gasta. `pensar: 0`
 * desliga. O limite de tamanho da resposta e a outra trava: sem ele, um engano
 * do modelo pode gerar milhares de linhas.
 */
export function configEconomica({ pensar = 0, maximoDeResposta = 4096, ...resto } = {}) {
  return {
    temperature: 0,
    maxOutputTokens: maximoDeResposta,
    thinkingConfig: { thinkingBudget: pensar },
    ...resto,
  };
}

/**
 * "O modelo mais barato que da conta", para tarefa simples (texto curto).
 * E um apelido: cada IA troca pelo seu (gemini-flash-lite / gpt-5.4-nano).
 */
export const MODELO_ECONOMICO = 'economico';

/** Junta o texto das partes da primeira resposta. */
export function textoDaResposta(dados) {
  return (dados?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();
}

export { ENDERECO_BASE };
