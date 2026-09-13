// Procura os Solus instalados neste PC.
//
// Motivo: no PC servidor da loja pode haver mais de um Solus (um por CNPJ), em
// pastas diferentes. Se o Plugin abrir o banco errado, os usuarios "nao existem"
// ou a senha "esta errada" - que foi exatamente o que aconteceu na instalacao.
//
// Como o Solus diz qual banco usa: na pasta do Solus.exe existe o BANCO.INI, com o
// caminho do banco na primeira linha. Aqui a gente varre os discos atras desses
// BANCO.INI (e de arquivos .FDB soltos), abre cada banco e le a empresa dele
// (tabela PARAMETRO: razao social, nome fantasia, CNPJ).
//
// So leitura: nada e alterado em nenhum banco.

import fs from 'node:fs';
import path from 'node:path';
import { consultarBancoAvulso, lerTexto, campoTexto, paraNumero } from './db/firebird.js';

// pastas que nunca tem Solus e sao enormes: pular deixa a busca rapida
const PULAR = new Set([
  'windows', '$recycle.bin', 'system volume information', 'recovery', 'perflogs',
  'programdata', 'appdata', 'node_modules', '.git', 'msocache', '$winreagent',
  'windows.old', 'intel', 'amd', 'nvidia', 'xboxgames', 'riot games', 'steam',
  'steamlibrary', 'epic games', 'onedrive',
]);

const PROFUNDIDADE_MAXIMA = 5;
const TEMPO_MAXIMO_MS = 25000;
const PASTAS_MAXIMAS = 60000;

function discosDoPC() {
  const letras = 'CDEFGHIJ'.split('');
  return letras.map((l) => `${l}:/`).filter((raiz) => {
    try { fs.accessSync(raiz); return true; } catch { return false; }
  });
}

/**
 * Le o BANCO.INI. A primeira linha com conteudo e o caminho do banco, as vezes
 * com o endereco do servidor na frente ("192.168.0.10:C:\SOLUS\...").
 */
function lerBancoIni(arquivo) {
  try {
    const conteudo = fs.readFileSync(arquivo, 'latin1');
    const linha = conteudo.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!linha) return null;

    // "servidor:C:\caminho" ou "servidor/3050:C:\caminho"; "C:\caminho" e local
    const comServidor = linha.match(/^([^:\\/]{2,})(?:\/(\d+))?:([A-Za-z]:[\\/].+)$/);
    if (comServidor) {
      return { host: comServidor[1], porta: Number(comServidor[2]) || 3050, caminho: comServidor[3] };
    }
    if (/^[A-Za-z]:[\\/]/.test(linha)) return { host: 'localhost', porta: 3050, caminho: linha };
    return null;
  } catch {
    return null;
  }
}

/** Varre os discos atras de BANCO.INI e bancos .FDB. */
function varrerDiscos() {
  const inicio = Date.now();
  const bancos = new Map();       // caminho normalizado -> dados
  let pastasVistas = 0;

  const chave = (host, caminho) =>
    `${String(host || 'localhost').toLowerCase()}|${String(caminho).replace(/\\/g, '/').toLowerCase()}`;

  const registrar = (host, porta, caminho, origem) => {
    const k = chave(host, caminho);
    const atual = bancos.get(k) || { host, porta, caminho, usadoPor: [], soltos: false };
    if (origem) {
      if (!atual.usadoPor.includes(origem)) atual.usadoPor.push(origem);
    } else {
      atual.soltos = true;
    }
    bancos.set(k, atual);
  };

  const visitar = (pasta, nivel) => {
    if (nivel > PROFUNDIDADE_MAXIMA) return;
    if (Date.now() - inicio > TEMPO_MAXIMO_MS || pastasVistas > PASTAS_MAXIMAS) return;
    pastasVistas += 1;

    let entradas;
    try {
      entradas = fs.readdirSync(pasta, { withFileTypes: true });
    } catch {
      return;   // sem permissao ou pasta sumiu: segue
    }

    for (const entrada of entradas) {
      const nome = entrada.name;
      const completo = path.join(pasta, nome);
      const minusculo = nome.toLowerCase();

      if (entrada.isDirectory()) {
        if (PULAR.has(minusculo) || minusculo.startsWith('$')) continue;
        visitar(completo, nivel + 1);
        continue;
      }

      if (minusculo === 'banco.ini') {
        const lido = lerBancoIni(completo);
        if (lido) registrar(lido.host, lido.porta, lido.caminho, pasta);
      } else if (minusculo.endsWith('.fdb') || minusculo.endsWith('.gdb')) {
        registrar('localhost', 3050, completo, null);
      }
    }
  };

  for (const disco of discosDoPC()) visitar(disco, 1);

  return {
    bancos: [...bancos.values()],
    demorou: Date.now() - inicio,
    incompleta: Date.now() - inicio > TEMPO_MAXIMO_MS || pastasVistas > PASTAS_MAXIMAS,
  };
}

