// Busca e atualizacao de produtos no Solus.
// Tudo aqui e defensivo: antes de gravar, confere quais colunas existem de verdade
// no banco da loja (versoes diferentes do Solus tem campos diferentes).

import { consultar, paraNumero, paraTextoBR, campoTexto, lerTexto } from './firebird.js';
import { carregarConfig } from '../config.js';
import { procurarNoCatalogo, motivoDaSugestao } from './catalogo.js';

const cacheColunas = new Map();

/** Colunas da tabela neste banco, com o tamanho de cada uma. */
export async function estruturaDe(tabela) {
  const nome = tabela.toUpperCase();
  // cada loja tem o seu banco, e os bancos podem ser de versoes diferentes do Solus
  const chaveCache = `${carregarConfig().lojaId || 'sem-loja'}:${nome}`;
  if (cacheColunas.has(chaveCache)) return cacheColunas.get(chaveCache);
  const linhas = await consultar(
    `SELECT TRIM(RF.RDB$FIELD_NAME) AS COLUNA, F.RDB$FIELD_LENGTH AS TAMANHO
       FROM RDB$RELATION_FIELDS RF
       JOIN RDB$FIELDS F ON F.RDB$FIELD_NAME = RF.RDB$FIELD_SOURCE
      WHERE RF.RDB$RELATION_NAME = ?`,
    [nome]
  );
  const estrutura = {
    nomes: new Set(linhas.map((l) => String(l.COLUNA).trim().toUpperCase())),
    tamanhos: new Map(linhas.map((l) => [String(l.COLUNA).trim().toUpperCase(), Number(l.TAMANHO) || 0])),
  };
  cacheColunas.set(chaveCache, estrutura);
  return estrutura;
}

/** Lista as colunas que a tabela realmente tem neste banco. */
export async function colunasDe(tabela) {
  return (await estruturaDe(tabela)).nomes;
}

/**
 * Tamanho da coluna no banco.
 * Serve para nao mandar texto maior do que cabe: o Firebird responde
 * "string right truncation" e derruba a consulta inteira. Foi o que acontecia
 * ao procurar um codigo de barras de 13 digitos em PRODUTO.CODIGO, que tem 6.
 */
