// Monta a conferencia: para cada item da nota, descobre qual produto do Solus e,
// calcula o custo real e propoe o preco de venda.
//
// Ordem de busca do produto (da mais confiavel para a menos):
//   1. codigo de barras da nota
//   2. codigo do produto no fornecedor (tabela PRODUTOFORNE)
//   3. campo REFERENCIA do cadastro
//   4. descricao parecida (so sugere, nunca decide sozinho)

import {
  buscarPorBarras,
  buscarPorCodigoDoFornecedor,
  buscarPorReferencia,
  buscarPorDescricao,
  buscarIrmaos,
  buscarParecidos,
  semelhanca,
} from '../db/produtos.js';
import { calcularCustos, explicarCusto, aplicarAjustes } from './custo.js';
import { analisarItem } from './precos.js';
import { decidirCaixa } from './caixa.js';
import { carregarConfig } from '../config.js';
import { buscarFornecedorPorCnpj } from '../db/fornecedores.js';
import { lembrarCaixa } from '../memoria-caixas.js';
import {
  classificarParecidos, nomePadraoDaLoja, podeUsarIAnosParecidos,
} from '../leitura/parecidos-ia.js';

// so aceitamos casar por descricao sozinho acima deste ponto de parecenca
const PARECENCA_SEGURA = 0.75;

async function encontrarProduto(item, codigoFornecedor) {
  if (item.codigoBarras) {
    const porBarras = await buscarPorBarras(item.codigoBarras);
    if (porBarras) return { produto: porBarras, comoAchou: 'codigo de barras', certeza: 'alta' };
  }

  if (item.codigoFornecedor) {
    const porFornecedor = await buscarPorCodigoDoFornecedor(item.codigoFornecedor, codigoFornecedor);
    if (porFornecedor) {
      return { produto: porFornecedor, comoAchou: 'codigo do fornecedor', certeza: 'alta' };
    }
    const porReferencia = await buscarPorReferencia(item.codigoFornecedor);
    if (porReferencia) {
      return { produto: porReferencia, comoAchou: 'referencia do cadastro', certeza: 'media' };
    }
  }

  // ultimo recurso: nome parecido
  const candidatos = await buscarPorDescricao(item.descricao);
  if (candidatos.length) {
    const ordenados = candidatos
      .map((produto) => ({ produto, nota: semelhanca(item.descricao, produto.descricao) }))
      .sort((a, b) => b.nota - a.nota);

    const melhor = ordenados[0];
    if (melhor.nota >= PARECENCA_SEGURA) {
      return {
        produto: melhor.produto,
        comoAchou: 'nome parecido',
        certeza: 'media',
        sugestoes: ordenados.slice(0, 5).map((o) => o.produto),
      };
    }
    // parecido demais de menos: nao decide, so oferece as opcoes
    return {
      produto: null,
      comoAchou: 'nao encontrado',
      certeza: 'nenhuma',
      sugestoes: ordenados.slice(0, 5).map((o) => o.produto),
    };
  }

  return { produto: null, comoAchou: 'nao encontrado', certeza: 'nenhuma', sugestoes: [] };
}

/**
 * Os cadastros repetidos/parecidos de um item, para a tela deixar escolher
 * qual vincular e quais desativar.
 *
 * Junta tres buscas, sem repetir: os irmaos de verdade (mesmo nome exato ou
 * mesmo codigo de barras do produto vinculado), os parecidos com o nome que a
 * LOJA usa, e os parecidos com o nome que veio na NOTA.
 */
export async function parecidosDoItem(item, produto) {
  const lista = [];
  const jaTem = new Set([produto?.codigo].filter(Boolean));
  const juntar = (achados) => {
    for (const achado of achados) {
      if (!achado?.codigo || jaTem.has(achado.codigo)) continue;
      jaTem.add(achado.codigo);
      lista.push(achado);
    }
  };

  if (produto) {
    juntar(await buscarIrmaos(produto.codigo));
    juntar(await buscarParecidos(produto.descricao, { excluir: produto.codigo }));
  }
  juntar(await buscarParecidos(item.descricao, { excluir: produto?.codigo }));

  // o que tem o MESMO nome primeiro; depois os mais parecidos
  return lista
    .sort((a, b) => (b.parecenca || 1) - (a.parecenca || 1))
    .slice(0, 8);
}

