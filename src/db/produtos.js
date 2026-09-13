// Busca e atualizacao de produtos no Solus.
// Tudo aqui e defensivo: antes de gravar, confere quais colunas existem de verdade
// no banco da loja (versoes diferentes do Solus tem campos diferentes).

import { consultar, paraNumero, paraTextoBR, campoTexto, lerTexto } from './firebird.js';
import { carregarConfig } from '../config.js';

const cacheColunas = new Map();

/** Lista as colunas que a tabela realmente tem neste banco. */
export async function colunasDe(tabela) {
  const nome = tabela.toUpperCase();
  if (cacheColunas.has(nome)) return cacheColunas.get(nome);
  const linhas = await consultar(
    `SELECT TRIM(RF.RDB$FIELD_NAME) AS COLUNA
       FROM RDB$RELATION_FIELDS RF
      WHERE RF.RDB$RELATION_NAME = ?`,
    [nome]
  );
  const conjunto = new Set(linhas.map((l) => String(l.COLUNA).trim().toUpperCase()));
  cacheColunas.set(nome, conjunto);
  return conjunto;
}

export function limparCacheColunas() {
  cacheColunas.clear();
}

/** Tira acento, pontuacao e espaco duplo - usado para comparar descricoes. */
export function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** So os digitos - codigo de barras as vezes vem com espaco ou ponto. */
function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

// DESCRICAO vem como bytes crus (CHARACTER SET OCTETS) para o acento nao quebrar
const CAMPOS_PRODUTO = `CODIGO, ${campoTexto('DESCRICAO', 70)}, BARRAS, CODBARRAS, REFERENCIA,
  UNIDADE, UNCOMPRA, VOLUMECAIXA, VOLUMECAIXA1, ESTOQUEATUAL, ESTOQUETOTAL,
  PRECOCUSTO, PRECOVENDA, PC, PV, UPRECOCUSTO, UPC, MARGEM, GRUPO, NCM, CEST,
  FORNECEDOR, STATUS, TRIBUTARIA, CST`;

function montarProduto(linha) {
  if (!linha) return null;
  const custo = paraNumero(linha.PRECOCUSTO ?? linha.PC);
  const venda = paraNumero(linha.PRECOVENDA ?? linha.PV);
  return {
    codigo: String(linha.CODIGO || '').trim(),
    descricao: lerTexto(linha.DESCRICAO),
    barras: soDigitos(linha.BARRAS) || soDigitos(linha.CODBARRAS),
    referencia: String(linha.REFERENCIA || '').trim(),
    unidade: String(linha.UNIDADE || '').trim(),
    unidadeCompra: String(linha.UNCOMPRA || '').trim(),
    volumeCaixa: paraNumero(linha.VOLUMECAIXA) || paraNumero(linha.VOLUMECAIXA1),
    estoque: paraNumero(linha.ESTOQUEATUAL),
    custoAtual: custo,
    vendaAtual: venda,
    custoAnterior: paraNumero(linha.UPRECOCUSTO ?? linha.UPC),
    margemAtual: custo > 0 ? ((venda - custo) / custo) * 100 : paraNumero(linha.MARGEM),
    grupo: String(linha.GRUPO || '').trim(),
    ncm: String(linha.NCM || '').trim(),
    cest: String(linha.CEST || '').trim(),
    status: String(linha.STATUS || '').trim(),
    // no Solus, produto ativo fica com STATUS vazio; 'CANCELADO' e produto desativado
    cancelado: String(linha.STATUS || '').trim().toUpperCase() === 'CANCELADO',
  };
}

/** Busca pelo codigo de barras (olha os dois campos que o Solus usa). */
export async function buscarPorBarras(codigoBarras) {
  const ean = soDigitos(codigoBarras);
  if (!ean || ean.length < 8) return null;

  // EAN-13 as vezes esta gravado sem o zero da frente (ou com um a mais)
  const variantes = [...new Set([ean, ean.replace(/^0+/, ''), ean.padStart(13, '0'), ean.padStart(14, '0')])];
  const marcadores = variantes.map(() => '?').join(', ');

  const linhas = await consultar(
    `SELECT FIRST 5 ${CAMPOS_PRODUTO} FROM PRODUTO
      WHERE BARRAS IN (${marcadores}) OR CODBARRAS IN (${marcadores})`,
    [...variantes, ...variantes]
  );
  const achados = linhas.map(montarProduto).filter(Boolean);
  // se o mesmo barras aparecer em mais de um produto, fica com o que esta ativo
  return achados.find((p) => !p.cancelado) || achados[0] || null;
}

/** Busca pela referencia / codigo do produto no fornecedor. */
export async function buscarPorReferencia(referencia) {
  const ref = String(referencia || '').trim();
  if (!ref) return null;
  const linhas = await consultar(
    `SELECT FIRST 1 ${CAMPOS_PRODUTO} FROM PRODUTO WHERE UPPER(TRIM(REFERENCIA)) = ?`,
    [ref.toUpperCase()]
  );
  return montarProduto(linhas[0]);
}

