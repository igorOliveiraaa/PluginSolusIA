import { revistar, consultaLivre } from '../ia/sql-seguro.js';

console.log('=== TENTATIVAS QUE DEVEM SER BARRADAS ===');
const perigosas = [
  ["apagar produtos", "DELETE FROM PRODUTO"],
  ["alterar preco", "UPDATE PRODUTO SET PRECOVENDA = 0"],
  ["dois comandos", "SELECT FIRST 1 CODIGO FROM PRODUTO; DROP TABLE PRODUTO"],
  ["ler senhas", "SELECT FIRST 10 NOME, SENHA FROM OPERADOR"],
  ["tabela interna", "SELECT FIRST 10 RDB$RELATION_NAME FROM RDB$RELATIONS"],
  ["comentario escondendo", "SELECT FIRST 1 CODIGO FROM PRODUTO -- DROP"],
  ["criar tabela", "CREATE TABLE X (Y INTEGER)"],
  ["select into", "SELECT FIRST 1 CODIGO FROM PRODUTO INTO :X"],
];
let barradas = 0;
for (const [nome, sql] of perigosas) {
  const r = revistar(sql);
  if (!r.ok) { barradas += 1; console.log(`  OK   barrou "${nome}": ${r.motivo}`); }
  else console.log(`  FALHOU! passou "${nome}"`);
}

console.log('\n=== CONSULTAS BOAS QUE DEVEM PASSAR ===');
const boas = [
  ["contar produtos", "SELECT COUNT(*) AS TOTAL FROM PRODUTO"],
  ["sem limite (deve ganhar limite)", "SELECT CODIGO, DESCRICAO FROM PRODUTO WHERE GRUPO = '5'"],
  ["limite exagerado (deve ser cortado)", "SELECT FIRST 99999 CODIGO FROM PRODUTO"],
];
for (const [nome, sql] of boas) {
  const r = revistar(sql);
  console.log(`  ${r.ok ? 'OK  ' : 'FALHOU'} ${nome}${r.ok ? ' -> ' + r.sql.slice(0, 60) : ': ' + r.motivo}`);
}

console.log('\n=== RODANDO UMA CONSULTA DE VERDADE ===');
const resultado = await consultaLivre({
  sql: `SELECT FIRST 3 CAST(P.DESCRICAO AS VARCHAR(70) CHARACTER SET OCTETS) AS PRODUTO,
        P.PRECOVENDA, P.ESTOQUEATUAL FROM PRODUTO P
        WHERE CAST(REPLACE(P.ESTOQUEATUAL, ',', '.') AS DOUBLE PRECISION) > 100
        ORDER BY P.PRECOVENDA DESC`,
  explicacao: 'produtos caros com bastante estoque',
});
console.log('  ok:', resultado.ok, '| linhas:', resultado.quantidade);
(resultado.linhas || []).forEach(l => console.log('   ', JSON.stringify(l)));

console.log('\n' + (barradas === perigosas.length ? '>>> TODAS AS TENTATIVAS PERIGOSAS FORAM BARRADAS' : '>>> ATENCAO: ALGO PASSOU'));
process.exit(barradas === perigosas.length ? 0 : 1);
