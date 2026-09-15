// Mostra quais campos fiscais do cadastro de produto ESTE Solus tem, o que o
// Plugin vai preencher quando estiverem vazios, e quantos produtos estao sem eles.
//
// Rode na LOJA depois de atualizar:  node src/ferramentas/campos-fiscais.mjs
//
// Serve para conferir os campos novos da reforma (CST Cbs/Ibs e Classificacao
// Fiscal), que nao existem na copia antiga do banco usada no desenvolvimento.

import { estruturaDe } from '../db/produtos.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { camposFiscaisDoBanco } from '../logica/padroes-fiscais.js';

const estrutura = await estruturaDe('PRODUTO');
const campos = camposFiscaisDoBanco(estrutura);

console.log('\n=== O que o Plugin vai preencher (so quando estiver vazio) ===');
for (const campo of campos) {
  console.log(`  ${campo.coluna.padEnd(22)} = ${String(campo.valor).padEnd(8)} (${campo.nome})`);
}

console.log('\n=== Colunas deste Solus que parecem ser da reforma (IBS/CBS) ===');
const suspeitas = [...estrutura.nomes].filter((c) => /IBS|CBS|CLASSTRIB|CCLASS|CLASSIFIC/.test(c));
console.log(suspeitas.length ? '  ' + suspeitas.join(', ') : '  nenhuma (este Solus ainda nao tem esses campos)');

const naoUsadas = suspeitas.filter((c) => !campos.some((campo) => campo.coluna === c));
if (naoUsadas.length) {
  console.log('\n  [!] Estas o Plugin NAO preenche (confira o nome com o suporte do Solus):');
  console.log('      ' + naoUsadas.join(', '));
}

console.log('\n=== Quantos produtos ativos estao sem cada campo ===');
for (const campo of campos) {
  try {
    const linhas = await consultar(
      `SELECT COUNT(*) AS QUANTOS FROM PRODUTO
        WHERE (STATUS IS NULL OR STATUS = '')
          AND (${campo.coluna} IS NULL OR TRIM(${campo.coluna}) = '')`
    );
    console.log(`  ${campo.coluna.padEnd(22)} ${String(linhas[0].QUANTOS).padStart(6)} produtos vazios`);
  } catch (erro) {
    console.log(`  ${campo.coluna.padEnd(22)} nao deu para contar: ${erro.message}`);
  }
}

console.log('\n=== Exemplo: 3 produtos ativos e o que esta gravado ===');
const exemplos = await consultar(
  `SELECT FIRST 3 CODIGO, ${campoTexto('DESCRICAO', 70)},
          ${campos.map((c) => campoTexto(c.coluna, 30)).join(', ')}
     FROM PRODUTO WHERE STATUS IS NULL OR STATUS = ''`
);
for (const linha of exemplos) {
  const valores = campos.map((c) => `${c.coluna}=[${lerTexto(linha[c.coluna])}]`).join(' ');
  console.log(`  ${String(linha.CODIGO).trim().padEnd(7)} ${lerTexto(linha.DESCRICAO).slice(0, 34).padEnd(36)} ${valores}`);
}

process.exit(0);
