// Testa: observacao escrita -> IA entende -> SISTEMA calcula.
import { entrarComoTeste } from './login-teste.mjs';
import fs from 'node:fs';

const chamar = await entrarComoTeste();
const xml = fs.readFileSync('exemplos/nota-teste-entrada.xml');

async function comObservacao(observacao) {
  const form = new FormData();
  form.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota.xml');
  form.append('observacao', observacao);
  const r = await (await chamar('/api/ler-nota', { method: 'POST', body: form })).json();
  if (!r.ok) { console.log('  FALHOU:', r.erro); return; }

  console.log(`\n=== observacao: "${observacao}"`);
  console.log('  IA entendeu:', r.conferencia.ajustes?.entendi || '(sem ajuste)');
  for (const i of r.conferencia.itens) {
    const marca = i.ajusteAplicado ? ` <<< ${i.ajusteAplicado}` : '';
    console.log(`   ${i.descricao.slice(0, 34).padEnd(35)} qtd ${String(i.quantidadeUnidades).padStart(5)} | custo/un R$ ${i.custoUnitario.toFixed(4)}${marca}`);
  }
  console.log('  soma dos custos: R$', r.conferencia.resumo.somaDosCustos, '| total da nota: R$', r.conferencia.resumo.totalDaNota);
}

await comObservacao('');
await comObservacao('Nessa nota veio uma taxa de 50 reais a mais que nao esta no papel, joga no custo.');
await comObservacao('A caixa da lamina wilkinson vem com 24 unidades, nao com 12.');
await comObservacao('Conferir a validade dos produtos quando chegar.');
process.exit(0);