/**
 * Recebe a nota lida (do XML ou da IA) e devolve tudo pronto para a tela.
 */
/**
 * A IA confere os parecidos que a busca por texto achou.
 *
 * O texto conta palavras e erra dos dois lados: "DET. YPE 500" e "DETERGENTE YPE
 * 500ML" sao o mesmo produto e ele da pouca parecenca; "AGUA SANITARIA 1L" e
 * "AGUA SANITARIA 5L" sao produtos diferentes e ele da 100%. A IA le como gente.
 *
 * Ela so CLASSIFICA o que ja estava na tela (mesmo / variacao / outro) - nao
 * escolhe produto, nao grava nada e nao pode derrubar a nota: sem chave, sem
 * credito ou com erro, a conferencia segue como era antes.
 */
export async function conferirParecidosComIA(itens) {
  if (!podeUsarIAnosParecidos()) return { usou: false, motivo: 'IA desligada ou sem chave' };

  // so gasta onde existe duvida: casamento por codigo de barras/fornecedor e
  // certeza, mas os PARECIDOS dele ainda precisam ser classificados (e o que
  // diz quais dao para desativar)
  const paraIA = [];
  for (const item of itens) {
    const candidatos = [];
    const vinculoFraco = item.produto
      && item.comoAchou !== 'codigo de barras'
      && item.comoAchou !== 'codigo do fornecedor';
    if (vinculoFraco) candidatos.push(item.produto);
    candidatos.push(...(item.irmaos || []));
    if (!candidatos.length) continue;

    paraIA.push({
      item,
      entrada: {
        descricaoNaNota: item.descricao,
        unidadeDaNota: item.unidadeComercial || item.unidadeOriginal || '',
        candidatos,
      },
    });
  }
  if (!paraIA.length) return { usou: false, motivo: 'nenhum item com parecidos' };

  let avaliacoes;
  try {
    avaliacoes = await classificarParecidos(paraIA.map((p) => p.entrada));
  } catch (erro) {
    // a nota continua valendo: a tela avisa que a conferencia foi so por texto
    console.error('[parecidos-ia]', erro.message);
    return { usou: false, falhou: true, motivo: erro.message };
  }

  // 'mesmo' na frente, 'outro' no fim; sem nota da IA fica no meio
  const peso = (relacao) => ({ mesmo: 0, variacao: 1, outro: 3 }[relacao] ?? 2);
  let conferidos = 0;

  paraIA.forEach(({ item }, ordem) => {
    const notas = avaliacoes[ordem];
    if (!notas?.size) return;
    conferidos += 1;
    item.conferidoPelaIA = true;

    for (const irmao of item.irmaos || []) {
      const nota = notas.get(String(irmao.codigo));
      if (!nota) continue;
      irmao.relacaoIA = nota.relacao;
      irmao.motivoIA = nota.motivo;
    }

    // a IA acha que o cadastro vinculado NAO e o mesmo produto
    const doVinculo = item.produto ? notas.get(String(item.produto.codigo)) : null;
    if (doVinculo) {
      item.relacaoDoVinculoIA = doVinculo.relacao;
      item.motivoDoVinculoIA = doVinculo.motivo;
      if (doVinculo.relacao !== 'mesmo') {
        item.precisaConfirmarVinculo = true;
        item.precisaAtencao = true;
      }
    }

    // achou um cadastro que e o mesmo produto e a nota nao esta nele
    const mesmos = (item.irmaos || []).filter((i) => i.relacaoIA === 'mesmo');
    if (mesmos.length && (!item.produto || (doVinculo && doVinculo.relacao !== 'mesmo'))) {
      item.sugestaoDaIA = {
        codigo: mesmos[0].codigo,
        descricao: mesmos[0].descricao,
        motivo: mesmos[0].motivoIA || 'a IA acha que e o mesmo produto',
      };
      item.precisaAtencao = true;
    }

    // so REORDENA: o mesmo produto em cima, o que nao tem relacao no fim.
    // Nada e escondido de proposito - se a IA errar e chamar de "outro" um
    // cadastro repetido de verdade, ele continua ali para ser desativado.
    item.irmaos = [...(item.irmaos || [])]
      .sort((a, b) => peso(a.relacaoIA) - peso(b.relacaoIA) || (b.parecenca || 0) - (a.parecenca || 0))
      .slice(0, 8);
  });

  const nomes = await sugerirNomesDeProdutoNovo(itens);

  return { usou: conferidos > 0, itens: conferidos, nomesSugeridos: nomes };
}

