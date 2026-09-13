import { procurarInstalacoes } from '../instalacoes-solus.js';
const r = await procurarInstalacoes({ usuarioProcurado: 'ELAINE' });
console.log(`busca: ${r.segundos}s | incompleta: ${r.buscaIncompleta} | encontrados: ${r.instalacoes.length}\n`);
for (const i of r.instalacoes) {
  console.log(`- ${i.caminho}`);
  console.log(`    Solus? ${i.ehSolus} | usado pelo Solus em: ${i.pastasDoSolus.join(', ') || '(nenhum - parece copia)'}`);
  if (i.empresa) console.log(`    empresa: ${i.empresa.fantasia} | ${i.empresa.razao} | CNPJ ${i.empresa.cnpj}`);
  console.log(`    ${i.produtos} produtos | ${i.clientes} clientes | ultimo movimento ${i.ultimoMovimento ? new Date(i.ultimoMovimento).toLocaleDateString('pt-BR') : '-'} | ${i.tamanhoMB} MB`);
  console.log(`    usuarios: ${i.quantidadeDeUsuarios} | tem ELAINE? ${i.temUsuarioProcurado}${i.erro ? ' | erro: ' + i.erro : ''}`);
}
process.exit(0);
