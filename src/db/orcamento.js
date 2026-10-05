// Grava o orcamento DENTRO do Solus, nas tabelas que ele ja usa:
// PEDIDOS (cabecalho) + ITEMPEDIDO (itens), com STATUS = 'ORCAMENTO'.
//
// O Solus ja trabalha com orcamento nativamente (tem milhares deles no banco),
// entao o orcamento feito aqui aparece na tela de orcamento do Solus e a venda
// e finalizada por la, com a nota saindo do jeito de sempre.
// A ferramenta nao emite nota e nao mexe em estoque nem no financeiro.
//
// REGRA DE OURO: a linha tem que sair IGUAL a que o proprio Solus grava.
// O Solus (Delphi) le muitos campos de texto como numero ("0,00"); campo vazio
// faz a tela de orcamento dele parar com "'' is not a valid floating point value".
// Foi o erro da loja em 10/2026: o orcamento gravava, mas nao abria no Solus.
// Os campos e valores abaixo sairam de 595 orcamentos feitos pelo proprio Solus
// no banco real (todos tinham esses campos preenchidos).

import { emTransacao, paraNumero, paraTextoBR, gravarTexto, campoTexto, lerTexto } from './firebird.js';
import { colunasDe } from './produtos.js';

// "Numero em texto" que o Solus sempre grava como "0,00" num orcamento.
const ZERADOS_PEDIDO = ['DESCONTO', 'BASEICMS', 'VALORICMS', 'BASEISS', 'VALORISS', 'JUROS',
  'TOTALSERVICO', 'VALORIPI', 'DESCONTOTOTALTABELA', 'BASEICMSS', 'VOLUME1', 'PESOBRUTO',
  'PESOLIQUIDO', 'VALORICMSS', 'ICMSSPAGAR', 'TVALORPIS', 'TVALORCOFINS'];
const ZERADOS_ITEM = ['DESCONTO', 'DESCONTOITEM', 'ALIQUOTAICMS', 'VALORICMS', 'BASEICMS',
  'ALIQUOTAISS', 'VALORISS', 'BASEISS', 'VALORIPI', 'ALIQUOTAIPI', 'VALORICMSS', 'ALIQUOTAICMSS',
  'BASEICMSS', 'ICMSSPAGAR', 'IVA', 'VOLUME', 'PESOBRUTO', 'PESOLIQUIDO'];

// CSOSN 500 / CST 60 = ICMS ja recolhido por substituicao. O Solus vende esses com
// CFOP 5405 (6403 para fora do estado); os outros, com o CFOP da loja (5102/6102).
const TRIBUTACAO_COM_ST = new Set(['500', '60']);

/**
 * Grava o orcamento e devolve o numero que o Solus vai mostrar.
 * Roda tudo numa transacao: ou o orcamento inteiro entra, ou nada entra.
 */
