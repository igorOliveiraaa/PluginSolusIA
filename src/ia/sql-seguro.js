// Porteiro das consultas livres da IA.
//
// Para o assistente responder QUALQUER pergunta, ele precisa poder montar a
// consulta dele. Isso e poderoso e perigoso ao mesmo tempo: uma consulta errada
// pode travar o Solus no meio do expediente, e um comando de escrita pode apagar
// dados da loja.
//
// Por isso nada passa direto. Aqui a consulta e revistada antes de rodar:
//   - so SELECT, um unico comando;
//   - nenhuma palavra que escreve, apaga ou muda estrutura;
//   - so as tabelas do Solus que fazem sentido consultar;
//   - limite de linhas obrigatorio;
//   - se demorar demais, a consulta e abandonada.

import { consultar } from '../db/firebird.js';

const TETO_LINHAS = 200;
const TEMPO_MAXIMO = 20000;     // 20 segundos

// tudo que NAO pode aparecer na consulta
const PROIBIDO = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'MERGE',
  'GRANT', 'REVOKE', 'EXECUTE', 'EXEC', 'PROCEDURE', 'TRIGGER', 'COMMIT',
  'ROLLBACK', 'SET GENERATOR', 'RECREATE', 'DECLARE', 'INTO', 'SHUTDOWN',
];

// tabelas que o assistente pode ler
const TABELAS_LIBERADAS = new Set([
  'PRODUTO', 'CLIENTES', 'FORNECEDOR', 'PEDIDOS', 'ITEMPEDIDO', 'ENTRADA',
  'CENTRADA', 'ALTERAPRECO', 'GRUPO', 'PRODUTOFORNE', 'FORNEPRODUTO',
  'VENDEDOR', 'NCM', 'CIDADE', 'BAIRRO', 'TRIBUTARIA', 'VALIDADE',
  'LOTEPRODUTO', 'COMPOSICAO', 'OS', 'ITEMOS', 'RECEBER', 'PAGAR',
]);

// tabelas com dado sensivel que nunca podem ser lidas por aqui
const TABELAS_BLOQUEADAS = new Set(['OPERADOR', 'PERMISSAO', 'SYSTEM']);

// Colunas de dinheiro de dentro: custo, margem e lucro. Quem nao ve custo no
// Solus nao pode buscar isso por SQL - senao bastava pedir "faz uma consulta
// livre trazendo PRECOCUSTO" para passar por cima da permissao.
const COLUNAS_DE_CUSTO = [
  'PRECOCUSTO', 'UPRECOCUSTO', 'CUSTOVENDA', 'MARGEM', 'UPC',
];

/** Confere a consulta. Devolve o SQL pronto ou explica por que recusou. */
export function revistar(sqlBruto, opcoes = {}) {
  const sql = String(sqlBruto || '').trim().replace(/;+\s*$/, '');

  if (!sql) return { ok: false, motivo: 'Consulta vazia.' };

  // um comando so: ponto e virgula no meio pode esconder um segundo comando
  if (sql.includes(';')) {
    return { ok: false, motivo: 'So e permitido um comando por consulta.' };
  }

  const maiusculo = sql.toUpperCase();

  if (!maiusculo.startsWith('SELECT')) {
    return { ok: false, motivo: 'So consulta de leitura (SELECT) e permitida.' };
  }

  for (const palavra of PROIBIDO) {
    // \b evita barrar "SELECTED" por causa de "SELECT", por exemplo
    const regra = new RegExp(`\\b${palavra.replace(' ', '\\s+')}\\b`);
    if (regra.test(maiusculo)) {
      return { ok: false, motivo: `A consulta usa "${palavra}", que nao e permitido aqui.` };
    }
  }

  if (opcoes.podeVerCusto === false) {
    for (const coluna of COLUNAS_DE_CUSTO) {
      // a barra da regra vai montada como TEXTO: escrita direto num template
      // literal, "\b" vira o caractere de backspace e a regra nunca casa nada
      if (new RegExp('\\b' + coluna + '\\b').test(maiusculo)) {
        return {
          ok: false,
          motivo: 'Esse usuario nao pode ver custo nem margem no Solus, entao essa '
            + 'consulta nao pode trazer ' + coluna + '. Refaca sem essa coluna.',
        };
      }
    }
    // "PC" sozinho tambem e o custo em texto neste banco ("PCT" nao e)
    if (new RegExp('\\bPC\\b').test(maiusculo)) {
      return { ok: false, motivo: 'Esse usuario nao pode ver custo (a coluna PC e o custo).' };
    }
  }

  // comentario pode esconder coisa depois dele
  if (maiusculo.includes('--') || maiusculo.includes('/*')) {
    return { ok: false, motivo: 'Comentarios nao sao permitidos na consulta.' };
  }

  // confere as tabelas citadas depois de FROM e JOIN
  const tabelas = [...maiusculo.matchAll(/\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_$]*)/g)]
    .map((achado) => achado[1]);

  if (!tabelas.length) {
    return { ok: false, motivo: 'Nao consegui identificar de qual tabela e a consulta.' };
  }

  for (const tabela of tabelas) {
    if (TABELAS_BLOQUEADAS.has(tabela)) {
      return { ok: false, motivo: `A tabela ${tabela} tem dado sensivel e nao pode ser consultada.` };
    }
    if (tabela.startsWith('RDB$')) {
      return { ok: false, motivo: 'Tabelas internas do banco nao podem ser consultadas.' };
    }
    if (!TABELAS_LIBERADAS.has(tabela)) {
      return { ok: false, motivo: `A tabela ${tabela} nao esta liberada para consulta.` };
    }
  }

  // limite obrigatorio de linhas
  let sqlFinal = sql;
  const temLimite = /^SELECT\s+(FIRST|DISTINCT\s+FIRST)\s+\d+/i.test(sql);
  if (!temLimite) {
    sqlFinal = sql.replace(/^SELECT\s+(DISTINCT\s+)?/i,
      (achado, distinto) => `SELECT ${distinto || ''}FIRST ${TETO_LINHAS} `);
  } else {
    // se pediu mais que o teto, corta para o teto
    sqlFinal = sql.replace(/^(SELECT\s+(?:DISTINCT\s+)?FIRST\s+)(\d+)/i,
      (achado, inicio, numero) => inicio + Math.min(Number(numero), TETO_LINHAS));
  }

  return { ok: true, sql: sqlFinal };
}

