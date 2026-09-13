// Acompanhamento da venda dentro do Solus.
//
// O Plugin nao finaliza venda nem emite nota - isso continua sendo feito no Solus,
// que e quem tem o certificado. O que este modulo faz e OLHAR o banco e descobrir
// em que pe esta cada pedido:
//
//   PEDIDOS.STATUS = 'ORCAMENTO'  -> ainda e orcamento, esperando alguem finalizar
//   PEDIDOS.STATUS = 'FATURADO'   -> virou venda (DATAVENDA diz quando)
//   PEDIDOS.NOTA                  -> numero da nota, quando ja foi gerada
//   NF.NUMERO = PEDIDOS.NOTA      -> a nota: chave, protocolo e situacao na Sefaz
//
// Tudo aqui e leitura.

import { consultar, paraNumero, campoTexto, lerTexto } from './firebird.js';

/** Formas de pagamento cadastradas no Solus (tabela CONDICAO). */
export async function formasDePagamento() {
  const linhas = await consultar(
    `SELECT CODIGO, ${campoTexto('DESCRICAO', 15)}, PRAZO, PARCELA FROM CONDICAO
      WHERE DESCRICAO IS NOT NULL AND DESCRICAO <> ''
        AND (STATUS IS NULL OR STATUS <> 'CANCELADO')
      ORDER BY DESCRICAO`
  );

  return linhas.map((l) => ({
    codigo: String(l.CODIGO || '').trim(),
    // o nome vai gravado como esta no Solus (ha um que comeca com espaco)
    nome: lerTexto(l.DESCRICAO),
    rotulo: lerTexto(l.DESCRICAO).trim(),
    aPrazo: String(l.PRAZO || '0').trim() !== '0',
    parcelado: String(l.PARCELA || '').trim().toUpperCase() === 'SIM',
  }));
}

/**
 * Como esse cliente costuma comprar: forma de pagamento e frete da ultima venda.
 * E o que o Plugin sugere sozinho na hora de montar o orcamento.
 */
export async function comoOClienteCompra(codigoCliente) {
  const cod = String(codigoCliente || '').trim();
  if (!cod) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 ${campoTexto('TIPOVENDA', 15)}, FRETE, MODALIDADEFRETE, EMISSAO, TOTPEDIDO
       FROM PEDIDOS
      WHERE TRIM(CODCLIENTE) = ? AND STATUS = 'FATURADO'
        AND TIPOVENDA IS NOT NULL AND TIPOVENDA <> ''
      ORDER BY EMISSAO DESC`,
    [cod]
  );

  if (!linhas.length) return null;
  const l = linhas[0];
  return {
    formaDePagamento: lerTexto(l.TIPOVENDA),
    frete: paraNumero(l.FRETE),
    modalidadeFrete: String(l.MODALIDADEFRETE || '').trim(),
    quando: l.EMISSAO,
    total: paraNumero(l.TOTPEDIDO),
  };
}

/** Vendedores ativos, para marcar quem atendeu. */
export async function vendedores() {
  try {
    const linhas = await consultar(
      `SELECT FIRST 50 CODIGO, ${campoTexto('NOME', 40)} FROM VENDEDOR
        WHERE NOME IS NOT NULL AND NOME <> '' ORDER BY NOME`
    );
    return linhas.map((l) => ({ codigo: String(l.CODIGO || '').trim(), nome: lerTexto(l.NOME) }));
  } catch {
    return [];
  }
}

function situacaoDaNota(nf) {
  if (!nf) return { etapa: 'sem-nota' };

  const texto = lerTexto(nf.STATUSNFE);
  const minusculo = texto.toLowerCase();

  let etapa = 'aguardando';
  if (minusculo.includes('autorizado')) etapa = 'autorizada';
  else if (minusculo.includes('cancel')) etapa = 'cancelada';
  else if (minusculo.includes('rejei')) etapa = 'rejeitada';
  else if (minusculo.includes('denegad')) etapa = 'denegada';

  return {
    etapa,
    situacao: texto,
    chave: String(nf.CHAVENFE || '').replace(/\D/g, ''),
    protocolo: String(nf.PROTOCOLONFE || '').trim(),
    caminhoXml: String(nf.XML || '').trim(),
    emissao: nf.EMISSAO,
  };
}

/**
 * Em que pe estao varios pedidos de uma vez.
 * Devolve um mapa: numero do pedido -> situacao.
 */
export async function situacaoDosPedidos(numeros = []) {
  const lista = [...new Set(numeros.map((n) => Math.trunc(paraNumero(n))).filter(Boolean))];
  if (!lista.length) return {};

  const marcadores = lista.map(() => '?').join(', ');
  const pedidos = await consultar(
    `SELECT NUMERO, STATUS, CODCLIENTE, ${campoTexto('NOMECLI', 50, 'NOMECLI')}, EMISSAO, DATAVENDA,
            TOTPEDIDO, TOTALPEDIDO, NOTA, SERIENF, ${campoTexto('TIPOVENDA', 15)}, FRETE, VALIDADE
       FROM PEDIDOS WHERE NUMERO IN (${marcadores})`,
    lista
  );

  // busca as notas desses pedidos de uma vez so
  const numerosDeNota = pedidos
    .map((p) => Math.trunc(paraNumero(p.NOTA)))
    .filter((n) => n > 0);

  let notasPorNumero = {};
  if (numerosDeNota.length) {
    const marcadoresNota = numerosDeNota.map(() => '?').join(', ');
    const notas = await consultar(
      `SELECT NUMERO, ${campoTexto('STATUSNFE', 50, 'STATUSNFE')}, CHAVENFE, PROTOCOLONFE, XML, EMISSAO
         FROM NF WHERE NUMERO IN (${marcadoresNota})`,
      numerosDeNota
    );
    notasPorNumero = Object.fromEntries(notas.map((n) => [Math.trunc(paraNumero(n.NUMERO)), n]));
  }

  const resultado = {};
  for (const p of pedidos) {
    const numero = Math.trunc(paraNumero(p.NUMERO));
    const status = String(p.STATUS || '').trim().toUpperCase();
    const numeroNota = Math.trunc(paraNumero(p.NOTA));

    resultado[numero] = {
      numero,
      status: status || 'ABERTO',
      cliente: lerTexto(p.NOMECLI),
      codigoCliente: String(p.CODCLIENTE || '').trim(),
      emissao: p.EMISSAO,
      dataVenda: p.DATAVENDA,
      total: paraNumero(p.TOTPEDIDO) || paraNumero(p.TOTALPEDIDO),
      formaDePagamento: lerTexto(p.TIPOVENDA),
      frete: paraNumero(p.FRETE),
      numeroNota: numeroNota || null,
      serieNota: String(p.SERIENF || '').trim(),
      nota: numeroNota ? situacaoDaNota(notasPorNumero[numeroNota]) : { etapa: 'sem-nota' },
    };
  }

  return resultado;
}

/** Um pedido so. */
export async function situacaoDoPedido(numero) {
  const mapa = await situacaoDosPedidos([numero]);
  return mapa[Math.trunc(paraNumero(numero))] || null;
}

/** Dados da nota pelo numero dela (para achar o arquivo e montar o DANFE). */
export async function dadosDaNota(numeroNota) {
  const numero = Math.trunc(paraNumero(numeroNota));
  if (!numero) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 NUMERO, ${campoTexto('STATUSNFE', 50, 'STATUSNFE')}, CHAVENFE, PROTOCOLONFE, XML,
            EMISSAO, CODCLIENTE, TOTALPEDIDO, SERIENF
       FROM NF WHERE NUMERO = ?`,
    [numero]
  );
  if (!linhas.length) return null;

  const l = linhas[0];
  return {
    numero,
    serie: String(l.SERIENF || '').trim(),
    total: paraNumero(l.TOTALPEDIDO),
    codigoCliente: String(l.CODCLIENTE || '').trim(),
    ...situacaoDaNota(l),
  };
}

