// Reproduz a situacao da loja: DOIS Solus no mesmo PC (um por CNPJ), cada um com
// os seus usuarios. Neste PC de desenvolvimento:
//   - C:/SolusTeste/EC.FDB               -> a loja principal
//   - C:/Solus/Solussis/BANCO/BANCO.FDB  -> a segunda loja
// Quem entra em cada uma vem de dados/teste.json (fora do Git).
//
// Guarda a configuracao atual antes e devolve no fim.

import fs from 'node:fs';
import { credenciaisDeTeste, credenciaisDaOutraLoja } from './credenciais-de-teste.mjs';
import { clienteParaTeste, termoDeBusca } from './dados-de-teste.mjs';

// as senhas nao ficam no codigo: ver credenciais-de-teste.mjs
const LOGIN = credenciaisDeTeste();
const LOGIN2 = credenciaisDaOutraLoja();
if (!LOGIN2) {
  console.log('\nEste teste precisa TAMBEM de um usuario da segunda loja.');
  console.log('Ponha em dados/teste.json:  "outraLoja": { "usuario": "...", "senha": "..." }');
  process.exit(0);
}

const S = 'http://localhost:3535';
const CONFIG = 'dados/config.json';
const original = fs.readFileSync(CONFIG, 'utf8');
let falhas = 0;

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

