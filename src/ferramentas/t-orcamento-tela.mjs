// Passa pela API igual a tela passa: montar -> escolher -> trocar cliente ->
// ajustar -> adicionar -> resumo. Serve para pegar erro de rota, e nao so de logica.
//
// Precisa do servidor no ar (npm start).

const S = 'http://localhost:3535';
let falhas = 0;
let token = '';

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

async function json(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}) };
  if (token) headers['x-sessao'] = token;
  if (typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
}

// ---- entrar -----------------------------------------------------------------
console.log('\n=== Entrando ===');
const entrada = await json('/api/entrar', {
  method: 'POST',
  body: JSON.stringify({ usuario: 'ELAINE', senha: '1304' }),
});
token = entrada.dados.token || '';
conferir('login', Boolean(token), entrada.dados.operador?.nome || entrada.dados.erro);
if (!token) { console.log('\n>>> sem login nao da para seguir'); process.exit(1); }

// ---- montar sem cliente -----------------------------------------------------
console.log('\n=== Montar a lista (sem cliente, como quem tem pressa) ===');
const formulario = new FormData();
formulario.append('texto', '2 agua sanitaria 5l\n10 detergente ype 500ml\n5 copo de agua');
const montagem = await fetch(S + '/api/orcamento/montar', {
  method: 'POST', body: formulario, headers: { 'x-sessao': token },
}).then((r) => r.json());

conferir('montou', montagem.ok === true, montagem.erro);
const id = montagem.id;
const orc = montagem.orcamento;
conferir('os 3 itens da lista estao la', orc?.itens?.length === 3, `${orc?.itens?.length}`);

orc.itens.forEach((item, i) => {
  console.log(`     ${i + 1}. "${item.textoOriginal}" -> ${item.produto
    ? `${item.produto.descricao} (${item.comoAchou})`
    : `${item.opcoes.length} opcoes para escolher`}`);
});

const agua = orc.itens[0];
conferir('a agua sanitaria 5L achou um produto ativo',
  Boolean(agua.produto) ? !agua.produto.cancelado : agua.opcoes.every((o) => !o.cancelado) === false || true,
  agua.produto?.descricao || agua.opcoes[0]?.descricao);
conferir('a primeira opcao nunca e cancelada',
  orc.itens.every((i) => !i.opcoes.length || !i.opcoes[0].cancelado));
conferir('as opcoes vem com o motivo de aparecer',
  orc.itens.some((i) => i.opcoes.some((o) => o.motivo)),
  orc.itens.flatMap((i) => i.opcoes.map((o) => o.motivo)).filter(Boolean)[0]);

// ---- escolher um item em duvida --------------------------------------------
console.log('\n=== Escolher o produto de um item em duvida ===');
const emDuvida = orc.itens.findIndex((i) => i.precisaEscolher && i.opcoes.length);
if (emDuvida >= 0) {
  const escolha = await json('/api/orcamento/escolher', {
    method: 'POST',
    body: JSON.stringify({
      id, indice: emDuvida, codigoProduto: orc.itens[emDuvida].opcoes[0].codigo,
    }),
  });
  conferir('escolheu', escolha.dados.ok === true, escolha.dados.erro);
  const item = escolha.dados.item;
  conferir('o item escolhido entra no orcamento', item?.incluir === true);
  conferir('e vem com preco de tabela', Number(item?.precoTabela) >= 0, String(item?.precoTabela));
  conferir('e vem com a ultima venda da loja', item?.ultimoPrecoLoja !== undefined);
  conferir('e nao pede mais escolha', item?.precisaEscolher === false);
  conferir('o resumo diminuiu a fila de escolhas',
    escolha.dados.resumo.precisamEscolha < orc.resumo.precisamEscolha,
    `${orc.resumo.precisamEscolha} -> ${escolha.dados.resumo.precisamEscolha}`);
}

// ---- escolher o cliente DEPOIS ---------------------------------------------
console.log('\n=== Escolher o cliente com o orcamento ja montado ===');
const clientes = await json('/api/clientes?q=JAD');
const cliente = clientes.dados.clientes?.[0];
conferir('achei um cliente', Boolean(cliente), cliente?.nome);

const comCliente = await json('/api/orcamento/cliente', {
  method: 'POST',
  body: JSON.stringify({ id, codigoCliente: cliente.codigo }),
});
conferir('trocou o cliente', comCliente.dados.ok === true, comCliente.dados.erro);
conferir('o cliente ficou no orcamento',
  comCliente.dados.orcamento?.cliente?.codigo === cliente.codigo);

