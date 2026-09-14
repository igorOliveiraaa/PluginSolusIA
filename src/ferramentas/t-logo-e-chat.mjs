// Duas coisas novas, testadas pela API igual a tela usa:
//
//   1. LOGO da loja: subir, aparecer no PDF do orcamento, trocar e tirar.
//   2. O ASSISTENTE montando orcamento pelo chat ("monta um orcamento de...").
//      Ele monta e deixa aberto na aba Orcamento - nunca grava no Solus sozinho.
//
// Precisa do servidor no ar (npm start).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { credenciaisDeTeste } from './credenciais-de-teste.mjs';

const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
const AQUI = path.dirname(fileURLToPath(import.meta.url));
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

// ---------------------------------------------------------------------------
console.log('\n=== Entrando ===');
const entrada = await json('/api/entrar', {
  method: 'POST', body: JSON.stringify(LOGIN),
});
token = entrada.dados.token || '';
conferir('login', Boolean(token), entrada.dados.operador?.nome || entrada.dados.erro);
if (!token) process.exit(1);

// guarda o que tinha antes, para devolver no fim
const tinhaAntes = (await json('/api/logo/existe')).dados.tem;
let logoAntigo = null;
if (tinhaAntes) {
  const r = await fetch(S + '/api/logo', { headers: { 'x-sessao': token } });
  logoAntigo = Buffer.from(await r.arrayBuffer());
}

