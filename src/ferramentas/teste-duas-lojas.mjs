// Reproduz a situacao da loja: DOIS Solus no mesmo PC (um por CNPJ), cada um com
// os seus usuarios. Neste PC de desenvolvimento:
//   - C:/SolusTeste/EC.FDB               -> ECS LIMPEZA (tem ELAINE / 1304)
//   - C:/Solus/Solussis/BANCO/BANCO.FDB  -> EDITORA     (tem IGOR)
//
// Guarda a configuracao atual antes e devolve no fim.

import fs from 'node:fs';

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

  const loginSemLoja = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: '1304' }) });
  conferir('login sem loja explica o que fazer', /Configurar lojas/.test(loginSemLoja.dados.erro || ''), loginSemLoja.dados.erro);

  // ---- 2. procura os Solus ------------------------------------------------
  console.log('\n=== 2. Procurando os Solus deste PC ===');
  const busca = await json('/api/instalacao/procurar?usuario=ELAINE');
  const achados = busca.dados.instalacoes || [];
  achados.forEach((i) => console.log(`     - ${i.empresa?.fantasia} | ${i.empresa?.cnpj} | tem ELAINE: ${i.temUsuarioProcurado}`));
  const ecs = achados.find((i) => /EC\.FDB$/i.test(i.caminho));
  const editora = achados.find((i) => /BANCO\.FDB$/i.test(i.caminho));
  conferir('achou os dois Solus', Boolean(ecs && editora), `${achados.length} encontrados em ${busca.dados.segundos}s`);
  conferir('escondeu os bancos internos do Firebird', !achados.some((i) => /security2|help\.fdb/i.test(i.caminho)));
  conferir('mostra em qual esta a ELAINE', ecs?.temUsuarioProcurado === true && editora?.temUsuarioProcurado === false);

  // ---- 3. salva as duas lojas ---------------------------------------------
  console.log('\n=== 3. Salvando as duas lojas ===');
  const salvas = await json('/api/instalacao/lojas', {
    method: 'POST',
    body: JSON.stringify({ lojas: [
      { nome: 'ECS Limpeza', cnpj: ecs.empresa.cnpj, caminho: ecs.caminho },
      { nome: 'Editora', cnpj: editora.empresa.cnpj, caminho: editora.caminho },
    ] }),
  });
  conferir('salvou', salvas.dados.ok === true, (salvas.dados.lojas || []).map((l) => l.id).join(', ') || salvas.dados.erro);
  const [lojaEcs, lojaEditora] = salvas.dados.lojas || [];

  const repetido = await json('/api/instalacao/lojas', {
    method: 'POST',
    body: JSON.stringify({ lojas: [{ nome: 'A', caminho: ecs.caminho }, { nome: 'B', caminho: ecs.caminho }] }),
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
  const elaineNaEditora = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: '1304', loja: lojaEditora.id }) });
  conferir('ELAINE na loja errada nao entra', elaineNaEditora.dados.ok === false);
  conferir('e a mensagem diz para conferir a loja', /loja certa/i.test(elaineNaEditora.dados.erro || ''), elaineNaEditora.dados.erro);

  const semEscolher = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: '1304' }) });
  conferir('com duas lojas, exige escolher', /Escolha a loja/i.test(semEscolher.dados.erro || ''));

  // ---- 5. cada um na sua loja --------------------------------------------
  console.log('\n=== 5. Cada usuario na sua loja ===');
  const elaine = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: '1304', loja: lojaEcs.id }) });
  conferir('ELAINE entra na ECS', elaine.dados.ok === true, elaine.dados.operador?.loja?.nome);
  const admin = await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'IGOR', senha: '1605', loja: lojaEditora.id }) });
  conferir('IGOR entra na Editora', admin.dados.ok === true, admin.dados.operador?.loja?.nome);

  const operadoresEcs = await json('/api/operadores?loja=' + lojaEcs.id);
  const operadoresEditora = await json('/api/operadores?loja=' + lojaEditora.id);
  conferir('lista de usuarios e de cada loja',
    operadoresEcs.dados.operadores?.includes('ELAINE') && !operadoresEditora.dados.operadores?.includes('ELAINE'),
    `${operadoresEcs.dados.operadores?.length} x ${operadoresEditora.dados.operadores?.length}`);

  // ---- 6. os dados nao se misturam ----------------------------------------
  console.log('\n=== 6. Os dados nao se misturam ===');
  const bancoEcs = await json('/api/testar-banco', {}, elaine.dados.token);
  const bancoEditora = await json('/api/testar-banco', {}, admin.dados.token);
  conferir('ELAINE ve os produtos da ECS', bancoEcs.dados.totalProdutos > 10000, `${bancoEcs.dados.totalProdutos} produtos`);
  conferir('IGOR ve os produtos da Editora', bancoEditora.dados.totalProdutos < 100, `${bancoEditora.dados.totalProdutos} produtos`);

  // as duas ao mesmo tempo, para garantir que uma requisicao nao pega a loja da outra
  const simultaneas = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    json('/api/testar-banco', {}, i % 2 ? admin.dados.token : elaine.dados.token)));
  const trocou = simultaneas.some((r, i) => (i % 2 ? r.dados.totalProdutos > 100 : r.dados.totalProdutos < 10000));
  conferir('10 consultas ao mesmo tempo, cada uma no seu banco', !trocou && simultaneas.every((r) => r.dados.totalProdutos !== undefined));

  const clientesEcs = await json('/api/clientes?q=JAD', {}, elaine.dados.token);
  const clientesEditora = await json('/api/clientes?q=JAD', {}, admin.dados.token);
  conferir('busca de cliente respeita a loja',
    clientesEcs.dados.clientes?.length > 0 && clientesEditora.dados.clientes?.length === 0);

  const ajustesEcs = await json('/api/config', {}, elaine.dados.token);
  conferir('Ajustes mostra a loja certa', ajustesEcs.dados.config?.lojaNome === 'ECS Limpeza', ajustesEcs.dados.config?.lojaNome);
  conferir('Ajustes nao expoe o caminho do banco', ajustesEcs.dados.config?.banco === undefined);

  // um orcamento montado na ECS nao pode ser gravado pela Editora
  const form = new FormData();
  form.append('texto', '2 detergente ype 500ml');
  const montado = await fetch(S + '/api/orcamento/montar', { method: 'POST', body: form, headers: { 'x-sessao': elaine.dados.token } }).then((r) => r.json());
  const invasao = await json('/api/orcamento/gravar', { method: 'POST', body: JSON.stringify({ id: montado.id }) }, admin.dados.token);
  conferir('orcamento de uma loja nao grava na outra', /outra loja/.test(invasao.dados.erro || ''), invasao.dados.erro);

  // ---- 7. sem ser gerente e de fora do servidor, nao configura -----------
  console.log('\n=== 7. Protecao da configuracao ===');
  const { ehDoProprioServidor } = await import('../rotas-lojas.js');
  conferir('reconhece o proprio PC', ehDoProprioServidor({ socket: { remoteAddress: '::ffff:127.0.0.1' } }));
  conferir('recusa um celular do WiFi', !ehDoProprioServidor({ socket: { remoteAddress: '192.168.0.57' } }));
} finally {
  fs.writeFileSync(CONFIG, original);
  console.log('\n(configuracao original devolvida)');
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