/** Roda a consulta depois de revistada, com tempo maximo. */
export async function consultaLivre({ sql, explicacao = '' }, contexto = {}) {
  const podeVerCusto = !contexto.operador || Boolean(contexto.operador.permissoes?.verCusto);
  const revista = revistar(sql, { podeVerCusto });
  if (!revista.ok) {
    return { ok: false, erro: revista.motivo, sqlRecusado: sql };
  }

  const corrida = consultar(revista.sql);
  const relogio = new Promise((_, rejeitar) => {
    setTimeout(() => rejeitar(new Error('A consulta demorou demais e foi cancelada.')), TEMPO_MAXIMO);
  });

  try {
    const linhas = await Promise.race([corrida, relogio]);
    return {
      ok: true,
      explicacao,
      sqlUsado: revista.sql,
      quantidade: linhas.length,
      linhas: linhas.map(limparLinha),
      avisoDeLimite: linhas.length >= TETO_LINHAS
        ? `Mostrando as primeiras ${TETO_LINHAS} linhas. Pode haver mais.`
        : undefined,
    };
  } catch (erro) {
    return { ok: false, erro: erro.message, sqlUsado: revista.sql };
  }
}

/** Deixa a linha pronta para a IA ler: texto com acento certo e sem espaco sobrando. */
function limparLinha(linha) {
  const decodificador = new TextDecoder('windows-1252');
  const saida = {};
  for (const [campo, valor] of Object.entries(linha)) {
    if (Buffer.isBuffer(valor)) {
      saida[campo] = decodificador.decode(valor).trim();
    } else if (typeof valor === 'string') {
      saida[campo] = valor.trim();
    } else if (valor instanceof Date) {
      saida[campo] = valor.toLocaleDateString('pt-BR');
    } else {
      saida[campo] = valor;
    }
  }
  return saida;
}

/** Texto que explica ao assistente como o banco e, para ele montar consultas certas. */
export const MAPA_DO_BANCO = `
Banco Firebird 2.5 do sistema Solus (loja de material de limpeza e utilidades).
ATENCAO ao montar consultas:
- Quase todo numero esta guardado como TEXTO no formato brasileiro ("1844,50").
  Para contas, use CAST(REPLACE(campo, ',', '.') AS DOUBLE PRECISION).
- Textos estao em ANSI. Para ler com acento certo use
  CAST(campo AS VARCHAR(70) CHARACTER SET OCTETS).
- Produto ATIVO tem STATUS nulo ou vazio; STATUS='CANCELADO' e produto desativado.
- Use sempre SELECT FIRST n.

TABELAS:

PRODUTO - cadastro de produtos
  CODIGO (codigo interno), DESCRICAO (nome), BARRAS (codigo de barras),
  ESTOQUEATUAL (texto), PRECOCUSTO (numero), PRECOVENDA (numero),
  MARGEM (texto, % sobre o custo), UNIDADE, GRUPO, NCM, FORNECEDOR,
  STATUS ('CANCELADO' = desativado), ULTIMACOMPRA, ULTIMAVENDA (texto dd/mm/aaaa)

CLIENTES - cadastro de clientes
  CODIGO, NOME, FANTASIA, CPFCNPJ, CIDADE, UF, TELEFONE, CELULAR, EMAIL, TIPO

FORNECEDOR - cadastro de fornecedores
  CODIGO, NOME, CIDADE, UF, TELEFONE

PEDIDOS - cabecalho de venda E de orcamento
  NUMERO, CODCLIENTE, NOMECLI, EMISSAO (data), TOTPEDIDO (numero),
  STATUS ('FATURADO' = venda feita, 'ORCAMENTO', 'CANCELADO'), USUARIO, TIPOVENDA

ITEMPEDIDO - itens da venda/orcamento (liga por NUMERO)
  NUMERO, ITEM, PRODUTO (guarda o CODIGO DE BARRAS do produto), DESCRICAO,
  QTD (texto), PRECO (texto), TOT (numero), DATA, PRECOCUSTO,
  STATUS ('EXTORNADO' = item estornado)

ENTRADA - itens das notas de compra
  NOTA, PRODUTO (codigo de barras), DESCPRODUTO, QTD, PC (custo), DATA,
  CODFORNECEDOR, USUARIO

CENTRADA - cabecalho das notas de compra
  DOCUMENTO, NOTA, DATA, CODFORNECEDOR, TOTALNOTA, CHAVENFE

ALTERAPRECO - historico de mudanca de preco de venda
  DATA, USUARIO, BARRAS, PRODUTO, PVA (preco antes), PVN (preco depois)

RECEBER - contas a receber | PAGAR - contas a pagar
GRUPO - grupos de produto | OS/ITEMOS - ordens de servico

REGRAS:
- Para juntar produto com venda: ITEMPEDIDO.PRODUTO = PRODUTO.BARRAS
- Venda valida: PEDIDOS.STATUS nulo ou 'FATURADO', e ITEMPEDIDO.STATUS diferente de 'EXTORNADO'
- A tabela OPERADOR (usuarios e senhas) NAO pode ser consultada.
`;
