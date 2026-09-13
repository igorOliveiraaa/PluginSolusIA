// Monta o orcamento a partir da lista do cliente.
//
// O pulo do gato aqui: o cliente escreve do jeito dele ("copo de agua", "detergente",
// "saco de lixo grande") e o catalogo tem outro nome ("COPO DESCARTAVEL 200ML PCT C/100").
// Entao a ferramenta NAO tenta adivinhar sozinha quando fica em duvida: ela mostra as
// opcoes e pergunta. Chutar produto errado em orcamento vira preco errado para o cliente.

import { buscarPorBarras, buscarPorDescricao, buscarPorCodigo, semelhanca, normalizarTexto } from '../db/produtos.js';
import { ultimoPrecoDoCliente, ultimoPrecoDaLoja, ultimasCompras } from '../db/clientes.js';

// acima disso, e a mesma coisa e pode escolher sozinho
const CERTEZA_SUFICIENTE = 0.72;
// diferenca minima para o primeiro ser "claramente melhor" que o segundo
const DISTANCIA_SEGURA = 0.18;

/** Junta descricao + marca + tamanho no texto que vai para a busca. */
function textoDeBusca(item) {
  return [item.descricao, item.marca, item.tamanho].filter(Boolean).join(' ').trim();
}

/**
 * Da uma nota melhor ao candidato quando marca e tamanho batem.
 * "detergente ype 500ml" tem que ganhar de "detergente limpol 500ml".
 */
function pontuar(item, produto) {
  let nota = semelhanca(textoDeBusca(item), produto.descricao);

  const alvo = normalizarTexto(produto.descricao);
  if (item.marca && alvo.includes(normalizarTexto(item.marca))) nota += 0.15;
  if (item.tamanho) {
    // o cliente escreve "100 litros" e o catalogo tem "100 LT": compara pelos
    // dois jeitos, com a unidade por extenso e abreviada
    const semEspaco = (texto) => normalizarTexto(texto).replace(/\s/g, '');
    const abreviar = (texto) => semEspaco(texto)
      .replace(/LITROS?/g, 'LT')
      .replace(/MILILITROS?/g, 'ML')
      .replace(/QUILOS?|KILOS?|QUILOGRAMAS?/g, 'KG')
      .replace(/GRAMAS?/g, 'G')
      .replace(/METROS?/g, 'M');

    const alvoSemEspaco = semEspaco(produto.descricao);
    const alvoAbreviado = abreviar(produto.descricao);
    const tamanho = semEspaco(item.tamanho);
    const tamanhoAbreviado = abreviar(item.tamanho);

    if ((tamanho && alvoSemEspaco.includes(tamanho))
      || (tamanhoAbreviado && alvoAbreviado.includes(tamanhoAbreviado))) {
      nota += 0.2;
    }
  }

  // No catalogo o nome comeca pelo tipo do produto ("COPO DESC. AGUA 180ML"),
  // entao quem COMECA com o que o cliente pediu costuma ser o certo -
  // e nao um acessorio que so cita o produto ("LIXEIRA P/ COPO DE AGUA").
  const pedido = normalizarTexto(item.descricao);
  const primeiraPalavra = pedido.split(' ')[0];
  if (primeiraPalavra && primeiraPalavra.length >= 3) {
    if (alvo.startsWith(primeiraPalavra)) nota += 0.18;
  }
  // acessorio de outra coisa costuma ter "P/" ou "PARA" no nome
  if (/\bP\/|\bPARA\b|SUPORTE|DISPENSER|LIXEIRA/.test(alvo) && !/P\/|PARA|SUPORTE|DISPENSER|LIXEIRA/.test(pedido)) {
    nota -= 0.12;
  }

  // produto sem estoque continua aparecendo, mas perde um pouco de prioridade
  if (produto.estoque <= 0) nota -= 0.05;
  if (produto.cancelado) nota -= 0.5;

  return Math.min(Math.max(nota, 0), 1);
}

