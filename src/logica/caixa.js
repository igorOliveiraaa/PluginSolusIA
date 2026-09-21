// Caixa ou unidade? A decisao final, olhando o PRODUTO DO SOLUS.
//
// A regra da loja: tudo entra SEPARADO em unidade. A excecao e o que a loja vende
// fechado - produto cadastrado no Solus como CX, PCT, FD... (acucar sache em caixa,
// saco de lixo C/100 em pacote, papel higienico em fardo). Esses entram como estao.
//
// Para saber quantas unidades vem na caixa, nesta ordem de confianca:
//   1. o XML ja diz (quantidade tributavel em UN)            -> certeza
//   2. o Plugin ja aprendeu numa nota anterior desse produto -> certeza
//   3. a descricao diz ("C/12", "12X500ML") E a conta bate  -> certeza
//   4. a descricao diz, mas nao da para conferir pela conta -> pede para conferir
//   5. so a conta do custo diz (caixa de R$ 60, unidade custa R$ 5 = 12)
//                                                            -> pede para conferir
//   6. nada disso -> pergunta. Chutar quantidade vira estoque errado.
//
// "A conta do custo": o preco da caixa na nota dividido pelo custo por unidade
// que o produto tem hoje no Solus. Da um numero proximo de inteiro quando a caixa
// e de N unidades. So vale se ficar a menos de 18% de um inteiro - aumento de
// preco entre uma compra e outra cabe nessa folga.

import { unidadesNaDescricao, ehUnidadeDeCaixa } from '../leitura/xml.js';

// unidade de cadastro que significa "a loja vende isso fechado"
const VENDE_FECHADO = /^(CX|CAIXA|FD|FARDO|PCT|PACOTE|DP|DISPLAY|CJ|KIT)$/;
const FOLGA_DA_CONTA = 0.18;

export function vendeFechado(produto) {
  return VENDE_FECHADO.test(String(produto?.unidade || '').trim().toUpperCase());
}

const arredondar = (valor, casas = 4) => Math.round((Number(valor) || 0) * 10 ** casas) / 10 ** casas;

// tamanhos de caixa/fardo que existem de verdade no atacado. Com preco que subiu
// desde a ultima compra, "R$ 65 ÷ R$ 5 = 13" e na verdade a caixa de 12 um pouco
// mais cara: entre um tamanho comum e um numero "quebrado", fica o comum.
const TAMANHOS_COMUNS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 24, 25, 30, 36, 40, 48, 50, 60,
  72, 80, 96, 100, 120, 144, 150, 200, 240, 250, 300, 400, 500, 600, 1000];

const perto = (razao, n) => Math.abs(razao - n) / n <= FOLGA_DA_CONTA;

/**
 * Quantas unidades a conta do custo indica (0 = a conta nao diz nada seguro).
 * `bate(n)` diz se um numero vindo de outro lugar (descricao) confere com a conta.
 */
function pelaConta(precoNaNota, custoDoProduto) {
  if (!(precoNaNota > 0) || !(custoDoProduto > 0)) return { vezes: 0, razao: 0, bate: () => false };
  const razao = precoNaNota / custoDoProduto;
  const bate = (n) => n > 1 && perto(razao, n);
  if (razao < 1.6 || razao > 1100) return { vezes: 0, razao, bate };

  // 1o: o tamanho comum mais perto, dentro da folga
  const comum = TAMANHOS_COMUNS
    .filter((n) => perto(razao, n))
    .sort((a, b) => Math.abs(razao - a) / a - Math.abs(razao - b) / b)[0];
  if (comum) return { vezes: comum, razao, bate };
  // 2o: numero "quebrado" so se a conta fechar quase exata (ate 3%)
  const inteiro = Math.round(razao);
  return { vezes: Math.abs(razao - inteiro) / inteiro <= 0.03 ? inteiro : 0, razao, bate };
}

const dinheiro = (valor) => 'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');

/**
 * Decide a quantidade em unidades de UM item da nota.
 * `lembrar(codigoProduto, unidadeDaNota)` devolve o que ja foi aprendido (ou null).
 */