export async function gravarOrcamento({ orcamento, operador, natureza = null, pagamento = {} }) {
  const itens = (orcamento.itens || []).filter((i) => i.incluir && i.produto);
  if (!itens.length) throw new Error('Nenhum item para gravar no orcamento.');

  const colunasPedido = await colunasDe('PEDIDOS');
  const colunasItem = await colunasDe('ITEMPEDIDO');
  const colunasProduto = await colunasDe('PRODUTO');
  const colunasParametro = await colunasDe('PARAMETRO');

  // No Solus o frete entra no total do pedido (TOTALPEDIDO = itens + frete)
  const frete = Number(pagamento.frete) > 0 ? arredondar(Number(pagamento.frete)) : 0;
  const nomeOperador = String(operador?.nome || '').trim();
  const agora = new Date();
  // O Solus grava a data do orcamento SEM hora (meia-noite). Com a hora junto, o
  // orcamento sumia do filtro "de hoje" do Solus e aparecia com outra data.
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const hora = agora.toTimeString().slice(0, 8);

  return emTransacao(async (executar) => {
    const loja = await dadosDaLoja(executar, colunasParametro);
    const cliente = await clienteDoPedido(executar, orcamento.cliente);
    const pagamentoSolus = await formaDePagamentoDoSolus(executar, pagamento.formaDePagamento);
    const interestadual = Boolean(cliente.uf && loja.uf && cliente.uf !== loja.uf);
    const cfopDaLoja = String(natureza || (interestadual ? loja.cfopInter : loja.cfop));

    // cada produto e lido de novo do cadastro: o barras exatamente como esta
    // gravado, a tributacao, o custo e o preco de tabela de agora
    const linhas = [];
    for (const item of itens) {
      const produto = await produtoDoCadastro(executar, item.produto, colunasProduto);
      const quantidade = Number(item.quantidade) || 0;
      const preco = Number(item.precoUnitario) || 0;
      linhas.push({ produto, quantidade, preco, total: arredondar(preco * quantidade) });
    }

    const totalItens = arredondar(linhas.reduce((soma, l) => soma + l.total, 0));
    const total = arredondar(totalItens + frete);
    const custoTotal = arredondar(linhas.reduce((soma, l) => soma + l.quantidade * l.produto.custo, 0));
    // operador sem codigo de vendedor: o Solus usa o vendedor padrao da loja
    const vendedor = String(pagamento.codigoVendedor || operador?.codigoVendedor || loja.vendedor || '').trim();
    const nomeVendedor = String(pagamento.vendedor || nomeOperador).trim();
    // o Solus nao usa o campo ENTREGA (vazio em 20 mil pedidos) e pode querer ler
    // data dele: o prazo de entrega vai junto da observacao, que aparece na tela
    const observacao = [pagamento.observacao, pagamento.entrega ? `Entrega: ${pagamento.entrega}` : '']
      .map((t) => String(t || '').trim()).filter(Boolean).join(' - ');

    const numero = await reservarNumero(executar);

    // ---- cabecalho -------------------------------------------------------
    const cabecalho = {
      NUMERO: numero,
      STATUS: 'ORCAMENTO',
      CODEMPRESA: '',
      CODCLIENTE: cliente.codigo.slice(0, 5),
      NOMECLI: gravarTexto(cliente.nome.slice(0, 50)),
      CPFCNPJ: cliente.cpfCnpj.slice(0, 20),
      RUA: gravarTexto(cliente.rua.slice(0, 50)),
      NUM: cliente.numero.slice(0, 10),
      BAIRRO: gravarTexto(cliente.bairro.slice(0, 30)),
      CIDADE: gravarTexto(cliente.cidade.slice(0, 30)),
      FONE: cliente.telefone.slice(0, 20),
      EMISSAO: hoje,
      DTDIGITA: hoje,
      DTENTREGA: hoje,
      DATAVENDA: agora,
      USUARIO: nomeOperador.slice(0, 40),
      DIGITADO: nomeOperador.slice(0, 20),
      TOTALITENS: paraTextoBR(totalItens),
      TOTITENS: totalItens,
      TOTALPECAS: paraTextoBR(totalItens),
      TOTALPEDIDOTABELA: paraTextoBR(totalItens),
      TOTALPEDIDO: paraTextoBR(total),
      TOTPEDIDO: total,
      TOTALPEDIDOTAB: paraTextoBR(total),
      TOTPEDIDOTAB: total,
      JUROS1: 0,
      DESCONTO1: 0,
      CUSTOVENDA: custoDaVenda(custoTotal, totalItens),
      ATUALIZA: 'S',
      PDV: '0',
      CODABERTURA: 0,
      ST: ' ',
      IMPRESSO: 'F',
      RETENCAOISS: 'S',
      MARCA: '',
      OS: '',
      PLACA: '',
      MODELO: '',
      ROTA: '',
      GARANTIA: '',
      NATUREZA: cfopDaLoja.slice(0, 6),

      // pagamento e entrega, para o Solus ja abrir a venda preenchida
      TIPOVENDA: pagamentoSolus.bytes,
      PRAZO: String(pagamento.prazo ?? '0').slice(0, 4),
      FRETE: paraTextoBR(frete),
      MODALIDADEFRETE: frete > 0 ? String(pagamento.modalidadeFrete ?? '0').slice(0, 1) : undefined,
      OBS1: observacao ? gravarTexto(observacao.slice(0, 100)) : undefined,
      VENDEDOR: vendedor.slice(0, 6),
      NOMEVENDEDOR: gravarTexto(nomeVendedor.slice(0, 40)),
    };
    for (const campo of ZERADOS_PEDIDO) cabecalho[campo] ??= '0,00';

    await inserir(executar, 'PEDIDOS', colunasPedido, cabecalho);

    // ---- itens -----------------------------------------------------------
    let posicao = 0;
    for (const { produto, quantidade, preco, total: totalDoItem } of linhas) {
      posicao += 1;
      const comST = TRIBUTACAO_COM_ST.has(produto.tributacao);
      const linhaDoItem = {
        NUMERO: numero,
        ITEM: posicao,
        STATUS: 'ORCAMENTO',
        PRODUTO: produto.chave.slice(0, 40),
        DESCRICAO: produto.descricao.subarray(0, 70),
        QTD: quantidadeParaSolus(quantidade),
        QTD1: quantidade,
        PRECO: paraTextoBR(preco),
        PRECOVENDA: preco,
        PRECOTABELA: paraTextoBR(preco),
        PRECOCHEIO: paraTextoBR(produto.precoDeTabela),
        TOTALITEM: paraTextoBR(totalDoItem),
        TOT: totalDoItem,
        TOTALPRECOTABELA: paraTextoBR(totalDoItem),
        PRECOCUSTO: produto.custo,
        DESCITEM: 0,
        TRIBUTACAO: produto.tributacao.slice(0, 6),
        NATUREZA: (comST ? (interestadual ? '6403' : '5405') : cfopDaLoja).slice(0, 6),
        CLASSIFICA: (produto.classifica || 'V').slice(0, 1),
        DATA: hoje,
        HORA: hora,
        HOR: hora.slice(0, 2),
        USUARIO: nomeOperador.slice(0, 40),
        VENDEDOR: vendedor.slice(0, 5),
        NOMEVENDEDOR: gravarTexto(nomeVendedor.slice(0, 40)),
        CODABERTURA: 0,
        TIPOVENDA: '',
        PROMOCAO: ' ',
        CONTROLE: 'V',
        FECHA: 'S',
        LOTE: '',
        LOTEA: '',
        COMPLE: '',
      };
      for (const campo of ZERADOS_ITEM) linhaDoItem[campo] ??= '0,00';

      await inserir(executar, 'ITEMPEDIDO', colunasItem, linhaDoItem);
    }

    return {
      numero,
      total,
      totalItens,
      frete,
      quantidadeItens: linhas.length,
      cliente: orcamento.cliente ? cliente.nome : 'CONSUMIDOR',
      codigoCliente: orcamento.cliente ? cliente.codigo : '',
      formaDePagamento: pagamentoSolus.nome,
    };
  });
}

