// Letras estranhas ("RejeiÃ§Ã£o", "SAB?O") em QUALQUER texto do banco.
//
//   node src/ferramentas/t-acentos-banco.mjs     (só leitura)
//
// O Solus grava em Windows-1252; o ACBr e outras integrações às vezes gravam em
// UTF-8 - e tem texto que já chegou "embolado" de outro sistema. Este teste passa
// por TODAS as colunas de texto de TODAS as tabelas e confere, depois da leitura
// do Plugin (lerTexto), se sobrou alguma letra estranha.

import { consultar, lerTexto } from '../db/firebird.js';

// o que denuncia texto embolado: UTF-8 lido como Windows-1252 ("Ã§", "Ã£", "Â°"...)
// e o caractere de substituição (quando um byte não virou letra nenhuma)
const EMBOLADO = /Ã[\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]|Â[ -¿]|�/;

const colunas = await consultar(`
  SELECT TRIM(RF.RDB$RELATION_NAME) AS TABELA, TRIM(RF.RDB$FIELD_NAME) AS COLUNA,
         F.RDB$FIELD_TYPE AS TIPO, F.RDB$FIELD_LENGTH AS TAMANHO
    FROM RDB$RELATION_FIELDS RF
    JOIN RDB$FIELDS F ON F.RDB$FIELD_NAME = RF.RDB$FIELD_SOURCE
    JOIN RDB$RELATIONS R ON R.RDB$RELATION_NAME = RF.RDB$RELATION_NAME
   WHERE COALESCE(R.RDB$SYSTEM_FLAG, 0) = 0 AND R.RDB$VIEW_BLR IS NULL
     AND F.RDB$FIELD_TYPE IN (14, 37)
   ORDER BY 1, 2`);

console.log(`\n${colunas.length} colunas de texto no banco. Conferindo uma por uma...\n`);

let colunasComProblema = 0;
let valoresComProblema = 0;
let valoresUtf8Consertados = 0;
const amostras = [];

for (const { TABELA, COLUNA, TAMANHO } of colunas) {
  const tamanho = Math.max(1, Math.min(Number(TAMANHO) || 1, 32000));
  let linhas;
  try {
    linhas = await consultar(
      `SELECT CAST("${COLUNA}" AS VARCHAR(${tamanho}) CHARACTER SET OCTETS) AS T
         FROM "${TABELA}" WHERE "${COLUNA}" IS NOT NULL`
    );
  } catch {
    continue;                 // coluna que não aceita a conversão: não é texto de verdade
  }

  let ruins = 0;
  for (const { T } of linhas) {
    if (!Buffer.isBuffer(T) || !T.some((b) => b > 127)) continue;
    const texto = lerTexto(T);
    // quanto o conserto do UTF-8 (lerTexto) já está salvando
    const comoEraAntes = new TextDecoder('windows-1252').decode(T).trim();
    if (comoEraAntes !== texto) valoresUtf8Consertados += 1;
    if (EMBOLADO.test(texto)) {
      ruins += 1;
      if (amostras.length < 25) amostras.push(`${TABELA}.${COLUNA}: ${texto.slice(0, 70)}`);
    }
  }
  if (ruins) {
    colunasComProblema += 1;
    valoresComProblema += ruins;
    console.log(`  EMBOLADO  ${TABELA}.${COLUNA}: ${ruins} valor(es)`);
  }
}

console.log(`\nTextos em UTF-8 que a leitura já consertou: ${valoresUtf8Consertados}`);
console.log(`Colunas com letra estranha DEPOIS da leitura: ${colunasComProblema} (${valoresComProblema} valores)`);
for (const a of amostras) console.log('   ' + a);

console.log(valoresComProblema ? '\n>>> AINDA TEM LETRA ESTRANHA' : '\n>>> TUDO CERTO: nenhum texto embolado');
process.exit(valoresComProblema ? 1 : 0);
