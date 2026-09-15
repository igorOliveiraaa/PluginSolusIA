// Monta o orcamento a partir da lista do cliente.
//
// O pulo do gato aqui: o cliente escreve do jeito dele ("copo de agua", "detergente",
// "saco de lixo grande") e o catalogo tem outro nome ("COPO DESCARTAVEL 200ML PCT C/100").
// Entao a ferramenta NAO tenta adivinhar sozinha quando fica em duvida: ela mostra as
// opcoes e pergunta. Chutar produto errado em orcamento vira preco errado para o cliente.
//
// Quem procura e ordena e o indice do catalogo (`db/catalogo.js`): ignora acento e
// cedilha, entende "5LT" = "5 litros", aguenta erro de digitacao e poe na frente o
// que a loja mais vende e o que saiu por ultimo. Na duvida, o que ESTE cliente ja
// comprou vem antes de tudo.

import { buscarPorBarras, buscarPorDescricao, buscarPorCodigo } from '../db/produtos.js';
import { chavesDoProduto, codigosDasChaves } from '../db/catalogo.js';
import { ultimoPrecoDoCliente, ultimoPrecoDaLoja, ultimasCompras } from '../db/clientes.js';

// acima disso, casou com quase tudo que foi pedido e pode escolher sozinho
const COBERTURA_SUFICIENTE = 0.85;
// diferenca minima para o primeiro ser "claramente melhor" que o segundo
const DISTANCIA_SEGURA = 0.15;

/** Junta descricao + marca + tamanho no texto que vai para a busca. */
function textoDeBusca(item) {
  return [item.descricao, item.marca, item.tamanho].filter(Boolean).join(' ').trim();
}

/**
 * Procura os candidatos de um item no catalogo.
 * Devolve o escolhido (quando da para ter certeza) e sempre a lista de opcoes.
 */
async function procurarCandidatos(item, preferidos) {
  // 1) se o cliente mandou um codigo de barras, acabou a duvida
  const digitos = String(item.descricao || '').replace(/\D/g, '');
  if (digitos.length >= 12) {
    const porBarras = await buscarPorBarras(digitos);
    if (porBarras) {
      return { escolhido: porBarras, opcoes: [porBarras], certeza: 'alta', comoAchou: 'código de barras' };
    }
  }

  // 2) busca no catalogo, ja com o historico do cliente pesando na ordem
  // sugestao automatica: produto parado ha mais de 2 anos nao entra
  const candidatos = await buscarPorDescricao(textoDeBusca(item), 8, {
    preferir: preferidos,
    esconderParados: true,
  });
  if (!candidatos.length) {
    return { escolhido: null, opcoes: [], certeza: 'nenhuma', comoAchou: 'não encontrado' };
  }

  const melhor = candidatos[0];
  const segundo = candidatos[1];
  const jaComprou = preferidos.includes(melhor.codigo);

  const claramenteMelhor = !segundo || (melhor.nota - segundo.nota) >= DISTANCIA_SEGURA;
  const casouQuaseTudo = melhor.cobertura >= COBERTURA_SUFICIENTE;

  // so decide sozinho quando casou o que foi pedido E nao ha empate com outro
  if (casouQuaseTudo && (claramenteMelhor || jaComprou)) {
    return {
      escolhido: melhor,
      opcoes: candidatos.slice(0, 6),
      certeza: 'alta',
      comoAchou: jaComprou ? 'esse cliente já levou' : 'nome parecido',
    };
  }

  return {
    escolhido: null,
    opcoes: candidatos.slice(0, 6),
    certeza: casouQuaseTudo ? 'empate' : 'baixa',
    comoAchou: 'precisa escolher',
  };
}

// ---------------------------------------------------------------------------
// Um item pronto para a tela
// ---------------------------------------------------------------------------

/** O que este cliente pagou, e o que a loja praticou, neste produto. */
async function precosDeReferencia(produto, cliente) {
  if (!produto) return { doCliente: null, daLoja: null };
  const chaves = chavesDoProduto(produto);
  const doCliente = cliente?.codigo ? await ultimoPrecoDoCliente(cliente.codigo, chaves) : null;
  const daLoja = await ultimoPrecoDaLoja(chaves);
  return { doCliente, daLoja };
}

