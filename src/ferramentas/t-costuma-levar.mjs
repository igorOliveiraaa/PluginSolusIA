// "Esse cliente costuma levar também" — e a pergunta que o Igor fez:
// e se ele comprou semana passada e hoje veio só repor duas coisas?
//
//   node src/ferramentas/t-costuma-levar.mjs      (banco de TESTE, só leitura)
//
// A regra é o RITMO de cada produto para AQUELE cliente. O teste usa clientes
// reais do banco e confere item por item:
//   - nada do que ele comprou há pouco pode ser sugerido;
//   - só entra produto com 3 compras ou mais (senão não há ritmo);
//   - o que já está no orçamento não é sugerido de novo.

import { oQueCostumaLevar } from '../logica/sugestoes.js';
import { ritmoDeCompra, buscarClientePorCodigo } from '../db/clientes.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { mapaDeChaves } from '../db/catalogo.js';
import { VENDA_VALIDA } from '../db/venda-valida.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};
const DIA = 24 * 60 * 60 * 1000;

// clientes que compram com frequência (os que fazem sentido para reposição)
const linhas = await consultar(
  `SELECT FIRST 6 TRIM(P.CODCLIENTE) AS CODIGO, COUNT(DISTINCT P.NUMERO) AS PEDIDOS
     FROM PEDIDOS P JOIN ITEMPEDIDO I ON I.NUMERO = P.NUMERO
    WHERE ${VENDA_VALIDA} AND P.CODCLIENTE IS NOT NULL AND TRIM(P.CODCLIENTE) NOT IN ('', '1')
      AND I.DATA >= '2024-01-01'
    GROUP BY 1 HAVING COUNT(DISTINCT P.NUMERO) >= 8
    ORDER BY 2 DESC`
);

// O banco de teste é uma CÓPIA: a última venda dele não é de hoje. Então
// "hoje", para este teste, é o dia da última venda que existe no banco — senão
// todo cliente pareceria ter sumido faz mais de um ano.
const [ultimaVenda] = await consultar(
  `SELECT MAX(I.DATA) AS QUANDO FROM ITEMPEDIDO I
     JOIN PEDIDOS P ON P.NUMERO = I.NUMERO WHERE ${VENDA_VALIDA}`
);
const hoje = new Date(ultimaVenda.QUANDO).getTime();

console.log(`\n${linhas.length} clientes que compram com frequência.`);
console.log(`(o banco vai até ${new Date(hoje).toLocaleDateString('pt-BR')} — é esse o "hoje" do teste)\n`);

let comSugestao = 0;
for (const linha of linhas) {
  const cliente = await buscarClientePorCodigo(linha.CODIGO);
  if (!cliente) continue;

  const sugestoes = await oQueCostumaLevar({ cliente, jaNoOrcamento: [], agora: hoje });
  console.log(`=== ${cliente.nome.slice(0, 38)} (${linha.PEDIDOS} pedidos)`);
  if (!sugestoes.length) {
    console.log('   nada para sugerir agora (comprou tudo há pouco)\n');
    continue;
  }
  comSugestao += 1;
  for (const s of sugestoes) {
    console.log(`   ${s.produto.descricao.slice(0, 40).padEnd(41)} ${s.motivo}`);
  }

  // a trava principal: nada do que ele comprou há pouco pode estar aqui
  const ritmo = await ritmoDeCompra(cliente.codigo);
  const porChave = await mapaDeChaves(ritmo.map((r) => r.chave));
  const porCodigo = new Map();
  for (const r of ritmo) {
    const codigo = porChave.get(r.chave);
    if (codigo) porCodigo.set(String(codigo), r);
  }

  for (const s of sugestoes) {
    const dele = porCodigo.get(String(s.produto.codigo));
    const intervalo = dele
      ? (new Date(dele.ultima).getTime() - new Date(dele.primeira).getTime()) / DIA / (dele.vezes - 1)
      : 0;
    const desdeAUltima = (hoje - new Date(dele?.ultima || 0).getTime()) / DIA;

    conferir(`   "${s.produto.descricao.slice(0, 26)}" não foi comprado há pouco`,
      desdeAUltima >= intervalo * 0.8,
      `última há ${Math.round(desdeAUltima)} dias, ritmo ${Math.round(intervalo)} dias`);
    conferir('     tem histórico suficiente (3+ compras)', s.vezes >= 3, `${s.vezes} compras`);
    conferir('     não está cancelado', !s.produto.cancelado);
  }
  console.log('');
}

conferir('pelo menos um cliente teve sugestão', comSugestao > 0, `${comSugestao} de ${linhas.length}`);

console.log('=== O que já está no orçamento não é sugerido de novo ===');
const cliente = await buscarClientePorCodigo(linhas[0].CODIGO);
const antes = await oQueCostumaLevar({ cliente, jaNoOrcamento: [], agora: hoje });
if (antes.length) {
  const primeiro = antes[0].produto.codigo;
  const depois = await oQueCostumaLevar({ cliente, jaNoOrcamento: [primeiro], agora: hoje });
  conferir('o item que está na lista sai da sugestão',
    !depois.some((s) => s.produto.codigo === primeiro),
    `${antes[0].produto.descricao} saiu`);
} else {
  console.log('  (esse cliente não tem sugestão agora)');
}

console.log('\n=== Quem não tem histórico não recebe sugestão nenhuma ===');
const semCliente = await oQueCostumaLevar({ cliente: null });
conferir('sem cliente, lista vazia', semCliente.length === 0);
const consumidor = await oQueCostumaLevar({ cliente: { codigo: '1', nome: 'CONSUMIDOR' } });
conferir('CONSUMIDOR (balcão) não vira recomendação', consumidor.length === 0);

console.log('\n=== "Comprou semana passada" não aparece (teste com data forçada) ===');
// mesmo cliente, mas fingindo que hoje é 3 dias depois da última compra dele
const ritmoDele = await ritmoDeCompra(linhas[0].CODIGO);
const maisRecente = ritmoDele.filter((r) => r.vezes >= 3)
  .sort((a, b) => new Date(b.ultima) - new Date(a.ultima))[0];
if (maisRecente) {
  const logoDepois = new Date(maisRecente.ultima).getTime() + 3 * DIA;
  const naSemanaSeguinte = await oQueCostumaLevar({ cliente, agora: logoDepois });
  const codigoRecente = (await mapaDeChaves([maisRecente.chave])).get(maisRecente.chave);
  conferir('o que ele levou 3 dias antes NÃO é sugerido',
    !naSemanaSeguinte.some((s) => s.produto.codigo === String(codigoRecente)),
    `${naSemanaSeguinte.length} sugestões nesse dia`);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
