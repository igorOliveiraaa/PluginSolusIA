// Login usando os MESMOS usuarios do Solus (tabela OPERADOR).
// Ninguem precisa decorar senha nova, e as permissoes que ja existem no Solus
// (ver custo, mexer em cadastro, fazer orcamento) valem tambem aqui.
//
// Observacao de seguranca: a ferramenta nao muda como o Solus guarda as senhas,
// so confere se batem com o que ja esta la. Por isso ela deve rodar SOMENTE
// dentro da rede da loja - nunca exposta na internet.

import crypto from 'node:crypto';
import { consultar, campoTexto, lerTexto } from './firebird.js';
import { comLoja } from '../loja-atual.js';
import { lojasConfiguradas } from '../config.js';

const sessoes = new Map();
const VALIDADE = 12 * 60 * 60 * 1000;      // 12 horas: um dia de trabalho

// Protecao contra quem fica tentando adivinhar a senha.
// As senhas do Solus sao curtas (quatro digitos), entao sem isso um robo
// testaria todas em poucos minutos.
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

  // Nome maior do que cabe no campo do banco nao existe - e mandar assim faz o
  // Firebird responder um erro tecnico em ingles na cara de quem esta entrando.
  if (usuario.length > 40 || chave.length > 40) {
    throw new Error('Usuario ou senha incorretos.');
  }

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

      // mexer no cadastro do produto (preco, custo, estoque) e o que a entrada de
      // nota faz. Neste Solus quase ninguem tem ACESSACADASTRO marcado, entao na
      // pratica so gerente lanca nota - que e como o proprio Solus se comporta.
      mexerProduto: gerente || ehSim(operador.ACESSACADASTRO),

      mexerCliente: gerente || ehSim(operador.ACESSACADASTROCLI) || ehSim(operador.CLIENTE),

      // Orcamento e liberado para todo mundo DE PROPOSITO: quem atende no balcao
      // precisa montar orcamento, e no banco da loja o campo PERMITEORCA esta
      // vazio para todos - exigir ele deixaria so os gerentes fazerem orcamento.
      // (Antes isto estava escrito como "gerente || ehSim(...) || true", que dava
      //  a impressao de haver uma checagem quando nunca houve.)
      fazerOrcamento: true,
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
// O que dizer quando falta permissao. Mensagem generica nao ajuda ninguem:
// a pessoa precisa saber o que fazer para destravar.
const EXPLICACAO = {
  mexerProduto: 'Seu usuario nao tem acesso ao cadastro de produtos no Solus, e lancar nota '
    + 'muda preco, custo e estoque. Entre com um usuario gerente, ou peca para marcarem '
    + '"acessa cadastro" no seu usuario dentro do Solus.',
  mexerCliente: 'Seu usuario nao tem acesso ao cadastro de clientes no Solus.',
  verCusto: 'Seu usuario nao pode ver custo nem margem no Solus.',
  gerente: 'So um usuario gerente pode mexer nos ajustes do Plugin.',
};

export function exigirPermissao(nome) {
  return (req, res, next) => {
    const temPermissao = nome === 'gerente'
      ? req.operador?.gerente
      : req.operador?.permissoes?.[nome];

    if (!temPermissao) {
      return res.status(403).json({
        ok: false,
        erro: EXPLICACAO[nome] || 'Seu usuario nao tem permissao para isso no Solus.',
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
