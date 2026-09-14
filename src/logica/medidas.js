// Medidas escritas no nome do item vendido.
//
// Tapete personalizado e vendido por metro quadrado, mas o Solus guarda na venda
// o PEDACO inteiro: a descricao vira "TAPETE PERSONALIZADO KAPAZI 3.70 X 2.10" e
// o preco e R$ 2.952,60 - o valor da peca, nao do metro. Quem vai orcar precisa
// do valor do METRO (2952,60 / 7,77 = R$ 380,00/m2), que e o numero comparavel
// com a tabela e com o que foi cobrado das outras vezes.
//
// Conferido contra vendas reais da loja: os valores batem exatamente com o preco
// de tabela do cadastro "... M2".

// unidades que NAO sao medida de comprimento: "5 X 180 GR" nao e 5m por 180m
const NAO_E_MEDIDA = /^(GR?|KG|ML|L|LT|UN|PCT|CX|FD|W|V)\b/i;

const numero = (texto) => Number(String(texto).replace(',', '.'));

/**
 * Le largura e comprimento do nome do item.
 * Devolve null quando nao ha medida de verdade (a maioria dos produtos).
 */
export function lerMedidas(descricao) {
  const texto = String(descricao || '');
  const achado = texto.match(
    /(\d+(?:[.,]\d+)?)\s*(CM|MM|M)?\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(CM|MM|M)?/i
  );
  if (!achado) return null;

  // o que vem logo depois: se for grama, litro e afins, aquilo nao era medida
  const depois = texto.slice(achado.index + achado[0].length).trimStart();
  if (NAO_E_MEDIDA.test(depois)) return null;

  let largura = numero(achado[1]);
  let comprimento = numero(achado[3]);
  if (!Number.isFinite(largura) || !Number.isFinite(comprimento)) return null;
  if (largura <= 0 || comprimento <= 0) return null;

  // a unidade que valer: a do segundo numero, senao a do primeiro
  let unidade = (achado[4] || achado[2] || '').toUpperCase();

  // sem unidade escrita: numero grande so pode ser centimetro
  // ("40 X 70" num pano e 40cm x 70cm, nao 40 metros)
  if (!unidade) unidade = (largura > 20 || comprimento > 20) ? 'CM' : 'M';

  const divisor = unidade === 'CM' ? 100 : unidade === 'MM' ? 1000 : 1;
  largura /= divisor;
  comprimento /= divisor;

  // acima disso nao e peca de tapete, e algum numero solto no meio do nome
  if (largura > 60 || comprimento > 60) return null;

  return {
    largura,
    comprimento,
    area: Math.round(largura * comprimento * 10000) / 10000,
    unidade,
    emMetros: unidade === 'M',
    escrito: achado[0].trim(),
  };
}

/** O cadastro e vendido por metro quadrado? ("TAPETE PERSONALIZADO KAPAZI M2") */
export function vendidoPorMetro(nomeDoCadastro) {
  return /\bM2\b|\bM²|METRO QUADRADO/i.test(String(nomeDoCadastro || ''));
}

/**
 * Quanto ficou o metro quadrado naquela venda.
 *
 * So faz a conta quando ela significa alguma coisa: ou o cadastro e vendido por
 * m2, ou a medida esta em metros. Para um pano de chao "40 X 70 CM" o valor do
 * metro quadrado nao quer dizer nada e so confundiria quem le.
 */
export function porMetroQuadrado(preco, descricaoDaVenda, nomeDoCadastro = '') {
  const medidas = lerMedidas(descricaoDaVenda);
  const valor = Number(preco) || 0;
  if (!medidas || valor <= 0 || medidas.area <= 0) return null;
  if (!medidas.emMetros && !vendidoPorMetro(nomeDoCadastro)) return null;

  return { ...medidas, metroQuadrado: Math.round((valor / medidas.area) * 100) / 100 };
}

/** Texto pronto para a resposta: "7,77 m² · R$ 380,00 o m²". */
export function explicarMedida(preco, descricaoDaVenda, nomeDoCadastro = '') {
  const conta = porMetroQuadrado(preco, descricaoDaVenda, nomeDoCadastro);
  if (!conta) return '';
  const brl = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');
  return `${conta.area.toFixed(2).replace('.', ',')} m² · ${brl(conta.metroQuadrado)} o m²`;
}