const json = async (caminho, opcoes = {}, token = '') => {
  const headers = { ...(opcoes.headers || {}) };
  if (token) headers['x-sessao'] = token;
  if (opcoes.body && typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
};

try {
  // ---- 1. comeca do zero, como numa instalacao nova ----------------------
  console.log('\n=== 1. Instalacao nova (sem loja configurada) ===');
  const semLojas = JSON.parse(original);
  delete semLojas.banco; delete semLojas.lojas; delete semLojas.loja; delete semLojas.notas; delete semLojas.empresa;
  fs.writeFileSync(CONFIG, JSON.stringify(semLojas, null, 2));

  const vazio = await json('/api/lojas');
  conferir('pede para configurar', vazio.dados.precisaConfigurar === true);
  conferir('este PC (o servidor) pode configurar', vazio.dados.podeConfigurar === true);

  const loginSemLoja = await json('/api/entrar', { method: 'POST', body: JSON.stringify(LOGIN) });
  conferir('login sem loja explica o que fazer', /Configurar lojas/.test(loginSemLoja.dados.erro || ''), loginSemLoja.dados.erro);

  // ---- 2. procura os Solus ------------------------------------------------
  console.log('\n=== 2. Procurando os Solus deste PC ===');
  const busca = await json('/api/instalacao/procurar?usuario=' + encodeURIComponent(LOGIN.usuario));
  const achados = busca.dados.instalacoes || [];
  achados.forEach((i) => console.log(`     - ${i.empresa?.fantasia} | ${i.empresa?.cnpj} | tem ${LOGIN.usuario}: ${i.temUsuarioProcurado}`));
  const bancoA = achados.find((i) => /EC\.FDB$/i.test(i.caminho));
  const bancoB = achados.find((i) => /BANCO\.FDB$/i.test(i.caminho));
  conferir('achou os dois Solus', Boolean(bancoA && bancoB), `${achados.length} encontrados em ${busca.dados.segundos}s`);
  conferir('escondeu os bancos internos do Firebird', !achados.some((i) => /security2|help\.fdb/i.test(i.caminho)));
  conferir('mostra em qual esta o usuario procurado', bancoA?.temUsuarioProcurado === true && bancoB?.temUsuarioProcurado === false);

  // ---- 3. salva as duas lojas ---------------------------------------------
  console.log('\n=== 3. Salvando as duas lojas ===');
  const salvas = await json('/api/instalacao/lojas', {
    method: 'POST',
    body: JSON.stringify({ lojas: [
      { nome: 'Loja A', cnpj: bancoA.empresa.cnpj, caminho: bancoA.caminho },
      { nome: 'Loja B', cnpj: bancoB.empresa.cnpj, caminho: bancoB.caminho },
    ] }),
  });
  conferir('salvou', salvas.dados.ok === true, (salvas.dados.lojas || []).map((l) => l.id).join(', ') || salvas.dados.erro);
  const [lojaA, lojaB] = salvas.dados.lojas || [];

  const repetido = await json('/api/instalacao/lojas', {
    method: 'POST',
    body: JSON.stringify({ lojas: [{ nome: 'A', caminho: bancoA.caminho }, { nome: 'B', caminho: bancoA.caminho }] }),
  });
  conferir('recusa o mesmo banco duas vezes', repetido.dados.ok === false);

  const inexistente = await json('/api/instalacao/lojas', {
    method: 'POST',
    body: JSON.stringify({ lojas: [{ nome: 'X', caminho: 'C:/NaoExiste/BANCO.FDB' }] }),
  });
  conferir('recusa banco que nao existe', inexistente.dados.ok === false, inexistente.dados.erro);

  const depois = await json('/api/lojas');
  conferir('login agora mostra as duas lojas', depois.dados.lojas?.length === 2);

  // ---- 4. o problema da loja: usuario no Solus errado ---------------------
  console.log('\n=== 4. O mesmo problema que aconteceu na loja ===');
  const naLojaErrada = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ ...LOGIN, loja: lojaB.id }) });
  conferir('o usuario na loja errada nao entra', naLojaErrada.dados.ok === false);
  conferir('e a mensagem diz para conferir a loja', /loja certa/i.test(naLojaErrada.dados.erro || ''), naLojaErrada.dados.erro);

  const semEscolher = await json('/api/entrar', { method: 'POST', body: JSON.stringify(LOGIN) });
  conferir('com duas lojas, exige escolher', /Escolha a loja/i.test(semEscolher.dados.erro || ''));

  // ---- 5. cada um na sua loja --------------------------------------------
  console.log('\n=== 5. Cada usuario na sua loja ===');
  const principal = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ ...LOGIN, loja: lojaA.id }) });
  conferir('entra na loja principal', principal.dados.ok === true, principal.dados.operador?.loja?.nome);
  const admin = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ ...LOGIN2, loja: lojaB.id }) });
  conferir('o outro usuario entra na segunda loja', admin.dados.ok === true, admin.dados.operador?.loja?.nome);

  const operadoresA = await json('/api/operadores?loja=' + lojaA.id);
  const operadoresB = await json('/api/operadores?loja=' + lojaB.id);
  conferir('lista de usuarios e de cada loja',
    operadoresA.dados.operadores?.includes(LOGIN.usuario)
    && !operadoresB.dados.operadores?.includes(LOGIN.usuario),
    `${operadoresA.dados.operadores?.length} x ${operadoresB.dados.operadores?.length}`);

  // ---- 6. os dados nao se misturam ----------------------------------------
  console.log('\n=== 6. Os dados nao se misturam ===');
  const bancoDaA = await json('/api/testar-banco', {}, principal.dados.token);
  const bancoDaB = await json('/api/testar-banco', {}, admin.dados.token);
  conferir('ve os produtos da loja principal', bancoDaA.dados.totalProdutos > 10000, `${bancoDaA.dados.totalProdutos} produtos`);
  conferir('o outro ve os produtos da segunda loja', bancoDaB.dados.totalProdutos < 100, `${bancoDaB.dados.totalProdutos} produtos`);

  // as duas ao mesmo tempo, para garantir que uma requisicao nao pega a loja da outra
  const simultaneas = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    json('/api/testar-banco', {}, i % 2 ? admin.dados.token : principal.dados.token)));
  const trocou = simultaneas.some((r, i) => (i % 2 ? r.dados.totalProdutos > 100 : r.dados.totalProdutos < 10000));
  conferir('10 consultas ao mesmo tempo, cada uma no seu banco', !trocou && simultaneas.every((r) => r.dados.totalProdutos !== undefined));

  // o nome vem do banco da loja principal: nome de cliente nao fica no codigo
  const alguem = encodeURIComponent(termoDeBusca((await clienteParaTeste())?.nome));
  const clientesA = await json('/api/clientes?q=' + alguem, {}, principal.dados.token);
  const clientesB = await json('/api/clientes?q=' + alguem, {}, admin.dados.token);
  conferir('busca de cliente respeita a loja',
    clientesA.dados.clientes?.length > 0 && clientesB.dados.clientes?.length === 0);

  const ajustesA = await json('/api/config', {}, principal.dados.token);
  conferir('Ajustes mostra a loja certa', ajustesA.dados.config?.lojaNome === 'Loja A', ajustesA.dados.config?.lojaNome);
  conferir('Ajustes nao expoe o caminho do banco', ajustesA.dados.config?.banco === undefined);

  // um orcamento montado na loja A nao pode ser gravado pela loja B
  const form = new FormData();
  form.append('texto', '2 detergente ype 500ml');
  const montado = await fetch(S + '/api/orcamento/montar', { method: 'POST', body: form, headers: { 'x-sessao': principal.dados.token } }).then((r) => r.json());
  const invasao = await json('/api/orcamento/gravar', { method: 'POST', body: JSON.stringify({ id: montado.id }) }, admin.dados.token);
  conferir('orcamento de uma loja nao grava na outra', /outra loja/.test(invasao.dados.erro || ''), invasao.dados.erro);

  // ---- 7. sem ser gerente e de fora do servidor, nao configura -----------
  console.log('\n=== 7. Protecao da configuracao ===');
  const { ehDoProprioServidor } = await import('../rotas-lojas.js');
  conferir('reconhece o proprio PC', ehDoProprioServidor({ socket: { remoteAddress: '::ffff:127.0.0.1' } }));
  conferir('recusa um celular do WiFi', !ehDoProprioServidor({ socket: { remoteAddress: '10.255.255.254' } }));
} finally {
  fs.writeFileSync(CONFIG, original);
  console.log('\n(configuracao original devolvida)');
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