function avisosDoItem({ produto, quantidade, precoTabela, ultimoDoCliente, confianca, textoOriginal }) {
  const avisos = [];
  if (!produto) {
    if (confianca === 'baixa') {
      avisos.push({ tipo: 'leitura', texto: `Não deu para ler direito: "${textoOriginal}".` });
    }
    return avisos;
  }

  if (produto.estoque <= 0) {
    avisos.push({ tipo: 'estoque', texto: `Sem estoque no sistema (${produto.estoque}).` });
  } else if (produto.estoque < quantidade) {
    avisos.push({
      tipo: 'estoque',
      texto: `O cliente pediu ${quantidade} e tem ${produto.estoque} em estoque.`,
    });
  }
  if (precoTabela <= 0) {
    avisos.push({ tipo: 'preco', texto: 'Esse produto está sem preço de venda no cadastro.' });
  }
  if (ultimoDoCliente && precoTabela > 0 && ultimoDoCliente.preco > 0) {
    const diferenca = ((precoTabela - ultimoDoCliente.preco) / ultimoDoCliente.preco) * 100;
    if (Math.abs(diferenca) >= 5) {
      avisos.push({
        tipo: 'historico',
        texto: `Da última vez esse cliente pagou R$ ${ultimoDoCliente.preco.toFixed(2).replace('.', ',')} `
          + `(hoje está ${Math.abs(diferenca).toFixed(0)}% mais ${diferenca > 0 ? 'caro' : 'barato'}).`,
      });
    }
  }
  if (produto.cancelado) {
    avisos.push({ tipo: 'cancelado', texto: 'Esse produto está CANCELADO no Solus.' });
  }
  if (confianca === 'baixa') {
    avisos.push({ tipo: 'leitura', texto: `Não deu para ler direito: "${textoOriginal}".` });
  }
  return avisos;
}

/**
 * Monta (ou remonta) UM item com o produto ja escolhido.
 * Usada nos tres caminhos - montar a lista, escolher na tela e adicionar na mao -
 * para que os tres mostrem exatamente as mesmas informacoes. Antes, escolher na
 * tela deixava "esse cliente pagou", custo e margem vazios.
 */
export async function montarItemComProduto({
  base, produto, cliente, mostrarCusto = false, precoUnitario, comoAchou, opcoes,
}) {
  // a quantidade "crua" que a pessoa pediu fica guardada: se o item nasceu sem
  // produto ("7,77 tapete") e depois virou tapete por m2, a virgula nao se perde
  const pedida = base?.quantidadePedida ?? base?.quantidade;
  const quantidade = ajustarQuantidade(pedida, produto, 1);
  const { doCliente, daLoja } = await precosDeReferencia(produto, cliente);

  const precoTabela = produto?.vendaAtual || 0;
  const preco = precoUnitario !== undefined && precoUnitario !== null
    ? Number(precoUnitario)
    : precoTabela;
  const custo = mostrarCusto ? (produto?.custoAtual || 0) : null;

  return {
    ...base,
    produto,
    opcoes: opcoes || base?.opcoes || (produto ? [produto] : []),
    certeza: produto ? 'alta' : (base?.certeza || 'baixa'),
    comoAchou: comoAchou || base?.comoAchou || '',
    precisaEscolher: !produto,
    quantidade,
    quantidadePedida: pedida,
    fracionado: vendeFracionado(produto),
    precoUnitario: preco,
    precoTabela,
    custo,
    margem: mostrarCusto && produto?.custoAtual > 0
      ? ((preco - produto.custoAtual) / produto.custoAtual) * 100
      : null,
    ultimoPrecoCliente: doCliente,
    ultimoPrecoLoja: daLoja,
    total: arredondar(preco * quantidade),
    avisos: avisosDoItem({
      produto,
      quantidade,
      precoTabela,
      ultimoDoCliente: doCliente,
      confianca: base?.confianca,
      textoOriginal: base?.textoOriginal || base?.descricao || '',
    }),
    incluir: Boolean(produto),
  };
}

// ---------------------------------------------------------------------------
// O orcamento inteiro
// ---------------------------------------------------------------------------

/** Codigos que este cliente ja comprou - na duvida, sao eles que ganham. */
async function produtosQueOClienteJaLevou(cliente) {
  if (!cliente?.codigo) return { preferidos: [], compras: [] };
  const compras = await ultimasCompras(cliente.codigo, 120);
  const preferidos = await codigosDasChaves(compras.map((c) => c.produto)).catch(() => []);
  return { preferidos, compras };
}

/**
 * Monta o orcamento inteiro.
 * `lista` vem da IA (ou digitada), `cliente` pode ser null (consumidor).
 */
export async function montarOrcamento({ lista, cliente, nomeCliente = '', mostrarCusto = false }) {
  const { preferidos } = await produtosQueOClienteJaLevou(cliente);

  const itens = [];
  for (const bruto of lista.itens) {
    const achado = await procurarCandidatos(bruto, preferidos);
    const item = await montarItemComProduto({
      base: { ...bruto, numero: itens.length + 1 },
      produto: achado.escolhido,
      cliente,
      mostrarCusto,
      comoAchou: achado.comoAchou,
      opcoes: achado.opcoes,
    });
    item.certeza = achado.certeza;
    itens.push(item);
  }

  return {
    cliente,
    nomeCliente: cliente ? '' : limparNomeLivre(nomeCliente),
    itens,
    preferidos,
    observacoesDaLista: lista.observacoes || '',
    clienteCitado: lista.clienteCitado || '',
    resumo: resumir(itens),
  };
}

/**
 * Troca o cliente de um orcamento ja montado e refaz o historico de preco de
 * todos os itens. E o que faz "escolhi o cliente depois" funcionar.
 */
