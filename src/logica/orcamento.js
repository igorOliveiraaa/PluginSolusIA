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
import { ultimoPrecoDoCliente, ultimoPrecoDaLoja, produtosQueOClienteComprou } from '../db/clientes.js';
import {
  classificarParecidos, outrosNomesDoProduto, podeUsarIAnosParecidos,
} from '../leitura/parecidos-ia.js';
import { oQueCostumaLevar } from './sugestoes.js';

// acima disso, casou com quase tudo que foi pedido e pode escolher sozinho
const COBERTURA_SUFICIENTE = 0.85;
// o que a PESSOA decidiu: trocar o cliente depois nunca mexe nesses
const ESCOLHIDO_NA_MAO = new Set(['escolhido na tela', 'adicionado na tela', 'código de barras']);
// diferenca minima para o primeiro ser "claramente melhor" que o segundo
const DISTANCIA_SEGURA = 0.15;

/** Junta descricao + marca + tamanho no texto que vai para a busca. */
function textoDeBusca(item) {
  return [item.descricao, item.marca, item.tamanho].filter(Boolean).join(' ').trim();
}

/**
 * Entre os produtos que o cliente ja comprou, um e claramente "o dele"?
 * Sim quando o mais recente tambem e o que ele mais compra, ou quando o outro
 * ficou para tras (ultima compra 90 dias ou mais antes). Assim quem compra a
 * Rende Mais toda semana e levou outra marca UMA vez continua recebendo a Rende
 * Mais - e so quem divide de verdade entre duas marcas e perguntado.
 */
function umDominaOsOutros(queEleJaLevou, historico) {
  const [primeiro, segundo] = queEleJaLevou.map((c) => historico.get(c.codigo));
  const DIAS_90 = 90 * 24 * 3600 * 1000;
  if (primeiro.ultima - segundo.ultima >= DIAS_90) return true;
  return primeiro.vezes >= 2 * segundo.vezes;
}

/**
 * Procura os candidatos de um item no catalogo.
 * Devolve o escolhido (quando da para ter certeza) e sempre a lista de opcoes.
 */
