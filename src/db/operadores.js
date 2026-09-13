// Login usando os MESMOS usuarios do Solus (tabela OPERADOR).
// Ninguem precisa decorar senha nova, e as permissoes que ja existem no Solus
// (ver custo, mexer em cadastro, fazer orcamento) valem tambem aqui.
//
// Observacao de seguranca: o Solus guarda a senha em texto puro no banco.
// Nao da para mudar isso sem quebrar o sistema, entao a ferramenta apenas
// compara - e por isso ela so deve rodar dentro da rede da loja.

import crypto from 'node:crypto';
import { consultar, campoTexto, lerTexto } from './firebird.js';
import { comLoja } from '../loja-atual.js';
import { lojasConfiguradas } from '../config.js';

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
export async function autenticar(nome, senha, origem = '', lojaId = null) {
  const lojas = lojasConfiguradas();
  if (!lojas.length) {
    throw new Error('O Plugin ainda nao sabe qual Solus usar. No PC servidor, toque em "Configurar lojas".');
  }
  const loja = lojas.find((l) => l.id === lojaId) || (lojas.length === 1 ? lojas[0] : null);
  if (!loja) throw new Error('Escolha a loja antes de entrar.');

  // tudo daqui para baixo (consulta do usuario, sessao) acontece no banco dessa loja
  return comLoja(loja.id, () => autenticarNaLoja(nome, senha, origem, loja, lojas.length));
}

async function autenticarNaLoja(nome, senha, origem, loja, quantidadeDeLojas) {
  const usuario = String(nome || '').trim().toUpperCase();
  const chave = String(senha || '').trim();
  if (!usuario || !chave) throw new Error('Informe usuario e senha.');

  // a trava de tentativas vale por loja (o mesmo nome pode existir nas duas)
  const origemNaLoja = `${loja.id}|${origem}`;
  conferirBloqueio(usuario, origemNaLoja);

  // dica que aparece quando o usuario nao bate: quase sempre e o Solus errado
  const dicaDeLoja = quantidadeDeLojas > 1
    ? ` Confira se escolheu a loja certa (agora esta em ${loja.nome}).`
    : ` O Plugin esta usando o Solus de ${loja.nome}. Se nao for esse, no PC servidor toque em "Configurar lojas".`;

  const linhas = await consultar(
    `SELECT FIRST 1 CODIGO, ${campoTexto('NOME', 50)}, SENHA, TIPO, SITUACAO,
            ACESSACADASTRO, ACESSACADASTROCLI, PERMITEORCA, CUSTO, CLIENTE, CODVENDEDOR
       FROM OPERADOR WHERE UPPER(TRIM(NOME)) = ?`,
    [usuario]
  );

  const operador = linhas[0];
  if (!operador) {
    marcarErro(usuario, origemNaLoja);
    throw new Error('Usuario nao encontrado nesse Solus.' + dicaDeLoja);
  }

  const situacao = String(operador.SITUACAO || '').trim().toUpperCase();
  if (situacao === 'I') throw new Error('Esse usuario esta inativo no Solus.');

  if (String(operador.SENHA || '').trim() !== chave) {
    marcarErro(usuario, origemNaLoja);
    throw new Error('Senha incorreta.' + dicaDeLoja);
  }

  limparTentativas(usuario, origemNaLoja);

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
  dados.loja = { id: loja.id, nome: loja.nome, cnpj: loja.cnpj };
  sessoes.set(token, { operador: dados, lojaId: loja.id, criadaEm: Date.now() });
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
  // a loja pode ter sido removida da configuracao depois do login
  if (operador.loja?.id && !lojasConfiguradas().some((l) => l.id === operador.loja.id)) {
    encerrarSessao(token);
    return res.status(401).json({ ok: false, erro: 'A configuracao das lojas mudou. Entre de novo.', precisaLogin: true });
  }
  req.operador = operador;
  req.lojaId = operador.loja?.id || null;
  comLoja(req.lojaId, next);
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
export async function listarOperadores(lojaId = null) {
  if (lojaId) return comLoja(lojaId, () => listarOperadoresDaLoja());
  return listarOperadoresDaLoja();
}

async function listarOperadoresDaLoja() {
  const linhas = await consultar(
    `SELECT ${campoTexto('NOME', 50)} FROM OPERADOR
      WHERE NOME IS NOT NULL AND NOME <> ''
        AND (SITUACAO IS NULL OR UPPER(SITUACAO) <> 'I')
      ORDER BY NOME`
  );
  return linhas.map((l) => lerTexto(l.NOME)).filter(Boolean);
}
