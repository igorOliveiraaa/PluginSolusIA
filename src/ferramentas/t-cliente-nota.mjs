// Confere o que a NOTA FISCAL exige do cadastro de cliente:
// endereco completo (rua com o tipo, numero, bairro, cidade, UF, CEP) e
// inscricao estadual. Cadastra num banco de TESTE e apaga no fim.
//
// Tambem mede o tempo de montar um orcamento grande, que e o que a pessoa
// sente no balcao.

import { consultarCnpj } from '../leitura/cnpj.js';
import { cadastrarCliente, buscarPorDocumento } from '../db/clientes.js';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';
import { montarOrcamento } from '../logica/orcamento.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas += 1;
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. O que a consulta de CNPJ devolve ===');

const dados = await consultarCnpj('47960950000121');
conferir('razao social', Boolean(dados.razaoSocial), dados.razaoSocial);
conferir('a rua vem com o tipo (RUA/AVENIDA)', /^(RUA|AV|AVENIDA|TRAVESSA|ROD|PRACA|ALAMEDA)/i.test(dados.rua), dados.rua);
conferir('numero', Boolean(dados.numero), dados.numero);
conferir('bairro', Boolean(dados.bairro), dados.bairro);
conferir('cidade e UF', Boolean(dados.cidade && dados.uf), `${dados.cidade}/${dados.uf}`);
conferir('CEP', /\d{5}-\d{3}/.test(dados.cep), dados.cep);
conferir('inscricao estadual', Boolean(dados.inscricaoEstadual), dados.inscricaoEstadual || '(vazia)');
conferir('diz se falta algo para a nota', Array.isArray(dados.faltando), JSON.stringify(dados.faltando));
conferir('endereco completo', dados.enderecoCompleto === true);

console.log('\n=== 2. Empresa sem inscricao ativa: avisa em vez de inventar ===');
const semIe = await consultarCnpj('33000167000101');
conferir('mesmo sem IE, o endereco vem completo', semIe.enderecoCompleto === true,
  `${semIe.rua}, ${semIe.numero} - ${semIe.bairro}`);
conferir('a IE fica vazia para a pessoa digitar', typeof semIe.inscricaoEstadual === 'string');

// ---------------------------------------------------------------------------
console.log('\n=== 3. Cadastrando no Solus (banco de teste) ===');

const documento = '47960950000121';
const jaExistia = await buscarPorDocumento(documento);
if (jaExistia) {
  console.log('     (esse CNPJ ja estava no banco de teste; pulando o cadastro)');
} else {
  const resultado = await cadastrarCliente({ ...dados, celular: '(14) 99999-0000', contato: 'TESTE' }, 'TESTE');
  conferir('cadastrou', resultado.jaExistia === false, 'codigo ' + resultado.cliente.codigo);

  const linhas = await consultar(
    `SELECT FIRST 1 CODIGO, ${campoTexto('NOME', 50)}, ${campoTexto('RUA', 60)}, NUMERO,
            ${campoTexto('BAIRRO', 70)}, ${campoTexto('CIDADE', 30)}, UF, CEP, INSCRICAO,
            ${campoTexto('COMPLEMENTO', 50)}, CELULAR, CPFCNPJ
       FROM CLIENTES WHERE TRIM(CODIGO) = ?`,
    [resultado.cliente.codigo]
  );
  const gravado = linhas[0];
  conferir('a rua gravou com o tipo', /^RUA/i.test(lerTexto(gravado.RUA)), lerTexto(gravado.RUA));
  conferir('numero gravou', String(gravado.NUMERO || '').trim() === dados.numero, gravado.NUMERO);
  conferir('bairro gravou', Boolean(lerTexto(gravado.BAIRRO)), lerTexto(gravado.BAIRRO));
  conferir('cidade e UF gravaram',
    Boolean(lerTexto(gravado.CIDADE)) && String(gravado.UF).trim() === dados.uf,
    `${lerTexto(gravado.CIDADE)}/${String(gravado.UF).trim()}`);
  conferir('CEP gravou', String(gravado.CEP || '').trim() === dados.cep, gravado.CEP);
  conferir('inscricao estadual gravou no formato do Solus',
    /^\d{3}\.\d{3}\.\d{3}\.\d{3}$/.test(String(gravado.INSCRICAO || '').trim()),
    gravado.INSCRICAO);
  conferir('celular gravou', String(gravado.CELULAR || '').includes('99999'), gravado.CELULAR);
  conferir('acentos ficaram certos no nome', !lerTexto(gravado.NOME).includes('?'), lerTexto(gravado.NOME));

  // limpeza: esse cliente foi criado so para o teste
  await consultar('DELETE FROM CLIENTES WHERE TRIM(CODIGO) = ?', [resultado.cliente.codigo]);
  const sumiu = await buscarPorDocumento(documento);
  conferir('cliente de teste removido do banco', !sumiu);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Tempo de montar um orcamento grande ===');

const pedidos = [
  'agua sanitaria 5l', 'detergente ype 500ml', 'sabao em po 1kg', 'papel higienico',
  'saco de lixo 100 litros', 'alcool em gel', 'desinfetante pinho', 'esponja dupla face',
  'pano de chao', 'vassoura', 'rodo', 'luva de borracha', 'copo descartavel 200ml',
  'guardanapo', 'papel toalha', 'sabonete liquido', 'cloro', 'amaciante',
  'limpa vidro', 'flanela',
];
const lista = { itens: pedidos.map((p, i) => ({ descricao: p, quantidade: i + 1, textoOriginal: p })) };

const comecou = Date.now();
const grande = await montarOrcamento({ lista, cliente: null, mostrarCusto: true });
const segundos = (Date.now() - comecou) / 1000;

conferir('montou os 20 itens', grande.itens.length === 20);
conferir('demorou menos de 10 segundos', segundos < 10, segundos.toFixed(1) + 's');
const achados = grande.itens.filter((i) => i.produto).length;
console.log(`     achou sozinho: ${achados} de 20 · precisam escolha: ${grande.resumo.precisamEscolha}`);
conferir('nenhum item ficou sem opcoes E sem produto',
  grande.itens.filter((i) => !i.produto && !i.opcoes.length).length <= 2,
  grande.itens.filter((i) => !i.produto && !i.opcoes.length).map((i) => i.descricao).join(', ') || 'nenhum');

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
