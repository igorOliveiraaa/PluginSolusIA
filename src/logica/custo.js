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
  if (!valorTotal || !itens.length) return itens.map(() => 0);
  // proporcao pelo valor do produto na nota; se ele nao veio (leitura por foto
  // incompleta), pelo custo do item e, em ultimo caso, dividido por igual.
  // Antes, sem valorProduto a taxa escrita na observacao sumia em silencio.
  const pesoPor = [
    (item) => item.valorProduto || 0,
    (item) => item.custoTotalItem || 0,
    () => 1,
  ].find((peso) => itens.reduce((total, item) => total + peso(item), 0) > 0);
  const soma = itens.reduce((total, item) => total + pesoPor(item), 0);
  return itens.map((item) => (valorTotal * pesoPor(item)) / soma);
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

/**
 * Aplica os ajustes que vieram da observacao do operador.
 *
 * A IA so entendeu o que foi escrito ("tem 50 reais de taxa nessa nota");
 * quem faz a conta e esta funcao, sempre do mesmo jeito:
 *   - valor da nota inteira -> rateado entre os itens, na proporcao do valor;
 *   - valor de um item -> vai so naquele item;
 *   - unidades por caixa -> recalcula quantidade e custo por unidade.
 */
export function aplicarAjustes(itens, ajustes) {
  if (!ajustes?.temAjuste) return itens;

  const porNumero = new Map((ajustes.porItem || []).map((a) => [a.numero, a]));
  const diferencaDaNota = (ajustes.acrescimoNaNota || 0) - (ajustes.descontoNaNota || 0);
  const rateio = ratear(diferencaDaNota, itens);
  const nomeDoPercentual = ajustes.nomeDoPercentual || 'acréscimo';

  return itens.map((item, indice) => {
    const ajuste = porNumero.get(item.numero);
    const explicacoes = [];

    let quantidade = item.quantidadeUnidades;
    let custoTotal = item.custoTotalItem;

    // 0) porcentagem (DIFAL de mercadoria que veio de outro estado, por exemplo).
    // A base e o valor da mercadoria na nota: produto - desconto + frete + IPI +
    // outras despesas. Credito de ICMS e ST nao entram - nao sao valor da operacao.
    const percentual = ajuste?.percentual || ajustes.percentualNaNota || 0;
    let valorDoPercentual = 0;
    if (percentual > 0) {
      const c = item.composicaoCusto || {};
      const base = c.produtos !== undefined
        ? (c.produtos || 0) - (c.desconto || 0) + (c.frete || 0) + (c.outrasDespesas || 0) + (c.ipi || 0)
        : (item.valorProduto || item.custoTotalItem || 0);
      valorDoPercentual = arredondar(base * (percentual / 100), 2);
      if (valorDoPercentual) {
        custoTotal += valorDoPercentual;
        explicacoes.push(`+ ${nomeDoPercentual} ${String(percentual).replace('.', ',')}%: `
          + `R$ ${formatar(valorDoPercentual)} (sobre R$ ${formatar(base)})`);
      }
    }

    // 1) quantas unidades vem na caixa
    if (ajuste?.unidadesPorCaixa > 1 && item.quantidadeComercial > 0) {
      quantidade = item.quantidadeComercial * ajuste.unidadesPorCaixa;
      explicacoes.push(`${ajuste.unidadesPorCaixa} unidades por ${item.unidadeOriginal || 'caixa'} (voce informou)`);
    }

    // 2) valor so deste item
    const doItem = (ajuste?.acrescimo || 0) - (ajuste?.desconto || 0);
    if (doItem) {
      custoTotal += doItem;
      explicacoes.push(`${doItem > 0 ? '+' : '-'} R$ ${Math.abs(doItem).toFixed(2).replace('.', ',')} neste item`);
    }

    // 3) parte do valor da nota inteira
    const daNota = rateio[indice] || 0;
    if (daNota) {
      custoTotal += daNota;
      explicacoes.push(`${daNota > 0 ? '+' : '-'} R$ ${Math.abs(daNota).toFixed(2).replace('.', ',')} rateado da nota`);
    }

    if (!explicacoes.length) return item;

    const quantidadeFinal = quantidade > 0 ? quantidade : 1;
    return {
      ...item,
      quantidadeUnidades: quantidadeFinal,
      unidadesPorCaixa: ajuste?.unidadesPorCaixa > 1 ? ajuste.unidadesPorCaixa : item.unidadesPorCaixa,
      convertido: ajuste?.unidadesPorCaixa > 1 ? true : item.convertido,
      custoTotalItem: arredondar(custoTotal, 2),
      custoUnitario: arredondar(custoTotal / quantidadeFinal, 4),
      ajusteAplicado: explicacoes.join(' · '),
      // para o resumo da tela: quanto a observacao somou/tirou neste item
      ajusteValores: {
        percentual: valorDoPercentual,
        doItem,
        daNota,
        custoAntes: item.custoUnitario,
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
