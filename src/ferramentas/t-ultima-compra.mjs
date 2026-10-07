// A nota lancada pelo Plugin aparece como "ultima compra" na tela de produto do Solus?
// Confere o que o PROPRIO Solus grava quando a nota entra por ele:
//   - aba "Fornecedores do Produto" (FORNEPRODUTO): fornecedor, custo, numero e data da nota
//   - historico de preco (ALTERAPRECO): dia, usuario, preco antes -> depois
//   - PRODUTO.ULTIMACOMPRA = data de EMISSAO da nota; PRODUTO.UPRECOCAIXA = dia do lancamento
// E que o desfazer apaga tudo isso. Usa a copia do banco e devolve como estava.
//   node src/ferramentas/t-ultima-compra.mjs
import { consultar, paraNumero } from '../db/firebird.js';
import { aplicarNota, desfazer, dataDaNota } from '../db/gravacao.js';
import { buscarPorBarras } from '../db/produtos.js';

let falhas = 0;
const conferir = (ok, texto) => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${texto}`);
  if (!ok) falhas += 1;
};
const doisDigitos = (n) => String(n).padStart(2, '0');
const br = (d) => `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
const iso = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
const hoje = new Date();
hoje.setHours(0, 0, 0, 0);
const diasAtras = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n);

// ---- 1. a data da nota ---------------------------------------------------------
console.log('--- data de emissao da nota');
const emissao = diasAtras(9);
for (const [entrada, esperado, porque] of [
  [iso(emissao), emissao, 'do XML (2025-08-18)'],
  [br(emissao), emissao, 'da foto (18/08/2025)'],
  ['31/02/2025', hoje, 'data que nao existe'],
  [iso(diasAtras(-5)), hoje, 'no futuro'],
  [iso(diasAtras(500)), hoje, 'velha demais (leitura errada)'],
  ['', hoje, 'sem data'],
]) {
  const r = dataDaNota(entrada, hoje);
  conferir(r.getTime() === esperado.getTime(), `${porque}: "${entrada}" -> ${br(r)}`);
}

// ---- 2. uma nota com produto atualizado, produto novo e preco igualado ------------
const contar = async (sql, params) => Number((await consultar(sql, params))[0].T);
const principal = await buscarPorBarras('7891051015210');   // LAMINA (fornecedor 59 no Solus)
const irmao = await buscarPorBarras('7896098905913');       // SABAO EM PEDRA
const fornecedor = { nome: 'COMPRE FACIL', codigoNoSolus: '59', nomeNoSolus: 'COMPRE FACIL COM. DE PROD. ALIMENTICIOS' };
const contadorProduto = (await consultar('SELECT FIRST 1 CODIGO FROM CODPRODUTO'))[0]?.CODIGO;

const antes = {
  fornePrincipal: await contar('SELECT COUNT(*) AS T FROM FORNEPRODUTO WHERE TRIM(BARRA) = ?', [principal.barrasNoBanco]),
  alteraPrincipal: await contar('SELECT COUNT(*) AS T FROM ALTERAPRECO WHERE TRIM(BARRAS) = ?', [principal.barrasNoBanco]),
  alteraIrmao: await contar('SELECT COUNT(*) AS T FROM ALTERAPRECO WHERE TRIM(BARRAS) = ?', [irmao.barrasNoBanco]),
  produto: (await consultar('SELECT ULTIMACOMPRA, UPRECOCAIXA, PV FROM PRODUTO WHERE CODIGO = ?', [principal.codigo]))[0],
  irmaoPv: (await consultar('SELECT PV, UPRECOCAIXA FROM PRODUTO WHERE CODIGO = ?', [irmao.codigo]))[0],
};
const vendaNova = principal.vendaAtual + 0.1;

const registros = await aplicarNota({
  itens: [
    {
      acao: 'atualizar', produto: principal, quantidadeUnidades: 6, custoUnitario: 1.23, precoVenda: vendaNova,
      igualarIrmaos: true, irmaos: [irmao],
    },
    {
      acao: 'criar', descricao: 'PRODUTO TESTE ULTIMA COMPRA 1L', codigoBarras: '7890000099992',
      quantidadeUnidades: 12, custoUnitario: 4.5, precoVenda: 7.9,
    },
  ],
  fornecedor,
  nota: { numero: '000.123.456', emissao: iso(emissao) },
  operador: 'TESTE',
});
const atualizado = registros.find((r) => r.acao === 'atualizado');
const criado = registros.find((r) => r.acao === 'criado');
const igualado = registros.find((r) => r.acao === 'preco-igualado');

