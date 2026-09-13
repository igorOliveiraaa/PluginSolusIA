// Grava um orcamento de teste na copia do banco, confere e apaga.
import { gravarOrcamento, apagarOrcamento } from '../db/orcamento.js';
import { consultar, paraNumero, campoTexto, lerTexto } from '../db/firebird.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { buscarPorBarras } from '../db/produtos.js';

const cliente = await buscarClientePorCodigo('861');
const p1 = await buscarPorBarras('7896098905913');   // SABAO EM PEDRA
const p2 = await buscarPorBarras('7891051015210');   // LAMINA

const orcamento = {
  cliente,
  itens: [
    { produto: p1, quantidade: 10, precoUnitario: 3.5, total: 35, incluir: true },
    { produto: p2, quantidade: 4, precoUnitario: 2.0, total: 8, incluir: true },
  ],
};

const antes = paraNumero((await consultar('SELECT NUMERO FROM CODVENDA'))[0].NUMERO);
console.log('proximo numero antes:', antes);

const r = await gravarOrcamento({ orcamento, operador: { nome: 'TESTE' } });
console.log('gravado:', JSON.stringify(r));

const cab = await consultar(
  `SELECT NUMERO, ${campoTexto('NOMECLI', 50)}, CODCLIENTE, STATUS, TOTALPEDIDO, USUARIO FROM PEDIDOS WHERE NUMERO = ?`, [r.numero]);
console.log('cabecalho no banco:', cab[0].NUMERO, '|', lerTexto(cab[0].NOMECLI), '| cli', String(cab[0].CODCLIENTE).trim(),
  '|', String(cab[0].STATUS).trim(), '| R$', String(cab[0].TOTALPEDIDO).trim(), '|', String(cab[0].USUARIO).trim());

const its = await consultar(
  `SELECT ITEM, PRODUTO, ${campoTexto('DESCRICAO', 70)}, QTD, PRECO, TOTALITEM FROM ITEMPEDIDO WHERE NUMERO = ? ORDER BY ITEM`, [r.numero]);
its.forEach(i => console.log(`  item ${i.ITEM}: ${String(i.PRODUTO).trim()} | ${lerTexto(i.DESCRICAO)} | qtd ${String(i.QTD).trim()} | R$ ${String(i.PRECO).trim()} = ${String(i.TOTALITEM).trim()}`));

const depois = paraNumero((await consultar('SELECT NUMERO FROM CODVENDA'))[0].NUMERO);
console.log('proximo numero depois:', depois, depois === antes + 1 ? '(OK avancou 1)' : '(FALHOU)');

await apagarOrcamento(r.numero);
const sumiu = (await consultar('SELECT COUNT(*) AS T FROM PEDIDOS WHERE NUMERO = ?', [r.numero]))[0].T;
console.log('apagado:', Number(sumiu) === 0 ? 'OK' : 'FALHOU');
process.exit(0);
