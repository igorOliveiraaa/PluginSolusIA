// Conexao com o banco Firebird do Solus.
// O banco usa charset NONE (o Delphi grava em Windows-1252) e guarda quase todos
// os numeros como TEXTO no formato brasileiro ("1844,00"). Tudo aqui respeita isso.

import Firebird from 'node-firebird';
import { carregarConfig } from '../config.js';

let poolCache = null;

function opcoes() {
  const cfg = carregarConfig();
  return {
    host: cfg.banco.host,
    port: cfg.banco.porta,
    database: normalizarCaminho(cfg.banco.caminho),
    user: cfg.banco.usuario,
    password: cfg.banco.senha,
    lowercase_keys: false,
    role: null,
    pageSize: 4096,
    // WIN1252 = ANSI do Windows, que e o que o Delphi do Solus grava
    charset: 'WIN1252',
    blobAsText: true,
  };
}

/**
 * O driver do Firebird se perde com barra invertida do Windows.
 * Aqui a gente troca por barra normal, que o Firebird aceita igual.
 */
export function normalizarCaminho(caminho) {
  const BARRA_INVERTIDA = String.fromCharCode(92);
  return String(caminho || '').trim().split(BARRA_INVERTIDA).join('/');
}

function pool() {
  if (!poolCache) poolCache = Firebird.pool(5, opcoes());
  return poolCache;
}

/** Deixa o pool de conexoes de lado (usado quando a configuracao muda). */
export function reiniciarConexao() {
  if (poolCache) {
    try { poolCache.destroy(); } catch { /* pool ja estava fechado */ }
    poolCache = null;
  }
}

/** Roda uma consulta e devolve as linhas. */
export function consultar(sql, params = []) {
  return new Promise((resolve, reject) => {
    pool().get((erro, db) => {
      if (erro) return reject(traduzErro(erro));
      db.query(sql, params, (erroQuery, resultado) => {
        db.detach();
        if (erroQuery) return reject(traduzErro(erroQuery));
        resolve(resultado || []);
      });
    });
  });
}

/**
 * Roda varios comandos dentro de UMA transacao: ou tudo grava, ou nada grava.
 * `trabalho` recebe uma funcao `executar(sql, params)`.
 */
export function emTransacao(trabalho) {
  return new Promise((resolve, reject) => {
    pool().get((erro, db) => {
      if (erro) return reject(traduzErro(erro));
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, async (erroTr, transacao) => {
        if (erroTr) { db.detach(); return reject(traduzErro(erroTr)); }

        const executar = (sql, params = []) => new Promise((ok, falha) => {
          transacao.query(sql, params, (e, r) => (e ? falha(traduzErro(e)) : ok(r || [])));
        });

        try {
          const retorno = await trabalho(executar);
          transacao.commit((erroCommit) => {
            db.detach();
            if (erroCommit) return reject(traduzErro(erroCommit));
            resolve(retorno);
          });
        } catch (falha) {
          transacao.rollback(() => db.detach());
          reject(falha);
        }
      });
    });
  });
}

/** Testa se da pra conectar e conta os produtos. Usado na tela de configuracao. */
export async function testarConexao() {
  const linhas = await consultar('SELECT COUNT(*) AS TOTAL FROM PRODUTO');
  return { ok: true, totalProdutos: Number(linhas[0]?.TOTAL ?? 0) };
}

function traduzErro(erro) {
  const texto = String(erro?.message || erro);
  if (texto.includes('ENOENT') || texto.includes('No such file'))
    return new Error('Arquivo do banco nao encontrado. Confira o caminho do BANCO.FDB na configuracao.');
  if (texto.includes('ECONNREFUSED'))
    return new Error('O servidor Firebird nao respondeu. O PC servidor esta ligado e o Firebird rodando?');
  if (texto.toLowerCase().includes('password') || texto.includes('335544472'))
    return new Error('Usuario ou senha do Firebird incorretos (normalmente SYSDBA / masterkey).');
  return erro instanceof Error ? erro : new Error(texto);
}

// ---------------------------------------------------------------------------
// Acentuacao: o banco e charset NONE e o Delphi gravou os textos em Windows-1252.
// O driver do Node tenta ler tudo como UTF-8 e estraga os acentos ("SAB?O").
// A saida e pedir os bytes crus no SQL (CHARACTER SET OCTETS) e converter aqui.
// ---------------------------------------------------------------------------

const decodificador = new TextDecoder('windows-1252');

/** Monta o pedaco de SQL que traz o campo como bytes crus. */
export function campoTexto(campo, tamanho = 100, apelido = null) {
  const nome = apelido || campo;
  return `CAST(${campo} AS VARCHAR(${tamanho}) CHARACTER SET OCTETS) AS ${nome}`;
}

/** Bytes vindos do banco -> texto legivel com acento certo. */
export function lerTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (Buffer.isBuffer(valor)) return decodificador.decode(valor).trim();
  return String(valor).trim();
}

/**
 * Texto -> bytes no formato que o Solus grava.
 * Acentos do portugues cabem em Latin-1; o que nao couber vira a letra sem acento
 * para nunca gravar caractere quebrado no sistema do cliente.
 */
export function gravarTexto(texto) {
  const limpo = String(texto ?? '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")      // aspas curvas
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');     // travessoes
  const seguro = [...limpo]
    .map((c) => (c.charCodeAt(0) <= 255 ? c : semAcento(c)))
    .join('');
  return Buffer.from(seguro, 'latin1');
}

function semAcento(caractere) {
  const base = caractere.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return base.charCodeAt(0) <= 255 ? base : '?';
}

// ---------------------------------------------------------------------------
// Conversao de numeros: o Solus guarda "1.844,50" em campos de texto
// ---------------------------------------------------------------------------

/** Texto do banco -> numero. Aceita "1.844,50", "1844,50", "1844.50", 1844.5 */
export function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  let texto = String(valor).trim().replace(/[^\d,.\-]/g, '');
  if (!texto) return 0;

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // "1.844,50" (BR) ou "1,844.50" (US) - vale quem vem por ultimo
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }
  // so com ponto: ja esta no formato certo ("1844.50")

  const numero = Number.parseFloat(texto);
  return Number.isFinite(numero) ? numero : 0;
}

/** Numero -> texto no formato que o Solus grava ("1844,50"), sem separador de milhar. */
export function paraTextoBR(numero, casas = 2) {
  const n = typeof numero === 'number' ? numero : paraNumero(numero);
  return (Number.isFinite(n) ? n : 0).toFixed(casas).replace('.', ',');
}
