// O áudio do WhatsApp virando texto.
//
// POR QUE EXISTE
// Metade dos pedidos chega por áudio: "bom dia, me vê aí uns dez detergente e
// duas água sanitária de cinco litros". Antes isso tinha que ser ouvido e
// digitado na mão. Agora o áudio entra na aba Orçamento como qualquer arquivo.
//
// Quem transcreve:
//   - OpenAI: o endereço de transcrição (`gpt-4o-mini-transcribe`), que é
//     separado do chat e por isso não passa por `leitura/gemini.js`;
//   - Gemini: o áudio vai junto no pedido normal, como imagem e PDF vão.
//
// O texto transcrito segue o caminho de sempre da lista - quem entende
// "dez detergente" continua sendo `lerListaDeCompras`.

import { carregarConfig } from '../config.js';
import { provedorDaIA } from './openai.js';
import { chamarGemini, configEconomica, textoDaResposta } from './gemini.js';

const ENDERECO_TRANSCRICAO = 'https://api.openai.com/v1/audio/transcriptions';
const MODELO_TRANSCRICAO = 'gpt-4o-mini-transcribe';
const TEMPO_MAXIMO_MS = 120000;

// o WhatsApp manda .ogg (opus); o iPhone manda .m4a; gravador do PC manda .wav
export const TIPOS_DE_AUDIO = [
  'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm',
];

/**
 * É áudio? Pelo tipo OU pela extensão do arquivo. No Windows o .ogg / .opus do
 * WhatsApp muitas vezes chega sem tipo ("application/octet-stream"), e aí o
 * áudio era jogado fora em silêncio e a tela dizia "envie uma foto ou PDF".
 */
export function ehAudio(tipo, nome = '') {
  const semParametro = String(tipo || '').toLowerCase().split(';')[0].trim();
  if (TIPOS_DE_AUDIO.includes(semParametro)) return true;
  return /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac)$/i.test(String(nome || ''));
}

/** Extensão que o serviço de transcrição entende, a partir do tipo do arquivo. */
function extensaoDe(tipo, nome = '') {
  const doNome = String(nome).toLowerCase().match(/\.(ogg|oga|opus|mp3|mpeg|mpga|m4a|mp4|wav|webm|flac)$/);
  if (doNome) return doNome[1] === 'opus' ? 'ogg' : doNome[1];
  const porTipo = {
    'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
  };
  return porTipo[String(tipo || '').toLowerCase()] || 'ogg';
}

async function transcreverNaOpenAI({ buffer, tipo, nome }) {
  const chave = carregarConfig().ia?.chave?.trim();
  if (!chave) throw new Error('Falta configurar a chave da IA (ChatGPT) na aba Ajustes.');

  const formulario = new FormData();
  formulario.append('file', new Blob([buffer], { type: tipo || 'audio/ogg' }),
    `audio.${extensaoDe(tipo, nome)}`);
  formulario.append('model', MODELO_TRANSCRICAO);
  formulario.append('language', 'pt');
  // o que a pessoa costuma falar: ajuda a transcrever marca e medida direito
  formulario.append('prompt',
    'Pedido de loja de material de limpeza: detergente, água sanitária, papel toalha, '
    + 'saco de lixo, álcool 70, litros, quilos, caixa, fardo, pacote.');

  const resposta = await fetch(ENDERECO_TRANSCRICAO, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}` },
    body: formulario,
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
  });

  if (!resposta.ok) {
    let mensagem = '';
    try { mensagem = (await resposta.json())?.error?.message || ''; } catch { /* sem corpo */ }
    if (resposta.status === 429) {
      throw new Error('Acabou o crédito da conta do ChatGPT (OpenAI) para ouvir o áudio.');
    }
    if (resposta.status === 401) {
      throw new Error('A chave da IA (ChatGPT) é inválida ou foi apagada. Confira na aba Ajustes.');
    }
    throw new Error(mensagem || `A IA não conseguiu ouvir o áudio (erro ${resposta.status}).`);
  }

  const dados = await resposta.json();
  return String(dados?.text || '').trim();
}

async function transcreverNoGemini({ buffer, tipo }) {
  const dados = await chamarGemini({
    contents: [{
      parts: [
        {
          text: 'Escreva exatamente o que a pessoa falou neste áudio, em português. '
            + 'É um pedido de compra numa loja de material de limpeza. '
            + 'Só o texto falado, sem comentário seu.',
        },
        { inlineData: { mimeType: tipo || 'audio/ogg', data: buffer.toString('base64') } },
      ],
    }],
    generationConfig: configEconomica({ maximoDeResposta: 1024 }),
  });
  return textoDaResposta(dados).trim();
}

/**
 * Transcreve um áudio. Devolve o texto falado (string vazia se não deu).
 * `arquivo`: { buffer, tipo, nome }
 */
export async function transcreverAudio(arquivo) {
  if (!arquivo?.buffer?.length) return '';
  // chegou sem tipo (o .ogg do WhatsApp no Windows): o tipo sai da extensão,
  // senão o Gemini recusa e a OpenAI adivinha
  const tipoCerto = String(arquivo.tipo || '').startsWith('audio/')
    ? arquivo.tipo
    : `audio/${{ mp3: 'mpeg', m4a: 'mp4' }[extensaoDe('', arquivo.nome)] || extensaoDe('', arquivo.nome)}`;
  const comTipo = { ...arquivo, tipo: tipoCerto };
  return provedorDaIA() === 'openai'
    ? transcreverNaOpenAI(comTipo)
    : transcreverNoGemini(comTipo);
}

/** Transcreve vários áudios e junta tudo num texto só (um pedido por linha). */
export async function transcreverAudios(arquivos) {
  const textos = [];
  for (const arquivo of arquivos) {
    const texto = await transcreverAudio(arquivo);
    if (texto) textos.push(texto);
  }
  return textos.join('\n');
}
