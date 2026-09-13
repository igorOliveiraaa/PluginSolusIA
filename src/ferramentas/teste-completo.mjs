// Teste de ponta a ponta na COPIA do banco:
// ler a nota -> gravar -> conferir no banco -> desfazer -> conferir de novo.

import { consultar, paraNumero, campoTexto, lerTexto } from '../db/firebird.js';

import { entrarComoTeste } from './login-teste.mjs';

const chamar = await entrarComoTeste();
const CODIGOS = ['11673', '7519', '10877', '11015'];   // produtos usados na nota de teste

async function fotografarBanco(titulo) {
  const linhas = await consultar(
    `SELECT CODIGO, ${campoTexto('DESCRICAO', 70)}, ESTOQUEATUAL, PRECOCUSTO, PRECOVENDA, STATUS
       FROM PRODUTO WHERE TRIM(CODIGO) IN (${CODIGOS.map(() => '?').join(',')})`,
    CODIGOS
  );
  const mapa = {};
  console.log('\n=== ' + titulo + ' ===');
  for (const l of linhas) {
    const cod = String(l.CODIGO).trim();
    mapa[cod] = {
      descricao: lerTexto(l.DESCRICAO),
      estoque: paraNumero(l.ESTOQUEATUAL),
      custo: paraNumero(l.PRECOCUSTO),
      venda: paraNumero(l.PRECOVENDA),
      status: String(l.STATUS || '').trim(),
    };
    const p = mapa[cod];
    console.log(`  [${cod}] ${p.descricao.padEnd(34).slice(0, 34)} est=${String(p.estoque).padStart(7)} custo=${String(p.custo).padStart(7)} venda=${String(p.venda).padStart(7)} ${p.status}`);
  }
  return mapa;
}