/** Abre o banco e descobre de que empresa ele e. */
async function examinarBanco(banco, usuarioProcurado = '') {
  const resultado = {
    ...banco,
    existe: null,
    tamanhoMB: null,
    modificadoEm: null,
    abriu: false,
    erro: '',
    empresa: null,
    produtos: 0,
    clientes: 0,
    ultimoMovimento: null,
    usuarios: [],
    temUsuarioProcurado: null,
  };

  // so da para olhar tamanho e data quando o arquivo esta neste PC
  if (!banco.host || banco.host === 'localhost' || banco.host === '127.0.0.1') {
    try {
      const info = fs.statSync(banco.caminho);
      resultado.existe = true;
      resultado.tamanhoMB = Math.round(info.size / 1024 / 1024);
      resultado.modificadoEm = info.mtime;
    } catch {
      resultado.existe = false;
      resultado.erro = 'O arquivo do banco nao existe mais nesse caminho.';
      return resultado;
    }
  }

  try {
    const [parametro] = await consultarBancoAvulso(banco,
      `SELECT FIRST 1 ${campoTexto('RAZAO', 50)}, ${campoTexto('FANTASIA', 50)}, CPFCNPJ, ${campoTexto('CIDADE', 30)}
         FROM PARAMETRO`);
    resultado.abriu = true;
    resultado.empresa = parametro
      ? {
        razao: lerTexto(parametro.RAZAO),
        fantasia: lerTexto(parametro.FANTASIA),
        cnpj: String(parametro.CPFCNPJ || '').trim(),
        cidade: lerTexto(parametro.CIDADE),
      }
      : null;
  } catch (erro) {
    resultado.erro = /PARAMETRO/i.test(erro.message)
      ? 'Esse banco nao parece ser do Solus.'
      : erro.message;
    return resultado;
  }

  // numeros para ajudar a reconhecer qual e o banco "de verdade" (o que tem movimento)
  const contar = async (sql) => {
    try {
      const [linha] = await consultarBancoAvulso(banco, sql);
      return linha;
    } catch {
      return null;
    }
  };

  resultado.produtos = Number((await contar('SELECT COUNT(*) AS T FROM PRODUTO'))?.T || 0);
  resultado.clientes = Number((await contar('SELECT COUNT(*) AS T FROM CLIENTES'))?.T || 0);
  resultado.ultimoMovimento = (await contar('SELECT MAX(EMISSAO) AS U FROM PEDIDOS'))?.U || null;

  try {
    const operadores = await consultarBancoAvulso(banco,
      `SELECT ${campoTexto('NOME', 50)}, SITUACAO FROM OPERADOR
        WHERE NOME IS NOT NULL AND NOME <> '' ORDER BY NOME`);
    resultado.usuarios = operadores
      .filter((o) => String(o.SITUACAO || '').trim().toUpperCase() !== 'I')
      .map((o) => lerTexto(o.NOME))
      .filter(Boolean);
  } catch { /* sem a tabela de usuarios: segue */ }

  if (usuarioProcurado) {
    const alvo = String(usuarioProcurado).trim().toUpperCase();
    resultado.temUsuarioProcurado = resultado.usuarios.some((u) => u.trim().toUpperCase() === alvo);
  }

  return resultado;
}

/**
 * Procura e examina os Solus do PC.
 * `usuarioProcurado` ajuda a achar o banco certo: "a ELAINE esta neste aqui".
 */
export async function procurarInstalacoes({ usuarioProcurado = '', caminhosExtras = [] } = {}) {
  const varredura = varrerDiscos();

  for (const extra of caminhosExtras) {
    if (!extra) continue;
    const existe = varredura.bancos.some((b) =>
      b.caminho.replace(/\\/g, '/').toLowerCase() === String(extra).replace(/\\/g, '/').toLowerCase());
    if (!existe) varredura.bancos.push({ host: 'localhost', porta: 3050, caminho: extra, usadoPor: [], soltos: true });
  }

  const examinados = [];
  for (const banco of varredura.bancos) {
    examinados.push(await examinarBanco(banco, usuarioProcurado));
  }

  // os bancos do Solus de verdade primeiro; entre eles, o com movimento mais recente
  const nota = (b) => (b.abriu ? 1e15 : 0)
    + (b.usadoPor.length ? 1e14 : 0)
    + (b.ultimoMovimento ? new Date(b.ultimoMovimento).getTime() : 0);
  examinados.sort((a, b) => nota(b) - nota(a));

  return {
    instalacoes: examinados.map((b) => ({
      caminho: b.caminho,
      host: b.host,
      porta: b.porta,
      pastasDoSolus: b.usadoPor,
      encontradoSolto: b.soltos && !b.usadoPor.length,
      existe: b.existe,
      tamanhoMB: b.tamanhoMB,
      modificadoEm: b.modificadoEm,
      ehSolus: b.abriu,
      erro: b.erro,
      empresa: b.empresa,
      produtos: b.produtos,
      clientes: b.clientes,
      ultimoMovimento: b.ultimoMovimento,
      quantidadeDeUsuarios: b.usuarios.length,
      temUsuarioProcurado: b.temUsuarioProcurado,
      // parece copia ou backup quando nenhum Solus aponta para ele
      pareceCopia: b.abriu && !b.usadoPor.length,
    })),
    buscaIncompleta: varredura.incompleta,
    segundos: Math.round(varredura.demorou / 100) / 10,
  };
}

/** Testa um banco escolhido na mao antes de salvar como loja. */
export async function testarBanco(banco, usuarioProcurado = '') {
  const examinado = await examinarBanco({ ...banco, usadoPor: [], soltos: true }, usuarioProcurado);
  return examinado;
}

export { paraNumero };