try {
  console.log('\n--- produto atualizado pela nota');
  const p = (await consultar('SELECT ULTIMACOMPRA, UPRECOCAIXA FROM PRODUTO WHERE CODIGO = ?', [principal.codigo]))[0];
  conferir(String(p.ULTIMACOMPRA).trim() === br(emissao), `"ultima compra" = data da nota (${p.ULTIMACOMPRA})`);
  conferir(String(p.UPRECOCAIXA).trim() === br(hoje), `"data alteracao preco" = hoje (${p.UPRECOCAIXA})`);

  const f = await consultar(
    `SELECT CODIGO, CAST(NOME AS VARCHAR(50) CHARACTER SET OCTETS) AS NOME, CUSTO, NOTA, DATA, MARCA
       FROM FORNEPRODUTO WHERE TRIM(BARRA) = ? AND NOTA = '123456'`, [principal.barrasNoBanco]);
  conferir(f.length === 1, `aba "Fornecedores do Produto" ganhou a nota (${f.length} linha)`);
  if (f[0]) {
    conferir(String(f[0].CODIGO).trim() === '59' && f[0].NOME.toString('latin1').startsWith('COMPRE FACIL'),
      `fornecedor: ${String(f[0].CODIGO).trim()} ${f[0].NOME.toString('latin1').trim()}`);
    conferir(String(f[0].CUSTO).trim() === '1,23', `custo da nota: ${f[0].CUSTO}`);
    conferir(br(f[0].DATA) === br(emissao) && String(f[0].MARCA).trim() === br(emissao),
      `data da nota: ${br(f[0].DATA)} (e ${f[0].MARCA} repetida, como o Solus faz)`);
  }

  const a = await consultar(
    `SELECT DATA, USUARIO, PVA, PVN, CAST(PRODUTO AS VARCHAR(70) CHARACTER SET OCTETS) AS PRODUTO
       FROM ALTERAPRECO WHERE TRIM(BARRAS) = ? AND USUARIO = 'TESTE'`, [principal.barrasNoBanco]);
  conferir(a.length === 1, `historico de preco ganhou a linha (${a.length})`);
  if (a[0]) {
    conferir(String(a[0].PVA).trim() === String(antes.produto.PV).trim() && Math.abs(paraNumero(a[0].PVN) - vendaNova) < 0.01,
      `preco ${a[0].PVA} -> ${a[0].PVN}, usuario ${a[0].USUARIO}, dia ${br(a[0].DATA)}`);
    conferir(br(a[0].DATA) === br(hoje) && a[0].DATA.getHours() === 0, 'dia de hoje, sem hora (como o Solus)');
    conferir(a[0].PRODUTO.toString('latin1').trim() === principal.descricao, `nome do produto: ${a[0].PRODUTO.toString('latin1').trim()}`);
  }

  console.log('\n--- produto novo');
  const n = (await consultar('SELECT BARRAS, ULTIMACOMPRA, UPRECOCAIXA FROM PRODUTO WHERE CODIGO = ?', [criado.codigo]))[0];
  conferir(String(n.ULTIMACOMPRA).trim() === br(emissao) && String(n.UPRECOCAIXA).trim() === br(hoje),
    `nasce com ultima compra ${n.ULTIMACOMPRA} e alteracao ${n.UPRECOCAIXA}`);
  conferir(await contar("SELECT COUNT(*) AS T FROM FORNEPRODUTO WHERE TRIM(BARRA) = '7890000099992' AND NOTA = '123456'") === 1,
    'produto novo ja nasce com a nota na aba de fornecedores');
  const an = await consultar("SELECT PVA, PVN FROM ALTERAPRECO WHERE TRIM(BARRAS) = '7890000099992'");
  conferir(an.length === 1 && String(an[0].PVA).trim() === '0,00' && String(an[0].PVN).trim() === '7,90',
    `historico de preco do novo: ${an[0]?.PVA} -> ${an[0]?.PVN}`);

  console.log('\n--- repetido com preco igualado');
  conferir(Boolean(igualado?.compraNoSolus?.alterapreco) && !igualado?.compraNoSolus?.forneproduto,
    'troca de preco vai para o historico de preco (e nao para a aba de fornecedores: nao foi compra)');
  const i = (await consultar('SELECT UPRECOCAIXA FROM PRODUTO WHERE CODIGO = ?', [irmao.codigo]))[0];
  conferir(String(i.UPRECOCAIXA).trim() === br(hoje), `"data alteracao preco" do repetido = hoje (${i.UPRECOCAIXA})`);
} finally {
  // o historico do Plugin guarda os registros em arquivo (JSON): o desfazer tem
  // que funcionar com eles depois dessa ida e volta
  await desfazer(JSON.parse(JSON.stringify(registros)));
  if (contadorProduto !== undefined) await consultar('UPDATE CODPRODUTO SET CODIGO = ?', [contadorProduto]);
}

