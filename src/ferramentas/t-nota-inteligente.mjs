// A nota "inteligente": caixa x unidade decidida pelo produto do Solus, e tudo
// da nota indo para o cadastro (NCM, CEST, fornecedor, vinculo, reativacao).
//
//   node src/ferramentas/t-nota-inteligente.mjs
//
// Usa o banco de TESTE e devolve tudo como estava no fim.

import { decidirCaixa, vendeFechado } from '../logica/caixa.js';
import { buscarFornecedorPorCnpj } from '../db/fornecedores.js';
import { consultar, emTransacao, campoTexto, lerTexto, gravarTexto } from '../db/firebird.js';
import { aplicarNota, desfazer } from '../db/gravacao.js';
import { buscarPorCodigo } from '../db/produtos.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 150) : ''}`);
  if (!ok) falhas += 1;
};

/** Um item de nota como sai do XML + calculo de custo. */
const item = (campos) => ({
  descricao: 'PRODUTO TESTE',
  unidadeComercial: 'UN',
  quantidadeComercial: 1,
  quantidadeUnidades: campos.quantidadeComercial || 1,
  unidadesPorCaixa: 0,
  convertido: false,
  confianca: 'alta',
  explicacao: '',
  ...campos,
});
const produto = (unidade, custo, descricao = 'PRODUTO') => ({ codigo: '1', unidade, custoAtual: custo, descricao });
const nenhumaMemoria = () => null;

// ===========================================================================
console.log('\n=== 1. Produto vendido por UNIDADE: sempre separa ===');

let r = decidirCaixa(item({
  unidadeComercial: 'CX', quantidadeComercial: 2, quantidadeUnidades: 48, custoTotalItem: 96,
  convertido: true, confianca: 'alta', unidadesPorCaixa: 24, explicacao: 'xml',
}), produto('UN', 2), nenhumaMemoria);
conferir('XML ja disse 24 por caixa: mantem 48 unidades', r.quantidadeUnidades === 48, r.explicacao);

r = decidirCaixa(item({
  descricao: 'DETERGENTE YPE 500ML CX C/24', unidadeComercial: 'CX', quantidadeComercial: 2, custoTotalItem: 96,
}), produto('UN', 2), nenhumaMemoria);
conferir('descricao "C/24" + conta do custo batendo: 48 un com certeza',
  r.quantidadeUnidades === 48 && r.confianca === 'alta' && r.custoUnitario === 2, `${r.quantidadeUnidades} un, ${r.confianca}`);

r = decidirCaixa(item({
  descricao: 'ALCOOL 70 1L', unidadeComercial: 'CX', quantidadeComercial: 3, custoTotalItem: 180,
}), produto('UN', 5), nenhumaMemoria);
conferir('caixa sem numero na descricao: acha 12 pela conta (R$ 60 ÷ R$ 5)',
  r.quantidadeUnidades === 36 && r.confianca === 'media', r.explicacao);

r = decidirCaixa(item({
  descricao: 'ALCOOL 70 1L', unidadeComercial: 'CX', quantidadeComercial: 3, custoTotalItem: 195,
}), produto('UN', 5), nenhumaMemoria);
conferir('preco subiu 8% desde a ultima compra: ainda acha 12', r.quantidadeUnidades === 36, r.explicacao);

r = decidirCaixa(item({
  descricao: 'PRODUTO NOVO SEM PISTA', unidadeComercial: 'CX', quantidadeComercial: 2, custoTotalItem: 100,
}), null, nenhumaMemoria);
conferir('produto novo, caixa sem pista: PERGUNTA em vez de chutar',
  r.confianca === 'baixa' && r.quantidadeUnidades === 2, r.explicacao);

r = decidirCaixa(item({
  descricao: 'PANO MULTIUSO', unidadeComercial: 'FD', quantidadeComercial: 2, custoTotalItem: 80,
}), produto('UN', 99), (codigo, unidade) => (unidade === 'FD' ? { porCaixa: 10 } : null));
conferir('aprendido na nota anterior (FD = 10): usa o aprendido',
  r.quantidadeUnidades === 20 && r.confianca === 'alta', r.explicacao);

r = decidirCaixa(item({
  descricao: 'DETERGENTE NEUTRO C/24', unidadeComercial: 'UN', quantidadeComercial: 1, custoTotalItem: 48,
}), produto('UN', 2), nenhumaMemoria);
conferir('nota diz "UN" mas e a caixa de 24 (descricao + conta): separa 24',
  r.quantidadeUnidades === 24, r.explicacao);

