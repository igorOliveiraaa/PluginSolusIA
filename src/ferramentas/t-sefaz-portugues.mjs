// A resposta da Sefaz explicada em portugues de gente.
//
//   node src/ferramentas/t-sefaz-portugues.mjs
//
// O que importa: as rejeicoes comuns saem da TABELA (sem gastar IA), o que a IA
// explicar uma vez fica guardado (a tela pergunta a cada 45 segundos) e, se a IA
// nao responder, aparece o texto da Sefaz - nunca fica sem resposta.

import fs from 'node:fs';
import path from 'node:path';
import { explicarSefaz, codigoDaRejeicao } from '../leitura/sefaz-em-portugues.js';
import { PASTAS } from '../config.js';
import { esquecerRespostasDaIA } from '../leitura/gemini.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};

const arquivo = path.join(PASTAS.dados, 'sefaz-explicado.json');
const memoriaAntes = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null;

console.log('\n=== 1. As rejeicoes comuns saem da tabela (nao gasta IA) ===');
conferir('acha o numero da rejeicao', codigoDaRejeicao('Rejeicao: 610 - Total da NF difere') === 610);

const comuns = await explicarSefaz([
  'Rejeicao: 610 - Total da NF difere do somatorio dos valores',
  'Rejeicao: 207 - CNPJ do destinatario invalido',
  'Rejeicao: 204 - Duplicidade de NF-e',
]);
conferir('610 vira "o total nao bate"', /total da nota não bate/i.test(comuns[0]), comuns[0]);
conferir('207 fala do CNPJ do cliente', /CNPJ do cliente/i.test(comuns[1]), comuns[1]);
conferir('204 fala de nota ja enviada', /enviada antes/i.test(comuns[2]), comuns[2]);
conferir('nenhuma delas repete o codigo tecnico',
  comuns.every((t) => !/Rejeicao:/i.test(t)));

console.log('\n=== 1b. O formato REAL do Solus (sem numero) sai da tabela tambem ===');
// copiados do banco da loja: o Solus/ACBr grava assim, sem o codigo
const reais = [
  ['Rejeicao: Duplicidade de NF-e, com diferenca na Chave de Acesso [chNFe:35250912345678000199550010000000201000000200]', /já tinha sido enviada/],
  ['Rejeição: IE do destinatário não informada', /inscrição estadual do cliente/],
  ['Rejeição: Informado NCM inexistente [nItem:3]', /NCM do item 3/],
  ['Rejeição: Código Regime Tributário do emitente diverge do cadastro na SEFAZ', /regime tributário/],
  ['Rejeição: Não informada vBCSTRet, pST, vICMSSubstituto', /ICMS-ST já retido/],
];
const explicadas = await explicarSefaz(reais.map(([texto]) => texto));
reais.forEach(([texto, esperado], i) => {
  conferir(`"${texto.slice(0, 44)}..."`, esperado.test(explicadas[i]), explicadas[i]);
});
conferir('numero de item/chave NAO vira codigo de rejeicao',
  codigoDaRejeicao('Rejeição: Informado NCM inexistente [nItem:610]') === null);

console.log('\n=== 1c. Acento que o ACBr grava em UTF-8 aparece certo ===');
const { lerTexto } = await import('../db/firebird.js');
const emUtf8 = Buffer.from('Rejeição: IE do destinatário não informada', 'utf8');
conferir('texto em UTF-8 no banco sai sem acento embolado',
  lerTexto(emUtf8) === 'Rejeição: IE do destinatário não informada', lerTexto(emUtf8));
const emWindows = Buffer.from([0x53, 0x41, 0x42, 0xC3, 0x4F, 0x20, 0x37, 0x30, 0xB0]); // "SABÃO 70°" em Windows-1252
conferir('texto do Solus (Windows-1252) continua certo', lerTexto(emWindows) === 'SABÃO 70°', lerTexto(emWindows));
conferir('texto sem acento nao muda', lerTexto(Buffer.from('DETERGENTE YPE')) === 'DETERGENTE YPE');

console.log('\n=== 2. O que nao esta na tabela vai para a IA ===');
const estranha = 'Rejeicao: 999 - Codigo de barras GTIN do item invalido para o produto informado';
const explicada = await explicarSefaz([estranha]);
const usouIA = explicada[0] !== estranha;
if (usouIA) {
  conferir('a IA explicou em portugues simples', explicada[0].length > 10 && explicada[0].length < 260, explicada[0]);
  conferir('  e guardou para nao pagar de novo',
    JSON.parse(fs.readFileSync(arquivo, 'utf8'))[estranha] === explicada[0]);

  // segunda vez: tem que vir da memoria, sem chamar a IA
  esquecerRespostasDaIA();                       // limpa o cache de 15 minutos
  const comecou = Date.now();
  const denovo = await explicarSefaz([estranha]);
  const demorou = Date.now() - comecou;
  conferir('a segunda vez sai da memoria (rapida e de graca)',
    denovo[0] === explicada[0] && demorou < 300, `${demorou}ms`);
} else {
  console.log('  (sem IA agora: caiu no texto original, que e o comportamento certo)');
  conferir('sem IA, devolve a mensagem original', explicada[0] === estranha);
}

console.log('\n=== 3. Nunca fica sem resposta ===');
const vazios = await explicarSefaz(['', null, undefined]);
conferir('mensagem vazia nao quebra', vazios.every((t) => t === ''));

// devolve a memoria ao que era, para o teste nao sujar a pasta dados
if (memoriaAntes === null) { try { fs.unlinkSync(arquivo); } catch { /* ja nao existe */ } }
else fs.writeFileSync(arquivo, memoriaAntes, 'utf8');

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
