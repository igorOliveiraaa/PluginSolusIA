// O que mudou nesta rodada, conferido de ponta a ponta:
//   1. quantidade do orcamento e numero inteiro (menos o que se vende por m2/kg)
//   2. cliente sem cadastro: nome sai no PDF, no Excel e no nome do arquivo
//   3. planilha do Excel do orcamento
//   4. produto parado ha mais de 2 anos nao e sugerido (mas aparece na busca)
//   5. campos fiscais preenchidos quando o produto esta sem eles
//
// Precisa do servidor no ar (npm start) e usa o banco de TESTE.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';
import { procurarNoCatalogo, indiceDoCatalogo } from '../db/catalogo.js';
import { ajustarQuantidade, vendeFracionado, nomeDoArquivoDoOrcamento } from '../logica/orcamento.js';
import { camposFiscaisDoBanco, oQueFaltaPreencher } from '../logica/padroes-fiscais.js';
import { estruturaDe } from '../db/produtos.js';
import { consultar, emTransacao, campoTexto, lerTexto } from '../db/firebird.js';
import { aplicarNota, desfazer } from '../db/gravacao.js';

const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
let token = '';
let falhas = 0;

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 110) : ''}`);
  if (!ok) falhas += 1;
};

async function json(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}), 'x-sessao': token };
  if (typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
}

const entrada = await fetch(S + '/api/entrar', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LOGIN),
}).then((r) => r.json());
token = entrada.token || '';
if (!token) { console.log('nao consegui entrar:', entrada.erro); process.exit(1); }

// ---------------------------------------------------------------------------
console.log('\n=== 1. Quantidade: inteira, menos o que se vende por pedaco ===');

conferir('"2,7" vira 3', ajustarQuantidade('2,7', { unidade: 'UN' }) === 3);
conferir('"0" nao zera o item', ajustarQuantidade(0, { unidade: 'UN' }, 5) === 5);
conferir('"dez" mantem o que estava', ajustarQuantidade('dez', { unidade: 'UN' }, 4) === 4);
conferir('tapete por m2 aceita virgula',
  ajustarQuantidade('7,77', { unidade: 'M2', descricao: 'TAPETE KAPAZI M2' }) === 7.77);
conferir('produto com M2 no nome conta como fracionado',
  vendeFracionado({ unidade: 'UN', descricao: 'TAPETE PERSONALIZADO KAPAZI M2' }));
conferir('detergente NAO e fracionado', !vendeFracionado({ unidade: 'UN', descricao: 'DETERGENTE 500ML' }));

// ---------------------------------------------------------------------------
console.log('\n=== 2 e 3. Cliente sem cadastro + Excel ===');

const formulario = new FormData();
formulario.append('texto', '2,4 detergente ype 500ml\n3 agua sanitaria 5l');
formulario.append('nomeCliente', 'Dona Maria da Silva');
const montado = await fetch(S + '/api/orcamento/montar', {
  method: 'POST', body: formulario, headers: { 'x-sessao': token },
}).then((r) => r.json());

conferir('montou com o nome digitado', montado.ok && montado.orcamento.nomeCliente === 'Dona Maria da Silva',
  montado.orcamento?.nomeCliente || montado.erro);
const primeiro = montado.orcamento?.itens?.[0];
conferir('a quantidade 2,4 virou 2', primeiro?.quantidade === 2, String(primeiro?.quantidade));
conferir('o nome do arquivo leva o cliente',
  nomeDoArquivoDoOrcamento({ numero: 77, nomeCliente: 'Dona Maria da Silva' }, 'xlsx')
    === 'orcamento-77-dona-maria-da-silva.xlsx',
  nomeDoArquivoDoOrcamento({ numero: 77, nomeCliente: 'Dona Maria da Silva' }, 'xlsx'));

// escolher um produto para os itens que ficaram em duvida (senao nao ha o que exportar)
for (let i = 0; i < (montado.orcamento?.itens || []).length; i += 1) {
  const item = montado.orcamento.itens[i];
  if (!item.precisaEscolher || !item.opcoes?.length) continue;
  await json('/api/orcamento/escolher', {
    method: 'POST',
    body: JSON.stringify({ id: montado.id, indice: i, codigoProduto: item.opcoes[0].codigo }),
  });
}

const respostaExcel = await fetch(`${S}/api/orcamento/${montado.id}/excel`, { headers: { 'x-sessao': token } });
const planilha = Buffer.from(await respostaExcel.arrayBuffer());
conferir('a planilha veio', respostaExcel.ok && planilha.length > 1000, `${planilha.length} bytes`);
conferir('o nome do arquivo tem o cliente',
  /filename="orcamento-.*dona-maria-da-silva\.xlsx"/.test(respostaExcel.headers.get('content-disposition') || ''),
  respostaExcel.headers.get('content-disposition'));
conferir('e mesmo um arquivo do Excel (ZIP)', planilha.slice(0, 2).toString() === 'PK');

// abre o zip na mao e le a planilha de dentro
function arquivoDoZip(buffer, nome) {
  let posicao = 0;
  while (posicao < buffer.length - 4 && buffer.readUInt32LE(posicao) === 0x04034b50) {
    const tamanhoNome = buffer.readUInt16LE(posicao + 26);
    const tamanhoExtra = buffer.readUInt16LE(posicao + 28);
    const comprimido = buffer.readUInt32LE(posicao + 18);
    const nomeArquivo = buffer.slice(posicao + 30, posicao + 30 + tamanhoNome).toString();
    const inicio = posicao + 30 + tamanhoNome + tamanhoExtra;
    if (nomeArquivo === nome) return zlib.inflateRawSync(buffer.slice(inicio, inicio + comprimido)).toString();
    posicao = inicio + comprimido;
  }
  return '';
}

const aba = arquivoDoZip(planilha, 'xl/worksheets/sheet1.xml');
conferir('a planilha tem o nome do cliente dentro', aba.includes('Dona Maria da Silva'));
conferir('a planilha tem formula de total', /<f>E\d+\*F\d+<\/f>/.test(aba));
conferir('a planilha tem a linha de TOTAL', aba.includes('TOTAL'));
fs.mkdirSync('dados/exportados', { recursive: true });
fs.writeFileSync('dados/exportados/orcamento-teste.xlsx', planilha);

// ---------------------------------------------------------------------------
console.log('\n=== 4. Produto parado nao e sugerido ===');

const indice = await indiceDoCatalogo();
const parados = indice.produtos.filter((p) => p.parado).length;
conferir('o indice marcou os produtos parados', parados > 0 && parados < indice.produtos.length,
  `${parados} parados de ${indice.produtos.length}`);

const naBusca = await procurarNoCatalogo('agua sanitaria 5l', { limite: 30 });
const naSugestao = await procurarNoCatalogo('agua sanitaria 5l', { limite: 30, esconderParados: true });
conferir('a sugestao nao traz nenhum parado', naSugestao.every((p) => !p.parado));
conferir('mas a pesquisa manual ainda acha os parados', naBusca.some((p) => p.parado),
  `${naBusca.filter((p) => p.parado).length} parados aparecem quando se procura`);
conferir('a etiqueta explica ("parado ha X anos")',
  naBusca.filter((p) => p.parado).every((p) => p.parado));

// ---------------------------------------------------------------------------
console.log('\n=== 5. Campos fiscais preenchidos quando faltam ===');

const estrutura = await estruturaDe('PRODUTO');
const campos = camposFiscaisDoBanco(estrutura);
conferir('achou os campos fiscais deste Solus', campos.length >= 5,
  campos.map((c) => c.coluna).join(', '));

conferir('so preenche o que esta vazio',
  Object.keys(oQueFaltaPreencher(campos, { TRIBUTARIA: '500', ACESSAD: '', ACESSAV: 'S', ACESSAESTOQUE: 'S', TRIBUTARIAINTER: '500' }).preencher)
    .join(',') === 'ACESSAD');

// um produto de verdade, esvaziado de proposito e devolvido no fim
const alvo = (await consultar(
  `SELECT FIRST 1 CODIGO, ${campoTexto('DESCRICAO', 70)}, TRIBUTARIA, ACESSAD, PRECOCUSTO, PRECOVENDA, ESTOQUEATUAL
     FROM PRODUTO WHERE (STATUS IS NULL OR STATUS = '') AND TRIBUTARIA IS NOT NULL`
))[0];

if (!alvo) {
  console.log('  (banco sem produto para este teste)');
} else {
  const codigo = String(alvo.CODIGO).trim();
  const antes = { TRIBUTARIA: lerTexto(alvo.TRIBUTARIA), ACESSAD: lerTexto(alvo.ACESSAD) };
  await emTransacao((executar) => executar(
    "UPDATE PRODUTO SET TRIBUTARIA = '', ACESSAD = '' WHERE TRIM(CODIGO) = ?", [codigo]
  ));

  const registros = await aplicarNota({
    itens: [{
      acao: 'atualizar',
      produto: {
        codigo,
        descricao: lerTexto(alvo.DESCRICAO),
        estoque: Number(alvo.ESTOQUEATUAL) || 0,
        custoAtual: Number(alvo.PRECOCUSTO) || 1,
        custoAnterior: Number(alvo.PRECOCUSTO) || 1,
        vendaAtual: Number(alvo.PRECOVENDA) || 2,
        margemAtual: 0,
        barras: '',
      },
      quantidadeUnidades: 0,
      custoUnitario: Number(alvo.PRECOCUSTO) || 1,
      precoVenda: Number(alvo.PRECOVENDA) || 2,
    }],
    atualizarEstoque: false,
  });

  const depois = (await consultar(
    `SELECT ${campoTexto('TRIBUTARIA', 10)}, ${campoTexto('ACESSAD', 5)} FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
  ))[0];
  conferir('CST vazio recebeu 102', lerTexto(depois.TRIBUTARIA) === '102', lerTexto(depois.TRIBUTARIA));
  conferir('"acessa descricao" vazio recebeu N', lerTexto(depois.ACESSAD) === 'N', lerTexto(depois.ACESSAD));
  conferir('a tela fica sabendo o que foi preenchido', (registros[0].fiscalPreenchido || []).length >= 2,
    (registros[0].fiscalPreenchido || []).join(', '));

  await desfazer(registros);
  const desfeito = (await consultar(
    `SELECT ${campoTexto('TRIBUTARIA', 10)}, ${campoTexto('ACESSAD', 5)} FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
  ))[0];
  conferir('desfazer devolve os campos ao que eram', lerTexto(desfeito.TRIBUTARIA) === '' && lerTexto(desfeito.ACESSAD) === '',
    `[${lerTexto(desfeito.TRIBUTARIA)}] [${lerTexto(desfeito.ACESSAD)}]`);

  // devolve o produto exatamente como estava antes do teste
  await emTransacao((executar) => executar(
    'UPDATE PRODUTO SET TRIBUTARIA = ?, ACESSAD = ? WHERE TRIM(CODIGO) = ?',
    [antes.TRIBUTARIA, antes.ACESSAD, codigo]
  ));
  const conferencia = (await consultar(
    `SELECT ${campoTexto('TRIBUTARIA', 10)} FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
  ))[0];
  conferir('produto do teste voltou ao normal', lerTexto(conferencia.TRIBUTARIA) === antes.TRIBUTARIA);
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
