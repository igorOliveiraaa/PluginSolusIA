// Teste rapido: conecta no banco e mostra o que achou.
import { consultar, paraNumero } from '../db/firebird.js';

try {
  const [{ TOTAL }] = await consultar('SELECT COUNT(*) AS TOTAL FROM PRODUTO');
  console.log('Conectou! Produtos no banco:', TOTAL);
  const amostra = await consultar(
    'SELECT FIRST 3 CODIGO, DESCRICAO, ESTOQUEATUAL, PRECOCUSTO, PRECOVENDA FROM PRODUTO'
  );
  for (const p of amostra) {
    console.log(`  [${p.CODIGO}] ${p.DESCRICAO} | estoque=${paraNumero(p.ESTOQUEATUAL)} custo=${p.PRECOCUSTO} venda=${p.PRECOVENDA}`);
  }
  process.exit(0);
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exit(1);
}
