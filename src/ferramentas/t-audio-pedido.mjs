// O áudio do WhatsApp virando orçamento.
//
//   node src/ferramentas/t-audio-pedido.mjs      (o Plugin precisa estar ligado)
//
// Gera um áudio falado de verdade (a voz da própria OpenAI), manda pela mesma
// porta que a tela usa e confere se o pedido virou itens do catálogo.
// Se não der para gerar o áudio, testa ao menos o que o código faz sozinho.

import fs from 'node:fs';
import path from 'node:path';
import { entrarComoTeste } from './login-teste.mjs';
import { ehAudio, transcreverAudio } from '../leitura/audio.js';
import { carregarConfig, PASTAS } from '../config.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};

console.log('\n=== 1. Que arquivo conta como áudio ===');
conferir('ogg do WhatsApp é áudio', ehAudio('audio/ogg'));
conferir('m4a do iPhone é áudio', ehAudio('audio/m4a'));
conferir('mp3 é áudio', ehAudio('audio/mpeg'));
conferir('foto NÃO é áudio', !ehAudio('image/jpeg'));
conferir('PDF NÃO é áudio', !ehAudio('application/pdf'));
conferir('áudio vazio não quebra', (await transcreverAudio({ buffer: Buffer.alloc(0) })) === '');

const chave = carregarConfig().ia?.chave?.trim();
if (!chave?.startsWith('sk-')) {
  console.log('\n  (sem chave da OpenAI: o resto do teste precisa dela)');
  process.exit(falhas ? 1 : 0);
}

console.log('\n=== 2. Gerando um áudio falado para testar ===');
const FALA = 'Bom dia, me vê aí dez detergente e duas água sanitária de cinco litros, por favor.';
let audio = null;
try {
  const resposta = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: FALA, response_format: 'mp3' }),
  });
  if (resposta.ok) audio = Buffer.from(await resposta.arrayBuffer());
  else console.log('  (não deu para gerar o áudio:', resposta.status, ')');
} catch (erro) {
  console.log('  (não deu para gerar o áudio:', erro.message, ')');
}

if (!audio) {
  console.log('  Sem áudio gerado, o teste para por aqui (o caminho já foi conferido acima).');
  process.exit(falhas ? 1 : 0);
}
conferir('o áudio foi gerado', audio.length > 1000, `${Math.round(audio.length / 1024)} KB`);

console.log('\n=== 3. A transcrição entende o pedido ===');
const transcrito = await transcreverAudio({ buffer: audio, tipo: 'audio/mpeg', nome: 'pedido.mp3' });
console.log(`  falado:      "${FALA}"`);
console.log(`  transcrito:  "${transcrito}"`);
conferir('transcreveu alguma coisa', transcrito.length > 10);
conferir('entendeu "detergente"', /detergente/i.test(transcrito), transcrito);
conferir('entendeu "água sanitária"', /[aá]gua sanit[aá]ria/i.test(transcrito), transcrito);
conferir('manteve as quantidades faladas', /dez|10/i.test(transcrito) && /duas|2/i.test(transcrito), transcrito);

console.log('\n=== 4. O caminho inteiro: áudio -> orçamento montado ===');
const arquivo = path.join(PASTAS.uploads, 'teste-pedido-falado.mp3');
fs.writeFileSync(arquivo, audio);

try {
  const chamar = await entrarComoTeste();
  const envio = new FormData();
  envio.append('arquivos', new Blob([audio], { type: 'audio/mpeg' }), 'pedido.mp3');
  const resposta = await chamar('/api/orcamento/montar', { method: 'POST', body: envio });
  const resultado = await resposta.json();

  conferir('o servidor montou o orçamento', resultado.ok === true, resultado.erro);
  if (resultado.ok) {
    const orc = resultado.orcamento;
    conferir('a tela recebe o que foi falado', Boolean(orc.oQueFoiFalado), orc.oQueFoiFalado);
    conferir('virou 2 itens', orc.itens.length === 2,
      orc.itens.map((i) => `${i.quantidade}x ${i.produto?.descricao || i.textoOriginal}`).join(' | '));
    conferir('achou 10 de detergente',
      orc.itens.some((i) => i.quantidade === 10 && /detergente/i.test(i.produto?.descricao || i.textoOriginal)),
      orc.itens.map((i) => `${i.quantidade}x ${i.produto?.descricao || '(em dúvida) ' + i.textoOriginal}`).join(' | '));
    conferir('achou 2 de água sanitária 5 litros',
      orc.itens.some((i) => i.quantidade === 2 && /sanit/i.test(i.produto?.descricao || i.textoOriginal)));
  }
} catch (erro) {
  conferir('o caminho pelo servidor funcionou', false, erro.message
    + ' (o Plugin precisa estar ligado: npm start)');
} finally {
  try { fs.unlinkSync(arquivo); } catch { /* ja nao existe */ }
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