r = decidirCaixa(item({
  descricao: 'DESINFETANTE 2L', unidadeComercial: 'UN', quantidadeComercial: 5, custoTotalItem: 40,
}), produto('UN', 4), nenhumaMemoria);
conferir('em UN com preco dobrado e sem descricao: NAO inventa caixa de 2',
  r.quantidadeUnidades === 5, `${r.quantidadeUnidades} un`);

// ===========================================================================
console.log('\n=== 2. Produto que a loja vende FECHADO: entra fechado ===');

conferir('CX, PCT e FD contam como vendido fechado',
  vendeFechado({ unidade: 'CX' }) && vendeFechado({ unidade: 'PCT' }) && vendeFechado({ unidade: 'FD' }));
conferir('UN, PC (peca), GL e MT nao', ![ 'UN', 'PC', 'GL', 'MT'].some((u) => vendeFechado({ unidade: u })));

r = decidirCaixa(item({
  descricao: 'ACUCAR SACHE CX C/400', unidadeComercial: 'CX', quantidadeComercial: 3, quantidadeUnidades: 1200,
  custoTotalItem: 150, convertido: true, confianca: 'alta', unidadesPorCaixa: 400,
}), produto('CX', 50, 'ACUCAR SACHE UNIAO CX'), nenhumaMemoria);
conferir('acucar sache vendido em CX: entram 3 CX (nao 1200 sachês)',
  r.quantidadeUnidades === 3 && r.custoUnitario === 50, r.explicacao);

r = decidirCaixa(item({
  descricao: 'SACO DE LIXO 100L C/100', unidadeComercial: 'PCT', quantidadeComercial: 10, custoTotalItem: 250,
}), produto('PCT', 25), nenhumaMemoria);
conferir('saco de lixo C/100 vendido em PCT: entram 10 PCT (o "C/100" nao multiplica)',
  r.quantidadeUnidades === 10, r.explicacao);

r = decidirCaixa(item({
  descricao: 'GUARDANAPO 22X23', unidadeComercial: 'UN', quantidadeComercial: 720, custoTotalItem: 72,
}), produto('CX', 7.2), nenhumaMemoria);
conferir('guardanapo vendido em CX de 72 e a nota em 720 UN: entram 10 CX (nao 720)',
  r.quantidadeUnidades === 10, r.explicacao);

r = decidirCaixa(item({
  descricao: 'SACO DE LIXO 60L', unidadeComercial: 'CX', quantidadeComercial: 2, custoTotalItem: 200,
}), produto('PCT', 10), nenhumaMemoria);
conferir('nota em CX com 10 PCT dentro e a loja vende PCT: entram 20 PCT',
  r.quantidadeUnidades === 20, r.explicacao);

// ===========================================================================
console.log('\n=== 3. O que a pessoa escreveu na observacao manda ===');

r = decidirCaixa(item({
  unidadeComercial: 'CX', quantidadeComercial: 2, quantidadeUnidades: 48, custoTotalItem: 96, caixaDaObservacao: true,
}), produto('CX', 48), nenhumaMemoria);
conferir('"a caixa vem com 24" escrito pela pessoa nao e desfeito', r.quantidadeUnidades === 48);

// ===========================================================================
console.log('\n=== 4. Fornecedor da nota achado no Solus pelo CNPJ ===');

const fornecedor = await buscarFornecedorPorCnpj('01611823000116');
conferir('achou o fornecedor pelo CNPJ sem pontuacao', fornecedor?.codigo === '355',
  fornecedor ? `${fornecedor.codigo} ${fornecedor.nome}` : 'nao achou');
conferir('CNPJ que nao existe nao inventa fornecedor', (await buscarFornecedorPorCnpj('11111111000111')) === null);

// ===========================================================================
console.log('\n=== 5. Gravar a nota leva tudo da nota para o cadastro (e desfaz) ===');

const alvo = (await consultar(
  `SELECT FIRST 1 CODIGO FROM PRODUTO
    WHERE (STATUS IS NULL OR STATUS = '') AND BARRAS IS NOT NULL AND TRIM(BARRAS) <> ''
      AND (FORNECEDOR IS NULL OR TRIM(FORNECEDOR) <> '355')
    ORDER BY CODIGO`
))[0];
const codigo = String(alvo.CODIGO).trim();

const lerCampos = async () => {
  const l = (await consultar(
    `SELECT ${['NCM', 'CEST', 'FORNECEDOR', 'NOMEFOR', 'UNCOMPRA', 'STATUS', 'REFERENCIA'].map((c) => campoTexto(c, 60)).join(', ')},
            ${campoTexto('DESCRICAO', 70)}, BARRAS FROM PRODUTO WHERE TRIM(CODIGO) = ?`, [codigo]
  ))[0];
  return Object.fromEntries(Object.entries(l).map(([k, v]) => [k, lerTexto(v)]));
};

