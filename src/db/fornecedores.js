// Fornecedor da nota -> fornecedor cadastrado no Solus.
//
// A nota traz o CNPJ do fornecedor; o Solus guarda o fornecedor com um CODIGO
// proprio (tabela FORNECEDOR) e o CNPJ escrito com pontuacao ("01.611.823/0001-16").
// Com o codigo em maos da para:
//   - achar o produto pelo codigo que o FORNECEDOR usa (tabela PRODUTOFORNE);
//   - gravar no produto quem foi o ultimo fornecedor (PRODUTO.FORNECEDOR/NOMEFOR);
//   - ensinar o Solus que "o codigo X desse fornecedor e o nosso produto Y".
//
// Antes o Plugin nunca descobria esse codigo, e a busca por codigo do fornecedor
// olhava de TODOS os fornecedores misturados.

import { consultar, emTransacao, campoTexto, lerTexto, gravarTexto, paraNumero } from './firebird.js';
import { colunasDe } from './produtos.js';
import { cnpjValido, formatarCnpj, formatarCep } from '../leitura/cnpj.js';

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

/**
 * Fornecedor do Solus com esse CNPJ, ou null.
 * Antes a lista ficava guardada 10 minutos na memoria: fornecedor cadastrado (ou
 * apagado) no Solus nesse meio tempo nao era visto. Sao ~400 linhas: consultar na
 * hora e rapido e sempre certo.
 */
export async function buscarFornecedorPorCnpj(cnpj) {
  try {
    return await fornecedorPorDocumento(cnpj);
  } catch {
    return null;       // banco sem a tabela: segue sem o codigo do fornecedor
  }
}

// ---------------------------------------------------------------------------
// Fornecedor OBRIGATORIO na nota.
// Sem o fornecedor no Solus a nota nao aparece na aba "Fornecedores do Produto"
// (o Solus exige o codigo dele) e o Plugin nao aprende os codigos desse
// fornecedor. Entao, antes de gravar, a pessoa escolhe um que ja existe ou
// cadastra - com os dados do XML ou da Receita, igual ao cadastro do Solus.
// ---------------------------------------------------------------------------

const CAMPOS = `CODIGO, ${campoTexto('NOME', 50)}, ${campoTexto('FANTASIA', 30)}, CPFCNPJ,
  ${campoTexto('CIDADE', 30)}, UF`;
const SO_DIGITOS_DO_CNPJ = "REPLACE(REPLACE(REPLACE(CPFCNPJ, '.', ''), '/', ''), '-', '')";

function montar(linha) {
  if (!linha) return null;
  return {
    codigo: String(linha.CODIGO || '').trim(),
    nome: lerTexto(linha.NOME) || lerTexto(linha.FANTASIA),
    fantasia: lerTexto(linha.FANTASIA),
    cnpj: String(linha.CPFCNPJ || '').trim(),
    // "  .   .   /    -" e "00.000.000/0000-00": cadastrado sem o CNPJ
    semCnpj: !/[1-9]/.test(digitos(linha.CPFCNPJ)),
    cidade: lerTexto(linha.CIDADE),
    uf: String(linha.UF || '').trim(),
  };
}

const formatarCpf = (cpf) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
const documentoDoSolus = (numeros) => (numeros.length === 14 ? formatarCnpj(numeros) : formatarCpf(numeros));

/** Fornecedor pelo codigo do Solus. */
export async function fornecedorPorCodigo(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod || cod.length > 5) return null;
  return montar((await consultar(`SELECT FIRST 1 ${CAMPOS} FROM FORNECEDOR WHERE CODIGO = ?`, [cod]))[0]);
}

