// PERMISSOES: o Plugin tem que respeitar o que o Solus ja decidiu.
//
// O risco real: o Plugin grava preco, custo e estoque no cadastro. Se qualquer
// pessoa que entra puder fazer isso, uma operadora de caixa muda o preco da loja
// inteira pelo celular - coisa que o Solus nao deixaria ela fazer.
//
// O outro risco e mais silencioso: CUSTO. A tela esconde, mas se o numero for
// junto na resposta da API, basta abrir o navegador para ler. E na consulta
// livre da IA bastaria pedir "traz PRECOCUSTO".
//
// Este teste entra com DOIS usuarios de verdade: um gerente e um sem permissao.

import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { revistar } from '../ia/sql-seguro.js';
import { procurarProduto, lucroDoPeriodo } from '../ia/consultas.js';
import { semCustoParaQuemNaoPodeVer } from '../db/produtos.js';

const S = 'http://localhost:3535';
let falhas = 0;
const conferir = (t, ok, d = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${t}${d ? ' -> ' + String(d).slice(0, 92) : ''}`);
  if (!ok) falhas += 1;
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. Quem e quem no Solus da loja ===');

const operadores = await consultar(
  `SELECT FIRST 60 ${campoTexto('NOME', 30)}, SENHA, TIPO, CUSTO, ACESSACADASTRO, STATUS
     FROM OPERADOR`
);

const ativos = operadores
  .map((o) => ({
    nome: lerTexto(o.NOME).trim(),
    senha: String(o.SENHA || '').trim(),
    gerente: String(o.TIPO || '').trim().toUpperCase() === 'G',
    cadastro: String(o.ACESSACADASTRO || '').trim().toUpperCase() === 'S',
    cancelado: String(o.STATUS || '').trim().toUpperCase() === 'CANCELADO',
  }))
  .filter((o) => o.nome && o.senha && !o.cancelado);

const oGerente = ativos.find((o) => o.gerente);
const oComum = ativos.find((o) => !o.gerente && !o.cadastro);

conferir('achei um gerente', Boolean(oGerente), oGerente?.nome);
conferir('achei alguem sem acesso a cadastro', Boolean(oComum), oComum?.nome);
if (!oGerente || !oComum) {
  console.log('\n(sem os dois tipos de usuario nao da para testar permissao)');
  process.exit(falhas ? 1 : 0);
}

// O login TEM que ser pelo servidor: a sessao vive no processo do servidor, e
// autenticar() aqui criaria um token que so existe dentro deste script.
async function entrar(usuario, senha) {
  const r = await fetch(S + '/api/entrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha }),
  });
  const dados = await r.json();
  if (!dados.ok) throw new Error(`nao entrei como ${usuario}: ${dados.erro}`);
  return dados;
}

const gerente = await entrar(oGerente.nome, oGerente.senha);
const comum = await entrar(oComum.nome, oComum.senha);

console.log(`     gerente: ${gerente.operador.nome} -> ${JSON.stringify(gerente.operador.permissoes)}`);
console.log(`     comum:   ${comum.operador.nome} -> ${JSON.stringify(comum.operador.permissoes)}`);

conferir('o gerente pode tudo',
  gerente.operador.permissoes.verCusto && gerente.operador.permissoes.mexerProduto);
conferir('o comum NAO ve custo', comum.operador.permissoes.verCusto === false);
conferir('o comum NAO mexe no cadastro', comum.operador.permissoes.mexerProduto === false);
conferir('mas o comum PODE fazer orcamento (e o trabalho dele)',
  comum.operador.permissoes.fazerOrcamento === true);

// ---------------------------------------------------------------------------
console.log('\n=== 2. Gravar no cadastro exige permissao ===');

const chamar = async (caminho, token, opcoes = {}) => {
  const headers = { 'x-sessao': token, ...(opcoes.headers || {}) };
  if (typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
};

const aplicarComum = await chamar('/api/aplicar', comum.token, {
  method: 'POST', body: JSON.stringify({ id: 'qualquer', decisoes: [] }),
});
conferir('o comum NAO consegue gravar nota', aplicarComum.status === 403,
  `${aplicarComum.status} · ${aplicarComum.dados.erro}`);
conferir('e a mensagem explica o que fazer',
  /cadastro|gerente/i.test(aplicarComum.dados.erro || ''), aplicarComum.dados.erro);

const desfazerComum = await chamar('/api/desfazer/qualquer', comum.token, { method: 'POST' });
conferir('o comum NAO consegue desfazer', desfazerComum.status === 403, desfazerComum.dados.erro);

const configComum = await chamar('/api/config', comum.token, {
  method: 'POST', body: JSON.stringify({ regras: { margemNovoProduto: 1 } }),
});
conferir('o comum NAO mexe nos ajustes', configComum.status === 403, configComum.dados.erro);

const logoComum = await chamar('/api/logo', comum.token, { method: 'DELETE' });
conferir('o comum NAO apaga o logo da loja', logoComum.status === 403, logoComum.dados.erro);

// o gerente passa pela permissao (o erro dele e outro: id inventado)
const aplicarGerente = await chamar('/api/aplicar', gerente.token, {
  method: 'POST', body: JSON.stringify({ id: 'qualquer', decisoes: [] }),
});
conferir('o gerente passa pela permissao', aplicarGerente.status !== 403,
  `${aplicarGerente.status} · ${aplicarGerente.dados.erro}`);

// ---------------------------------------------------------------------------
console.log('\n=== 3. Custo nao vaza para quem nao pode ver ===');

const buscaComum = await chamar('/api/produtos?q=detergente', comum.token);
const primeiro = buscaComum.dados.produtos?.[0];
conferir('a busca responde para o comum', Boolean(primeiro), primeiro?.descricao);
conferir('mas SEM custo na resposta',
  primeiro ? (primeiro.custoAtual === null || primeiro.custoAtual === undefined) : false,
  'custoAtual = ' + JSON.stringify(primeiro?.custoAtual));
conferir('e SEM margem', primeiro ? !primeiro.margemAtual : false,
  'margemAtual = ' + JSON.stringify(primeiro?.margemAtual));
conferir('o preco de venda continua aparecendo (isso ele pode ver)',
  Number(primeiro?.vendaAtual) >= 0, 'R$ ' + primeiro?.vendaAtual);

const buscaGerente = await chamar('/api/produtos?q=detergente', gerente.token);
conferir('o gerente continua vendo o custo',
  Number(buscaGerente.dados.produtos?.[0]?.custoAtual) > 0,
  'R$ ' + buscaGerente.dados.produtos?.[0]?.custoAtual);

const modalComum = await chamar('/api/orcamento/buscar-produto?q=detergente', comum.token);
conferir('a busca do orcamento tambem esconde',
  modalComum.dados.produtos?.[0] && !modalComum.dados.produtos[0].custoAtual);

// ---------------------------------------------------------------------------
console.log('\n=== 4. As consultas da IA respeitam a permissao ===');

const produtoComum = await procurarProduto({ termo: 'detergente' }, { operador: comum.operador });
conferir('procurar_produto esconde custo do comum',
  produtoComum.produtos?.every((p) => p.precoCusto === undefined),
  JSON.stringify(produtoComum.produtos?.[0] || {}).slice(0, 88));

const produtoGerente = await procurarProduto({ termo: 'detergente' }, { operador: gerente.operador });
conferir('e mostra para o gerente',
  produtoGerente.produtos?.some((p) => p.precoCusto > 0));

const lucroComum = await lucroDoPeriodo({ mes: 8, ano: 2025 }, { operador: comum.operador });
conferir('lucro e recusado para quem nao ve custo',
  lucroComum.semPermissao === true && lucroComum.lucroBruto === undefined,
  lucroComum.mensagem);

const lucroGerente = await lucroDoPeriodo({ mes: 8, ano: 2025 }, { operador: gerente.operador });
conferir('e calculado para o gerente', Number(lucroGerente.lucroBruto) > 0,
  'R$ ' + lucroGerente.lucroBruto);

// ---------------------------------------------------------------------------
console.log('\n=== 5. A consulta livre nao serve de atalho para o custo ===');

const tentativas = [
  'SELECT DESCRICAO, PRECOCUSTO FROM PRODUTO',
  'SELECT DESCRICAO, MARGEM FROM PRODUTO',
  'SELECT DESCRICAO, PC FROM PRODUTO',
  'SELECT DESCRICAO, UPRECOCUSTO FROM PRODUTO',
  'SELECT SUM(CUSTOVENDA) FROM PEDIDOS',
];
for (const sql of tentativas) {
  const r = revistar(sql, { podeVerCusto: false });
  conferir(`barrado: ${sql.slice(0, 44)}`, r.ok === false, r.motivo);
}
const permitido = revistar('SELECT DESCRICAO, PRECOVENDA FROM PRODUTO', { podeVerCusto: false });
conferir('mas preco de VENDA continua liberado', permitido.ok === true, permitido.motivo || 'ok');

const paraGerente = revistar('SELECT DESCRICAO, PRECOCUSTO FROM PRODUTO', { podeVerCusto: true });
conferir('e o gerente consulta custo normalmente', paraGerente.ok === true);

// ---------------------------------------------------------------------------
console.log('\n=== 6. O ajudante que esconde custo ===');

const limpo = semCustoParaQuemNaoPodeVer([{ custoAtual: 10, margemAtual: 50, vendaAtual: 15 }], false);
conferir('limpa custo, margem e mantem venda',
  limpo[0].custoAtual === null && limpo[0].margemAtual === null && limpo[0].vendaAtual === 15);
conferir('nao mexe em nada para quem pode ver',
  semCustoParaQuemNaoPodeVer([{ custoAtual: 10 }], true)[0].custoAtual === 10);
conferir('aguenta lista vazia e null',
  semCustoParaQuemNaoPodeVer([], false).length === 0
  && semCustoParaQuemNaoPodeVer(null, false) === null);

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
