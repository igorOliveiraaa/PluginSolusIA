// O caso exato que a loja descreveu: cliente escolhido, pediu "alcool 5l".
// Tem que aparecer PRIMEIRO o alcool 5L que ELE comprou por ultimo; depois os
// outros que ele ja levou (do mais recente para o mais antigo); depois o mais
// provavel da loja.
//
//   node src/ferramentas/t-alcool-5l.mjs     (banco de TESTE, so leitura)

import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { montarOrcamento } from '../logica/orcamento.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { codigosDasChaves, palavrasCanonicas } from '../db/catalogo.js';
import { VENDA_VALIDA } from '../db/venda-valida.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};

// todas as vendas faturadas de alcool 5 litros, por cliente
const vendas = await consultar(
  `SELECT TRIM(P.CODCLIENTE) AS CLIENTE, TRIM(I.PRODUTO) AS CHAVE, I.DATA,
          ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}
     FROM ITEMPEDIDO I JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
    WHERE ${VENDA_VALIDA} AND I.DESCRICAO CONTAINING 'ALCOOL'
      AND P.CODCLIENTE IS NOT NULL AND TRIM(P.CODCLIENTE) NOT IN ('', '1')
      AND I.DATA >= '2023-01-01'
    ORDER BY I.DATA DESC`
);

// por cliente: os alcool 5L que ele comprou, do mais recente para o mais antigo
const porCliente = new Map();
for (const venda of vendas) {
  const palavras = palavrasCanonicas(lerTexto(venda.DESCRICAO));
  if (!palavras.includes('5L')) continue;
  const [codigo] = await codigosDasChaves([venda.CHAVE]);
  if (!codigo) continue;
  const lista = porCliente.get(venda.CLIENTE) || [];
  if (!lista.includes(codigo)) lista.push(codigo);
  porCliente.set(venda.CLIENTE, lista);
}

const clientes = [...porCliente.entries()].slice(0, 12);
console.log(`\n${porCliente.size} clientes compraram alcool 5L; testando ${clientes.length}.\n`);
let certos = 0;

for (const [codigoCliente, comprados] of clientes) {
  const cliente = await buscarClientePorCodigo(codigoCliente);
  if (!cliente) continue;
  const orcamento = await montarOrcamento({
    lista: { itens: [{ textoOriginal: 'alcool 5l', descricao: 'alcool 5l', quantidade: 2 }] },
    cliente,
  });
  const item = orcamento.itens[0];
  const opcoes = (item.opcoes || []).map((o) => o.codigo);
  const primeiro = item.produto?.codigo || opcoes[0];

  // o ultimo que ele comprou vem primeiro, e os outros dele logo depois, na ordem
  const comprouEAindaVende = comprados.filter((c) => opcoes.includes(c));
  const ordemCerta = comprouEAindaVende.every((c, i) => opcoes[i] === c);
  const ok = primeiro === comprouEAindaVende[0] && ordemCerta;
  if (ok) certos += 1;

  const nome = (codigo) => (item.opcoes || []).find((o) => o.codigo === codigo)?.descricao || codigo;
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${cliente.nome.slice(0, 34).padEnd(34)} `
    + `${item.produto ? 'escolheu' : 'perguntou'}: ${nome(primeiro).slice(0, 34)}`
    + `${comprouEAindaVende.length > 1 ? `  (ele levou ${comprouEAindaVende.length} marcas)` : ''}`
    + `${ok ? '' : `  << devia ser ${nome(comprouEAindaVende[0])}`}`);
}

conferir('\nem todos, o alcool 5L que o cliente comprou por ultimo veio primeiro', certos === clientes.length,
  `${certos}/${clientes.length}`);
console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