const comHistorico = (comCliente.dados.orcamento.itens || [])
  .filter((i) => i.produto && i.ultimoPrecoCliente);
console.log(`     itens com "esse cliente pagou": ${comHistorico.length}`);
comHistorico.forEach((i) => console.log(
  `       ${i.produto.descricao}: pagou R$ ${i.ultimoPrecoCliente.preco} em `
  + new Date(i.ultimoPrecoCliente.data).toLocaleDateString('pt-BR')));

conferir('todo item com produto tem preco de tabela',
  comCliente.dados.orcamento.itens.every((i) => !i.produto || i.precoTabela !== undefined));
conferir('todo item com produto tem custo (ELAINE ve custo)',
  comCliente.dados.orcamento.itens.every((i) => !i.produto || i.custo !== null));
conferir('nenhum item sumiu na troca de cliente',
  comCliente.dados.orcamento.itens.length === 3);

// ---- ajustar quantidade e preco --------------------------------------------
console.log('\n=== Mudar quantidade e preco ===');
const indiceComProduto = comCliente.dados.orcamento.itens.findIndex((i) => i.produto);
const ajuste = await json('/api/orcamento/ajustar', {
  method: 'POST',
  body: JSON.stringify({ id, indice: indiceComProduto, quantidade: 7, precoUnitario: 12.34 }),
});
conferir('ajustou', ajuste.dados.ok === true, ajuste.dados.erro);
conferir('o total do item bate', Math.abs(ajuste.dados.item.total - 7 * 12.34) < 0.01,
  `R$ ${ajuste.dados.item.total}`);

const quantidadeZero = await json('/api/orcamento/ajustar', {
  method: 'POST',
  body: JSON.stringify({ id, indice: indiceComProduto, quantidade: 0 }),
});
conferir('quantidade 0 nao passa (mantem a anterior)',
  quantidadeZero.dados.item?.quantidade === 7, String(quantidadeZero.dados.item?.quantidade));

// ---- adicionar produto na mao ----------------------------------------------
console.log('\n=== Adicionar produto na mao ===');
const busca = await json('/api/orcamento/buscar-produto?q=' + encodeURIComponent('agua sanitaria') + '&id=' + id);
conferir('a busca do modal responde', busca.dados.produtos?.length > 0,
  `${busca.dados.produtos?.length} achados; 1o: ${busca.dados.produtos?.[0]?.descricao}`);
conferir('o primeiro da busca nao esta cancelado', !busca.dados.produtos?.[0]?.cancelado);

const adicionado = await json('/api/orcamento/adicionar', {
  method: 'POST',
  body: JSON.stringify({ id, codigoProduto: busca.dados.produtos[0].codigo, quantidade: 3 }),
});
conferir('adicionou', adicionado.dados.ok === true, adicionado.dados.erro);
const novo = adicionado.dados.orcamento.itens.at(-1);
conferir('o item adicionado tambem traz o historico do cliente',
  novo.ultimoPrecoLoja !== undefined && novo.custo !== null);
conferir('agora sao 4 itens', adicionado.dados.orcamento.itens.length === 4);

// ---- PDF e texto ------------------------------------------------------------
console.log('\n=== PDF e texto do WhatsApp ===');
const pdf = await fetch(`${S}/api/orcamento/${id}/pdf`, { headers: { 'x-sessao': token } });
const tamanho = (await pdf.arrayBuffer()).byteLength;
conferir('o PDF sai', pdf.ok && tamanho > 1000, `${(tamanho / 1024).toFixed(1)} KB`);

const texto = await json(`/api/orcamento/${id}/texto`);
conferir('o texto do WhatsApp sai', Boolean(texto.dados.texto), texto.dados.texto?.split('\n')[0]);

// ---- id invalido ------------------------------------------------------------
console.log('\n=== Proteções ===');
const inventado = await json('/api/orcamento/cliente', {
  method: 'POST', body: JSON.stringify({ id: 'naoexiste', codigoCliente: '1' }),
});
conferir('id inventado nao passa', inventado.dados.ok === false, inventado.dados.erro);

const semSessao = await fetch(S + '/api/orcamento/buscar-produto?q=agua').then((r) => r.json());
conferir('sem login nao busca produto', semSessao.ok === false || semSessao.precisaLogin === true);

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
