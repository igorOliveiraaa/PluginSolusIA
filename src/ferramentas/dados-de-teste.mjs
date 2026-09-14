// Acha no proprio banco um cliente e um produto bons para testar.
//
// Por que existe: os testes citavam pelo nome um cliente de verdade da loja.
// Num repositorio publico isso vira dado de terceiro exposto - da para saber
// quem compra da loja, quantas filiais tem e o que leva. Agora o teste descobre
// sozinho, no banco da propria maquina, e nada disso vai para o Git.

import { consultar, campoTexto, lerTexto } from '../db/firebird.js';

/**
 * Um cliente que realmente comprou (o teste precisa de historico).
 * `comVariosCadastros` procura um nome repetido em varios CNPJs, que e o caso
 * chato que a busca precisa acertar.
 */
export async function clienteParaTeste({ comVariosCadastros = false } = {}) {
  const linhas = await consultar(
    `SELECT FIRST 40 TRIM(P.CODCLIENTE) AS CODIGO, ${campoTexto('C.NOME', 50, 'NOME')},
            COUNT(*) AS COMPRAS
       FROM PEDIDOS P
       JOIN CLIENTES C ON TRIM(C.CODIGO) = TRIM(P.CODCLIENTE)
      WHERE P.CODCLIENTE IS NOT NULL AND TRIM(P.CODCLIENTE) <> ''
        AND (P.STATUS IS NULL OR P.STATUS <> 'CANCELADO')
      GROUP BY 1, 2
     HAVING COUNT(*) > 3
      ORDER BY 3 DESC`
  );

  const candidatos = linhas
    .map((l) => ({ codigo: l.CODIGO, nome: lerTexto(l.NOME).trim(), compras: Number(l.COMPRAS) }))
    // o codigo "1" costuma ser o consumidor do balcao, nao um cliente de verdade
    .filter((c) => c.nome && c.codigo !== '1');

  if (!candidatos.length) return null;

  if (comVariosCadastros) {
    // mesmo nome em mais de um cadastro = a rede com um CNPJ por cidade
    const porNome = new Map();
    for (const c of candidatos) {
      porNome.set(c.nome, (porNome.get(c.nome) || 0) + 1);
    }
    const repetido = candidatos.find((c) => porNome.get(c.nome) > 1);
    if (repetido) return repetido;
  }

  return candidatos[0];
}

/** As primeiras palavras do nome, para usar como termo de busca. */
export function termoDeBusca(nome, palavras = 1) {
  return String(nome || '').trim().split(/\s+/).slice(0, palavras).join(' ');
}
