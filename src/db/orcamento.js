// Grava o orcamento DENTRO do Solus, nas tabelas que ele ja usa:
// PEDIDOS (cabecalho) + ITEMPEDIDO (itens), com STATUS = 'ORCAMENTO'.
//
// O Solus ja trabalha com orcamento nativamente (tem milhares deles no banco),
// entao o orcamento feito aqui aparece na tela de orcamento do Solus e a venda
// e finalizada por la, com a nota saindo do jeito de sempre.
// A ferramenta nao emite nota e nao mexe em estoque nem no financeiro.

import { emTransacao, paraNumero, paraTextoBR, gravarTexto } from './firebird.js';
import { colunasDe } from './produtos.js';

/** Proximo numero de pedido, do jeito que o Solus controla (tabela CODVENDA). */
async function proximoNumero(executar) {
  const linhas = await executar('SELECT FIRST 1 NUMERO FROM CODVENDA');
  const numero = paraNumero(linhas[0]?.NUMERO);
  if (!numero) throw new Error('Nao consegui descobrir o proximo numero de pedido do Solus.');
  return Math.trunc(numero);
}

/**
 * Grava o orcamento e devolve o numero que o Solus vai mostrar.
 * Roda tudo numa transacao: ou o orcamento inteiro entra, ou nada entra.
 */
export async function gravarOrcamento({ orcamento, operador, natureza = '5102', pagamento = {} }) {
  const itens = (orcamento.itens || []).filter((i) => i.incluir && i.produto);
  if (!itens.length) throw new Error('Nenhum item para gravar no orcamento.');

  const colunasPedido = await colunasDe('PEDIDOS');
  const colunasItem = await colunasDe('ITEMPEDIDO');

  const totalItens = itens.reduce((soma, i) => soma + (i.total || 0), 0);
  // No Solus o frete entra no total do pedido (TOTALPEDIDO = itens + frete)
  const frete = Number(pagamento.frete) > 0 ? Number(pagamento.frete) : 0;
  const total = totalItens + frete;
  const tipoVenda = String(pagamento.formaDePagamento || '');
  const cliente = orcamento.cliente;
  const agora = new Date();
  const nomeOperador = String(operador?.nome || '').slice(0, 40);

  return emTransacao(async (executar) => {
    const numero = await proximoNumero(executar);

    // ---- cabecalho -------------------------------------------------------
    const cabecalho = {
      NUMERO: numero,
      CODCLIENTE: cliente?.codigo ? String(cliente.codigo).slice(0, 5) : '',
      NOMECLI: gravarTexto(String(cliente?.nome || 'CONSUMIDOR').slice(0, 50)),
      CPFCNPJ: String(cliente?.cpfCnpj || '').slice(0, 20),
      EMISSAO: agora,
      STATUS: 'ORCAMENTO',
      TOTALPEDIDO: paraTextoBR(total),
      TOTALITENS: paraTextoBR(totalItens),
      TOTPEDIDO: total,
      TOTITENS: totalItens,
      DESCONTO: '0,00',
      USUARIO: nomeOperador,
      ATUALIZA: 'S',
      NATUREZA: String(natureza).slice(0, 6),
      PDV: '0',
      CODABERTURA: 0,

      // pagamento e entrega, para o Solus ja abrir a venda preenchida
      TIPOVENDA: tipoVenda.slice(0, 15),
      PRAZO: String(pagamento.prazo ?? '0').slice(0, 4),
      FRETE: paraTextoBR(frete),
      MODALIDADEFRETE: String(pagamento.modalidadeFrete ?? '9').slice(0, 1),
      ENTREGA: String(pagamento.entrega || '').slice(0, 20),
      VALIDADE: String(pagamento.validade || '').slice(0, 20),
      OBS1: gravarTexto(String(pagamento.observacao || '').slice(0, 100)),
      VENDEDOR: String(pagamento.codigoVendedor || operador?.codigoVendedor || '').slice(0, 6),
      NOMEVENDEDOR: gravarTexto(String(pagamento.vendedor || nomeOperador).slice(0, 40)),
    };

    await inserir(executar, 'PEDIDOS', colunasPedido, cabecalho);

    // ---- itens -----------------------------------------------------------
    let posicao = 0;
    for (const item of itens) {
      posicao += 1;
      const produto = item.produto;
      // o Solus guarda em ITEMPEDIDO.PRODUTO o codigo de barras; quando o produto
      // nao tem barras, ele usa o proprio codigo
      const chave = produto.barras || produto.codigo;

      await inserir(executar, 'ITEMPEDIDO', colunasItem, {
        NUMERO: numero,
        ITEM: posicao,
        PRODUTO: String(chave).slice(0, 40),
        DESCRICAO: gravarTexto(String(produto.descricao).slice(0, 70)),
        QTD: paraTextoBR(item.quantidade),
        QTD1: Number(item.quantidade),
        PRECO: paraTextoBR(item.precoUnitario),
        TOTALITEM: paraTextoBR(item.total),
        TOT: Number(item.total),
        PRECOCUSTO: Number(produto.custoAtual || 0),
        PRECOVENDA: Number(item.precoUnitario),
        DESCONTO: '0,00',
        DATA: agora,
        USUARIO: nomeOperador,
        CONTROLE: 'V',
        FECHA: 'S',
        NATUREZA: String(natureza).slice(0, 6),
      });
    }

    // avanca o contador do Solus para o proximo pedido nao repetir numero
    await executar('UPDATE CODVENDA SET NUMERO = ?', [numero + 1]);

    return {
      numero,
      total: Math.round(total * 100) / 100,
      totalItens: Math.round(totalItens * 100) / 100,
      frete,
      quantidadeItens: itens.length,
      cliente: cliente?.nome || 'CONSUMIDOR',
      codigoCliente: cliente?.codigo || '',
      formaDePagamento: tipoVenda,
    };
  });
}

/** INSERT que so usa as colunas existentes na tabela deste banco. */
async function inserir(executar, tabela, colunas, valores) {
  const campos = [];
  const marcadores = [];
  const params = [];

  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === undefined || !colunas.has(campo)) continue;
    campos.push(campo);
    marcadores.push('?');
    params.push(valor);
  }

  if (!campos.length) throw new Error(`Nada para gravar em ${tabela}.`);

  await executar(
    `INSERT INTO ${tabela} (${campos.join(', ')}) VALUES (${marcadores.join(', ')})`,
    params
  );
}

/** Apaga um orcamento criado pela ferramenta (so enquanto ainda for ORCAMENTO). */
export async function apagarOrcamento(numero) {
  const num = Math.trunc(paraNumero(numero));
  if (!num) throw new Error('Numero de orcamento invalido.');

  return emTransacao(async (executar) => {
    const linhas = await executar('SELECT STATUS FROM PEDIDOS WHERE NUMERO = ?', [num]);
    if (!linhas.length) throw new Error('Orcamento nao encontrado.');

    const status = String(linhas[0].STATUS || '').trim().toUpperCase();
    if (status !== 'ORCAMENTO') {
      // se ja virou venda, mexer aqui bagunca estoque e financeiro do Solus
      throw new Error(`Esse pedido esta como ${status || 'sem status'} no Solus e nao pode ser apagado por aqui.`);
    }

    await executar('DELETE FROM ITEMPEDIDO WHERE NUMERO = ?', [num]);
    await executar('DELETE FROM PEDIDOS WHERE NUMERO = ?', [num]);
    return { numero: num, apagado: true };
  });
}
