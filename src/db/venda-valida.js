// O que conta como VENDA de verdade no Solus. Um lugar so, usado por todo o Plugin.
//
// PEDIDOS guarda venda, orcamento, cancelado e estornado na mesma tabela. Antes,
// as consultas so tiravam o CANCELADO - e contavam ORCAMENTO (2.664 no banco) e
// venda ESTORNADA (265) como se fossem venda. Resultado: "o cliente pagou R$ X"
// podia ser o preco de um orcamento que ele nunca comprou, e o lucro do mes
// somava orcamento como faturamento.
//
// Venda de verdade = pedido FATURADO, e o item nao foi estornado nem cancelado.
// Pedido sem situacao (STATUS vazio) e outra numeracao, sem cliente e sem total:
// venda que nao foi finalizada - tambem nao conta.
//
// Para usar: a consulta precisa chamar PEDIDOS de P e ITEMPEDIDO de I.

export const PEDIDO_FATURADO = "TRIM(P.STATUS) = 'FATURADO'";

export const ITEM_NAO_ESTORNADO =
  "(I.STATUS IS NULL OR TRIM(I.STATUS) NOT IN ('EXTORNADO', 'CANCELADO', 'ORCAMENTO'))";

export const VENDA_VALIDA = `${PEDIDO_FATURADO} AND ${ITEM_NAO_ESTORNADO}`;
