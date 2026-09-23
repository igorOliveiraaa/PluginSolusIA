// Conexao com o banco Firebird do Solus.
// O banco usa charset NONE (o Delphi grava em Windows-1252) e guarda quase todos
// os numeros como TEXTO no formato brasileiro ("1844,00"). Tudo aqui respeita isso.

import Firebird from 'node-firebird';
import { carregarConfig } from '../config.js';

// uma "fila" de conexoes por loja: cada Solus tem o seu banco
const pools = new Map();

function opcoes() {
  const cfg = carregarConfig();
  if (!cfg.banco?.caminho) {
    throw new Error('Nenhum banco do Solus configurado. Abra o Plugin no PC servidor e escolha a loja.');
  }
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
  const cfg = carregarConfig();
  const chave = cfg.lojaId || 'sem-loja';
  if (!pools.has(chave)) pools.set(chave, Firebird.pool(5, opcoes()));
  return pools.get(chave);
}

/** Deixa as conexoes de lado (usado quando a configuracao das lojas muda). */
export function reiniciarConexao() {
  for (const p of pools.values()) {
    try { p.destroy(); } catch { /* ja estava fechado */ }
  }
  pools.clear();
}

/**
 * Abre UMA conexao avulsa com um banco qualquer, sem passar pelas lojas.
 * Usado para testar um banco antes de salvar como loja.
 */
export function consultarBancoAvulso(banco, sql, params = [], tempoMaximo = 10000) {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('O banco demorou demais para responder.')), tempoMaximo);
    Firebird.attach({
      host: banco.host || 'localhost',
      port: banco.porta || 3050,
      database: normalizarCaminho(banco.caminho),
      // sem usuario/senha informados, vale o padrao da configuracao (ver config.js)
      user: banco.usuario || carregarConfig().banco?.usuario,
      password: banco.senha || carregarConfig().banco?.senha,
      lowercase_keys: false,
      charset: 'WIN1252',
      blobAsText: true,
    }, (erro, db) => {
      if (erro) { clearTimeout(relogio); return reject(traduzErro(erro)); }
      db.query(sql, params, (erroQuery, linhas) => {
        clearTimeout(relogio);
        db.detach();
        if (erroQuery) return reject(traduzErro(erroQuery));
        resolve(linhas || []);
      });
    });
  });
}

/** Roda uma consulta e devolve as linhas. */
export function consultar(sql, params = []) {
  return new Promise((resolve, reject) => {
    let filaDaLoja;
    try { filaDaLoja = pool(); } catch (erro) { return reject(erro); }
    filaDaLoja.get((erro, db) => {
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
    let filaDaLoja;
    try { filaDaLoja = pool(); } catch (erro) { return reject(erro); }
    filaDaLoja.get((erro, db) => {
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
    return new Error('Usuario ou senha do Firebird incorretos. Confira em "Configurar lojas".');

  // Rede de seguranca: o Firebird responde em ingles e cheio de codigo. Nada
  // disso pode chegar na tela de quem esta no balcao.
  if (/string right truncation|numeric overflow|arithmetic exception/i.test(texto))
    return new Error('O que foi digitado e maior do que cabe nesse campo do Solus.');
  if (/deadlock|lock conflict/i.test(texto))
    return new Error('O Solus esta com esse registro aberto em outra tela. Feche e tente de novo.');
  if (/Dynamic SQL Error|SQLSTATE|token unknown/i.test(texto))
    return new Error('Nao consegui fazer essa consulta no Solus. Tente de outro jeito.');

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
// Quase tudo no banco foi gravado pelo Solus em Windows-1252. Mas nem tudo: o
// ACBrMonitor grava a resposta da Sefaz em UTF-8, e ela aparecia na tela como
// "RejeiÃ§Ã£o: IE do destinatÃ¡rio nÃ£o informada". Texto em UTF-8 de verdade se
// denuncia sozinho: os bytes acima de 127 formam sequências válidas de UTF-8, o
// que um texto em Windows-1252 com acento praticamente nunca faz ("SABÃO" é
// 53 41 42 C3 4F - o C3 seguido de 4F não é UTF-8). Então: se passa como UTF-8
// estrito, é UTF-8; senão, é o Windows-1252 de sempre.
const utf8Estrito = new TextDecoder('utf-8', { fatal: true });

export function lerTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (Buffer.isBuffer(valor)) {
    if (valor.some((byte) => byte > 127)) {
      try { return utf8Estrito.decode(valor).trim(); } catch { /* não é UTF-8: segue */ }
    }
    return decodificador.decode(valor).trim();
  }
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