const original = await lerCampos();
console.log(`     produto de teste: ${codigo} ${original.DESCRICAO} (NCM ${original.NCM || '-'}, fornecedor ${original.FORNECEDOR || '-'})`);

// deixa o produto como um "parado marcado": nome com - DESATIVADO e CANCELADO
await emTransacao((executar) => executar(
  'UPDATE PRODUTO SET DESCRICAO = ?, STATUS = ? WHERE TRIM(CODIGO) = ?',
  [gravarTexto(`${original.DESCRICAO} - DESATIVADO`.slice(0, 70)), 'CANCELADO', codigo]
));
const antesDaNota = await lerCampos();

const codigoNoFornecedor = 'TESTE-' + codigo;
const produtoLido = await buscarPorCodigo(codigo);
const registros = await aplicarNota({
  itens: [{
    acao: 'atualizar',
    produto: produtoLido,
    descricao: 'PRODUTO DA NOTA DE TESTE',
    ncm: '34022000',
    cest: '1100100',
    codigoFornecedor: codigoNoFornecedor,
    unidadeComercial: 'CX',
    quantidadeUnidades: 0,
    custoUnitario: produtoLido.custoAtual || 1,
    precoVenda: produtoLido.vendaAtual || 2,
  }],
  atualizarEstoque: false,
  fornecedor: { cnpj: '01611823000116', codigoNoSolus: fornecedor.codigo, nomeNoSolus: fornecedor.nome },
});

const depois = await lerCampos();
conferir('NCM passou a ser o da nota', depois.NCM === '34022000', `${antesDaNota.NCM || '-'} -> ${depois.NCM}`);
conferir('CEST passou a ser o da nota', depois.CEST === '1100100', `${antesDaNota.CEST || '-'} -> ${depois.CEST}`);
conferir('fornecedor passou a ser o da nota', depois.FORNECEDOR === '355' && /MODENUTI/.test(depois.NOMEFOR),
  `${depois.FORNECEDOR} ${depois.NOMEFOR}`);
conferir('unidade de compra ficou a da nota', depois.UNCOMPRA === 'CX', depois.UNCOMPRA);
conferir('tirou o " - DESATIVADO" do nome', depois.DESCRICAO === original.DESCRICAO, depois.DESCRICAO);
conferir('saiu do CANCELADO (voltou a ser ativo)', depois.STATUS === '', `[${depois.STATUS}]`);
conferir('o NOME do produto nao foi trocado pelo da nota', depois.DESCRICAO !== 'PRODUTO DA NOTA DE TESTE');
conferir('o codigo de barras que ja existia nao foi trocado', depois.BARRAS === original.BARRAS);
conferir('a tela fica sabendo o que mudou', (registros[0].atualizadoPelaNota || []).length >= 4,
  (registros[0].atualizadoPelaNota || []).join(', '));

const vinculo = await consultar(
  'SELECT BARRAS FROM PRODUTOFORNE WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?', [codigoNoFornecedor, '355']
);
conferir('ensinou o Solus: codigo do fornecedor -> este produto (PRODUTOFORNE)',
  vinculo.length === 1 && String(vinculo[0].BARRAS).trim() === String(original.BARRAS).trim(),
  vinculo.length ? String(vinculo[0].BARRAS).trim() : 'sem vinculo');

await desfazer(registros);
const desfeito = await lerCampos();
conferir('desfazer devolve NCM, CEST e fornecedor',
  desfeito.NCM === antesDaNota.NCM && desfeito.CEST === antesDaNota.CEST && desfeito.FORNECEDOR === antesDaNota.FORNECEDOR,
  `NCM ${desfeito.NCM} CEST ${desfeito.CEST} forn ${desfeito.FORNECEDOR}`);
conferir('desfazer devolve o nome com " - DESATIVADO" e o CANCELADO',
  desfeito.DESCRICAO === antesDaNota.DESCRICAO && desfeito.STATUS === 'CANCELADO', `${desfeito.DESCRICAO} [${desfeito.STATUS}]`);
const vinculoDepois = await consultar(
  'SELECT COUNT(*) AS N FROM PRODUTOFORNE WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?', [codigoNoFornecedor, '355']
);
conferir('desfazer apaga o vinculo criado', Number(vinculoDepois[0].N) === 0);

// devolve o produto EXATAMENTE como estava antes do teste
await emTransacao((executar) => executar(
  'UPDATE PRODUTO SET DESCRICAO = ?, STATUS = ? WHERE TRIM(CODIGO) = ?',
  [gravarTexto(original.DESCRICAO), original.STATUS || null, codigo]
));
const final = await lerCampos();
conferir('produto de teste voltou ao que era', final.DESCRICAO === original.DESCRICAO && final.STATUS === original.STATUS);

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
