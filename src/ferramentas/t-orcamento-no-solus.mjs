// O orcamento gravado pelo Plugin abre no Solus?
// Grava orcamentos na copia do banco e compara com os que o PROPRIO Solus gravou:
// todo campo que o Solus sempre preenche tem que vir preenchido, numero em texto
// tem que ser numero que o Delphi entende, a data sem hora, a forma de pagamento
// com o nome exato da CONDICAO e o item apontando para um produto que existe.
// No fim apaga tudo o que gravou.
//   node src/ferramentas/t-orcamento-no-solus.mjs
import { gravarOrcamento, apagarOrcamento, quantidadeParaSolus } from '../db/orcamento.js';
import { consultar } from '../db/firebird.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { buscarPorBarras } from '../db/produtos.js';

let falhas = 0;
const conferir = (ok, texto) => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${texto}`);
  if (!ok) falhas += 1;
};

// ---- 1. a quantidade no formato do Solus (campo de 6 letras) -----------------
for (const [entrada, esperado] of [[2, '2'], [1000, '1000'], [2.5, '2,5'], [1.25, '1,25'], [0.5, '0,5'], [12.345, '12,345']]) {
  conferir(quantidadeParaSolus(entrada) === esperado, `quantidade ${entrada} -> "${quantidadeParaSolus(entrada)}"`);
}

// ---- 2. o que o Solus SEMPRE preenche nos orcamentos dele ----------------------
const proximo = (await consultar('SELECT NUMERO FROM CODVENDA'))[0].NUMERO;
const faixa = `NUMERO < ${proximo} AND NUMERO > ${proximo - 20000}`;

async function colunas(tabela) {
  const linhas = await consultar(
    `SELECT TRIM(rf.RDB$FIELD_NAME) AS N, f.RDB$FIELD_TYPE AS T FROM RDB$RELATION_FIELDS rf
       JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE rf.RDB$RELATION_NAME = ? ORDER BY rf.RDB$FIELD_POSITION`, [tabela]);
  // 261 = BLOB: nao da para contar com SUM(CASE ...)
  return linhas.filter((l) => l.T !== 261).map((l) => String(l.N).trim());
}

async function sempreNoSolus(tabela, onde) {
  const nomes = await colunas(tabela);
  const somas = nomes.map((c) => `SUM(CASE WHEN ${c} IS NULL THEN 1 ELSE 0 END) AS ${c}`).join(', ');
  const r = (await consultar(`SELECT COUNT(*) AS TOTAL_LINHAS, ${somas} FROM ${tabela} WHERE ${onde}`))[0];
  return nomes.filter((c) => Number(r[c]) === 0);
}

// campo de texto que, nos orcamentos do Solus, SEMPRE tem cara de numero ("0,00")
const DELPHI = /^-?\d*,?\d+$/;
async function numerosEmTexto(tabela, onde, candidatos) {
  if (!candidatos.length) return [];
  const linhas = await consultar(`SELECT FIRST 3000 ${candidatos.join(', ')} FROM ${tabela} WHERE ${onde}`);
  return candidatos.filter((c) => linhas.every((l) => DELPHI.test(String(l[c] ?? '').trim())));
}

const ondeOrcSolus = `STATUS = 'ORCAMENTO' AND ${faixa}`;
const ondeItemSolus = `NUMERO IN (SELECT NUMERO FROM PEDIDOS WHERE ${ondeOrcSolus})`;
const sempreCab = await sempreNoSolus('PEDIDOS', ondeOrcSolus);
const sempreItem = await sempreNoSolus('ITEMPEDIDO', ondeItemSolus);
const tiposTexto = async (tabela) => (await consultar(
  `SELECT TRIM(rf.RDB$FIELD_NAME) AS N FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
    WHERE rf.RDB$RELATION_NAME = ? AND f.RDB$FIELD_TYPE IN (14, 37)`, [tabela])).map((l) => String(l.N).trim());
const numCab = await numerosEmTexto('PEDIDOS', ondeOrcSolus, (await tiposTexto('PEDIDOS')).filter((c) => sempreCab.includes(c)));
const numItem = await numerosEmTexto('ITEMPEDIDO', ondeItemSolus, (await tiposTexto('ITEMPEDIDO')).filter((c) => sempreItem.includes(c)));
console.log(`\nO Solus sempre preenche ${sempreCab.length} campos no pedido e ${sempreItem.length} no item`);
console.log(`(${numCab.length + numItem.length} deles sao numero escrito em texto)\n`);

// ---- 3. grava dois orcamentos: com cliente e sem cliente ----------------------
const hojeTexto = new Date().toLocaleDateString('pt-BR');
const desinfetante = await buscarPorBarras('7898632910520');  // TRIBUTARIA 102
const agua = await buscarPorBarras('7898632911770');           // TRIBUTARIA 500 (ST)
const casos = [
  {
    nome: 'com cliente, DINHEIRO escolhido sem o espaco, frete e entrega',
    orcamento: {
      cliente: await buscarClientePorCodigo('861'),
      itens: [
        { produto: desinfetante, quantidade: 1000, precoUnitario: 9.5, total: 9500, incluir: true },
        { produto: agua, quantidade: 2.5, precoUnitario: 9.95, total: 24.88, incluir: true },
        { produto: agua, quantidade: 3, precoUnitario: 9.95, total: 29.85, incluir: false },
      ],
    },
    pagamento: { formaDePagamento: 'DINHEIRO', frete: 25, modalidadeFrete: '0', entrega: '5 dias', observacao: 'teste do plugin' },
  },
  {
    nome: 'sem cliente e sem forma de pagamento',
    orcamento: { cliente: null, itens: [{ produto: agua, quantidade: 2, precoUnitario: 10, total: 20, incluir: true }] },
    pagamento: {},
  },
];

const gravados = [];
try {
  for (const caso of casos) {
    console.log(`--- ${caso.nome}`);
    const r = await gravarOrcamento({ orcamento: caso.orcamento, operador: { nome: 'TESTE PLUGIN' }, pagamento: caso.pagamento });
    gravados.push(r.numero);

    const cab = (await consultar('SELECT * FROM PEDIDOS WHERE NUMERO = ?', [r.numero]))[0];
    const itens = await consultar('SELECT * FROM ITEMPEDIDO WHERE NUMERO = ? ORDER BY ITEM', [r.numero]);
    const texto = (v) => (Buffer.isBuffer(v) ? v.toString('latin1') : String(v ?? ''));

    const vaziosCab = sempreCab.filter((c) => cab[c] === null);
    conferir(!vaziosCab.length, `pedido ${r.numero}: todo campo que o Solus preenche veio preenchido ${vaziosCab.join(' ')}`);
    const vaziosItem = itens.flatMap((i) => sempreItem.filter((c) => i[c] === null).map((c) => `${i.ITEM}.${c}`));
    conferir(!vaziosItem.length, `itens: todo campo que o Solus preenche veio preenchido ${vaziosItem.join(' ')}`);

    const ruinsCab = numCab.filter((c) => !DELPHI.test(texto(cab[c]).trim()));
    const ruinsItem = itens.flatMap((i) => numItem.filter((c) => !DELPHI.test(texto(i[c]).trim())).map((c) => `${i.ITEM}.${c}=${JSON.stringify(texto(i[c]))}`));
    conferir(!ruinsCab.length && !ruinsItem.length, `numero em texto que o Delphi le sem erro ${[...ruinsCab, ...ruinsItem].join(' ')}`);

    const emissao = cab.EMISSAO;
    conferir(emissao.toLocaleDateString('pt-BR') === hojeTexto && emissao.getHours() === 0 && emissao.getMinutes() === 0,
      `data de emissao = hoje, sem hora (${emissao.toLocaleString('pt-BR')})`);
    conferir(itens.every((i) => i.DATA.getHours() === 0 && i.DATA.toLocaleDateString('pt-BR') === hojeTexto), 'data dos itens = hoje, sem hora');

    const condicoes = (await consultar('SELECT CAST(DESCRICAO AS VARCHAR(15) CHARACTER SET OCTETS) AS D FROM CONDICAO'))
      .map((c) => c.D.toString('latin1'));
    conferir(condicoes.includes(texto(cab.TIPOVENDA)), `forma de pagamento existe na CONDICAO: ${JSON.stringify(texto(cab.TIPOVENDA))}`);

    for (const i of itens) {
      const chave = String(i.PRODUTO).trim();
      const achou = await consultar('SELECT FIRST 1 CODIGO, TRIBUTARIA FROM PRODUTO WHERE BARRAS = ? OR CODIGO = ?', [chave, chave.slice(0, 6)]);
      conferir(achou.length > 0, `item ${i.ITEM}: produto "${chave}" existe no cadastro`);
      const st = String(achou[0]?.TRIBUTARIA || '').trim() === '500';
      conferir(String(i.NATUREZA).trim() === (st ? '5405' : '5102'), `item ${i.ITEM}: CFOP ${String(i.NATUREZA).trim()} (${st ? 'com' : 'sem'} ST)`);
    }

    const soma = itens.reduce((s, i) => s + i.TOT, 0);
    conferir(Math.abs(soma + r.frete - Number(texto(cab.TOTALPEDIDO).replace(',', '.'))) < 0.01,
      `total do pedido = itens + frete (${texto(cab.TOTALPEDIDO)})`);
    conferir(itens.length === caso.orcamento.itens.filter((i) => i.incluir).length, `${itens.length} itens gravados (os desmarcados ficam fora)`);
    console.log(`      cliente ${String(cab.CODCLIENTE).trim()} ${texto(cab.NOMECLI).trim()} | ${texto(cab.CPFCNPJ)} | ${texto(cab.CIDADE)} | QTD ${itens.map((i) => texto(i.QTD)).join(' / ')} | OBS ${texto(cab.OBS1)}`);
  }
  conferir(gravados.length === 2 && gravados[1] === gravados[0] + 1, `numeros em sequencia: ${gravados.join(', ')}`);
  const depois = (await consultar('SELECT NUMERO FROM CODVENDA'))[0].NUMERO;
  conferir(depois === gravados.at(-1) + 1, `contador do Solus avancou para ${depois}`);
} finally {
  for (const numero of gravados) await apagarOrcamento(numero);
  // devolve o contador como estava, para a copia do banco nao andar a cada teste
  await consultar('UPDATE CODVENDA SET NUMERO = ?', [proximo]);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo: o orcamento sai igual ao do Solus.');
process.exit(falhas ? 1 : 0);