/**
 * Vendas para empresa (CNPJ) que sairam sem nota nos ultimos dias.
 * Vira tarefa: quase sempre e nota que faltou gerar.
 */
export async function vendasParaEmpresaSemNota({ dias = 3, quantos = 10 } = {}) {
  const desde = new Date();
  desde.setDate(desde.getDate() - Math.max(1, Number(dias) || 3));

  const linhas = await consultar(
    `SELECT FIRST ${Math.min(Number(quantos) || 10, 30)}
            P.NUMERO, ${campoTexto('P.NOMECLI', 50, 'NOMECLI')}, P.EMISSAO, P.DATAVENDA, P.TOTPEDIDO,
            C.CPFCNPJ
       FROM PEDIDOS P
       JOIN CLIENTES C ON TRIM(C.CODIGO) = TRIM(P.CODCLIENTE)
      WHERE P.STATUS = 'FATURADO'
        AND P.EMISSAO >= ?
        AND (P.NOTA IS NULL OR P.NOTA = '' OR P.NOTA = '0')
        AND CHAR_LENGTH(REPLACE(REPLACE(REPLACE(C.CPFCNPJ, '.', ''), '/', ''), '-', '')) = 14
      ORDER BY P.EMISSAO DESC`,
    [desde]
  );

  return linhas.map((l) => ({
    numero: Math.trunc(paraNumero(l.NUMERO)),
    cliente: lerTexto(l.NOMECLI),
    documento: String(l.CPFCNPJ || '').trim(),
    quando: l.DATAVENDA || l.EMISSAO,
    total: paraNumero(l.TOTPEDIDO),
  }));
}

/** Quantos orcamentos estao em aberto no Solus (feitos aqui ou por la). */
export async function orcamentosEmAberto({ dias = 15 } = {}) {
  const desde = new Date();
  desde.setDate(desde.getDate() - Math.max(1, Number(dias) || 15));

  const [linha] = await consultar(
    `SELECT COUNT(*) AS QTD, SUM(TOTPEDIDO) AS TOTAL FROM PEDIDOS
      WHERE STATUS = 'ORCAMENTO' AND EMISSAO >= ?`,
    [desde]
  );

  return { quantidade: Number(linha?.QTD || 0), total: paraNumero(linha?.TOTAL), dias };
}