/**
 * Proximo numero de pedido, do jeito que o Solus controla (tabela CODVENDA).
 * PEDIDOS nao tem chave unica no banco: se o contador estiver atrasado, dois
 * pedidos sairiam com o mesmo numero sem erro nenhum. Por isso pula o que ja existe.
 */
async function reservarNumero(executar) {
  const linhas = await executar('SELECT FIRST 1 NUMERO FROM CODVENDA');
  let numero = Math.trunc(paraNumero(linhas[0]?.NUMERO));
  if (!numero) throw new Error('Nao consegui descobrir o proximo numero de pedido do Solus.');

  for (let tentativa = 0; tentativa < 1000; tentativa += 1) {
    const usado = await executar('SELECT FIRST 1 NUMERO FROM PEDIDOS WHERE NUMERO = ?', [numero]);
    if (!usado.length) break;
    numero += 1;
  }

  // avanca o contador logo, e nao no fim: a linha fica presa nesta gravacao e o
  // Solus nao pega o mesmo numero se gravar um pedido ao mesmo tempo
  await executar('UPDATE CODVENDA SET NUMERO = ?', [numero + 1]);
  return numero;
}

/** CFOP, UF e vendedor padrao da loja (tabela PARAMETRO). */
async function dadosDaLoja(executar, colunas) {
  const campos = ['CFOP', 'CFOPINTER', 'UF', 'VENDEDOR'].filter((c) => colunas.has(c));
  let linha = {};
  if (campos.length) {
    linha = (await executar(`SELECT FIRST 1 ${campos.join(', ')} FROM PARAMETRO`))[0] || {};
  }
  const cfop = (valor) => {
    const numeros = String(valor ?? '').replace(/\D/g, '');
    return numeros.length === 4 ? numeros : '';
  };
  return {
    cfop: cfop(linha.CFOP) || '5102',
    cfopInter: cfop(linha.CFOPINTER) || '6102',
    uf: String(linha.UF ?? '').trim().toUpperCase(),
    vendedor: String(linha.VENDEDOR ?? '').trim(),
  };
}

