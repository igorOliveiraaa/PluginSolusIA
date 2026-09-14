import { consultarBancoAvulso } from './src/db/firebird.js';
const B = { host:'localhost', porta:3050, caminho:'C:/SolusTeste/EC.FDB', usuario:'SYSDBA', senha:'masterkey' };
const q = (sql,p=[]) => consultarBancoAvulso(B, sql, p, 60000);
const l = await q(`SELECT FIRST 25 NOME, TIPO, CUSTO, ACESSACADASTRO, ACESSACADASTROCLI, CLIENTE, PERMITEORCA, STATUS FROM OPERADOR`);
console.log('nome'.padEnd(18), 'TIPO', 'CUSTO', 'CADASTRO', 'CADCLI', 'CLIENTE', 'ORCA', 'STATUS');
for (const o of l) {
  console.log(
    String(o.NOME||'').trim().padEnd(18),
    String(o.TIPO||'-').trim().padEnd(4),
    String(o.CUSTO||'-').trim().padEnd(5),
    String(o.ACESSACADASTRO||'-').trim().padEnd(8),
    String(o.ACESSACADASTROCLI||'-').trim().padEnd(6),
    String(o.CLIENTE||'-').trim().padEnd(7),
    String(o.PERMITEORCA||'-').trim().padEnd(4),
    String(o.STATUS||'-').trim());
}
process.exit(0);
