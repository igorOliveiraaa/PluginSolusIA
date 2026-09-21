// Clientes do Solus: buscar, cadastrar e ver o que o cliente ja comprou.
//
// O historico de compra sai de PEDIDOS + ITEMPEDIDO (89 mil pedidos no banco real).
// E o que permite mostrar "esse cliente ja levou esse item por R$ X em tal data",
// que e a informacao que falta na hora de montar um orcamento.

import { consultar, emTransacao, paraNumero, paraTextoBR, campoTexto, lerTexto, gravarTexto } from './firebird.js';
import { colunasDe, tamanhoDaColuna } from './produtos.js';
import { formatarCnpj } from '../leitura/cnpj.js';
import { VENDA_VALIDA } from './venda-valida.js';

const CAMPOS_CLIENTE = `CODIGO, ${campoTexto('NOME', 50)}, ${campoTexto('FANTASIA', 40)},
  CPFCNPJ, INSCRICAO, ${campoTexto('RUA', 60)}, NUMERO, ${campoTexto('BAIRRO', 70)},
  ${campoTexto('CIDADE', 30)}, UF, CEP, TELEFONE, CELULAR, EMAIL, TIPO, STATUS, SITUACAO,
  ${campoTexto('CONTATO', 20)}`;

function montarCliente(linha) {
  if (!linha) return null;
  return {
    codigo: String(linha.CODIGO || '').trim(),
    nome: lerTexto(linha.NOME),
    fantasia: lerTexto(linha.FANTASIA),
    cpfCnpj: String(linha.CPFCNPJ || '').trim(),
    inscricao: String(linha.INSCRICAO || '').trim(),
    rua: lerTexto(linha.RUA),
    numero: String(linha.NUMERO || '').trim(),
    bairro: lerTexto(linha.BAIRRO),
    cidade: lerTexto(linha.CIDADE),
    uf: String(linha.UF || '').trim(),
    cep: String(linha.CEP || '').trim(),
    telefone: String(linha.TELEFONE || '').trim(),
    celular: String(linha.CELULAR || '').trim(),
    email: String(linha.EMAIL || '').trim(),
    tipo: String(linha.TIPO || '').trim(),
    contato: lerTexto(linha.CONTATO),
    status: String(linha.STATUS || '').trim(),
    bloqueado: String(linha.STATUS || '').trim().toUpperCase() === 'BLOQUEADO',
  };
}

/** Procura cliente por CPF/CNPJ (com ou sem pontuacao). */
export async function buscarPorDocumento(documento) {
  const numeros = String(documento || '').replace(/\D/g, '');
  if (numeros.length < 11) return null;

  const variantes = [numeros, formatarCnpj(numeros)];
  const linhas = await consultar(
    `SELECT FIRST 1 ${CAMPOS_CLIENTE} FROM CLIENTES
      WHERE CPFCNPJ = ? OR CPFCNPJ = ?
         OR REPLACE(REPLACE(REPLACE(CPFCNPJ, '.', ''), '/', ''), '-', '') = ?`,
    [...variantes, numeros]
  );
  return montarCliente(linhas[0]);
}

