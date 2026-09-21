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
  semelhanca,
} from '../db/produtos.js';
import { calcularCustos, explicarCusto, aplicarAjustes } from './custo.js';
import { analisarItem } from './precos.js';
import { decidirCaixa } from './caixa.js';
import { carregarConfig } from '../config.js';
import { buscarFornecedorPorCnpj } from '../db/fornecedores.js';
import { lembrarCaixa } from '../memoria-caixas.js';

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
 * Recebe a nota lida (do XML ou da IA) e devolve tudo pronto para a tela.
 */
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

    // 4) produtos repetidos com o mesmo nome (o caso do estoque negativo)
    let irmaos = [];
    if (achado.produto) {
      irmaos = await buscarIrmaos(achado.produto.codigo);
    }

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

  return {
    ...nota,
    itens,
    // vai para a tela mesmo sem ajuste: a pessoa precisa saber o que foi feito
    // com o que ela escreveu (inclusive "nao consegui ler")
    ajustes: ajustes || null,
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