/**
 * Procura os candidatos de um item no catalogo.
 * Devolve o escolhido (quando da para ter certeza) e sempre a lista de opcoes.
 */
async function procurarCandidatos(item, comprasAnteriores) {
  // 1) se o cliente mandou um codigo de barras, acabou a duvida
  const digitos = String(item.descricao || '').replace(/\D/g, '');
  if (digitos.length >= 12) {
    const porBarras = await buscarPorBarras(digitos);
    if (porBarras) {
      return { escolhido: porBarras, opcoes: [porBarras], certeza: 'alta', comoAchou: 'codigo de barras' };
    }
  }

  // 2) o cliente ja comprou algo parecido antes? isso costuma matar a duvida
  const doHistorico = comprasAnteriores
    .map((compra) => ({ compra, nota: semelhanca(textoDeBusca(item), compra.descricao) }))
    .filter((x) => x.nota >= 0.6)
    .sort((a, b) => b.nota - a.nota)[0];

  // 3) busca no catalogo pelo nome
  const candidatos = await buscarPorDescricao(textoDeBusca(item), 12);

  if (doHistorico) {
    // traz tambem o produto exato que ele levou da outra vez
    const jaComprado = await buscarPorBarras(doHistorico.compra.produto)
      || await buscarPorCodigo(doHistorico.compra.produto);
    if (jaComprado && !candidatos.some((c) => c.codigo === jaComprado.codigo)) {
      candidatos.unshift(jaComprado);
    }
  }

  if (!candidatos.length) {
    return { escolhido: null, opcoes: [], certeza: 'nenhuma', comoAchou: 'nao encontrado' };
  }

  const ordenados = candidatos
    .map((produto) => {
      let nota = pontuar(item, produto);
      // se foi esse mesmo que o cliente levou da ultima vez, ganha bastante peso
      if (doHistorico && (produto.barras === doHistorico.compra.produto
        || produto.codigo === doHistorico.compra.produto)) {
        nota = Math.min(nota + 0.25, 1);
      }
      return { produto, nota };
    })
    .sort((a, b) => b.nota - a.nota);

  const melhor = ordenados[0];
  const segundo = ordenados[1];

  const claramenteMelhor = !segundo || (melhor.nota - segundo.nota) >= DISTANCIA_SEGURA;
  const bomOSuficiente = melhor.nota >= CERTEZA_SUFICIENTE;

  // so decide sozinho quando esta seguro E nao ha empate com outro produto
  if (bomOSuficiente && claramenteMelhor) {
    return {
      escolhido: melhor.produto,
      opcoes: ordenados.slice(0, 6).map((o) => o.produto),
      certeza: 'alta',
      comoAchou: doHistorico ? 'ja comprou antes' : 'nome parecido',
    };
  }

  return {
    escolhido: null,
    opcoes: ordenados.slice(0, 6).map((o) => o.produto),
    certeza: bomOSuficiente ? 'empate' : 'baixa',
    comoAchou: 'precisa escolher',
  };
}

/**
 * Monta o orcamento inteiro.
 * `lista` vem da IA (ou digitada), `cliente` pode ser null (consumidor).
 */
