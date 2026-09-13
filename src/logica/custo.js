// Custo real do produto que entrou pela nota.
//
// O preco que aparece na nota NAO e o custo de verdade. Falta somar frete, IPI e
// ICMS-ST (que a loja paga e nao recupera) e, dependendo do regime da empresa,
// descontar os impostos que a loja aproveita como credito.
//
// Regime da loja:
//  - SIMPLES NACIONAL: nao aproveita credito de ICMS/PIS/COFINS -> custo cheio.
//  - LUCRO PRESUMIDO / REAL: aproveita o credito -> custo desconta esses impostos.

/**
 * Rateia um valor que so veio no total da nota (ex.: frete) entre os itens,
 * na proporcao do valor de cada um.
 */
function ratear(valorTotal, itens) {
  const soma = itens.reduce((total, item) => total + (item.valorProduto || 0), 0);
  if (!valorTotal || soma <= 0) return itens.map(() => 0);
  return itens.map((item) => (valorTotal * (item.valorProduto || 0)) / soma);
}

/**
 * Calcula o custo de cada item da nota.
 * Devolve os itens com custoTotalItem, custoUnitario e a conta detalhada,
 * para a tela poder mostrar de onde saiu cada centavo.
 */
export function calcularCustos(nota, { regime = 'simples', somarFrete = true, somarIPI = true, somarST = true } = {}) {
  const itens = nota.itens || [];
  const aproveitaCredito = regime === 'normal';

  // frete/seguro/outras despesas as vezes vem so no total da nota
  const freteNoItem = itens.some((item) => (item.frete || 0) > 0);
  const outrosNoItem = itens.some((item) => (item.outrasDespesas || 0) > 0 || (item.seguro || 0) > 0);

  const freteRateado = freteNoItem ? itens.map((i) => i.frete || 0) : ratear(nota.totais?.frete || 0, itens);
  const outrosRateados = outrosNoItem
    ? itens.map((i) => (i.outrasDespesas || 0) + (i.seguro || 0))
    : ratear((nota.totais?.outras || 0) + (nota.totais?.seguro || 0), itens);

  return itens.map((item, indice) => {
    const quantidade = item.quantidadeUnidades > 0 ? item.quantidadeUnidades : 1;

    const valorProdutos = item.valorProduto || 0;
    const desconto = item.desconto || 0;
    const frete = somarFrete ? freteRateado[indice] || 0 : 0;
    const outros = somarFrete ? outrosRateados[indice] || 0 : 0;
    const ipi = somarIPI ? item.valorIPI || 0 : 0;
    const substituicao = somarST ? (item.valorICMSST || 0) + (item.valorFCPST || 0) : 0;

    // creditos (so para quem nao e Simples Nacional)
    const creditoICMS = aproveitaCredito ? item.valorICMS || 0 : 0;

    const custoTotalItem = valorProdutos - desconto + frete + outros + ipi + substituicao - creditoICMS;
    const custoUnitario = custoTotalItem / quantidade;

    return {
      ...item,
      custoUnitario: arredondar(custoUnitario, 4),
      custoTotalItem: arredondar(custoTotalItem, 2),
      // custo "seco", so a mercadoria, para comparacao
      custoSemEncargos: arredondar((valorProdutos - desconto) / quantidade, 4),
      composicaoCusto: {
        produtos: arredondar(valorProdutos, 2),
        desconto: arredondar(desconto, 2),
        frete: arredondar(frete, 2),
        outrasDespesas: arredondar(outros, 2),
        ipi: arredondar(ipi, 2),
        icmsST: arredondar(substituicao, 2),
        creditoICMS: arredondar(creditoICMS, 2),
        regime,
      },
    };
  });
}

/** Explica em uma frase o que entrou no custo, para mostrar na tela. */
export function explicarCusto(composicao) {
  if (!composicao) return '';
  const partes = [`produto R$ ${formatar(composicao.produtos)}`];
  if (composicao.desconto > 0) partes.push(`- desconto R$ ${formatar(composicao.desconto)}`);
  if (composicao.frete > 0) partes.push(`+ frete R$ ${formatar(composicao.frete)}`);
  if (composicao.outrasDespesas > 0) partes.push(`+ despesas R$ ${formatar(composicao.outrasDespesas)}`);
  if (composicao.ipi > 0) partes.push(`+ IPI R$ ${formatar(composicao.ipi)}`);
  if (composicao.icmsST > 0) partes.push(`+ ICMS-ST R$ ${formatar(composicao.icmsST)}`);
  if (composicao.creditoICMS > 0) partes.push(`- credito de ICMS R$ ${formatar(composicao.creditoICMS)}`);
  return partes.join(' ');
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(valor) || 0) * fator) / fator;
}

function formatar(valor) {
  return (Number(valor) || 0).toFixed(2).replace('.', ',');
}