export async function buscarClientePorCodigo(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;

  // codigo maior do que o campo do banco nao existe - e mandar assim derruba a
  // consulta com um erro tecnico em ingles (o mesmo caso de PRODUTO.CODIGO)
  const cabe = await tamanhoDaColuna('CLIENTES', 'CODIGO');
  if (cabe && cod.length > cabe) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 ${CAMPOS_CLIENTE} FROM CLIENTES WHERE TRIM(CODIGO) = ?`,
    [cod]
  );
  return montarCliente(linhas[0]);
}

/** Procura cliente por parte do nome (para a tela de busca). */
export async function buscarClientePorNome(termo, limite = 15) {
  const texto = String(termo || '').trim().toUpperCase();
  if (texto.length < 2) return [];

  // mesma manha dos produtos: corta a palavra antes do acento
  const posicaoAcento = texto.search(/[^A-Z0-9 .\-/]/);
  const procurar = posicaoAcento > 1 ? texto.slice(0, posicaoAcento) : texto;

  const linhas = await consultar(
    `SELECT FIRST ${limite} ${CAMPOS_CLIENTE} FROM CLIENTES
      WHERE UPPER(NOME) LIKE ? OR UPPER(FANTASIA) LIKE ?`,
    [`%${procurar}%`, `%${procurar}%`]
  );
  return linhas.map(montarCliente).filter(Boolean);
}

/** Proximo codigo livre de cliente, do jeito que o Solus controla. */
async function proximoCodigoCliente(executar = consultar) {
  let candidato = 1;
  try {
    const linhas = await executar('SELECT FIRST 1 CODIGO FROM CODCLIENTE');
    candidato = paraNumero(linhas[0]?.CODIGO) || 1;
  } catch { /* banco sem CODCLIENTE: usa o maior codigo em uso */ }

  const maior = await executar(
    "SELECT MAX(CAST(CODIGO AS INTEGER)) AS MAIOR FROM CLIENTES WHERE CODIGO SIMILAR TO '[0-9]+'"
  );
  return String(Math.max(candidato, paraNumero(maior[0]?.MAIOR) + 1));
}

/**
 * Escreve a inscricao estadual do jeito que este Solus ja guarda.
 * Em SP o banco guarda com pontos ("123.456.789.012"); a consulta publica
 * devolve so os digitos.
 */
function formatarInscricao(valor, uf) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  if (/^isent/i.test(texto)) return 'ISENTO';
  const digitos = texto.replace(/\D/g, '');
  if (String(uf || '').toUpperCase() === 'SP' && digitos.length === 12) {
    return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3.$4');
  }
  return texto;
}

function hoje() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Cadastra o cliente no Solus com os dados vindos da consulta de CNPJ.
 * Se ja existir alguem com o mesmo documento, devolve o que existe em vez de
 * criar duplicado (cadastro repetido de cliente da a mesma dor de cabeca que
 * produto repetido).
 */
export async function cadastrarCliente(dados, operador = '') {
  const documento = String(dados.cpfCnpj || dados.cnpj || '').trim();
  const numeros = documento.replace(/\D/g, '');
  const nome = String(dados.razaoSocial || dados.nome || '').trim();

  // Sem isto, uma chamada com o corpo vazio criava um cliente EM BRANCO no
  // Solus - com codigo, ocupando numero, e sem ninguem dentro.
  if (!nome) throw new Error('O cliente precisa de nome (razao social).');
  if (numeros.length !== 11 && numeros.length !== 14) {
    throw new Error('Informe um CPF (11 numeros) ou CNPJ (14 numeros) valido.');
  }

  const existente = await buscarPorDocumento(numeros);
  if (existente) {
    return { cliente: existente, jaExistia: true };
  }

  const colunas = await colunasDe('CLIENTES');

  return emTransacao(async (executar) => {
    const codigo = await proximoCodigoCliente(executar);

    const valores = {
      CODIGO: codigo,
      NOME: gravarTexto(nome.slice(0, 50)),
      FANTASIA: gravarTexto(String(dados.fantasia || '').slice(0, 40)),
      CPFCNPJ: numeros.length === 14 ? formatarCnpj(numeros) : documento.slice(0, 20),
      INSCRICAO: formatarInscricao(dados.inscricaoEstadual || dados.inscricao, dados.uf).slice(0, 20),
      RUA: gravarTexto(String(dados.rua || '').slice(0, 60)),
      NUMERO: String(dados.numero || '').slice(0, 8),
      COMPLEMENTO: gravarTexto(String(dados.complemento || '').slice(0, 50)),
      BAIRRO: gravarTexto(String(dados.bairro || '').slice(0, 70)),
      CIDADE: gravarTexto(String(dados.cidade || '').slice(0, 30)),
      UF: String(dados.uf || '').slice(0, 2).toUpperCase(),
      CEP: String(dados.cep || '').slice(0, 20),
      TELEFONE: String(dados.telefone || '').slice(0, 15),
      CELULAR: String(dados.celular || '').slice(0, 15),
      EMAIL: String(dados.email || '').slice(0, 60),
      CONTATO: gravarTexto(String(dados.contato || '').slice(0, 20)),
      TIPO: numeros.length === 14 ? 'JURIDICA' : 'FISICA',
      DTABERTURA: hoje(),
      USUABERTURA: String(operador || '').slice(0, 20),
    };

    const campos = [];
    const marcadores = [];
    const params = [];
    for (const [campo, valor] of Object.entries(valores)) {
      if (valor === undefined || !colunas.has(campo)) continue;
      campos.push(campo);
      marcadores.push('?');
      params.push(valor);
    }

    await executar(
      `INSERT INTO CLIENTES (${campos.join(', ')}) VALUES (${marcadores.join(', ')})`,
      params
    );

    try {
      await executar('UPDATE CODCLIENTE SET CODIGO = ?', [String(paraNumero(codigo) + 1)]);
    } catch { /* banco sem CODCLIENTE */ }

    return {
      jaExistia: false,
      cliente: {
        codigo,
        nome: String(dados.razaoSocial || dados.nome || ''),
        fantasia: String(dados.fantasia || ''),
        cpfCnpj: valores.CPFCNPJ,
        cidade: String(dados.cidade || ''),
        uf: valores.UF,
      },
    };
  });
}

/** Ultimas compras do cliente (para a tela do orcamento). */
export async function ultimasCompras(codigoCliente, limite = 40) {
  const cod = String(codigoCliente || '').trim();
  if (!cod) return [];

  const linhas = await consultar(
    `SELECT FIRST ${limite}
            I.PRODUTO, ${campoTexto('I.DESCRICAO', 70, 'DESCRICAO')}, I.QTD, I.PRECO, I.DATA, P.NUMERO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ?
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    [cod]
  );

  return linhas.map((l) => ({
    produto: String(l.PRODUTO || '').trim(),
    descricao: lerTexto(l.DESCRICAO),
    quantidade: paraNumero(l.QTD),
    preco: paraNumero(l.PRECO),
    data: l.DATA,
    pedido: Number(l.NUMERO),
  }));
}

