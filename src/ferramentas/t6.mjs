// Testa gravacao de texto com acento numa COPIA do banco (nunca no da loja)
import { consultar, emTransacao, gravarTexto, lerTexto, campoTexto } from '../db/firebird.js';

const CODIGO_TESTE = '999999';
await emTransacao(async (executar) => {
  await executar('DELETE FROM PRODUTO WHERE CODIGO = ?', [CODIGO_TESTE]);
  await executar(
    'INSERT INTO PRODUTO (CODIGO, DESCRICAO, BARRAS, UNIDADE) VALUES (?, ?, ?, ?)',
    [CODIGO_TESTE, gravarTexto('SABÃO LÍQUIDO AÇÃO 3L - TESTE'), '7999999999999', 'UN']
  );
});

const linhas = await consultar(
  `SELECT ${campoTexto('DESCRICAO', 70)} FROM PRODUTO WHERE CODIGO = ?`, [CODIGO_TESTE]
);
console.log('gravou e leu de volta:', JSON.stringify(lerTexto(linhas[0].DESCRICAO)));

// limpa o produto de teste
await emTransacao((executar) => executar('DELETE FROM PRODUTO WHERE CODIGO = ?', [CODIGO_TESTE]));
console.log('produto de teste removido');
process.exit(0);