/**
 * Busca pelo codigo que o FORNECEDOR usa para o produto.
 * O Solus guarda esse de-para na tabela PRODUTOFORNE:
 *   CODIGO = codigo do produto no fornecedor
 *   CODFOR = codigo do fornecedor
 *   BARRAS = codigo de barras do produto aqui na loja
 * E o que salva os itens que chegam na nota sem codigo de barras.
 */
export async function buscarPorCodigoDoFornecedor(codigoNoFornecedor, codigoFornecedor = null) {
  const cod = String(codigoNoFornecedor || '').trim();
  if (!cod) return null;

  let linhas;
  if (codigoFornecedor) {
    linhas = await consultar(
      `SELECT FIRST 1 BARRAS FROM PRODUTOFORNE
        WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?`,
      [cod, String(codigoFornecedor).trim()]
    );
  }
  // sem achar pelo par (produto + fornecedor), tenta so pelo codigo do produto
  if (!linhas?.length) {
    linhas = await consultar(
      'SELECT FIRST 1 BARRAS FROM PRODUTOFORNE WHERE TRIM(CODIGO) = ?',
      [cod]
    );
  }

  const barras = soDigitos(linhas?.[0]?.BARRAS);
  if (!barras) return null;
  return buscarPorBarras(barras);
}

/**
 * Acha os "irmaos" de um produto: outros cadastros com a descricao IDENTICA.
 * Acontece bastante no Solus (mesmo produto cadastrado 2x, com codigos de barras
 * diferentes). O sintoma classico e um deles ficar com estoque negativo, porque
 * vendem por um codigo e dao entrada no outro.
 *
 * A comparacao da descricao e feita dentro do proprio SQL (subconsulta pelo codigo)
 * de proposito: assim nao precisamos mandar texto com acento como parametro, que e
 * onde o charset antigo do banco quebraria a comparacao.
 */
export async function buscarIrmaos(codigoProduto) {
  const cod = String(codigoProduto || '').trim();
  if (!cod) return [];

  // repetido = mesma descricao OU mesmo codigo de barras
  const linhas = await consultar(
    `SELECT FIRST 20 ${CAMPOS_PRODUTO} FROM PRODUTO
      WHERE (
              DESCRICAO = (SELECT DESCRICAO FROM PRODUTO WHERE TRIM(CODIGO) = ?)
              OR (
                   BARRAS = (SELECT BARRAS FROM PRODUTO WHERE TRIM(CODIGO) = ?)
                   AND BARRAS IS NOT NULL AND BARRAS <> ''
                 )
            )
        AND TRIM(CODIGO) <> ?
        AND (STATUS IS NULL OR STATUS <> 'CANCELADO')`,
    [cod, cod, cod]
  );

  const proprio = await buscarPorCodigo(cod);
  return linhas.map(montarProduto).filter(Boolean).map((irmao) => ({
    ...irmao,
    // diz por que ele apareceu, para a tela poder explicar ao operador
    motivo: proprio && irmao.barras && irmao.barras === proprio.barras
      ? 'mesmo código de barras'
      : 'mesmo nome',
  }));
}

export async function buscarPorCodigo(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;
  const linhas = await consultar(
    `SELECT FIRST 1 ${CAMPOS_PRODUTO} FROM PRODUTO WHERE TRIM(CODIGO) = ?`,
    [cod]
  );
  return montarProduto(linhas[0]);
}

/**
 * Escolhe as palavras que vao para o LIKE.
 * Duas manhas importantes:
 *  - pega as palavras maiores (mais especificas), no maximo 3;
 *  - o banco guarda acento em ANSI, entao "SABAO" nunca casaria com "SABÃO":
 *    quando a palavra tem acento, procuramos so o pedaco antes dele ("SAB").
 */
// Palavras que quase nao ajudam a achar o produto: unidade de medida, ligacao,
// e palavras genericas demais. Elas nunca podem virar a palavra principal da
// busca - foi o que fez "saco de lixo 100 LITROS" trazer bacia e balde.
const PALAVRAS_FRACAS = new Set([
  'LITRO', 'LITROS', 'LTS', 'UNIDADE', 'UNIDADES', 'PACOTE', 'PACOTES', 'CAIXA',
  'CAIXAS', 'FARDO', 'PECA', 'PECAS', 'KIT', 'PRODUTO', 'PRODUTOS', 'ITEM',
  'ITENS', 'TAMANHO', 'MARCA', 'TIPO', 'COM', 'SEM', 'PARA', 'POR', 'QUE',
  'NAO', 'DOS', 'DAS', 'GRANDE', 'PEQUENO', 'MEDIO', 'NOVO', 'CADA',
]);

function limparAcento(palavra) {
  const posicaoAcento = palavra.search(/[^A-Z0-9]/);
  const termo = posicaoAcento >= 0 ? palavra.slice(0, posicaoAcento) : palavra;
  return termo.length >= 2 ? termo : palavra.slice(0, 3);
}

/**
 * Transforma a palavra num padrao de LIKE que ignora acento.
 * O problema: quem digita escreve "SABAO", mas no banco esta "SABÃO" - e o LIKE
 * comum nunca casa os dois. No Firebird o "_" vale por um caractere qualquer,
 * entao "SABAO" vira "SAB_O", que acha as duas formas.
 * So as vogais viram curinga; as consoantes seguram a busca no lugar.
 */
