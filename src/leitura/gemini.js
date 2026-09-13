// Uma unica porta de saida para o Google Gemini, usada por todo o Plugin.
//
// Por que existe: o Gemini as vezes responde "sobrecarregado, tente depois" (503)
// ou "limite por minuto" (429), e o Google tambem aposenta modelos (404 "no longer
// available"). Para a funcionaria no balcao isso nao pode virar erro na tela.
// Entao aqui a chamada:
//   1. tenta de novo sozinha, esperando um pouco mais a cada vez;
//   2. se o modelo continuar cheio ou tiver sido aposentado, passa para o reserva.

import { carregarConfig } from '../config.js';

const ENDERECO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// reservas, na ordem: o "latest" sempre aponta para a versao atual de cada familia
const MODELOS_RESERVA = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

const ESPERAS_MS = [1500, 4000];          // entre as tentativas do mesmo modelo
const TEMPO_MAXIMO_MS = 90000;            // uma chamada nunca prende a tela mais que isso

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

function lerChave() {
  const cfg = carregarConfig();
  const chave = cfg.ia?.chave?.trim();
  if (!chave) throw new Error('Falta configurar a chave da IA (Gemini) na aba Ajustes.');
  const modelo = cfg.ia?.modelo || MODELOS_RESERVA[0];
  return { chave, modelo };
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
export async function chamarGemini(corpo) {
  const { chave, modelo } = lerChave();
  const candidatos = [modelo, ...MODELOS_RESERVA.filter((m) => m !== modelo)];

  let ultimoErro = null;

  for (const candidato of candidatos) {
    for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa += 1) {
      let resposta;
      try {
        resposta = await fetch(
          `${ENDERECO_BASE}/models/${encodeURIComponent(candidato)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
          }
        );
      } catch (erro) {
        ultimoErro = erro.name === 'TimeoutError'
          ? 'A IA demorou demais para responder.'
          : 'Nao consegui falar com a IA. O PC esta com internet?';
        if (tentativa < ESPERAS_MS.length) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      if (resposta.ok) {
        const dados = await resposta.json();
        dados.modeloUsado = candidato;
        return dados;
      }

      const detalhe = await detalheDoErro(resposta);

      // chave errada: nao adianta tentar de novo nem trocar de modelo
      if (resposta.status === 400 && /API key/i.test(detalhe)) {
        throw new Error('A chave da IA parece invalida. Confira na aba Ajustes.');
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
        ultimoErro = resposta.status === 429
          ? 'A IA atingiu o limite de uso por agora. Espere um minuto e tente de novo.'
          : 'O servico da IA esta sobrecarregado no momento. Tente de novo em instantes.';
        if (tentativa < ESPERAS_MS.length) { await esperar(ESPERAS_MS[tentativa]); continue; }
        break;
      }

      // qualquer outro erro: nao insiste
      throw new Error(`A IA nao respondeu (erro ${resposta.status}). ${detalhe}`.trim());
    }
  }

  throw new Error(ultimoErro || 'A IA nao respondeu agora. Tente de novo em instantes.');
}

/** Junta o texto das partes da primeira resposta. */
export function textoDaResposta(dados) {
  return (dados?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();
}

export { ENDERECO_BASE };
