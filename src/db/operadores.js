// Login usando os MESMOS usuarios do Solus (tabela OPERADOR).
// Ninguem precisa decorar senha nova, e as permissoes que ja existem no Solus
// (ver custo, mexer em cadastro, fazer orcamento) valem tambem aqui.
//
// Observacao de seguranca: o Solus guarda a senha em texto puro no banco.
// Nao da para mudar isso sem quebrar o sistema, entao a ferramenta apenas
// compara - e por isso ela so deve rodar dentro da rede da loja.

import crypto from 'node:crypto';
import { consultar, campoTexto, lerTexto } from './firebird.js';

const sessoes = new Map();
const VALIDADE = 12 * 60 * 60 * 1000;      // 12 horas: um dia de trabalho

// Protecao contra quem fica tentando adivinhar a senha.
// As senhas do Solus sao curtas e ficam em texto puro no banco, entao sem isso
// um robo testaria milhares de senhas por minuto - especialmente se a ferramenta
// um dia for acessada de fora da loja.
const tentativas = new Map();
const MAX_TENTATIVAS = 5;
const CASTIGO = 10 * 60 * 1000;            // 10 minutos travado

function chaveTentativa(usuario, origem) {
  return `${String(usuario).toUpperCase()}|${origem || 'local'}`;
}

function conferirBloqueio(usuario, origem) {
  const registro = tentativas.get(chaveTentativa(usuario, origem));
  if (!registro) return;

  const passou = Date.now() - registro.ultima;
  if (registro.erros >= MAX_TENTATIVAS && passou < CASTIGO) {
    const faltam = Math.ceil((CASTIGO - passou) / 60000);
    throw new Error(`Muitas tentativas de senha. Espere ${faltam} minuto(s) e tente de novo.`);
  }
  if (passou >= CASTIGO) tentativas.delete(chaveTentativa(usuario, origem));
}

function marcarErro(usuario, origem) {
  const chave = chaveTentativa(usuario, origem);
  const registro = tentativas.get(chave) || { erros: 0, ultima: 0 };
  registro.erros += 1;
  registro.ultima = Date.now();
  tentativas.set(chave, registro);
}

function limparTentativas(usuario, origem) {
  tentativas.delete(chaveTentativa(usuario, origem));
}

function ehSim(valor) {
  return String(valor || '').trim().toUpperCase() === 'S';
}

/** Confere usuario e senha contra a tabela OPERADOR do Solus. */
export async function autenticar(nome, senha, origem = '') {
  const usuario = String(nome || '').trim().toUpperCase();
  const chave = String(senha || '').trim();
  if (!usuario || !chave) throw new Error('Informe usuario e senha.');

  conferirBloqueio(usuario, origem);

  const linhas = await consultar(
    `SELECT FIRST 1 CODIGO, ${campoTexto('NOME', 50)}, SENHA, TIPO, SITUACAO,
            ACESSACADASTRO, ACESSACADASTROCLI, PERMITEORCA, CUSTO, CLIENTE, CODVENDEDOR
       FROM OPERADOR WHERE UPPER(TRIM(NOME)) = ?`,
    [usuario]
  );

  const operador = linhas[0];
  if (!operador) {
    marcarErro(usuario, origem);
    throw new Error('Usuario nao encontrado no Solus.');
  }

  const situacao = String(operador.SITUACAO || '').trim().toUpperCase();
  if (situacao === 'I') throw new Error('Esse usuario esta inativo no Solus.');

  if (String(operador.SENHA || '').trim() !== chave) {
    marcarErro(usuario, origem);
    throw new Error('Senha incorreta.');
  }

  limparTentativas(usuario, origem);

  const gerente = String(operador.TIPO || '').trim().toUpperCase() === 'G';

  const dados = {
    codigo: String(operador.CODIGO || '').trim(),
    nome: lerTexto(operador.NOME),
    gerente,
    // usado para marcar quem vendeu, quando o operador tambem e vendedor no Solus
    codigoVendedor: String(operador.CODVENDEDOR || '').trim(),
    permissoes: {
      // gerente pode tudo; os outros seguem o que esta marcado no Solus
      verCusto: gerente || ehSim(operador.CUSTO),
      mexerProduto: gerente || ehSim(operador.ACESSACADASTRO),
      mexerCliente: gerente || ehSim(operador.ACESSACADASTROCLI) || ehSim(operador.CLIENTE),
      fazerOrcamento: gerente || ehSim(operador.PERMITEORCA) || true,
    },
  };

  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { operador: dados, criadaEm: Date.now() });
  limparSessoesVelhas();

  return { token, operador: dados };
}

function limparSessoesVelhas() {
  for (const [token, sessao] of sessoes) {
    if (Date.now() - sessao.criadaEm > VALIDADE) sessoes.delete(token);
  }
}

export function operadorDaSessao(token) {
  const sessao = sessoes.get(String(token || ''));
  if (!sessao) return null;
  if (Date.now() - sessao.criadaEm > VALIDADE) {
    sessoes.delete(token);
    return null;
  }
  return sessao.operador;
}

export function encerrarSessao(token) {
  sessoes.delete(String(token || ''));
}

/** Middleware do Express: exige estar logado. */
export function exigirLogin(req, res, next) {
  const token = req.headers['x-sessao'] || req.query.sessao;
  const operador = operadorDaSessao(token);
  if (!operador) {
    return res.status(401).json({ ok: false, erro: 'Sessao expirada. Entre de novo.', precisaLogin: true });
  }
  req.operador = operador;
  next();
}

/** Middleware que exige uma permissao especifica. */
export function exigirPermissao(nome) {
  return (req, res, next) => {
    if (!req.operador?.permissoes?.[nome]) {
      return res.status(403).json({
        ok: false,
        erro: 'Seu usuario nao tem permissao para isso no Solus.',
      });
    }
    next();
  };
}

/** Lista os usuarios ativos, para a tela de login sugerir quem entra. */
export async function listarOperadores() {
  const linhas = await consultar(
    `SELECT ${campoTexto('NOME', 50)} FROM OPERADOR
      WHERE NOME IS NOT NULL AND NOME <> ''
        AND (SITUACAO IS NULL OR UPPER(SITUACAO) <> 'I')
      ORDER BY NOME`
  );
  return linhas.map((l) => lerTexto(l.NOME)).filter(Boolean);
}