export async function montarOrcamento({ lista, cliente, mostrarCusto = false }) {
  const comprasAnteriores = cliente?.codigo ? await ultimasCompras(cliente.codigo, 60) : [];

  const itens = [];
  for (const bruto of lista.itens) {
    const achado = await procurarCandidatos(bruto, comprasAnteriores);
    const produto = achado.escolhido;

    // preco que esse cliente pagou da ultima vez neste produto
    let ultimoDoCliente = null;
    let ultimoDaLoja = null;
    if (produto && cliente?.codigo) {
      const chave = produto.barras || produto.codigo;
      ultimoDoCliente = await ultimoPrecoDoCliente(cliente.codigo, chave);
      if (!ultimoDoCliente) ultimoDaLoja = await ultimoPrecoDaLoja(chave);
    } else if (produto) {
      ultimoDaLoja = await ultimoPrecoDaLoja(produto.barras || produto.codigo);
    }

    const precoTabela = produto?.vendaAtual || 0;
    // sugere o preco de tabela; se o cliente ja tem um preco praticado, avisa a diferenca
    const precoSugerido = precoTabela;

    const avisos = [];
    if (produto) {
      if (produto.estoque <= 0) {
        avisos.push({ tipo: 'estoque', texto: `Sem estoque no sistema (${produto.estoque}).` });
      } else if (produto.estoque < bruto.quantidade) {
        avisos.push({
          tipo: 'estoque',
          texto: `O cliente pediu ${bruto.quantidade} e tem ${produto.estoque} em estoque.`,
        });
      }
      if (precoTabela <= 0) {
        avisos.push({ tipo: 'preco', texto: 'Esse produto esta sem preco de venda no cadastro.' });
      }
      if (ultimoDoCliente && precoTabela > 0) {
        const diferenca = ((precoTabela - ultimoDoCliente.preco) / ultimoDoCliente.preco) * 100;
        if (Math.abs(diferenca) >= 5) {
          avisos.push({
            tipo: 'historico',
            texto: `Da ultima vez esse cliente pagou R$ ${ultimoDoCliente.preco.toFixed(2)} `
              + `(${diferenca > 0 ? 'hoje esta ' + diferenca.toFixed(0) + '% mais caro' : 'hoje esta ' + Math.abs(diferenca).toFixed(0) + '% mais barato'}).`,
          });
        }
      }
      if (produto.cancelado) {
        avisos.push({ tipo: 'cancelado', texto: 'Esse produto esta CANCELADO no Solus.' });
      }
    }
    if (bruto.confianca === 'baixa') {
      avisos.push({ tipo: 'leitura', texto: `Nao deu para ler direito: "${bruto.textoOriginal}".` });
    }

    itens.push({
      ...bruto,
      produto,
      opcoes: achado.opcoes,
      certeza: achado.certeza,
      comoAchou: achado.comoAchou,
      precisaEscolher: !produto,
      quantidade: bruto.quantidade,
      precoUnitario: precoSugerido,
      precoTabela,
      custo: mostrarCusto ? (produto?.custoAtual || 0) : null,
      margem: mostrarCusto && produto?.custoAtual > 0
        ? ((precoSugerido - produto.custoAtual) / produto.custoAtual) * 100
        : null,
      ultimoPrecoCliente: ultimoDoCliente,
      ultimoPrecoLoja: ultimoDaLoja,
      total: arredondar(precoSugerido * bruto.quantidade),
      avisos,
      incluir: Boolean(produto),
    });
  }

  return {
    cliente,
    itens,
    observacoesDaLista: lista.observacoes || '',
    clienteCitado: lista.clienteCitado || '',
    resumo: resumir(itens),
  };
}

function resumir(itens) {
  const incluidos = itens.filter((i) => i.incluir && i.produto);
  return {
    totalItens: itens.length,
    precisamEscolha: itens.filter((i) => i.precisaEscolher).length,
    semEstoque: itens.filter((i) => i.produto && i.produto.estoque <= 0).length,
    total: arredondar(incluidos.reduce((soma, i) => soma + (i.total || 0), 0)),
  };
}

/** Recalcula um item quando o operador muda preco, quantidade ou produto. */
export function recalcularItem(item, { quantidade, precoUnitario, mostrarCusto }) {
  const qtd = quantidade !== undefined ? Number(quantidade) : item.quantidade;
  const preco = precoUnitario !== undefined ? Number(precoUnitario) : item.precoUnitario;

  return {
    ...item,
    quantidade: qtd,
    precoUnitario: preco,
    total: arredondar(preco * qtd),
    margem: mostrarCusto && item.produto?.custoAtual > 0
      ? ((preco - item.produto.custoAtual) / item.produto.custoAtual) * 100
      : item.margem,
  };
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) || 0) * fator) / fator;
}