/**
 * O nome do produto que vai ser CADASTRADO, no padrao da loja.
 *
 * O fornecedor manda "SAB.PO OMO LAV.PERF 1,6KG" e era isso que ia para o
 * cadastro - e dali para a etiqueta da prateleira, para o orcamento e para a
 * busca de quem atende. A IA reescreve olhando como a loja nomeia os produtos
 * parecidos. Quem confere ve o nome num campo e muda se quiser; se a IA falhar,
 * fica o nome da nota, como sempre foi.
 */
async function sugerirNomesDeProdutoNovo(itens) {
  const novos = itens.filter((i) => i.acao === 'criar' && i.descricao);
  if (!novos.length) return 0;

  try {
    // exemplos do padrao da loja: os parecidos do proprio item; sem eles, o que
    // o catalogo achar pela primeira palavra do nome
    const pedidos = [];
    for (const item of novos) {
      let exemplos = (item.irmaos || []).map((i) => i.descricao);
      if (exemplos.length < 3) {
        const primeira = String(item.descricao).split(/[\s.]+/)[0];
        const achados = primeira.length >= 3 ? await buscarPorDescricao(primeira, 5) : [];
        exemplos = [...exemplos, ...achados.map((a) => a.descricao)];
      }
      pedidos.push({ nomeNaNota: item.descricao, exemplos });
    }

    const nomes = await nomePadraoDaLoja(pedidos);
    let sugeridos = 0;
    novos.forEach((item, ordem) => {
      const nome = nomes[ordem];
      if (!nome || nome === item.descricao.toUpperCase()) return;
      item.nomeSugerido = nome;
      item.nomeNaNota = item.descricao;
      item.descricao = nome;              // ja vai preenchido; da para voltar na tela
      sugeridos += 1;
    });
    return sugeridos;
  } catch (erro) {
    console.error('[nome-do-produto-novo]', erro.message);
    return 0;
  }
}

