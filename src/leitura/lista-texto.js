// Leitura de lista DIGITADA, sem IA.
//
// Quando a pessoa digita a lista na mao ("2 saco de lixo 100 litros"), nao faz
// sentido gastar uma chamada de IA: o formato e simples e a leitura aqui e exata.
// A IA fica para o que ela faz de melhor: ler foto e letra de mao.

// So abreviacoes que sao SEMPRE embalagem.
// Palavras como SACO, BALDE, GALAO, ROLO e KIT ficam de fora de proposito:
// numa loja de limpeza elas sao o nome do produto ("2 saco de lixo"), e tratar
// isso como unidade estragaria a busca no estoque.
const UNIDADES = [
  'CX', 'CAIXA', 'CAIXAS', 'FD', 'FARDO', 'FARDOS', 'PCT',
  'UN', 'UNID', 'UNIDADE', 'UNIDADES', 'PC', 'PECA', 'PECAS',
  'DZ', 'DUZIA', 'DP', 'DISPLAY',
];

const MEDIDA = /(\d+(?:[.,]\d+)?)\s*(ML|LITROS?|LTS?|L|KG|GR?|MG|MT?|METROS?|CM|MM|UN|UNID)\b/i;

function semAcento(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Le uma linha e separa quantidade, unidade e descricao.
 * Entende os jeitos que as pessoas escrevem de verdade:
 *   "2 saco de lixo"      "10x detergente"     "detergente - 5"
 *   "3 cx de sabao"       "5 un vassoura"      "sabao em po 1kg x 4"
 */
function lerLinha(linha, numero) {
  const original = linha.trim();
  let resto = original;
  let quantidade = null;
  let unidade = '';

  // "10x produto" ou "10 x produto"
  const comX = resto.match(/^(\d+(?:[.,]\d+)?)\s*[xX*]\s+(.+)$/);
  if (comX) {
    quantidade = Number(comX[1].replace(',', '.'));
    resto = comX[2];
  }

  // "2 produto" / "2 cx produto"
  if (quantidade === null) {
    const comNumero = resto.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
    if (comNumero) {
      quantidade = Number(comNumero[1].replace(',', '.'));
      resto = comNumero[2];

      const palavras = resto.split(/\s+/);
      const primeira = semAcento(palavras[0] || '').toUpperCase().replace(/[^A-Z]/g, '');

      if (UNIDADES.includes(primeira)) {
        unidade = primeira;
        // como a lista so tem embalagem de verdade, da para tirar da descricao:
        // "3 cx de sabao" e "6 un rodo" viram "sabao" e "rodo"
        const semUnidade = palavras.slice(1);
        if (/^de$/i.test(semUnidade[0] || '')) semUnidade.shift();
        // so aceita se ainda sobrar nome de produto
        if (semUnidade.join(' ').trim().length >= 2) resto = semUnidade.join(' ');
      }
    }
  }

  // "produto - 5" ou "produto x 5" no fim
  if (quantidade === null) {
    const noFim = resto.match(/^(.+?)\s*[-–x*]\s*(\d+(?:[.,]\d+)?)\s*$/i);
    if (noFim) {
      resto = noFim[1];
      quantidade = Number(noFim[2].replace(',', '.'));
    }
  }

  if (!quantidade || quantidade <= 0) quantidade = 1;

  // tamanho ("500ml", "1kg", "100 litros")
  const medida = resto.match(MEDIDA);
  const tamanho = medida ? `${medida[1]}${medida[2]}`.toUpperCase() : '';

  const descricao = resto
    .replace(/^[-•*.\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    numero,
    textoOriginal: original,
    descricao,
    quantidade,
    unidade,
    marca: '',
    tamanho,
    observacao: quantidade === 1 && !/^\d/.test(original)
      ? 'A quantidade nao estava escrita; considerei 1.'
      : '',
    confianca: 'alta',      // foi digitado, nao tem erro de leitura
  };
}

/** Le a lista inteira digitada. Uma linha por item. */
export function lerListaDigitada(texto) {
  const linhas = String(texto || '')
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2);

  const itens = linhas
    .map((linha, indice) => lerLinha(linha, indice + 1))
    .filter((item) => item.descricao.length >= 2);

  return {
    clienteCitado: '',
    observacoes: '',
    itens,
  };
}
