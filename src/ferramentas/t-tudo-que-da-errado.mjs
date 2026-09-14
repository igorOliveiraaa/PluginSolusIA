// Bateria "o que a pessoa pode fazer de errado".
//
// Nao testa o caminho feliz (os outros scripts ja fazem). Aqui a gente TENTA
// QUEBRAR: campo vazio, numero negativo, texto gigante, arquivo trocado, codigo
// que nao existe, sessao vencida, tentativa de injecao de SQL, acento estranho.
//
// A regra que vale para tudo aqui: pode recusar, mas tem que recusar com
// mensagem em portugues e SEM derrubar o servidor. Erro 500 com texto em ingles
// na frente da funcionaria e bug.
//
// Precisa do servidor no ar (npm start).

import { credenciaisDeTeste } from './credenciais-de-teste.mjs';
import { clienteParaTeste, termoDeBusca } from './dados-de-teste.mjs';

const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
let falhas = 0;
let token = '';

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 95) : ''}`);
  if (!ok) falhas += 1;
};

async function json(caminho, opcoes = {}, tokenUsado = token) {
  const headers = { ...(opcoes.headers || {}) };
  if (tokenUsado) headers['x-sessao'] = tokenUsado;
  if (typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(S + caminho, { ...opcoes, headers });
    const texto = await r.text();
    let dados = {};
    try { dados = JSON.parse(texto); } catch { dados = { naoEraJson: texto.slice(0, 120) }; }
    return { status: r.status, dados };
  } catch (erro) {
    return { status: 0, dados: { erro: 'servidor caiu: ' + erro.message }, caiu: true };
  }
}

/** Recusar e OK. Cair, devolver HTML ou erro em ingles nao e. */
function recusouComJeito(resposta, titulo) {
  if (resposta.caiu) { conferir(titulo, false, 'O SERVIDOR CAIU'); return; }
  const erro = String(resposta.dados.erro || '');
  const recusou = resposta.dados.ok === false || resposta.status >= 400;
  const emIngles = /\b(undefined|null is not|cannot read|TypeError|ECONN|at Object\.|Firebird|SQLSTATE)\b/i.test(erro);
  conferir(titulo, recusou && !emIngles && !resposta.dados.naoEraJson,
    erro || `status ${resposta.status}` + (resposta.dados.naoEraJson ? ' (nao devolveu JSON!)' : ''));
}

/** Aceitar tambem e OK, desde que a resposta faca sentido e nao quebre. */
function aguentou(resposta, titulo, detalhe = '') {
  if (resposta.caiu) { conferir(titulo, false, 'O SERVIDOR CAIU'); return; }
  conferir(titulo, !resposta.dados.naoEraJson, detalhe || `status ${resposta.status}`);
}

const formulario = (campos) => {
  const f = new FormData();
  for (const [chave, valor] of Object.entries(campos)) f.append(chave, valor);
  return f;
};

const enviarFormulario = async (caminho, campos) => {
  const r = await fetch(S + caminho, {
    method: 'POST', body: formulario(campos), headers: { 'x-sessao': token },
  });
  return { status: r.status, dados: await r.json().catch(() => ({ naoEraJson: true })) };
};

// ===========================================================================
console.log('\n=== 1. Login e sessao ===');

recusouComJeito(await json('/api/entrar', { method: 'POST', body: JSON.stringify({}) }, ''),
  'entrar sem usuario nem senha');
recusouComJeito(await json('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: '', senha: '' }) }, ''),
  'entrar com campos vazios');
recusouComJeito(await json('/api/entrar', {
  method: 'POST', body: JSON.stringify({ usuario: "' OR 1=1 --", senha: "' OR '1'='1" }),
}, ''), 'tentativa de injecao no login');
recusouComJeito(await json('/api/entrar', {
  method: 'POST', body: JSON.stringify({ usuario: 'A'.repeat(5000), senha: 'B'.repeat(5000) }),
}, ''), 'usuario e senha gigantes');

const entrada = await json('/api/entrar', { method: 'POST', body: JSON.stringify(LOGIN) }, '');
token = entrada.dados.token || '';
conferir('login de verdade funciona', Boolean(token), entrada.dados.operador?.nome || entrada.dados.erro);
if (!token) { console.log('\n>>> sem login nao da para seguir'); process.exit(1); }

recusouComJeito(await json('/api/config', {}, 'sessao-inventada-123'), 'sessao inventada e barrada');
recusouComJeito(await json('/api/config', {}, ''), 'sem sessao nenhuma e barrado');

// ===========================================================================
console.log('\n=== 2. Orcamento: lista que a pessoa digita errado ===');

recusouComJeito(await enviarFormulario('/api/orcamento/montar', { texto: '' }),
  'montar com a lista vazia');
recusouComJeito(await enviarFormulario('/api/orcamento/montar', { texto: '     \n\n   ' }),
  'montar so com espacos e linhas em branco');
recusouComJeito(await enviarFormulario('/api/orcamento/montar', { texto: '?????  ###  ...' }),
  'montar so com simbolos');

const injecao = await enviarFormulario('/api/orcamento/montar', {
  texto: "2 detergente'; DROP TABLE PRODUTO; --",
});
aguentou(injecao, 'tentativa de injecao na lista nao quebra',
  injecao.dados.ok ? 'montou sem estragar nada' : injecao.dados.erro);

const conferePodruto = await json('/api/orcamento/buscar-produto?q=' + encodeURIComponent('detergente'));
conferir('a tabela PRODUTO continua inteira depois da tentativa',
  (conferePodruto.dados.produtos || []).length > 0, `${conferePodruto.dados.produtos?.length} produtos`);

const emojis = await enviarFormulario('/api/orcamento/montar', { texto: '3 detergente 🧼 ypê 500ml\n2 água 💧' });
aguentou(emojis, 'lista com emoji e acento', emojis.dados.ok ? 'leu normal' : emojis.dados.erro);

const listona = await enviarFormulario('/api/orcamento/montar', {
  texto: Array.from({ length: 120 }, (_, i) => `${i + 1} detergente ype 500ml`).join('\n'),
});
aguentou(listona, 'lista com 120 linhas',
  listona.dados.ok ? `montou ${listona.dados.orcamento.itens.length} itens` : listona.dados.erro);

// ===========================================================================
console.log('\n=== 3. Orcamento: mexendo nos numeros ===');

const base = await enviarFormulario('/api/orcamento/montar', { texto: '2 detergente ype 500ml' });
const id = base.dados.id;
conferir('montou o orcamento de teste', Boolean(id), base.dados.erro);

const ajustar = (corpo) => json('/api/orcamento/ajustar', { method: 'POST', body: JSON.stringify({ id, ...corpo }) });

const negativa = await ajustar({ indice: 0, quantidade: -5 });
conferir('quantidade negativa nao passa',
  negativa.dados.ok === false || negativa.dados.item?.quantidade > 0,
  'ficou ' + negativa.dados.item?.quantidade);

const precoNegativo = await ajustar({ indice: 0, precoUnitario: -10 });
conferir('preco negativo nao passa',
  precoNegativo.dados.ok === false || precoNegativo.dados.item?.precoUnitario >= 0,
  'ficou ' + precoNegativo.dados.item?.precoUnitario);

const absurda = await ajustar({ indice: 0, quantidade: 999999999 });
aguentou(absurda, 'quantidade absurda nao quebra a conta',
  'total ' + absurda.dados.item?.total);
conferir('e o total continua sendo um numero',
  Number.isFinite(absurda.dados.item?.total), String(absurda.dados.item?.total));

const texto = await ajustar({ indice: 0, quantidade: 'dez' });
conferir('quantidade escrita por extenso nao vira NaN',
  Number.isFinite(texto.dados.item?.quantidade), String(texto.dados.item?.quantidade));

recusouComJeito(await ajustar({ indice: 99, quantidade: 1 }), 'item que nao existe');
recusouComJeito(await ajustar({ indice: -1, quantidade: 1 }), 'indice negativo');
recusouComJeito(await json('/api/orcamento/ajustar', {
  method: 'POST', body: JSON.stringify({ id: 'nao-existe', indice: 0, quantidade: 1 }),
}), 'orcamento que nao existe');

recusouComJeito(await json('/api/orcamento/escolher', {
  method: 'POST', body: JSON.stringify({ id, indice: 0, codigoProduto: '999999' }),
}), 'escolher produto que nao existe');
recusouComJeito(await json('/api/orcamento/escolher', {
  method: 'POST', body: JSON.stringify({ id, indice: 0, codigoProduto: '7891234567890123456' }),
}), 'escolher com codigo gigante (campo do banco tem 6)');

recusouComJeito(await json('/api/orcamento/cliente', {
  method: 'POST', body: JSON.stringify({ id, codigoCliente: '999999' }),
}), 'cliente que nao existe');

const semCliente = await json('/api/orcamento/cliente', { method: 'POST', body: JSON.stringify({ id, codigoCliente: '' }) });
aguentou(semCliente, 'tirar o cliente (voltar para consumidor)',
  semCliente.dados.ok ? 'virou consumidor' : semCliente.dados.erro);

// ===========================================================================
console.log('\n=== 4. Busca de produto e de cliente ===');

const umaLetra = await json('/api/orcamento/buscar-produto?q=a');
aguentou(umaLetra, 'busca com uma letra so nao trava', `${umaLetra.dados.produtos?.length ?? 0} achados`);

const naoExiste = await json('/api/orcamento/buscar-produto?q=' + encodeURIComponent('xyzabc que nao existe'));
conferir('busca sem resultado devolve lista vazia, nao erro',
  naoExiste.dados.ok === true && Array.isArray(naoExiste.dados.produtos),
  `${naoExiste.dados.produtos?.length} achados`);

const porcentagem = await json('/api/orcamento/buscar-produto?q=' + encodeURIComponent('%_%'));
aguentou(porcentagem, 'busca com % e _ (curingas do banco) nao quebra',
  `${porcentagem.dados.produtos?.length ?? 0} achados`);

const clienteVazio = await json('/api/clientes?q=');
aguentou(clienteVazio, 'busca de cliente vazia', `${clienteVazio.dados.clientes?.length ?? 0} achados`);

const clienteInjecao = await json('/api/clientes?q=' + encodeURIComponent("'; DELETE FROM CLIENTES; --"));
aguentou(clienteInjecao, 'injecao na busca de cliente', `${clienteInjecao.dados.clientes?.length ?? 0} achados`);
const alguemDeVerdade = termoDeBusca((await clienteParaTeste())?.nome);
const clientesAindaExistem = await json('/api/clientes?q=' + encodeURIComponent(alguemDeVerdade));
conferir('a tabela CLIENTES continua inteira',
  (clientesAindaExistem.dados.clientes || []).length > 0,
  `${clientesAindaExistem.dados.clientes?.length} clientes`);

// ===========================================================================
console.log('\n=== 5. Cadastro de cliente por CNPJ ===');

recusouComJeito(await json('/api/consultar-cnpj/123'), 'CNPJ curto demais');
recusouComJeito(await json('/api/consultar-cnpj/' + encodeURIComponent('abcdefghijklmn')), 'CNPJ com letras');
recusouComJeito(await json('/api/consultar-cnpj/11111111111111'), 'CNPJ com digito verificador errado');
recusouComJeito(await json('/api/clientes', { method: 'POST', body: JSON.stringify({}) }),
  'cadastrar cliente sem nenhum dado');

// ===========================================================================
console.log('\n=== 6. Entrada de nota ===');

recusouComJeito(await enviarFormulario('/api/ler-nota', { observacao: 'sem arquivo' }),
  'ler nota sem mandar arquivo');

const xmlQuebrado = new FormData();
xmlQuebrado.append('arquivos', new Blob(['<isto nao e um xml de nota'], { type: 'text/xml' }), 'nota.xml');
const respostaXml = await fetch(S + '/api/ler-nota', {
  method: 'POST', body: xmlQuebrado, headers: { 'x-sessao': token },
}).then(async (r) => ({ status: r.status, dados: await r.json().catch(() => ({ naoEraJson: true })) }));
recusouComJeito(respostaXml, 'XML quebrado');

// ===========================================================================
console.log('\n=== 7. Logo ===');

recusouComJeito(await enviarFormulario('/api/logo', { nada: 'x' }), 'subir logo sem arquivo');

const gigante = new FormData();
gigante.append('logo', new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'image/png' }), 'grande.png');
const respostaGigante = await fetch(S + '/api/logo', {
  method: 'POST', body: gigante, headers: { 'x-sessao': token },
}).then(async (r) => ({ status: r.status, dados: await r.json().catch(() => ({ naoEraJson: true })) }));
recusouComJeito(respostaGigante, 'logo de 4 MB (o limite e 3)');

// ===========================================================================
console.log('\n=== 8. Assistente ===');

recusouComJeito(await json('/api/perguntar', { method: 'POST', body: JSON.stringify({ pergunta: '' }) }),
  'pergunta vazia');
recusouComJeito(await json('/api/perguntar', { method: 'POST', body: JSON.stringify({ pergunta: 'a'.repeat(3000) }) }),
  'pergunta gigante');

const exportarSemNada = await json('/api/exportar/planilha');
aguentou(exportarSemNada, 'exportar sem ter perguntado nada antes', exportarSemNada.dados.erro);
recusouComJeito(await json('/api/exportar/formato-inventado'), 'formato de exportacao inventado');

// ===========================================================================
console.log('\n=== 9. O servidor continua de pe? ===');

const vivo = await json('/api/testar-banco');
conferir('o banco continua respondendo depois de tudo isso',
  vivo.dados.ok === true, `${vivo.dados.totalProdutos} produtos`);
const telaVive = await fetch(S + '/').then((r) => r.status).catch(() => 0);
conferir('a tela continua abrindo', telaVive === 200, 'status ' + telaVive);

console.log('\n' + (falhas ? `>>> ${falhas} PROBLEMA(S)` : '>>> AGUENTOU TUDO'));
process.exit(falhas ? 1 : 0);