export async function montarConferencia(nota, ajustes = null) {
  const cfg = carregarConfig();
  const regras = cfg.regras || {};

  // 1) custo real de cada item (frete, IPI, ST, credito de imposto)
  let itensComCusto = calcularCustos(nota, {
    regime: cfg.empresa?.regime || 'simples',
    somarFrete: regras.somarFrete !== false,
    somarIPI: regras.somarIPI !== false,
    somarST: regras.somarST !== false,
  });

  // o fornecedor da nota no cadastro do Solus (pelo CNPJ): e o que deixa achar o
  // produto pelo codigo que o FORNECEDOR usa, e gravar quem foi o ultimo fornecedor
  if (nota.fornecedor?.cnpj && !nota.fornecedor.codigoNoSolus) {
    const doSolus = await buscarFornecedorPorCnpj(nota.fornecedor.cnpj);
    if (doSolus) {
      nota.fornecedor.codigoNoSolus = doSolus.codigo;
      nota.fornecedor.nomeNoSolus = doSolus.nome;
    }
  }

  // 2) achar o produto no Solus e, com ele, decidir caixa x unidade
  //    (a loja vende quase tudo separado; o que ela vende fechado entra fechado)
  const achados = [];
  for (let i = 0; i < itensComCusto.length; i += 1) {
    const achado = await encontrarProduto(itensComCusto[i], nota.fornecedor?.codigoNoSolus);
    achados.push(achado);
    itensComCusto[i] = decidirCaixa(itensComCusto[i], achado.produto, lembrarCaixa);
  }

  // o que a pessoa escreveu na observacao (a IA entendeu, o codigo calcula).
  // Vem DEPOIS da caixa: "a caixa vem com 24" escrito pela pessoa manda.
  itensComCusto = aplicarAjustes(itensComCusto, ajustes);

  const itens = [];
  for (let i = 0; i < itensComCusto.length; i += 1) {
    const item = itensComCusto[i];
    const achado = achados[i];

    // 3) decidir o preco
    const analise = analisarItem({
      produto: achado.produto,
      custoNovo: item.custoUnitario,
      regras,
    });

    // 4) cadastros repetidos ou PARECIDOS.
    //
    // Antes isto so rodava quando o produto tinha sido achado, e so pegava nome
    // IDENTICO: na loja, lancar "RODO DE MADEIRA 40CM" nao mostrava os outros 4
    // rodos parecidos, e um deles acabava recebendo a mercadoria (ou nascia mais
    // um repetido). Agora a lista sai sempre - inclusive para o produto que vai
    // ser cadastrado novo, para dar para vincular a um que ja existe.
    const irmaos = await parecidosDoItem(item, achado.produto);

    itens.push({
      ...item,
      // o que a tela precisa mostrar
      produto: achado.produto,
      comoAchou: achado.comoAchou,
      certezaDoCasamento: achado.certeza,
      sugestoes: achado.sugestoes || [],
      irmaos,
      igualarIrmaos: false,          // so liga se o operador marcar na tela
      acao: achado.produto ? 'atualizar' : 'criar',
      // casou so pelo NOME: a tela pede confirmacao (foi assim que uma nota
      // atualizou o produto errado em vez de cadastrar o novo)
      precisaConfirmarVinculo: achado.comoAchou === 'nome parecido',
      analise,
      precoVenda: analise.precoEscolhido,
      explicacaoCusto: explicarCusto(item.composicaoCusto),
      precisaAtencao:
        !achado.produto ||
        achado.certeza !== 'alta' ||
        item.confianca === 'baixa' ||
        (item.convertido && item.confianca !== 'alta') ||
        analise.alertas.some((a) => ['prejuizo', 'cancelado', 'alta'].includes(a.tipo)),
    });
  }

  // 5) a IA confere os parecidos (uma chamada para a nota inteira).
  // Roda por ultimo de proposito: se falhar, tudo acima ja esta pronto.
  const conferenciaIA = await conferirParecidosComIA(itens);

  return {
    ...nota,
    itens,
    // vai para a tela mesmo sem ajuste: a pessoa precisa saber o que foi feito
    // com o que ela escreveu (inclusive "nao consegui ler")
    ajustes: ajustes || null,
    conferenciaIA,
    resumo: montarResumo(itens, nota),
  };
}

function montarResumo(itens, nota) {
  const novos = itens.filter((i) => !i.produto).length;
  const convertidos = itens.filter((i) => i.convertido).length;
  const atencao = itens.filter((i) => i.precisaAtencao).length;
  const comIrmaos = itens.filter((i) => i.irmaos?.length).length;
  const somaCusto = itens.reduce((total, i) => total + (i.custoTotalItem || 0), 0);

  // confere se a soma dos itens bate com o total da nota
  const totalNota = nota.totais?.nota || 0;
  const diferenca = totalNota > 0 ? somaCusto - totalNota : 0;

  return {
    totalItens: itens.length,
    produtosNovos: novos,
    itensConvertidosDeCaixa: convertidos,
    itensComAtencao: atencao,
    itensComNomeRepetido: comIrmaos,
    somaDosCustos: Math.round(somaCusto * 100) / 100,
    totalDaNota: totalNota,
    diferencaParaNota: Math.round(diferenca * 100) / 100,
    conferiuComATotal: Math.abs(diferenca) <= 0.05,
  };
}