async function procurarCandidatos(item, preferidos, historico = new Map()) {
  // 1) se o cliente mandou um codigo de barras, acabou a duvida
  const digitos = String(item.descricao || '').replace(/\D/g, '');
  if (digitos.length >= 12) {
    const porBarras = await buscarPorBarras(digitos);
    if (porBarras) {
      return { escolhido: porBarras, opcoes: [porBarras], certeza: 'alta', comoAchou: 'código de barras' };
    }
  }

  // 2) busca no catalogo, ja com o historico do cliente pesando na ordem
  // sugestao automatica: produto parado (prazo dos Ajustes) nao entra
  const candidatos = await buscarPorDescricao(textoDeBusca(item), 8, {
    preferir: preferidos,
    esconderParados: true,
  });
  if (!candidatos.length) {
    return { escolhido: null, opcoes: [], certeza: 'nenhuma', comoAchou: 'não encontrado' };
  }
  for (const candidato of candidatos) {
    const dele = historico.get(candidato.codigo);
    if (dele) candidato.doCliente = { vezes: dele.vezes, ultima: dele.ultima };
  }

  const melhor = candidatos[0];
  const segundo = candidatos[1];
  const jaComprou = preferidos.includes(melhor.codigo);

  // O cliente ja levou MAIS DE UM dos que servem ("lava roupas 5l": comprou o
  // Harmoniex e o Coco). Escolher um dos dois seria chute - pergunta, com os
  // que ELE compra na frente.
  const queEleJaLevou = candidatos
    .filter((c) => c.cobertura >= COBERTURA_SUFICIENTE && historico.has(c.codigo))
    .sort((a, b) => historico.get(b.codigo).ultima - historico.get(a.codigo).ultima);
  if (queEleJaLevou.length >= 2 && !umDominaOsOutros(queEleJaLevou, historico)) {
    const resto = candidatos.filter((c) => !queEleJaLevou.includes(c));
    return {
      escolhido: null,
      opcoes: [...queEleJaLevou, ...resto].slice(0, 6),
      certeza: 'empate',
      comoAchou: 'esse cliente já levou mais de um destes',
    };
  }

  // um so dos que servem e "o dele" (ou um domina): e esse, mesmo que outra marca
  // venda mais na loja - o orcamento e para ESTE cliente
  if (queEleJaLevou.length) {
    return {
      escolhido: queEleJaLevou[0],
      // na lista: primeiro o que ELE comprou (do mais recente), depois o mais provavel
      opcoes: [...queEleJaLevou, ...candidatos.filter((c) => !queEleJaLevou.includes(c))].slice(0, 6),
      certeza: 'alta',
      comoAchou: 'esse cliente já levou',
    };
  }

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
// A IA conferindo o que o cliente pediu
// ---------------------------------------------------------------------------

/**
 * Entre os cadastros que a IA disse serem O QUE O CLIENTE PEDIU, qual escolher.
 * A regra da casa continua valendo: o que ESTE cliente compra ganha. Sem
 * historico, so escolhe quando ha um unico candidato - dois seria chute.
 */
function melhorEntreOsQueServem(servem, historico, opcoes = []) {
  // O do cliente que casa o pedido INTEIRO pelo texto conta como "serve" mesmo
  // que a IA torça o nariz. Numa rodada ela disse que a água sanitária de 2L
  // (a que o cliente compra) era "outro tamanho" para um pedido SEM tamanho -
  // e o sistema escolheu a de 1L. A IA só manda quando o pedido diz algo que o
  // produto dele não tem ("5 litros" contra o de 1 litro): aí o texto não casa
  // inteiro e este atalho não vale.
  const casaInteiro = opcoes.filter((o) => historico.has(o.codigo)
    && (o.cobertura ?? 0) >= COBERTURA_SUFICIENTE && o.relacaoIA !== 'outro');
  const dele = [...new Map([...servem.filter((p) => historico.has(p.codigo)), ...casaInteiro]
    .map((p) => [p.codigo, p])).values()]
    .sort((a, b) => historico.get(b.codigo).ultima - historico.get(a.codigo).ultima);

  // ele compra MAIS DE UMA das que servem (4 marcas de alcool 5L): a regra da
  // casa manda perguntar, com as dele na frente. Escolher a mais recente seria
  // chute - e foi assim que este mesmo teste caiu de 12/12 para 7/12.
  if (dele.length > 1 && !umDominaOsOutros(dele, historico)) return null;
  if (dele.length) return dele[0];

  // NENHUM dos que a IA aprovou e do cliente, e ele compra VARIAS das outras
  // opcoes: e o caso "alcool 5l" - a IA aprovou so o generico
  // "ALCOOL 70% LIQUIDO 5 LITROS" e reprovou as 4 marcas que o cliente leva.
  // Escolher o generico seria trocar a marca dele por conta propria. Pergunta.
  // (Com UM so do cliente na lista a IA continua podendo trocar: e o caso de
  // ele ter comprado 1 litro antes e estar pedindo 5 litros agora.)
  // (conta só os dele que casam de verdade: o álcool 1L que ele compra aparece
  // na lista de "qboa 1 litro" só por causa do "1 litro" - e travava o Q.BOA)
  const deleQueCasam = opcoes.filter((o) => historico.has(o.codigo) && opcaoForte(o) && o.relacaoIA !== 'outro');
  if (deleQueCasam.length >= 2) return null;

  // sem historico: so quando ha UMA opcao certa. Duas marcas que servem e
  // escolha de quem esta atendendo (foi o que o Igor decidiu).
  return servem.length === 1 ? servem[0] : null;
}

// Abaixo disso, a opção só casou METADE do pedido - em geral só a medida.
// "qboa 1 litro" trazia qualquer coisa de 1 litro (álcool, garrafa térmica,
// querosene) com 50%, e a IA acabou escolhendo QUEROSENE sozinha. Com opção
// fraca assim a IA não escolhe nada: procura por outro nome e, se ainda assim
// não houver opção forte, pergunta.
const COBERTURA_PARA_A_IA_DECIDIR = 0.6;
const opcaoForte = (opcao) => (opcao.cobertura ?? 1) >= COBERTURA_PARA_A_IA_DECIDIR;

/**
 * Esta opção SERVE para o que foi pedido?
 *
 *   - a IA disse que é o mesmo produto E o texto casou o bastante; ou
 *   - o texto casou o pedido INTEIRO e a IA não disse que é outro tipo.
 *
 * O segundo caso é o que dá estabilidade: sem temperatura zero, a IA ora diz
 * que "ESCUMADEIRA P/ FRITURA 40CM" é "outro tamanho" para um pedido de
 * "escumadeira fritura" (sem tamanho nenhum), ora diz que é "o mesmo" - e o
 * orçamento mudava de uma vez para outra. Se o cadastro tem todas as palavras
 * do pedido, ele não contradiz nada do que foi pedido: só "outro TIPO" derruba.
 */
function serveAoPedido(opcao) {
  if (opcao.relacaoIA === 'outro') return false;
  if (opcao.relacaoIA === 'mesmo' && opcaoForte(opcao)) return true;
  return (opcao.cobertura ?? 0) >= COBERTURA_SUFICIENTE;
}

/**
 * Item sem opção nenhuma OU só com opções fracas: a IA diz de que outro jeito a
 * loja chamaria aquilo ("qboa" -> "agua sanitaria") e o catálogo é procurado de novo.
 */
async function procurarPorOutroNome(itens) {
  const semNada = itens.filter((i) => !i.produto && !(i.opcoes || []).some(opcaoForte));
  if (!semNada.length) return 0;

  // sem a quantidade pedida: "3 qboa" iria virar "3 litros de qboa"
  const nomes = await outrosNomesDoProduto(semNada.map((i) => textoDeBusca(i) || i.descricao || ''));

  let achados = 0;
  for (const [ordem, item] of semNada.entries()) {
    for (const nome of nomes[ordem] || []) {
      const candidatos = (await buscarPorDescricao(nome, 6, { esconderParados: true })).filter(opcaoForte);
      if (!candidatos.length) continue;
      // os achados pelo outro nome vêm na frente; as opções de antes continuam
      // atrás (se a IA errar o outro nome, nada que existia some da tela)
      const vistos = new Set(candidatos.map((c) => c.codigo));
      item.opcoes = [
        ...candidatos.map((c) => ({ ...c, achadoPorOutroNome: nome })),
        ...(item.opcoes || []).filter((o) => !vistos.has(o.codigo)),
      ].slice(0, 6);
      item.nomeQueAIAsugeriu = nome;
      item.comoAchou = `procurei também por "${nome}"`;
      achados += 1;
      break;
    }
  }
  return achados;
}

/**
 * A IA confere as opcoes de cada item do orcamento.
 *
 * O texto escolhe os candidatos (de graca); a IA diz qual deles e MESMO o que o
 * cliente pediu. Com isso:
 *   - item em duvida com um so candidato certo e resolvido sozinho;
 *   - item que o texto escolheu errado (pediu 5 litros e veio o de 1 litro) e
 *     trocado, com aviso na tela do que foi trocado e por que;
 *   - item que nao achou nada e procurado de novo com outro nome ("qboa" ->
 *     "agua sanitaria"), que e como o cliente escreve e a loja nao cadastra.
 *
 * Nada e gravado aqui e nada fica escondido: as opcoes continuam na tela, com o
 * parecer da IA em cada uma. Sem chave, sem credito ou com erro, o orcamento
 * sai do jeito de antes.
 */
export async function conferirOpcoesComIA({ itens, cliente, mostrarCusto = false, historico = new Map() }) {
  if (!podeUsarIAnosParecidos()) return { usou: false, motivo: 'IA desligada ou sem chave' };

  // so os itens que tem opcoes para comparar - e nunca o que a PESSOA escolheu
  // na mao: decisao de gente a IA nao desfaz
  const paraConferir = () => itens.filter((i) => (i.opcoes || []).length && !ESCOLHIDO_NA_MAO.has(i.comoAchou));
  // vai a DESCRICAO, nunca o texto original: "5 papel higienico 30 metros"
  // fazia a IA ler o 5 como tamanho da embalagem ("12 rolos contra 5") e
  // trocar um produto que estava certo. O 5 e a quantidade que ele quer.
  const pedidoDaIA = (item) => ({
    descricaoNaNota: textoDeBusca(item) || item.descricao || '',
    unidadeDaNota: item.unidade || '',
    candidatos: item.opcoes,
  });

  // 1) AO MESMO TEMPO: o outro nome para os itens fracos e o parecer do que já
  //    está na tela. Em fila, um orçamento de 20 itens levava 13s; junto, a
  //    espera é a da chamada mais lenta.
  const [outroNome] = await Promise.allSettled([
    procurarPorOutroNome(itens),
    classificarParecidos(paraConferir().map(pedidoDaIA), 'pedido'),
  ]);
  const achadosPorOutroNome = outroNome.status === 'fulfilled' ? outroNome.value : 0;
  if (outroNome.status === 'rejected') console.error('[orcamento-ia] outros nomes', outroNome.reason?.message);

  const comOpcoes = paraConferir();
  if (!comOpcoes.length) {
    return { usou: achadosPorOutroNome > 0, achadosPorOutroNome, itens: 0 };
  }

  // 2) de novo, mas só vai para a IA o que ainda não tem parecer: as opções
  //    novas que o outro nome trouxe. O resto sai da memória, de graça e na hora.
  let avaliacoes;
  try {
    avaliacoes = await classificarParecidos(comOpcoes.map(pedidoDaIA), 'pedido');
  } catch (erro) {
    console.error('[orcamento-ia]', erro.message);
    return { usou: false, falhou: true, motivo: erro.message, achadosPorOutroNome };
  }

  /**
   * A ordem das opcoes na tela.
   *
   * Duas regras mandam juntas: o que SERVE vem antes do que nao serve, e o que
   * ESTE cliente compra vem antes do resto. Ordenar so pelo parecer da IA jogava
   * o alcool que o cliente compra para o fim da lista (o teste `t-alcool-5l`
   * caiu de 12/12 para 7/12 assim). Como o sort do JavaScript e estavel, dentro
   * de cada grupo continua valendo a ordem que veio: a compra mais recente dele
   * primeiro.
   */
  const grupo = (opcao) => {
    // o que ESTE cliente compra fica na frente, na ordem que ja veio (a compra
    // mais recente primeiro). A IA nao mexe nisso: ela so poe a etiqueta
    // ("IA: 1 litro contra 5 litros"), e quem atende ve na hora.
    if (opcao.doCliente || historico.has(opcao.codigo)) return 0;
    return { mesmo: 1, variacao: 3, outro: 4 }[opcao.relacaoIA] ?? 2;
  };
  let conferidos = 0;
  let resolvidos = 0;
  let trocados = 0;

  for (const [ordem, item] of comOpcoes.entries()) {
    const notas = avaliacoes[ordem];
    if (!notas?.size) continue;
    conferidos += 1;
    item.conferidoPelaIA = true;

    for (const opcao of item.opcoes) {
      const nota = notas.get(String(opcao.codigo));
      if (nota) {
        opcao.relacaoIA = nota.relacao;
        opcao.motivoIA = nota.motivo;
      }
      // a mesma conta que decide abaixo vai para a tela ("N destes servem")
      opcao.serve = serveAoPedido(opcao);
    }
    item.opcoes = [...item.opcoes].sort((a, b) => grupo(a) - grupo(b));

    const servem = item.opcoes.filter(serveAoPedido);
    const doEscolhido = item.produto ? notas.get(String(item.produto.codigo)) : null;
    const escolhidoNaLista = item.produto
      ? item.opcoes.find((o) => String(o.codigo) === String(item.produto.codigo))
        || { ...item.produto, relacaoIA: doEscolhido?.relacao }
      : null;

    // 1) o texto escolheu algo que NAO serve para o que o cliente pediu
    if (item.produto && doEscolhido && !serveAoPedido(escolhidoNaLista)) {
      // ...MENOS quando e o produto que ESTE cliente ja compra E nao ha nada
      // melhor na lista. Ele levou isso antes; a IA achar que o nome nao bate
      // exatamente nao desfaz um fato. (Sem esta trava a IA derrubava escolhas
      // certas: "botina usafe" virava duvida porque o cadastro diz "BICO PVC".)
      // Mas se existe um cadastro que E o que ele pediu agora - pediu 5 litros
      // e o do historico e 1 litro -, esse ganha.
      const certo = melhorEntreOsQueServem(servem, historico, item.opcoes);
      const eraDele = historico.has(item.produto.codigo);

      if (certo && String(certo.codigo) === String(item.produto.codigo)) {
        // a regra do cliente confirmou o que já estava escolhido: fica, com o
        // aviso do que a IA achou (quem atende decide se quer trocar)
        item.duvidaDaIA = doEscolhido.motivo || 'a IA achou que não é bem isso';
      } else if (certo) {
        item.trocadoPelaIA = {
          de: item.produto.descricao,
          para: certo.descricao,
          motivo: doEscolhido.motivo || 'não é o que foi pedido',
        };
        item.produto = certo;
        item.comoAchou = 'a IA viu que é este';
        trocados += 1;
      } else if (eraDele) {
        // nao ha um substituto claro e o cliente ja comprou este: MANTEM, com
        // aviso. Transformar em "escolha o produto" seria piorar uma escolha
        // que estava certa (foi o que fez este teste cair de 27 para 26).
        item.duvidaDaIA = doEscolhido.motivo || 'a IA achou que não é bem isso';
      } else {
        item.trocadoPelaIA = {
          de: item.produto.descricao,
          para: '',
          motivo: doEscolhido.motivo || 'não é o que foi pedido',
        };
        item.produto = null;
        item.comoAchou = 'precisa escolher';
        trocados += 1;
      }
    // 2) estava em duvida e a IA achou o certo
    } else if (!item.produto && servem.length) {
      const certo = melhorEntreOsQueServem(servem, historico, item.opcoes);
      if (certo) {
        item.produto = certo;
        item.escolhidoPelaIA = true;
        item.comoAchou = item.nomeQueAIAsugeriu
          ? `a IA procurou por "${item.nomeQueAIAsugeriu}"`
          : 'a IA viu que é este';
        resolvidos += 1;
      }
    }
  }

  // refaz os itens que mudaram de produto (preco do cliente, avisos, fracionado)
  for (const [posicao, item] of itens.entries()) {
    if (!item.trocadoPelaIA && !item.escolhidoPelaIA) continue;
    const refeito = await montarItemComProduto({
      base: item,
      produto: item.produto,
      cliente,
      mostrarCusto,
      comoAchou: item.comoAchou,
      opcoes: item.opcoes,
    });
    refeito.certeza = item.produto ? 'alta' : 'baixa';
    refeito.conferidoPelaIA = true;
    refeito.trocadoPelaIA = item.trocadoPelaIA;
    refeito.escolhidoPelaIA = item.escolhidoPelaIA;
    refeito.duvidaDaIA = item.duvidaDaIA;
    refeito.nomeQueAIAsugeriu = item.nomeQueAIAsugeriu;
    itens[posicao] = refeito;
  }

  return { usou: conferidos > 0, itens: conferidos, resolvidos, trocados, achadosPorOutroNome };
}

/**
 * O "costuma levar" roda junto com a IA, então ele ainda não sabe o que a IA
 * escolheu. Aqui sai da sugestão o que já acabou entrando na lista.
 */
function semOQueJaEstaNaLista(sugestoes, itens) {
  const naLista = new Set(itens.map((i) => String(i.produto?.codigo || '')).filter(Boolean));
  return (sugestoes || []).filter((s) => !naLista.has(String(s.produto?.codigo || '')));
}

// ---------------------------------------------------------------------------
// O orcamento inteiro
// ---------------------------------------------------------------------------

/** Codigos que este cliente ja comprou - na duvida, sao eles que ganham. */
async function produtosQueOClienteJaLevou(cliente) {
  const vazio = { preferidos: [], compras: [], historico: new Map() };
  if (!cliente?.codigo) return vazio;
  // "CONSUMIDOR" e o balcao inteiro, nao uma pessoa: o historico dele e a loja toda
  if (/^CONSUMIDOR/i.test(String(cliente.nome || '').trim())) return vazio;

  // tudo o que ele comprou nos ultimos 3 anos, do mais recente para o mais antigo
  const compras = await produtosQueOClienteComprou(cliente.codigo).catch(() => []);
  const historico = new Map();          // codigo -> { ultima (ms), vezes }
  const preferidos = [];
  for (const compra of compras) {
    const [codigo] = await codigosDasChaves([compra.chave]).catch(() => []);
    if (!codigo) continue;
    const quando = compra.ultima ? new Date(compra.ultima).getTime() : 0;
    const atual = historico.get(codigo) || { ultima: 0, vezes: 0 };
    atual.ultima = Math.max(atual.ultima, quando);
    atual.vezes += compra.vezes;
    historico.set(codigo, atual);
    if (!preferidos.includes(codigo)) preferidos.push(codigo);
  }
  return { preferidos, compras, historico };
}

/**
 * Monta o orcamento inteiro.
 * `lista` vem da IA (ou digitada), `cliente` pode ser null (consumidor).
 */
export async function montarOrcamento({ lista, cliente, nomeCliente = '', mostrarCusto = false }) {
  const { preferidos, historico } = await produtosQueOClienteJaLevou(cliente);

  const itens = [];
  for (const bruto of lista.itens) {
    const achado = await procurarCandidatos(bruto, preferidos, historico);
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

  // AO MESMO TEMPO (uma não depende da outra): a IA confere o que o texto
  // escolheu, e o "costuma levar" olha o ritmo de compra do cliente
  const [conferenciaIA, sugestoesBrutas] = await Promise.all([
    conferirOpcoesComIA({ itens, cliente, mostrarCusto, historico }),
    oQueCostumaLevar({ cliente, jaNoOrcamento: itens.map((i) => i.produto?.codigo).filter(Boolean) }),
  ]);
  const sugestoes = semOQueJaEstaNaLista(sugestoesBrutas, itens);

  return {
    cliente,
    nomeCliente: cliente ? '' : limparNomeLivre(nomeCliente),
    itens,
    conferenciaIA,
    sugestoes,
    preferidos,
    observacoesDaLista: lista.observacoes || '',
    // quando o pedido veio por audio: a tela mostra o que foi entendido da fala
    oQueFoiFalado: lista.oQueFoiFalado || '',
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
  const doCliente = await produtosQueOClienteJaLevou(cliente);
  orcamento.preferidos = doCliente.preferidos;
  const historicoDoCliente = doCliente.historico;

  for (let i = 0; i < orcamento.itens.length; i += 1) {
    const item = orcamento.itens[i];

    // O que o PLUGIN escolheu sozinho e escolhido de novo, agora sabendo o que ESTE
    // cliente compra (antes, escolher o cliente depois so trocava os precos e o
    // produto continuava o "mais vendido da loja", nao o dele). O que a pessoa
    // escolheu ou adicionou na mao fica como esta.
    if (!ESCOLHIDO_NA_MAO.has(item.comoAchou)) {
      const achado = await procurarCandidatos(item, orcamento.preferidos, historicoDoCliente);
      const mudou = (achado.escolhido?.codigo || null) !== (item.produto?.codigo || null);
      if (mudou || !item.produto) {
        orcamento.itens[i] = await montarItemComProduto({
          base: item,
          produto: achado.escolhido,
          cliente,
          mostrarCusto,
          // produto trocado volta ao preco de tabela dele; o mesmo mantem o preco ajustado
          precoUnitario: mudou ? undefined : item.precoUnitario,
          comoAchou: achado.comoAchou,
          opcoes: achado.opcoes,
        });
        orcamento.itens[i].certeza = achado.certeza;
        continue;
      }
    }

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

  // a IA confere de novo: escolher o cliente depois tem que dar o MESMO
  // resultado de ter escolhido antes (sem isto, a lista montada sem cliente
  // ficava diferente da montada com ele)
  // trocou o cliente: a IA confere de novo e o "costuma levar" é de outra
  // pessoa agora (os dois ao mesmo tempo)
  const [conferenciaIA, sugestoesBrutas] = await Promise.all([
    conferirOpcoesComIA({ itens: orcamento.itens, cliente, mostrarCusto, historico: historicoDoCliente }),
    oQueCostumaLevar({ cliente, jaNoOrcamento: orcamento.itens.map((i) => i.produto?.codigo).filter(Boolean) }),
  ]);
  orcamento.conferenciaIA = conferenciaIA;
  orcamento.sugestoes = semOQueJaEstaNaLista(sugestoesBrutas, orcamento.itens);

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