const CAMPOS_CLIENTE = `CODIGO, ${campoTexto('NOME', 50)}, CPFCNPJ, ${campoTexto('RUA', 60)}, NUMERO,
  ${campoTexto('BAIRRO', 70)}, ${campoTexto('CIDADE', 30)}, UF, TELEFONE, CELULAR`;

/**
 * O cliente como esta no cadastro (o Solus copia nome, documento e endereco para
 * o pedido). Sem cliente, vai o cadastro CONSUMIDOR do Solus - e nao codigo vazio.
 */
async function clienteDoPedido(executar, cliente) {
  const codigo = String(cliente?.codigo || '').trim();
  let linha = null;
  try {
    linha = codigo
      ? (await executar(`SELECT FIRST 1 ${CAMPOS_CLIENTE} FROM CLIENTES WHERE CODIGO = ?`, [codigo]))[0]
      : (await executar(`SELECT FIRST 1 ${CAMPOS_CLIENTE} FROM CLIENTES
          WHERE UPPER(TRIM(NOME)) = 'CONSUMIDOR' ORDER BY CODIGO`))[0];
  } catch { /* cadastro fora do padrao: fica com o que veio da tela */ }

  const texto = (valor) => String(valor ?? '').trim();
  if (linha) {
    return {
      codigo: texto(linha.CODIGO),
      nome: lerTexto(linha.NOME) || texto(cliente?.nome) || 'CONSUMIDOR',
      cpfCnpj: texto(linha.CPFCNPJ),
      rua: lerTexto(linha.RUA),
      numero: texto(linha.NUMERO),
      bairro: lerTexto(linha.BAIRRO),
      cidade: lerTexto(linha.CIDADE),
      uf: texto(linha.UF).toUpperCase(),
      telefone: texto(linha.TELEFONE) || texto(linha.CELULAR),
    };
  }
  return {
    codigo,
    nome: texto(cliente?.nome) || 'CONSUMIDOR',
    cpfCnpj: texto(cliente?.cpfCnpj),
    rua: texto(cliente?.rua),
    numero: texto(cliente?.numero),
    bairro: texto(cliente?.bairro),
    cidade: texto(cliente?.cidade),
    uf: texto(cliente?.uf).toUpperCase(),
    telefone: texto(cliente?.telefone) || texto(cliente?.celular),
  };
}

/**
 * O produto lido de novo do cadastro, dentro da gravacao.
 * O barras vai EXATAMENTE como esta gravado: tem loja com "02.01.06.0076", e o
 * Solus procura o item do orcamento por ele. So os digitos nao achavam o produto.
 */
