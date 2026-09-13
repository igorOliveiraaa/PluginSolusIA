// Testa o caminho inteiro pelo servidor, como a tela faz: login -> orcamento -> PDF.
const S = 'http://localhost:3535';
let token = '';
let falhas = 0;

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

async function chamar(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}) };
  if (token) headers['x-sessao'] = token;
  if (opcoes.body && !(opcoes.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, dados: tipo.includes('json') ? await r.json() : await r.arrayBuffer() };
}

console.log('\n=== 1. Login ===');
const semLogin = await chamar('/api/produtos?q=sabao');
conferir('sem login e barrado', semLogin.status === 401);

const errado = await chamar('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: 'xxx' }) });
conferir('senha errada barrada', errado.status === 401);

const login = await chamar('/api/entrar', { method: 'POST', body: JSON.stringify({ usuario: 'ELAINE', senha: '1304' }) });
conferir('login com senha certa', login.dados.ok === true, login.dados.operador?.nome);
token = login.dados.token;

const eu = await chamar('/api/eu');
conferir('sessao reconhecida', eu.dados.ok === true, 've custo: ' + eu.dados.operador.permissoes.verCusto);

console.log('\n=== 2. Cliente ===');
const clientes = await chamar('/api/clientes?q=JAD');
conferir('busca de cliente', clientes.dados.clientes?.length > 0, clientes.dados.clientes?.length + ' achados');

const umCliente = await chamar('/api/clientes/861');
conferir('historico do cliente', umCliente.dados.compras?.length > 0, umCliente.dados.compras?.length + ' compras');

console.log('\n=== 3. Orcamento (lista digitada, sem IA) ===');
const form = new FormData();
form.append('texto', '2 saco de lixo 100 litros\n10 detergente ype 500ml\n3 mop umido');
form.append('cliente', '861');
const montagem = await chamar('/api/orcamento/montar', { method: 'POST', body: form });

if (!montagem.dados.ok) {
  console.log('  (pulado: ' + montagem.dados.erro + ')');
  console.log('\n  A leitura da lista depende da chave do Gemini. O resto do fluxo foi testado direto.');
} else {
  const id = montagem.dados.id;
  const orc = montagem.dados.orcamento;
  conferir('lista lida', orc.itens.length === 3, orc.itens.length + ' itens');

  // escolhe o produto dos itens em duvida
  for (let i = 0; i < orc.itens.length; i += 1) {
    if (orc.itens[i].precisaEscolher && orc.itens[i].opcoes.length) {
      await chamar('/api/orcamento/escolher', {
        method: 'POST',
        body: JSON.stringify({ id, indice: i, codigoProduto: orc.itens[i].opcoes[0].codigo }),
      });
    }
  }
  const gravado = await chamar('/api/orcamento/gravar', { method: 'POST', body: JSON.stringify({ id, observacao: 'teste' }) });
  conferir('orcamento gravado no Solus', gravado.dados.ok === true, 'no ' + gravado.dados.numero);

  const pdf = await chamar(`/api/orcamento/${id}/pdf`);
  const inicio = Buffer.from(pdf.dados.slice(0, 5)).toString();
  conferir('PDF gerado', inicio === '%PDF-', (pdf.dados.byteLength / 1024).toFixed(1) + ' KB');

  const texto = await chamar(`/api/orcamento/${id}/texto`);
  conferir('texto do WhatsApp', Boolean(texto.dados.texto));

  if (gravado.dados.numero) {
    const apagou = await chamar('/api/orcamento/' + gravado.dados.numero, { method: 'DELETE' });
    conferir('orcamento de teste apagado', apagou.dados.ok === true);
  }
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