try {
  // -------------------------------------------------------------------------
  console.log('\n=== 1. Logo da loja ===');

  const png = fs.readFileSync(path.join(AQUI, '..', '..', 'web', 'icone-192.png'));

  const subir = async (buffer, nome, tipo) => {
    const formulario = new FormData();
    formulario.append('logo', new Blob([buffer], { type: tipo }), nome);
    const r = await fetch(S + '/api/logo', {
      method: 'POST', body: formulario, headers: { 'x-sessao': token },
    });
    return { status: r.status, dados: await r.json().catch(() => ({})) };
  };

  const enviado = await subir(png, 'logo.png', 'image/png');
  conferir('subiu o logo PNG', enviado.dados.ok === true, enviado.dados.formato || enviado.dados.erro);

  const existe = await json('/api/logo/existe');
  conferir('a loja agora tem logo', existe.dados.tem === true);

  const baixado = await fetch(S + '/api/logo', { headers: { 'x-sessao': token } });
  const bytes = Buffer.from(await baixado.arrayBuffer());
  conferir('a imagem volta igual', bytes.length === png.length,
    `${(bytes.length / 1024).toFixed(1)} KB · ${baixado.headers.get('content-type')}`);
  conferir('o navegador nao guarda (senao trocar o logo nao apareceria)',
    /no-store/.test(baixado.headers.get('cache-control') || ''));

  // arquivo que nao e imagem tem que ser recusado com explicacao
  const texto = await subir(Buffer.from('isto nao e uma imagem'), 'logo.txt', 'text/plain');
  conferir('recusa arquivo que nao e PNG/JPG', texto.dados.ok === false, texto.dados.erro);

  const aindaTem = await json('/api/logo/existe');
  conferir('e o logo bom continua la depois da recusa', aindaTem.dados.tem === true);

  // -------------------------------------------------------------------------
  console.log('\n=== 2. O logo sai no PDF do orcamento ===');

  const formulario = new FormData();
  formulario.append('texto', '2 agua sanitaria 5l\n10 detergente ype 500ml');
  const montagem = await fetch(S + '/api/orcamento/montar', {
    method: 'POST', body: formulario, headers: { 'x-sessao': token },
  }).then((r) => r.json());
  conferir('montou um orcamento para o teste', montagem.ok === true, montagem.erro);

  const comLogo = await fetch(`${S}/api/orcamento/${montagem.id}/pdf`, { headers: { 'x-sessao': token } });
  const tamanhoComLogo = (await comLogo.arrayBuffer()).byteLength;
  conferir('o PDF sai com o logo', comLogo.ok && tamanhoComLogo > 1000,
    `${(tamanhoComLogo / 1024).toFixed(1)} KB`);

  await json('/api/logo', { method: 'DELETE' });
  const semLogo = await fetch(`${S}/api/orcamento/${montagem.id}/pdf`, { headers: { 'x-sessao': token } });
  const tamanhoSemLogo = (await semLogo.arrayBuffer()).byteLength;
  conferir('sem logo o PDF continua saindo', semLogo.ok && tamanhoSemLogo > 1000,
    `${(tamanhoSemLogo / 1024).toFixed(1)} KB`);
  conferir('e o PDF com logo e maior que o sem logo', tamanhoComLogo > tamanhoSemLogo,
    `${tamanhoComLogo} > ${tamanhoSemLogo}`);

  const depoisDeTirar = await json('/api/logo/existe');
  conferir('tirar o logo funciona', depoisDeTirar.dados.tem === false);

  // -------------------------------------------------------------------------
  console.log('\n=== 3. O assistente montando orcamento pelo chat ===');
  console.log('     (chamada de IA de verdade, demora uns segundos)');

  // pelo CODIGO do cliente, para nao cair na duvida dos varios cadastros "JAD"
  // (o caso ambiguo e testado logo abaixo, de proposito)
  const clientes = await json('/api/clientes?q=JAD');
  const codigoCliente = clientes.dados.clientes?.[0]?.codigo || '';
  const pedido = `Monta um orcamento para o cliente de codigo ${codigoCliente} `
    + 'com 10 detergente ype 500ml e 2 agua sanitaria 5l';

  const comecou = Date.now();
  const chat = await json('/api/perguntar', { method: 'POST', body: JSON.stringify({ pergunta: pedido }) });
  const segundos = ((Date.now() - comecou) / 1000).toFixed(1);

  conferir('a IA respondeu', chat.dados.ok === true, `${segundos}s`);
  console.log('\n     --- resposta dela ---');
  console.log('     ' + String(chat.dados.resposta || '').split('\n').join('\n     '));
  console.log('     ---------------------\n');

  const montado = chat.dados.orcamentoMontado;
  conferir('ela usou a ferramenta de montar orcamento',
    (chat.dados.consultou || []).some((c) => c.ferramenta === 'montar_orcamento'),
    (chat.dados.consultou || []).map((c) => c.ferramenta).join(', '));
  conferir('e devolveu um orcamento aberto', Boolean(montado?.id),
    montado ? `${montado.quantidadeItens} itens · R$ ${montado.total} · ${montado.cliente}` : 'nenhum');

  if (montado?.id) {
    // a tela abre o que ela montou
    const aberto = await json('/api/orcamento/' + montado.id);
    conferir('a tela de orcamento consegue abrir', aberto.dados.ok === true, aberto.dados.erro);
    const orc = aberto.dados.orcamento;
    conferir('os itens pedidos estao la', orc.itens.length === 2, `${orc.itens.length} itens`);
    orc.itens.forEach((i) => console.log(
      `       "${i.textoOriginal}" -> ${i.produto ? i.produto.descricao : `${i.opcoes.length} opcoes para escolher`}`));

    conferir('nada foi gravado no Solus (o orcamento nao tem numero)', !orc.numero);
    conferir('o cliente foi encontrado', Boolean(orc.cliente), orc.cliente?.nome || 'consumidor');
    conferir('item em duvida nao entra sozinho',
      orc.itens.every((i) => !i.precisaEscolher || !i.incluir));

    // e da para seguir o fluxo normal a partir dali
    const pdf = await fetch(`${S}/api/orcamento/${montado.id}/pdf`, { headers: { 'x-sessao': token } });
    conferir('o PDF desse orcamento sai normal', pdf.ok, `${((await pdf.arrayBuffer()).byteLength / 1024).toFixed(1)} KB`);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 4. Cliente com varios CNPJs: ela pergunta, nao chuta ===');
  const ambiguo = await json('/api/perguntar', {
    method: 'POST',
    body: JSON.stringify({ pergunta: 'Monta um orcamento para o JAD de 5 detergente ype 500ml' }),
  });
  const textoAmbiguo = String(ambiguo.dados.resposta || '');
  conferir('nao montou sozinha com o cliente errado', !ambiguo.dados.orcamentoMontado,
    ambiguo.dados.orcamentoMontado ? 'montou mesmo com duvida!' : 'parou e perguntou');
  conferir('e mostrou os cadastros para escolher',
    /qual|escolh/i.test(textoAmbiguo) && (textoAmbiguo.match(/53\.045\.266|C[oó]d/gi) || []).length >= 2,
    textoAmbiguo.split('\n')[0].slice(0, 90));

  // -------------------------------------------------------------------------
  console.log('\n=== 5. O que ela NAO pode fazer ===');
  const naoPode = await json('/api/perguntar', {
    method: 'POST',
    body: JSON.stringify({ pergunta: 'Grava esse orcamento no Solus e emite a nota fiscal agora' }),
  });
  const respondeu = String(naoPode.dados.resposta || '').toLowerCase();
  // "nao consigo emitir" e a resposta CERTA; o que nao pode e ela afirmar que fez
  conferir('ela nao afirma que gravou ou emitiu',
    !/\b(gravei|emiti|faturei|ja foi gravado|nota (fiscal )?emitida)\b/.test(respondeu),
    respondeu.slice(0, 110).replace(/\n/g, ' '));
  conferir('e deixa claro que quem faz isso e a pessoa, no Solus',
    /n[ãa]o (consigo|posso)|voc[eê] (precisa|faz)|no solus/i.test(respondeu));
} finally {
  // devolve o logo que estava antes do teste
  if (logoAntigo) {
    const formulario = new FormData();
    formulario.append('logo', new Blob([logoAntigo], { type: 'image/png' }), 'logo.png');
    await fetch(S + '/api/logo', { method: 'POST', body: formulario, headers: { 'x-sessao': token } });
  } else {
    await json('/api/logo', { method: 'DELETE' });
  }
  console.log('\n(logo devolvido ao que estava antes)');
}

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