export function decidirCaixa(item, produto, lembrar = () => null) {
  // o que a pessoa escreveu na observacao ("a caixa vem com 24") manda em tudo
  if (item.caixaDaObservacao) return item;

  const qCom = Number(item.quantidadeComercial) > 0 ? Number(item.quantidadeComercial) : 0;
  if (!qCom) return item;
  const uCom = String(item.unidadeComercial || item.unidadeOriginal || '').trim().toUpperCase();
  const total = Number(item.custoTotalItem) || 0;
  const precoNaNota = total / qCom;                       // custo de UMA unidade comercial
  const custoHoje = Number(produto?.custoAtual) || 0;
  const descricao = unidadesNaDescricao(item.descricao);
  const aprendido = produto ? lembrar(produto.codigo, uCom) : null;
  const notaEmCaixa = ehUnidadeDeCaixa(uCom);

  const decidir = (porCaixa, confianca, explicacao, origem) => {
    const quantidade = qCom * (porCaixa > 1 ? porCaixa : 1);
    return {
      ...item,
      quantidadeUnidades: quantidade,
      custoUnitario: arredondar(total / quantidade),
      unidadesPorCaixa: porCaixa > 1 ? porCaixa : 0,
      convertido: porCaixa > 1,
      confianca,
      explicacao,
      origemDaCaixa: origem,
    };
  };

  // ---- A) a loja vende esse produto FECHADO: entra como esta -----------------
  if (produto && vendeFechado(produto)) {
    const unidadeLoja = String(produto.unidade).trim().toUpperCase();
    if (aprendido?.porCaixa > 1) {
      return decidir(aprendido.porCaixa, 'alta',
        `A loja vende fechado (${unidadeLoja}). Cada ${uCom} desta nota tem ${aprendido.porCaixa} ${unidadeLoja} `
        + '(aprendido numa nota anterior deste produto).', 'aprendido');
    }
    // a nota pode vir numa embalagem MENOR que a da loja: 720 UN de guardanapo que
    // a loja vende em CX de 72. Sem isto entrariam 720 CAIXAS no estoque.
    if (custoHoje > 0 && precoNaNota > 0 && precoNaNota / custoHoje < 0.6) {
      const porEmbalagem = Math.round(custoHoje / precoNaNota);
      const bate = porEmbalagem >= 2
        && Math.abs(custoHoje / precoNaNota - porEmbalagem) / porEmbalagem <= FOLGA_DA_CONTA;
      if (bate) {
        const quantidade = arredondar(qCom / porEmbalagem, 2);
        return {
          ...item,
          quantidadeUnidades: quantidade,
          custoUnitario: arredondar(total / quantidade),
          unidadesPorCaixa: 0,
          convertido: true,
          confianca: Number.isInteger(quantidade) ? 'media' : 'baixa',
          origemDaCaixa: 'juntar',
          explicacao: `A loja vende fechado (${unidadeLoja}) e a nota veio em ${uCom || 'unidade'}: pela conta do `
            + `custo, ${porEmbalagem} ${uCom || 'unidades'} formam 1 ${unidadeLoja}. Entram ${String(quantidade).replace('.', ',')} `
            + `${unidadeLoja}. Confira.`,
        };
      }
    }

    // a nota pode vir numa embalagem MAIOR que a da loja (CX com 10 PCT)
    const conta = pelaConta(precoNaNota, custoHoje);
    if (uCom && uCom !== unidadeLoja && conta.vezes > 1) {
      return decidir(conta.vezes, 'media',
        `A loja vende fechado (${unidadeLoja}), e a nota veio em ${uCom}: pela conta do custo `
        + `(${dinheiro(precoNaNota)} ÷ ${dinheiro(custoHoje)}) cada ${uCom} tem ${conta.vezes} ${unidadeLoja}. Confira.`,
        'conta');
    }
    return decidir(1, 'alta',
      `A loja vende este produto fechado (${unidadeLoja}), então entrou ${qCom} ${unidadeLoja} sem separar em unidades.`,
      'vende-fechado');
  }

  // ---- B) vendido por unidade: separa sempre que der para saber --------------

  // 1. o proprio XML ja converteu pela quantidade tributavel
  if (item.convertido && item.confianca === 'alta' && item.unidadesPorCaixa > 1) {
    const unitario = total / (qCom * item.unidadesPorCaixa);
    const estranho = custoHoje > 0 && (unitario > custoHoje * 3 || unitario < custoHoje / 3);
    if (!estranho) return { ...item, origemDaCaixa: 'xml' };
    return {
      ...item,
      confianca: 'media',
      origemDaCaixa: 'xml',
      explicacao: `${item.explicacao} Atenção: o custo por unidade ficou ${dinheiro(unitario)} e o produto `
        + `custava ${dinheiro(custoHoje)}. Confira a quantidade.`,
    };
  }

  // 2. aprendido numa nota anterior
  if (aprendido?.porCaixa > 1 && (notaEmCaixa || descricao > 1)) {
    return decidir(aprendido.porCaixa, 'alta',
      `Cada ${uCom || 'caixa'} tem ${aprendido.porCaixa} unidades (aprendido numa nota anterior deste produto).`,
      'aprendido');
  }

  const conta = pelaConta(precoNaNota, custoHoje);

  // 3 e 4. a descricao diz quantas vem
  if (descricao > 1 && (notaEmCaixa || conta.bate(descricao))) {
    if (conta.bate(descricao)) {
      return decidir(descricao, 'alta',
        `A descrição diz ${descricao} por ${uCom || 'caixa'} e a conta do custo confirma `
        + `(${dinheiro(precoNaNota)} ÷ ${dinheiro(custoHoje)} ≈ ${descricao}).`, 'descricao+conta');
    }
    return decidir(descricao, 'media',
      `A nota veio em ${uCom} e a descrição indica ${descricao} unidades por ${uCom}. Confira se está certo.`,
      'descricao');
  }

  // 5. so a conta do custo (apenas quando a nota veio em caixa: com UN, um preco
  //    que dobrou pareceria "caixa de 2")
  if (notaEmCaixa && conta.vezes > 1) {
    return decidir(conta.vezes, 'media',
      `A nota veio em ${uCom} sem dizer quantas vêm. Pela conta do custo (${dinheiro(precoNaNota)} ÷ `
      + `${dinheiro(custoHoje)}) cada ${uCom} tem ${conta.vezes} unidades. Confira.`, 'conta');
  }

  // 6. em caixa e sem nenhuma pista: pergunta
  if (notaEmCaixa) {
    return {
      ...item,
      quantidadeUnidades: qCom,
      custoUnitario: arredondar(total / qCom),
      unidadesPorCaixa: 0,
      convertido: false,
      confianca: 'baixa',
      origemDaCaixa: 'perguntar',
      explicacao: `A nota veio em ${uCom} e não dá para saber quantas unidades vêm dentro. `
        + `Informe a quantidade de unidades (a loja vende este produto por ${produto?.unidade || 'unidade'}).`,
    };
  }

  return item;
}