export async function trocarClienteDoOrcamento(orcamento, cliente, mostrarCusto = false, nomeCliente = '') {
  orcamento.cliente = cliente || null;
  // nome sem cadastro so vale quando nao ha cliente do Solus escolhido
  orcamento.nomeCliente = cliente ? '' : limparNomeLivre(nomeCliente);
  orcamento.preferidos = (await produtosQueOClienteJaLevou(cliente)).preferidos;

  for (let i = 0; i < orcamento.itens.length; i += 1) {
    const item = orcamento.itens[i];
    if (!item.produto) continue;
    orcamento.itens[i] = await montarItemComProduto({
      base: item,
      produto: item.produto,
      cliente,
      mostrarCusto,
      precoUnitario: item.precoUnitario,
      comoAchou: item.comoAchou,
      opcoes: item.opcoes,
    });
    orcamento.itens[i].incluir = item.incluir;
  }

  orcamento.resumo = resumir(orcamento.itens);
  return orcamento;
}

export function resumir(itens) {
  const incluidos = itens.filter((i) => i.incluir && i.produto);
  return {
    totalItens: itens.length,
    precisamEscolha: itens.filter((i) => i.precisaEscolher).length,
    semEstoque: itens.filter((i) => i.produto && i.produto.estoque <= 0).length,
    total: arredondar(incluidos.reduce((soma, i) => soma + (i.total || 0), 0)),
  };
}

/** Recalcula um item quando o operador muda preco ou quantidade. */
export function recalcularItem(item, { quantidade, precoUnitario, mostrarCusto }) {
  const qtd = quantidade !== undefined
    ? ajustarQuantidade(quantidade, item.produto, item.quantidade)
    : item.quantidade;

  const pedido = precoUnitario !== undefined ? Number(precoUnitario) : item.precoUnitario;
  const preco = Number.isFinite(pedido) && pedido >= 0 ? pedido : item.precoUnitario;

  return {
    ...item,
    quantidade: qtd,
    quantidadePedida: qtd,
    fracionado: vendeFracionado(item.produto),
    precoUnitario: preco,
    total: arredondar(preco * qtd),
    margem: mostrarCusto && item.produto?.custoAtual > 0
      ? ((preco - item.produto.custoAtual) / item.produto.custoAtual) * 100
      : item.margem,
  };
}

/**
 * Nome digitado para quem nao tem cadastro ("Dona Maria", "Escola Estadual X").
 * No Solus o orcamento entra como CONSUMIDOR; o nome sai no PDF, no Excel e no
 * nome do arquivo - que e o que o cliente ve.
 */
export function limparNomeLivre(nome) {
  return String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** O nome que aparece para o cliente: cadastro > nome digitado > CONSUMIDOR. */
export function nomeDoClienteDoOrcamento(orcamento) {
  return orcamento?.cliente?.nome || orcamento?.nomeCliente || 'CONSUMIDOR';
}

/** "orcamento-123-dona-maria.pdf": da para achar o arquivo pelo nome do cliente. */
export function nomeDoArquivoDoOrcamento(orcamento, extensao) {
  const nome = nomeDoClienteDoOrcamento(orcamento);
  const pedaco = nome === 'CONSUMIDOR' ? '' : '-' + nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `orcamento-${orcamento?.numero || 'sem-numero'}${pedaco}.${extensao}`;
}

// Unidades em que a loja vende pedaco: tapete por m2, mangueira por metro,
// produto a granel por litro ou quilo. So essas aceitam quantidade com virgula.
const UNIDADES_FRACIONADAS = new Set(['M2', 'M²', 'M', 'MT', 'MTS', 'METRO', 'KG', 'G', 'GR', 'L', 'LT', 'LTS', 'ML']);

/** O produto e vendido em pedaco (m², metro, kg, litro)? */
export function vendeFracionado(produto) {
  if (!produto) return false;
  const unidade = String(produto.unidade || '').toUpperCase().trim();
  if (UNIDADES_FRACIONADAS.has(unidade)) return true;
  // o tapete personalizado costuma estar como UN, mas com "M2" no nome
  return /(^|\s)M2(\s|$)|M²/.test(String(produto.descricao || '').toUpperCase());
}

/**
 * Quantidade do orcamento: numero inteiro (1, 2, 10), porque a loja vende por
 * unidade - "2,5 detergentes" nao existe. A excecao e o que se vende em pedaco.
 * Valor invalido (vazio, negativo, "dez") mantem o `reserva`.
 */
export function ajustarQuantidade(valor, produto, reserva = 1) {
  const numero = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) return reserva;
  if (vendeFracionado(produto)) return Math.round(numero * 100) / 100;
  return Math.max(1, Math.round(numero));
}

/** Procura um produto pelo codigo, aceitando tambem codigo de barras. */
export async function produtoPorCodigoOuBarras(codigo) {
  const texto = String(codigo || '').trim();
  if (!texto) return null;
  return (await buscarPorCodigo(texto)) || (await buscarPorBarras(texto));
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) || 0) * fator) / fator;
}