async function produtoDoCadastro(executar, produto, colunas) {
  const codigo = String(produto?.codigo || '').trim();
  const campos = ['BARRAS', 'TRIBUTARIA', 'CLASSIFICA', 'PRECOVENDA', 'PV', 'PRECOCUSTO', 'PC']
    .filter((c) => colunas.has(c));
  const linha = codigo
    ? (await executar(
      `SELECT FIRST 1 ${[campoTexto('DESCRICAO', 70), ...campos].join(', ')} FROM PRODUTO WHERE CODIGO = ?`,
      [codigo]))[0]
    : null;
  if (!linha) {
    throw new Error(`O produto "${produto?.descricao || codigo}" nao existe mais no cadastro do Solus. `
      + 'Tire ele do orcamento (ou escolha outro) e grave de novo.');
  }

  return {
    codigo,
    chave: String(linha.BARRAS ?? '').trim() || codigo,
    // os bytes como o Solus gravou: nenhum acento muda no caminho
    descricao: Buffer.isBuffer(linha.DESCRICAO) ? linha.DESCRICAO : gravarTexto(lerTexto(linha.DESCRICAO)),
    tributacao: String(linha.TRIBUTARIA ?? '').trim(),
    classifica: String(linha.CLASSIFICA ?? '').trim(),
    precoDeTabela: paraNumero(linha.PRECOVENDA ?? linha.PV),
    custo: paraNumero(linha.PRECOCUSTO ?? linha.PC),
  };
}

/**
 * A forma de pagamento com o nome EXATO da tabela CONDICAO (o Solus procura por ele).
 * " DINHEIRO" comeca com espaco, e a tela recebia o nome ja sem o espaco: gravava
 * "DINHEIRO", que nao existe. Sem forma escolhida vai DINHEIRO, o padrao do Solus
 * (ele nunca deixa esse campo vazio).
 */
async function formaDePagamentoDoSolus(executar, escolhida) {
  let formas = [];
  try {
    const linhas = await executar(
      `SELECT ${campoTexto('DESCRICAO', 15)}, STATUS FROM CONDICAO
        WHERE DESCRICAO IS NOT NULL AND DESCRICAO <> ''`);
    formas = linhas.map((l) => {
      const bytes = Buffer.isBuffer(l.DESCRICAO) ? l.DESCRICAO : gravarTexto(l.DESCRICAO);
      return {
        bytes,
        nome: lerTexto(bytes),
        cancelada: String(l.STATUS ?? '').trim().toUpperCase() === 'CANCELADO',
      };
    });
  } catch { /* banco sem CONDICAO: grava como veio */ }

  const procurada = String(escolhida || '').trim().toUpperCase();
  const achada = procurada
    ? formas.find((f) => f.nome.toUpperCase() === procurada)
    : formas.find((f) => !f.cancelada && f.nome.toUpperCase() === 'DINHEIRO');
  if (achada) return { bytes: achada.bytes, nome: achada.nome };

  const nome = String(escolhida || '').trim();
  return { bytes: gravarTexto(nome.slice(0, 15)), nome };
}

/**
 * "-00-128.57-00-68.81-00-53.52" = custo, lucro e margem (%) da venda, com ponto.
 * E o formato que o Solus grava (e mostra como "custo da venda").
 */
function custoDaVenda(custo, venda) {
  const lucro = venda - custo;
  const margem = custo > 0 ? (lucro / custo) * 100 : 0;
  return [custo, lucro, margem].map((n) => `-00-${n.toFixed(2)}`).join('').slice(0, 50);
}

/**
 * Quantidade como o Solus grava: "2" (inteiro, sem ",00") e "1,5" no fracionado.
 * O campo tem 6 letras: com ",00" a quantidade 1000 virava "1000,00" e o
 * orcamento inteiro era recusado.
 */
export function quantidadeParaSolus(quantidade) {
  const numero = Number(quantidade) || 0;
  if (Number.isInteger(numero)) return String(numero);
  for (let casas = 3; casas >= 0; casas -= 1) {
    const texto = String(Number(numero.toFixed(casas))).replace('.', ',');
    if (texto.length <= 6) return texto;
  }
  return String(Math.round(numero));
}

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
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