console.log('\n--- desfazer');
conferir(await contar('SELECT COUNT(*) AS T FROM FORNEPRODUTO WHERE TRIM(BARRA) = ?', [principal.barrasNoBanco]) === antes.fornePrincipal,
  'a linha da nota saiu da aba de fornecedores');
conferir(await contar('SELECT COUNT(*) AS T FROM ALTERAPRECO WHERE TRIM(BARRAS) = ?', [principal.barrasNoBanco]) === antes.alteraPrincipal
  && await contar('SELECT COUNT(*) AS T FROM ALTERAPRECO WHERE TRIM(BARRAS) = ?', [irmao.barrasNoBanco]) === antes.alteraIrmao,
  'as linhas do historico de preco sairam');
conferir(await contar("SELECT COUNT(*) AS T FROM FORNEPRODUTO WHERE TRIM(BARRA) = '7890000099992'") === 0
  && await contar("SELECT COUNT(*) AS T FROM ALTERAPRECO WHERE TRIM(BARRAS) = '7890000099992'") === 0,
  'o produto novo nao deixou rastro');
const depois = (await consultar('SELECT ULTIMACOMPRA, UPRECOCAIXA, PV FROM PRODUTO WHERE CODIGO = ?', [principal.codigo]))[0];
conferir(depois.ULTIMACOMPRA === antes.produto.ULTIMACOMPRA && depois.UPRECOCAIXA === antes.produto.UPRECOCAIXA
  && depois.PV === antes.produto.PV, `datas e preco voltaram (${depois.ULTIMACOMPRA} / ${depois.UPRECOCAIXA} / ${depois.PV})`);
const irmaoDepois = (await consultar('SELECT PV, UPRECOCAIXA FROM PRODUTO WHERE CODIGO = ?', [irmao.codigo]))[0];
conferir(irmaoDepois.PV === antes.irmaoPv.PV && irmaoDepois.UPRECOCAIXA === antes.irmaoPv.UPRECOCAIXA, 'o repetido voltou ao preco de antes');

// ---- 3. fornecedor que nao esta no Solus ---------------------------------------
console.log('\n--- fornecedor sem cadastro no Solus');
const semFornecedor = await aplicarNota({
  itens: [{ acao: 'atualizar', produto: await buscarPorBarras('7891051015210'), quantidadeUnidades: 0, custoUnitario: 1.12, precoVenda: principal.vendaAtual }],
  fornecedor: { nome: 'FORNECEDOR NOVO' },
  nota: { numero: '999', emissao: iso(emissao) },
  operador: 'TESTE',
  atualizarEstoque: false,
});
try {
  const r = semFornecedor.find((x) => x.acao === 'atualizado');
  conferir(!r.compraNoSolus?.forneproduto && Boolean(r.compraNoSolus?.alterapreco),
    'sem codigo de fornecedor nao entra na aba de fornecedores (o Solus sempre tem um), mas o historico de preco entra');
} finally {
  await desfazer(JSON.parse(JSON.stringify(semFornecedor)));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo: a nota do Plugin aparece como ultima compra no Solus.');
process.exit(falhas ? 1 : 0);