/**
 * TODOS os produtos que o cliente ja comprou (faturado), do mais recente para o
 * mais antigo, um por produto. E o que faz o orcamento escolher "o que ESTE
 * cliente leva" quando ha varios parecidos.
 *
 * Antes usava as ultimas 120 linhas de venda: cliente grande (empresa de limpeza)
 * estoura isso em poucas semanas, e o produto que ele compra todo mes ficava de
 * fora - o orcamento escolhia outra marca e "o cliente pagou" saia vazio.
 */
export async function produtosQueOClienteComprou(codigoCliente, anos = 3) {
  const cod = String(codigoCliente || '').trim();
  if (!cod) return [];
  const desde = new Date();
  desde.setFullYear(desde.getFullYear() - anos);

  const linhas = await consultar(
    `SELECT TRIM(I.PRODUTO) AS CHAVE, MAX(I.DATA) AS ULTIMA, COUNT(*) AS VEZES
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ? AND I.DATA >= ?
        AND ${VENDA_VALIDA}
      GROUP BY 1
      ORDER BY 2 DESC`,
    [cod, desde]
  );
  return linhas.map((l) => ({
    chave: String(l.CHAVE || '').trim(),
    ultima: l.ULTIMA,
    vezes: Number(l.VEZES) || 0,
  })).filter((l) => l.chave);
}

/**
 * As chaves viram uma lista de "?" para o IN do SQL.
 * O Solus grava em ITEMPEDIDO.PRODUTO ora o codigo de barras, ora o codigo curto,
 * ora o codigo com zeros na frente ("000000012743"). Procurar por uma forma so
 * era o motivo de "esse cliente pagou" aparecer vazio mesmo com o cliente escolhido.
 */
function listaDeChaves(chaves) {
  const lista = (Array.isArray(chaves) ? chaves : [chaves])
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  return [...new Set(lista)].slice(0, 8);
}

/** Ultimo preco que ESTE cliente pagou neste produto. */
export async function ultimoPrecoDoCliente(codigoCliente, chaves) {
  const cod = String(codigoCliente || '').trim();
  const lista = listaDeChaves(chaves);
  if (!cod || !lista.length) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 I.PRECO, I.QTD, I.DATA, P.NUMERO
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(P.CODCLIENTE) = ? AND TRIM(I.PRODUTO) IN (${lista.map(() => '?').join(', ')})
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    [cod, ...lista]
  );

  if (!linhas.length) return null;
  return {
    preco: paraNumero(linhas[0].PRECO),
    quantidade: paraNumero(linhas[0].QTD),
    data: linhas[0].DATA,
    pedido: Number(linhas[0].NUMERO) || null,
  };
}

/** Ultimo preco praticado na loja para o produto, para qualquer cliente. */
export async function ultimoPrecoDaLoja(chaves) {
  const lista = listaDeChaves(chaves);
  if (!lista.length) return null;

  const linhas = await consultar(
    `SELECT FIRST 1 I.PRECO, I.DATA
       FROM ITEMPEDIDO I
       JOIN PEDIDOS P ON P.NUMERO = I.NUMERO
      WHERE TRIM(I.PRODUTO) IN (${lista.map(() => '?').join(', ')})
        AND ${VENDA_VALIDA}
      ORDER BY I.DATA DESC`,
    lista
  );

  if (!linhas.length) return null;
  return { preco: paraNumero(linhas[0].PRECO), data: linhas[0].DATA };
}

export { paraTextoBR };