function padraoSemAcento(palavra) {
  return palavra.replace(/[AEIOUC]/g, '_');
}

/**
 * Separa as palavras da busca em "fortes" (as que identificam o produto) e
 * "fracas" (medida, ligacao). A busca sempre comeca pelas fortes.
 */
function palavrasDeBusca(descricao, quantidade = 3) {
  const todas = String(descricao || '')
    .toUpperCase()
    .split(/[^A-Za-zÀ-ÿ0-9]+/)
    .filter((p) => p.length >= 3 && !/^\d+$/.test(p))
    .map(limparAcento)
    .filter((p) => p.length >= 2);

  const fortes = todas.filter((p) => !PALAVRAS_FRACAS.has(p));
  const fracas = todas.filter((p) => PALAVRAS_FRACAS.has(p));

  // as fortes primeiro (maiores na frente), e as fracas so completam a lista
  const ordenadas = [
    ...fortes.sort((a, b) => b.length - a.length),
    ...fracas.sort((a, b) => b.length - a.length),
  ];

  return { todas: ordenadas.slice(0, quantidade), fortes: fortes.sort((a, b) => b.length - a.length) };
}

/**
 * Procura por descricao parecida. Usa as palavras mais "fortes" do nome
 * (as maiores) para nao trazer o catalogo inteiro.
 */
export async function buscarPorDescricao(descricao, limite = 8) {
  const { todas, fortes } = palavrasDeBusca(descricao);
  if (!todas.length) return [];

  const procurar = async (palavras, ignorarAcento = false) => {
    if (!palavras.length) return [];
    const condicoes = palavras.map(() => 'UPPER(DESCRICAO) LIKE ?').join(' AND ');
    return consultar(
      `SELECT FIRST ${limite} ${CAMPOS_PRODUTO} FROM PRODUTO WHERE ${condicoes}`,
      palavras.map((p) => `%${ignorarAcento ? padraoSemAcento(p) : p}%`)
    );
  };

  // vai afrouxando aos poucos: todas as palavras -> so as fortes -> as 2 fortes
  // principais -> a forte principal sozinha. Nunca cai numa palavra fraca
  // sozinha, senao "100 litros" traz o setor de baldes inteiro.
  const tentativas = [
    { palavras: todas, ignorarAcento: false },
    // mesma busca, mas aceitando acento no banco ("SABAO" achando "SABÃO")
    { palavras: todas, ignorarAcento: true },
    fortes.length && fortes.length !== todas.length ? { palavras: fortes, ignorarAcento: true } : null,
    fortes.length > 2 ? { palavras: fortes.slice(0, 2), ignorarAcento: true } : null,
    fortes.length > 1 ? { palavras: [fortes[0]], ignorarAcento: true } : null,
  ].filter(Boolean);

  for (const tentativa of tentativas) {
    const linhas = await procurar(tentativa.palavras, tentativa.ignorarAcento);
    if (linhas.length) return linhas.map(montarProduto).filter(Boolean);
  }
  return [];
}

/** Nota de 0 a 1 de quanto duas descricoes se parecem (palavras em comum). */
export function semelhanca(a, b) {
  const pa = new Set(normalizarTexto(a).split(' ').filter((p) => p.length > 2));
  const pb = new Set(normalizarTexto(b).split(' ').filter((p) => p.length > 2));
  if (!pa.size || !pb.size) return 0;
  let iguais = 0;
  for (const palavra of pa) if (pb.has(palavra)) iguais += 1;
  return iguais / Math.max(pa.size, pb.size);
}

/**
 * Proximo codigo livre de produto.
 * O Solus guarda o proximo numero na tabela CODPRODUTO; a gente confere tambem
 * o maior codigo em uso para nunca gerar um codigo repetido.
 */
export async function proximoCodigoProduto(executar = consultar) {
  let candidato = 1;
  try {
    const linhas = await executar('SELECT FIRST 1 CODIGO FROM CODPRODUTO');
    candidato = paraNumero(linhas[0]?.CODIGO) || 1;
  } catch { /* banco sem a tabela CODPRODUTO: segue pelo maior codigo */ }

  const maior = await executar(
    "SELECT MAX(CAST(CODIGO AS INTEGER)) AS MAIOR FROM PRODUTO WHERE CODIGO SIMILAR TO '[0-9]+'"
  );
  const maiorEmUso = paraNumero(maior[0]?.MAIOR);
  return String(Math.max(candidato, maiorEmUso + 1));
}

export { paraNumero, paraTextoBR, soDigitos };
export function empresaAtual() {
  return String(carregarConfig().empresa.codigo || '1');
}

/**
 * Nota sobre transacoes: as funcoes daqui que rodam DENTRO de uma gravacao
 * precisam receber o `executar` da transacao. Consultar por fora, numa outra
 * conexao, trava: a leitura fica esperando o commit e o commit fica esperando
 * a leitura terminar.
 */