/** Fornecedor pelo CNPJ/CPF, lido agora do banco (sem a lembranca de 10 minutos). */
export async function fornecedorPorDocumento(documento, executar = consultar) {
  const numeros = digitos(documento);
  if (numeros.length !== 14 && numeros.length !== 11) return null;
  const linhas = await executar(
    // cadastro repetido do mesmo CNPJ: fica o mais antigo (menor codigo)
    `SELECT FIRST 1 ${CAMPOS} FROM FORNECEDOR WHERE ${SO_DIGITOS_DO_CNPJ} = ?
      ORDER BY CHAR_LENGTH(TRIM(CODIGO)), CODIGO`, [numeros]);
  return montar(linhas[0]);
}

/** Procura pelo nome, nome fantasia ou CNPJ (para a tela de escolher). */
export async function procurarFornecedores(termo, limite = 8) {
  const texto = String(termo || '').trim().toUpperCase().slice(0, 40);
  const numeros = digitos(texto);
  if (numeros.length >= 8) {
    const linhas = await consultar(
      `SELECT FIRST ${limite} ${CAMPOS} FROM FORNECEDOR WHERE ${SO_DIGITOS_DO_CNPJ} STARTING WITH ?`, [numeros]);
    return linhas.map(montar);
  }
  if (texto.length < 2) return [];
  // o banco e Windows-1252: corta a palavra antes do acento (o mesmo das outras buscas)
  const posicaoAcento = texto.search(/[^A-Z0-9 .&/-]/);
  const procurar = posicaoAcento > 1 ? texto.slice(0, posicaoAcento) : texto;
  const linhas = await consultar(
    `SELECT FIRST ${limite} ${CAMPOS} FROM FORNECEDOR
      WHERE UPPER(NOME) LIKE ? OR UPPER(FANTASIA) LIKE ? ORDER BY NOME`,
    [`%${procurar}%`, `%${procurar}%`]);
  return linhas.map(montar);
}

/** CNPJ da propria loja: a IA as vezes le o do destinatario no lugar do fornecedor. */
export async function cnpjDaLoja() {
  try {
    return digitos((await consultar('SELECT FIRST 1 CPFCNPJ FROM PARAMETRO'))[0]?.CPFCNPJ);
  } catch {
    return '';
  }
}

/** Proximo codigo de fornecedor, do jeito que o Solus controla (CODFORNECEDOR). */
async function proximoCodigoFornecedor(executar) {
  let candidato = 0;
  try {
    candidato = Math.trunc(paraNumero((await executar('SELECT FIRST 1 CODIGO FROM CODFORNECEDOR'))[0]?.CODIGO));
  } catch { /* banco sem o contador: vai pelo maior codigo */ }
  if (!candidato) {
    const linhas = await executar(
      "SELECT MAX(CAST(CODIGO AS INTEGER)) AS MAIOR FROM FORNECEDOR WHERE CODIGO SIMILAR TO '[0-9]+'");
    candidato = (Number(linhas[0]?.MAIOR) || 0) + 1;
  }
  // o contador pode estar atrasado: nunca repete um codigo que ja existe
  for (let tentativa = 0; tentativa < 1000; tentativa += 1) {
    const usado = await executar('SELECT FIRST 1 CODIGO FROM FORNECEDOR WHERE CODIGO = ?', [String(candidato)]);
    if (!usado.length) break;
    candidato += 1;
  }
  return String(candidato);
}

/**
 * Cadastra o fornecedor no Solus, com os campos que o proprio Solus preenche
 * (conferido nos cadastros dele: CNPJ com pontuacao, IE so com numeros, CEP
 * "00000-000", TIPOFORN JURIDICA e os textos que ele deixa vazios).
 * Se o CNPJ ja existir, devolve o que existe em vez de criar repetido.
 * `aceitarDocumento`: CNPJ que veio no XML foi autorizado pela Sefaz e vale como esta.
 */
