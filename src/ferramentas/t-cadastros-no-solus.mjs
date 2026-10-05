// Produto novo (da nota) e cliente novo (do CNPJ) abrem na tela do Solus?
// Mesma ideia do t-orcamento-no-solus: o que o PROPRIO Solus sempre grava como
// numero em texto ("0,00") tem que vir preenchido e legivel para o Delphi -
// vazio, a tela dele para com "'' is not a valid floating point value".
// Cria um de cada na copia do banco, confere e apaga.
//   node src/ferramentas/t-cadastros-no-solus.mjs
import { consultar } from '../db/firebird.js';
import { aplicarNota, desfazer } from '../db/gravacao.js';
import { cadastrarCliente, buscarPorDocumento } from '../db/clientes.js';

let falhas = 0;
const conferir = (ok, texto) => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${texto}`);
  if (!ok) falhas += 1;
};
const DELPHI = /^-?\d*,?\d+$/;
const texto = (v) => (Buffer.isBuffer(v) ? v.toString('latin1') : String(v ?? ''));

/** Campos que o Solus preenche em 98% ou mais dos cadastros recentes dele. */
async function oQueOSolusPreenche(tabela) {
  const cols = await consultar(
    `SELECT TRIM(rf.RDB$FIELD_NAME) AS N, f.RDB$FIELD_TYPE AS T FROM RDB$RELATION_FIELDS rf
       JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE WHERE rf.RDB$RELATION_NAME = ?`, [tabela]);
  const nomes = cols.filter((c) => c.T !== 261).map((c) => String(c.N).trim());
  const linhas = await consultar(
    `SELECT ${nomes.join(', ')} FROM ${tabela} WHERE CODIGO SIMILAR TO '[0-9]+'
        AND CAST(CODIGO AS INTEGER) > (SELECT MAX(CAST(CODIGO AS INTEGER)) - 300 FROM ${tabela}
                                        WHERE CODIGO SIMILAR TO '[0-9]+')`);
  const sempre = nomes.filter((c) => linhas.filter((l) => l[c] !== null).length >= linhas.length * 0.98);
  // codigos so de digitos (CEST, NCM...) nao sao valores: o Delphi nao faz conta com eles
  const CODIGOS = new Set(['CODIGO', 'CEST', 'NCM', 'BARRAS', 'CODBARRAS', 'REFERENCIA', 'CEP', 'NUMERO']);
  const numeros = sempre.filter((c) => !CODIGOS.has(c)).filter((c) => {
    const valores = linhas.filter((l) => l[c] !== null).map((l) => texto(l[c]).trim());
    return typeof linhas[0][c] === 'string' || Buffer.isBuffer(linhas[0][c])
      ? valores.every((v) => DELPHI.test(v))
      : false;
  });
  return { sempre, numeros };
}

function comparar(nome, linha, { sempre, numeros }) {
  const vazios = numeros.filter((c) => linha[c] === null);
  conferir(!vazios.length, `${nome}: numero em texto que o Solus sempre preenche veio preenchido ${vazios.join(' ')}`);
  const ruins = numeros.filter((c) => linha[c] !== null && !DELPHI.test(texto(linha[c]).trim()));
  conferir(!ruins.length, `${nome}: e numero que o Delphi le ${ruins.map((c) => `${c}=${JSON.stringify(texto(linha[c]))}`).join(' ')}`);
  const outros = sempre.filter((c) => linha[c] === null && !numeros.includes(c));
  if (outros.length) console.log(`      (texto que o Solus preenche e aqui ficou vazio - sem problema para o Delphi: ${outros.join(' ')})`);
}

// ---- produto novo pela nota --------------------------------------------------
{
  const contador = (await consultar('SELECT FIRST 1 CODIGO FROM CODPRODUTO'))[0]?.CODIGO;
  const regra = await oQueOSolusPreenche('PRODUTO');
  const registros = await aplicarNota({
    itens: [{
      acao: 'criar',
      descricao: 'PRODUTO TESTE DO PLUGIN 500ML',
      codigoBarras: '7890000099991',
      unidadeCompra: 'CX',
      unidadesPorCaixa: 12,
      ncm: '34022000',
      quantidadeUnidades: 24,
      custoUnitario: 3.21,
      precoVenda: 5.9,
    }],
  });
  const codigo = registros.find((r) => r.acao === 'criado')?.codigo;
  try {
    const linha = (await consultar('SELECT * FROM PRODUTO WHERE TRIM(CODIGO) = ?', [codigo]))[0];
    conferir(Boolean(linha), `produto novo ${codigo} criado`);
    comparar('produto novo', linha, regra);
    conferir(texto(linha.GRUPOPRINCIPAL).trim() === texto(linha.GRUPO).trim(), `grupo principal = grupo (${texto(linha.GRUPO).trim()})`);
  } finally {
    await desfazer(registros);
    if (contador !== undefined) await consultar('UPDATE CODPRODUTO SET CODIGO = ?', [contador]);
  }
  const sobrou = await consultar('SELECT COUNT(*) AS T FROM PRODUTO WHERE TRIM(CODIGO) = ?', [codigo]);
  conferir(Number(sobrou[0].T) === 0, 'produto de teste removido');
}

// ---- cliente novo pelo CNPJ ----------------------------------------------------
{
  const documento = '11222333000181';   // CNPJ valido de exemplo
  if (await buscarPorDocumento(documento)) {
    console.log('(esse CNPJ ja esta no banco de teste; pulando o cliente)');
  } else {
    const contador = (await consultar('SELECT FIRST 1 CODIGO FROM CODCLIENTE'))[0]?.CODIGO;
    const regra = await oQueOSolusPreenche('CLIENTES');
    const { cliente } = await cadastrarCliente({
      cnpj: documento, razaoSocial: 'CLIENTE TESTE DO PLUGIN LTDA', rua: 'RUA TESTE', numero: '10',
      bairro: 'CENTRO', cidade: 'BAURU', uf: 'SP', cep: '17000-000',
    }, 'TESTE');
    try {
      const linha = (await consultar('SELECT * FROM CLIENTES WHERE TRIM(CODIGO) = ?', [cliente.codigo]))[0];
      comparar('cliente novo', linha, regra);
      conferir(texto(linha.TIPOCLIENTE).trim() === 'JURIDICA', `CNPJ fica como JURIDICA em TIPOCLIENTE (${texto(linha.TIPOCLIENTE)})`);
      conferir(!['JURIDICA', 'FISICA'].includes(texto(linha.TIPO).trim()), `TIPO nao recebe JURIDICA/FISICA (${JSON.stringify(texto(linha.TIPO))})`);
    } finally {
      await consultar('DELETE FROM CLIENTES WHERE TRIM(CODIGO) = ?', [cliente.codigo]);
      if (contador !== undefined) await consultar('UPDATE CODCLIENTE SET CODIGO = ?', [contador]);
    }
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo: produto e cliente novos saem como o Solus grava.');
process.exit(falhas ? 1 : 0);