export async function tamanhoDaColuna(tabela, coluna) {
  const { tamanhos } = await estruturaDe(tabela);
  return tamanhos.get(String(coluna).toUpperCase()) || 0;
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
    // como esta gravado de verdade: tem loja com 'barras' do tipo 02.01.06.0076, e a
    // VENDA guarda assim. Sem o original, 'o cliente pagou' nao achava a venda.
    barrasNoBanco: String(linha.BARRAS || '').trim(),
    codBarras: String(linha.CODBARRAS || '').trim(),
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

  const bruto = String(linhas?.[0]?.BARRAS || '').trim();
  if (!bruto) return null;
  // o vinculo pode apontar para um barras com pontos (02.01.06.0076) ou para o codigo
  const exato = await consultar(
    `SELECT FIRST 1 ${CAMPOS_PRODUTO} FROM PRODUTO WHERE TRIM(BARRAS) = ? OR TRIM(CODIGO) = ?`,
    [bruto, bruto.slice(0, 6)]
  );
  if (exato.length) return montarProduto(exato[0]);
  const barras = soDigitos(bruto);
  return barras ? buscarPorBarras(barras) : null;
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
/**
 * Cadastros PARECIDOS: o mesmo produto cadastrado mais de uma vez com o nome
 * escrito de outro jeito ("RODO DE MADEIRA 40CM" x "RODO MADEIRA 40 CM").
 *
 * O `buscarIrmaos` só achava nome IDENTICO ou mesmo codigo de barras - e por
 * isso, na maioria das notas, os repetidos nao apareciam para a pessoa escolher
 * qual vincular e quais desativar. Aqui a procura passa pelo indice do catalogo,
 * que ignora acento, cedilha e erro de digitacao.
 *
 * `texto` e o nome que veio na nota (ou o do proprio cadastro).
 * `excluir` e o codigo do produto que ja esta vinculado ao item.
 */
export async function buscarParecidos(texto, { excluir = '', limite = 6 } = {}) {
  const procurado = String(texto || '').trim();
  if (procurado.length < 3) return [];

  const fora = new Set([String(excluir || '').trim()].filter(Boolean));
  try {
    // inclui os parados e os cancelados de proposito: e justamente o repetido
    // velho que precisa aparecer para ser desativado
    const achados = await procurarNoCatalogo(procurado, { limite: limite + 4 });
    const bons = achados.filter((a) => !fora.has(a.codigo) && a.cobertura >= 0.7).slice(0, limite);
    if (!bons.length) return [];

    const produtos = await buscarVariosPorCodigo(bons.map((a) => a.codigo));
    const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));

    return bons.map((achado) => {
      const produto = porCodigo.get(achado.codigo);
      if (!produto) return null;
      const igual = normalizarTexto(produto.descricao) === normalizarTexto(procurado);
      return {
        ...produto,
        parecenca: achado.cobertura,
        motivo: igual ? 'mesmo nome' : `nome parecido (${Math.round(achado.cobertura * 100)}%)`,
        parado: achado.parado,
      };
    }).filter(Boolean);
  } catch {
    return [];      // indice fora do ar: segue sem a lista de parecidos
  }
}

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

  // codigo maior do que o campo do banco nao existe - e ainda derruba a consulta
  const cabe = await tamanhoDaColuna('PRODUTO', 'CODIGO');
  if (cabe && cod.length > cabe) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 ${CAMPOS_PRODUTO} FROM PRODUTO WHERE TRIM(CODIGO) = ?`,
    [cod]
  );
  return montarProduto(linhas[0]);
}

/** Varios produtos de uma vez, pelo codigo (usado depois de ordenar a busca). */
export async function buscarVariosPorCodigo(codigos) {
  const lista = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (!lista.length) return [];

  const cabe = await tamanhoDaColuna('PRODUTO', 'CODIGO');
  const validos = cabe ? lista.filter((c) => c.length <= cabe) : lista;
  if (!validos.length) return [];

  const marcadores = validos.map(() => '?').join(', ');
  const linhas = await consultar(
    `SELECT FIRST ${validos.length} ${CAMPOS_PRODUTO} FROM PRODUTO
      WHERE TRIM(CODIGO) IN (${marcadores})`,
    validos
  );
  return linhas.map(montarProduto).filter(Boolean);
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
 * Procura por descricao.
 *
 * Quem faz o trabalho e o indice em memoria (`catalogo.js`): ele ignora acento e
 * cedilha, entende que "5LT" e "5 litros" sao a mesma coisa, aguenta erro de
 * digitacao e poe na frente o que a loja mais vende e o que saiu por ultimo.
 * `preferir` sao codigos que este cliente ja comprou - na duvida, ganham.
 *
 * Se o indice nao subir (banco fora do ar na hora de montar), cai sozinho na
 * busca antiga por LIKE, que e pior mas nao deixa a tela sem resposta.
 */
export async function buscarPorDescricao(descricao, limite = 8, opcoes = {}) {
  const texto = String(descricao || '').trim();
  if (!texto) return [];

  try {
    const achados = await procurarNoCatalogo(texto, {
      limite,
      preferir: opcoes.preferir || [],
      esconderParados: Boolean(opcoes.esconderParados),
    });
    if (!achados.length) return [];

    // preco e estoque vem frescos do banco: o indice serve so para escolher quais
    const produtos = await buscarVariosPorCodigo(achados.map((a) => a.codigo));
    const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));

    return achados.map((achado) => {
      const produto = porCodigo.get(achado.codigo);
      if (!produto) return null;
      return {
        ...produto,
        nota: achado.nota,
        cobertura: achado.cobertura,
        vendidoNoPeriodo: achado.vendidoNoPeriodo,
        vezesVendido: achado.vezesVendido,
        ultimaVenda: achado.ultimaVenda,
        parado: achado.parado,
        motivo: motivoDaSugestao(achado),
      };
    }).filter(Boolean);
  } catch (erro) {
    console.error('[busca] indice do catalogo indisponivel, usando LIKE:', erro?.message || erro);
    return buscarPorDescricaoComLike(texto, limite);
  }
}

/** Busca antiga, por LIKE no banco. Fica como reserva do indice. */
async function buscarPorDescricaoComLike(descricao, limite = 8) {
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
    if (!linhas.length) continue;
    // mesmo na reserva, quem chama espera "nota" e "cobertura" para decidir
    return linhas.map(montarProduto).filter(Boolean).map((produto) => {
      const parecido = semelhanca(descricao, produto.descricao);
      return { ...produto, nota: parecido, cobertura: parecido, motivo: '' };
    }).sort((a, b) => b.nota - a.nota);
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

/**
 * Tira custo e margem do produto quando quem pediu nao pode ver no Solus.
 *
 * A tela ja escondia, mas o dado ia junto na resposta da API - bastava abrir o
 * navegador para ler. Esconder na tela nao e esconder.
 */
export function semCustoParaQuemNaoPodeVer(produtos, podeVerCusto) {
  if (podeVerCusto) return produtos;
  const limpar = (p) => ({ ...p, custoAtual: null, custoAnterior: null, margemAtual: null });
  return Array.isArray(produtos) ? produtos.map(limpar) : (produtos ? limpar(produtos) : produtos);
}