function conferir(descricao, obtido, esperado) {
  const ok = Math.abs(Number(obtido) - Number(esperado)) < 0.015;
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${descricao}: esperado ${esperado}, obtido ${obtido}`);
  return ok;
}

const antes = await fotografarBanco('ANTES (como esta hoje)');

// ---- 1. ler a nota --------------------------------------------------------
const formulario = new FormData();
const xml = await import('node:fs').then((fs) =>
  fs.readFileSync('exemplos/nota-teste-entrada.xml'));
formulario.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota-teste-entrada.xml');

const leitura = await (await chamar('/api/ler-nota', { method: 'POST', body: formulario })).json();
if (!leitura.ok) { console.error('FALHOU ao ler:', leitura.erro); process.exit(1); }

const itens = leitura.conferencia.itens;
console.log('\nNota lida:', itens.length, 'itens');

// ---- 2. montar as decisoes (como se o operador tivesse clicado) -----------
const decisoes = itens.map((item) => ({
  acao: item.acao,
  quantidadeUnidades: item.quantidadeUnidades,
  custoUnitario: item.custoUnitario,
  precoVenda: item.analise.precoSugerido,
  // no item AVENTAL: igualar o preco do repetido e desativar o cadastro 11015
  igualarIrmaos: item.descricao === 'AVENTAL',
  desativarIrmaos: item.descricao === 'AVENTAL' ? ['11015'] : [],
}));

// ---- 3. gravar -----------------------------------------------------------
const gravacao = await (await chamar('/api/aplicar', {
  method: 'POST',
  body: JSON.stringify({ id: leitura.id, decisoes, operador: 'TESTE' }),
})).json();

if (!gravacao.ok) { console.error('FALHOU ao gravar:', gravacao.erro); process.exit(1); }
console.log('\nGravado:', JSON.stringify(gravacao.resumo));

const depois = await fotografarBanco('DEPOIS DE GRAVAR');

// ---- 4. conferir o que mudou --------------------------------------------
console.log('\n=== CONFERINDO ===');
let tudoCerto = true;

// SABAO: 60 unidades a mais
tudoCerto &= conferir('estoque do SABAO somou 60', depois['11673'].estoque, antes['11673'].estoque + 60);

// LAMINA: veio 5 CX -> tem que somar 60 unidades, nao 5
tudoCerto &= conferir('estoque da LAMINA somou 60 (e nao 5)', depois['7519'].estoque, antes['7519'].estoque + 60);
tudoCerto &= conferir('custo da LAMINA virou o da unidade', depois['7519'].custo, 1.33);

// AVENTAL: 30 unidades entram so no cadastro principal
tudoCerto &= conferir('estoque do AVENTAL somou 30', depois['10877'].estoque, antes['10877'].estoque + 30);
tudoCerto &= conferir('estoque do repetido 11015 NAO foi mexido', depois['11015'].estoque, antes['11015'].estoque);
// o 11015 foi DESATIVADO, entao o preco dele fica como estava (vale o historico);
// desativar tem prioridade sobre igualar preco, de proposito
tudoCerto &= conferir('preco do desativado 11015 ficou intacto', depois['11015'].venda, antes['11015'].venda);

const marcado = depois['11015'].descricao.includes('DESATIVADO');
console.log(`  ${marcado ? 'OK  ' : 'FALHOU'} repetido 11015 marcado como DESATIVADO no nome: "${depois['11015'].descricao}"`);
tudoCerto &= marcado;

const cancelado = depois['11015'].status === 'CANCELADO';
console.log(`  ${cancelado ? 'OK  ' : 'FALHOU'} repetido 11015 com STATUS CANCELADO`);
tudoCerto &= cancelado;

// produto novo criado?
const novo = await consultar(
  `SELECT CODIGO, ${campoTexto('DESCRICAO', 70)}, ESTOQUEATUAL, PRECOCUSTO, PRECOVENDA, UNIDADE
     FROM PRODUTO WHERE BARRAS = '7891000555123'`
);
if (novo.length) {
  const p = novo[0];
  console.log(`  OK   produto novo criado: [${String(p.CODIGO).trim()}] ${lerTexto(p.DESCRICAO)} | est=${paraNumero(p.ESTOQUEATUAL)} custo=${paraNumero(p.PRECOCUSTO)} venda=${paraNumero(p.PRECOVENDA)} un=${String(p.UNIDADE).trim()}`);
} else {
  console.log('  FALHOU produto novo nao foi criado');
  tudoCerto = false;
}

// ---- 5. desfazer ---------------------------------------------------------
console.log('\n=== DESFAZENDO ===');
const desfazer = await (await chamar('/api/desfazer/' + gravacao.historico, { method: 'POST' })).json();
if (!desfazer.ok) { console.error('FALHOU ao desfazer:', desfazer.erro); process.exit(1); }
console.log(desfazer.resultado.length, 'produtos restaurados');

const voltou = await fotografarBanco('DEPOIS DE DESFAZER');

console.log('\n=== CONFERINDO O DESFAZER ===');
for (const codigo of CODIGOS) {
  tudoCerto &= conferir(`estoque do ${codigo} voltou`, voltou[codigo].estoque, antes[codigo].estoque);
  tudoCerto &= conferir(`custo do ${codigo} voltou`, voltou[codigo].custo, antes[codigo].custo);
  tudoCerto &= conferir(`venda do ${codigo} voltou`, voltou[codigo].venda, antes[codigo].venda);
}
const nomeVoltou = voltou['11015'].descricao === antes['11015'].descricao;
console.log(`  ${nomeVoltou ? 'OK  ' : 'FALHOU'} nome do 11015 voltou ao original: "${voltou['11015'].descricao}"`);
tudoCerto &= nomeVoltou;

const semNovo = await consultar("SELECT COUNT(*) AS T FROM PRODUTO WHERE BARRAS = '7891000555123'");
const removido = Number(semNovo[0].T) === 0;
console.log(`  ${removido ? 'OK  ' : 'FALHOU'} produto criado foi removido no desfazer`);
tudoCerto &= removido;

console.log('\n' + (tudoCerto ? '>>> TUDO CERTO' : '>>> TEM COISA ERRADA ACIMA'));
process.exit(tudoCerto ? 0 : 1);
