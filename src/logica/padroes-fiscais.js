// Campos fiscais que o produto PRECISA ter para a nota de venda sair.
//
// A importacao de nota nao traz isso (o CST que vem no XML e o do FORNECEDOR,
// nao o da loja), e produto cadastrado pelo Plugin nascia com esses campos
// vazios - a nota de venda depois era recusada. A regra que o dono da loja
// passou: quando o produto nao tiver, preenche com o padrao da loja.
//
// So preenche o que esta VAZIO. Produto que ja tem um CST diferente (500,
// 300...) foi configurado assim de proposito por alguem e continua como esta.
//
// Na tela de produto do Solus:
//   Situacao Tributaria (CST) ........ 102    TRIBUTADA SEM PERMISSAO DE CREDITO DE ICMS
//   CST Cbs/Ibs ....................... 000    TRIBUTACAO INTEGRAL
//   Classificacao Fiscal .............. 000001 SITUACOES TRIBUTADAS INTEGRALMENTE PELO IBS E CBS
//   Acessa Descricao na Venda ......... N
//   Acessa Valores na Venda ........... S
//   Baixa Estoque ..................... S

/** Colunas com nome conhecido (conferido no banco do Solus). */
const FIXOS = [
  { coluna: 'TRIBUTARIA', valor: '102', nome: 'CST' },
  // a mesma situacao para venda para fora do estado; no banco anda sempre igual a TRIBUTARIA
  { coluna: 'TRIBUTARIAINTER', valor: '102', nome: 'CST interestadual' },
  { coluna: 'ACESSAD', valor: 'N', nome: 'Acessa descrição na venda' },
  { coluna: 'ACESSAV', valor: 'S', nome: 'Acessa valores na venda' },
  { coluna: 'ACESSAESTOQUE', valor: 'S', nome: 'Baixa estoque' },
];

/*
 * Os campos da reforma tributaria (IBS/CBS) sao novos: a copia do banco usada no
 * desenvolvimento e anterior a eles, entao o nome exato da coluna nao foi visto.
 * Em vez de chutar um nome, procura pelo padrao - e so aceita coluna que fale
 * claramente do assunto, para nunca gravar "000" numa coluna errada.
 */
const PELO_NOME = [
  {
    // CSTIBS, CSTCBS, CSTIBSCBS, CST_IBS_CBS, CSTCBSIBS...
    teste: (c) => /CST/.test(c) && /(IBS|CBS)/.test(c) && !/ALIQ|VALOR|BASE|PERC/.test(c),
    valor: '000',
    nome: 'CST Cbs/Ibs',
  },
  {
    // CCLASSTRIB, CLASSTRIB, CLASSIFICACAOFISCAL, CLASSFISCAL, CLASSIFTRIB...
    teste: (c) => /CCLASS|CLASSTRIB|CLASSIFTRIB|CLASSFISC|CLASSIFICACAOFISC|CLASSIFICACAOTRIB/.test(c),
    valor: '000001',
    nome: 'Classificação fiscal',
  },
];

/**
 * Quais colunas desta versao do Solus recebem padrao, e com qual valor.
 * `estrutura` = { nomes: Set, tamanhos: Map } (de estruturaDe('PRODUTO')).
 * So entra coluna onde o valor cabe inteiro.
 */
export function camposFiscaisDoBanco(estrutura) {
  const { nomes, tamanhos } = estrutura;
  const cabe = (coluna, valor) => {
    const tamanho = tamanhos.get(coluna) || 0;
    return !tamanho || tamanho >= valor.length;
  };

  const campos = FIXOS.filter((f) => nomes.has(f.coluna) && cabe(f.coluna, f.valor));
  for (const regra of PELO_NOME) {
    for (const coluna of nomes) {
      if (regra.teste(coluna) && cabe(coluna, regra.valor)) {
        campos.push({ coluna, valor: regra.valor, nome: regra.nome });
      }
    }
  }
  return campos;
}

const vazio = (valor) => valor === null || valor === undefined || String(valor).trim() === ''
  || String(valor).trim() === '.';

/**
 * O que precisa ser preenchido num produto que ja existe.
 * `atual` = valores lidos do banco para essas colunas.
 * Devolve { preencher: {COLUNA: valor}, antes: {COLUNA: valorAntigo}, nomes: [...] }.
 */
export function oQueFaltaPreencher(campos, atual) {
  const preencher = {};
  const antes = {};
  const nomes = [];
  for (const campo of campos) {
    const valor = atual?.[campo.coluna];
    if (!vazio(valor)) continue;
    preencher[campo.coluna] = campo.valor;
    antes[campo.coluna] = valor ?? '';
    nomes.push(campo.nome);
  }
  return { preencher, antes, nomes };
}

/** Os padroes para um produto novo: todos os campos, sem olhar nada. */
export function padroesParaProdutoNovo(campos) {
  return Object.fromEntries(campos.map((c) => [c.coluna, c.valor]));
}
