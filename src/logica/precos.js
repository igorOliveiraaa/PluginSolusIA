// Decisao de preco item a item.
//
// A pergunta que a tela precisa responder para o operador e sempre a mesma:
//   "o custo mudou de X para Y. Da para continuar vendendo pelo mesmo preco,
//    ou precisa subir para manter a margem de antes?"
//
// A margem aqui e sempre MARGEM SOBRE O CUSTO (markup), que e como o Solus
// calcula o campo MARGEM: (venda - custo) / custo * 100.

/** Margem sobre o custo, em %. */
export function calcularMargem(custo, venda) {
  if (!custo || custo <= 0) return 0;
  return ((venda - custo) / custo) * 100;
}

/** Preco que resulta em uma margem desejada. */
export function precoParaMargem(custo, margemPercentual) {
  return custo * (1 + (margemPercentual || 0) / 100);
}

/**
 * Arredonda o preco para um final "de loja" (ex.: terminar em ,90).
 * `terminacao` 0 desliga o arredondamento.
 */
export function arredondarPreco(valor, terminacao = 0.90, tolerancia = 8) {
  if (!valor || valor <= 0) return 0;
  if (!terminacao || terminacao <= 0) return Math.round(valor * 100) / 100;

  // Regra 1: arredondar SEMPRE PARA CIMA, nunca para baixo.
  // Arredondar para baixo parece inofensivo mas come a margem justamente quando
  // o preco existe para proteger a margem (alvo R$ 4,24 virando R$ 3,90).
  const inteiro = Math.floor(valor);
  const candidato = [inteiro + terminacao, inteiro + 1 + terminacao]
    .find((c) => c >= valor - 0.001) ?? inteiro + 1 + terminacao;

  // Regra 2: em produto barato, o final ",90" obriga saltos de R$ 1,00, o que
  // distorce demais (um item de R$ 2,37 iria para R$ 2,90 = 22% a mais).
  // Quando o salto passa da tolerancia, arredonda para cima de 10 em 10 centavos.
  const exagero = ((candidato - valor) / valor) * 100;
  if (exagero > tolerancia) {
    return Math.ceil(valor * 10) / 10;
  }

  return Math.round(candidato * 100) / 100;
}

/**
 * Monta a analise completa de um item.
 * `produto` e o cadastro de hoje (pode ser null quando o produto ainda nao existe).
 */
export function analisarItem({ produto, custoNovo, regras = {} }) {
  const {
    arredondarPara = 0.90,
    toleranciaArredondamento = 8,
    margemNovoProduto = 30,
    avisarAumentoAcima = 10,
    margemMinima = 0,
  } = regras;

  const novoProduto = !produto;
  const custoAntigo = novoProduto ? 0 : produto.custoAtual;
  const vendaAtual = novoProduto ? 0 : produto.vendaAtual;

  // produto novo: nao existe margem anterior, usa a margem padrao da loja
  const margemAnterior = novoProduto
    ? margemNovoProduto
    : calcularMargem(custoAntigo, vendaAtual);

  const precoMantendoMargem = precoParaMargem(custoNovo, margemAnterior);
  const precoSugerido = arredondarPreco(precoMantendoMargem, arredondarPara, toleranciaArredondamento);

  // se o preco de venda nao mudar, em que margem a loja fica?
  const margemSeManterPreco = novoProduto ? 0 : calcularMargem(custoNovo, vendaAtual);

  const variacaoCusto = custoAntigo > 0 ? ((custoNovo - custoAntigo) / custoAntigo) * 100 : 0;

  const alertas = [];
  if (novoProduto) {
    alertas.push({
      tipo: 'novo',
      texto: `Produto ainda nao existe no Solus. Vai ser cadastrado com margem de ${margemNovoProduto}%.`,
    });
  } else {
    if (custoAntigo <= 0) {
      alertas.push({ tipo: 'atencao', texto: 'O produto nao tinha custo cadastrado, entao nao da para comparar a margem anterior.' });
    }
    if (vendaAtual <= 0) {
      alertas.push({ tipo: 'atencao', texto: 'O produto esta sem preco de venda no cadastro.' });
    }
    if (variacaoCusto >= avisarAumentoAcima) {
      alertas.push({ tipo: 'alta', texto: `O custo subiu ${variacaoCusto.toFixed(1)}%.` });
    } else if (variacaoCusto <= -avisarAumentoAcima) {
      alertas.push({ tipo: 'baixa', texto: `O custo caiu ${Math.abs(variacaoCusto).toFixed(1)}%. Da para rever o preco.` });
    }
    if (vendaAtual > 0 && custoNovo > 0 && vendaAtual < custoNovo) {
      alertas.push({ tipo: 'prejuizo', texto: 'ATENCAO: o preco de venda de hoje esta ABAIXO do novo custo. Vendendo assim a loja perde dinheiro.' });
    } else if (vendaAtual > 0 && margemSeManterPreco < margemMinima) {
      alertas.push({ tipo: 'margem', texto: `Mantendo o preco de hoje a margem cai para ${margemSeManterPreco.toFixed(1)}%.` });
    }
    if (produto.cancelado) {
      alertas.push({ tipo: 'cancelado', texto: 'Esse produto esta marcado como CANCELADO no Solus. Confira antes de atualizar.' });
    }
  }

  // o que a ferramenta recomenda por padrao
  let recomendacao = 'manter';
  if (novoProduto) {
    recomendacao = 'sugerido';
  } else if (vendaAtual <= 0) {
    recomendacao = 'sugerido';
  } else if (Math.abs(variacaoCusto) >= avisarAumentoAcima || vendaAtual < custoNovo) {
    recomendacao = 'sugerido';
  }

  return {
    novoProduto,
    custoAntigo: arredondar(custoAntigo),
    custoNovo: arredondar(custoNovo),
    variacaoCusto: arredondar(variacaoCusto, 1),
    vendaAtual: arredondar(vendaAtual),
    margemAnterior: arredondar(margemAnterior, 1),
    margemSeManterPreco: arredondar(margemSeManterPreco, 1),
    precoMantendoMargem: arredondar(precoMantendoMargem),
    precoSugerido: arredondar(precoSugerido),
    margemDoSugerido: arredondar(calcularMargem(custoNovo, precoSugerido), 1),
    recomendacao,              // 'manter' = continuar com o preco de hoje
    precoEscolhido: arredondar(recomendacao === 'manter' && vendaAtual > 0 ? vendaAtual : precoSugerido),
    alertas,
  };
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) || 0) * fator) / fator;
}