export async function cadastrarFornecedor(dados, { aceitarDocumento = false } = {}) {
  const numeros = digitos(dados?.cnpj || dados?.cpfCnpj);
  const nome = String(dados?.razaoSocial || dados?.nome || '').trim();
  if (!nome) throw new Error('O fornecedor precisa de nome (razao social).');
  if (numeros.length === 14) {
    if (!aceitarDocumento && !cnpjValido(numeros)) throw new Error('CNPJ invalido. Confira os numeros.');
  } else if (numeros.length !== 11) {
    throw new Error('Informe o CNPJ (14 numeros) ou o CPF (11 numeros) do fornecedor.');
  }

  const colunas = await colunasDe('FORNECEDOR');
  const resultado = await emTransacao(async (executar) => {
    // procura de novo AQUI DENTRO: alguem pode ter cadastrado no Solus agora ha pouco
    const existente = await fornecedorPorDocumento(numeros, executar);
    if (existente) return { fornecedor: existente, jaExistia: true };

    const codigo = await proximoCodigoFornecedor(executar);
    const texto = (valor, tamanho) => gravarTexto(String(valor || '').trim().toUpperCase().slice(0, tamanho));
    const inscricao = String(dados.inscricaoEstadual || dados.inscricao || '').trim();
    const valores = {
      CODIGO: codigo,
      NOME: texto(nome, 50),
      FANTASIA: texto(dados.fantasia, 30),
      CPFCNPJ: documentoDoSolus(numeros),
      TIPOFORN: numeros.length === 14 ? 'JURIDICA' : 'FISICA',
      INSCRICAO: (/^isent/i.test(inscricao) ? 'ISENTO' : digitos(inscricao)).slice(0, 20),
      RUA: texto(dados.rua, 60),
      NUMERO: String(dados.numero || '').trim().toUpperCase().slice(0, 5),
      BAIRRO: texto(dados.bairro, 30),
      CIDADE: texto(dados.cidade, 30),
      UF: String(dados.uf || '').trim().toUpperCase().slice(0, 2),
      CEP: formatarCep(dados.cep).slice(0, 20),
      TELEFONE: String(dados.telefone || '').trim().slice(0, 15),
      EMAIL: String(dados.email || '').trim().toLowerCase().slice(0, 60),
      // o que o Solus grava vazio num fornecedor novo
      CELULAR: '', CONTATO: '', RG: '', SITE: '', FAX: '', VENDEDOR: '',
      FONEV1: '', FONEV2: '', FONEV3: '', FONEV4: '', CCUSTO: '',
    };
    const campos = Object.keys(valores).filter((c) => colunas.has(c));
    await executar(
      `INSERT INTO FORNECEDOR (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`,
      campos.map((c) => valores[c]));

    // avanca o contador do Solus para ele nao repetir o codigo depois
    try {
      await executar('UPDATE CODFORNECEDOR SET CODIGO = ?', [Number(codigo) + 1]);
    } catch { /* banco sem o contador */ }

    return {
      fornecedor: {
        codigo, nome: nome.toUpperCase().slice(0, 50), cnpj: valores.CPFCNPJ, semCnpj: false,
        cidade: String(dados.cidade || '').toUpperCase(), uf: valores.UF,
      },
      jaExistia: false,
    };
  });
  return resultado;
}

/**
 * Fornecedor escolhido na mao que esta SEM CNPJ no Solus recebe o da nota: na
 * proxima nota dele o Plugin ja acha sozinho. Quem tem CNPJ (mesmo outro, de
 * filial) nao e mexido.
 */
export async function completarCnpjDoFornecedor(codigo, documento) {
  const numeros = digitos(documento);
  if (numeros.length !== 14 && numeros.length !== 11) return false;
  const atual = await fornecedorPorCodigo(codigo);
  if (!atual || !atual.semCnpj) return false;
  // outro cadastro ja tem esse CNPJ: gravar aqui deixaria dois iguais
  if (await fornecedorPorDocumento(numeros)) return false;
  await emTransacao((executar) => executar(
    'UPDATE FORNECEDOR SET CPFCNPJ = ? WHERE CODIGO = ?', [documentoDoSolus(numeros), atual.codigo]));
  return true;
}
