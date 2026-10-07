// Fornecedor OBRIGATORIO antes de gravar a nota.
//
//   node src/ferramentas/t-fornecedor-nota.mjs     (o Plugin precisa estar ligado)
//
// A nota de exemplo vem de um fornecedor que NAO existe no Solus. Confere:
//   1. gravar sem fornecedor e recusado (e isso nao vira "tentativa com erro");
//   2. o CNPJ da propria loja e recusado (a IA as vezes le o do destinatario);
//   3. procurar pelo nome acha os fornecedores do Solus;
//   4. escolher um cadastrado SEM CNPJ grava nele o CNPJ da nota;
//   5. cadastrar com os dados do XML grava igual ao Solus, e repetir nao duplica;
//   6. CNPJ digitado errado e recusado;
//   7. com o fornecedor ligado a gravacao segue, e a proxima nota dele ja vem ligada.
// No fim apaga o fornecedor de teste e devolve o que mudou.
import fs from 'node:fs';
import path from 'node:path';
import { entrarComoTeste } from './login-teste.mjs';
import { consultar } from '../db/firebird.js';
import { pastaDaLoja } from '../config.js';
import { apagarFornecedorDeTeste, CNPJ_DA_NOTA_DE_TESTE, CNPJ_NO_SOLUS } from './fornecedor-de-teste.mjs';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};

const chamar = await entrarComoTeste();
const json = async (caminho, opcoes) => (await chamar(caminho, opcoes)).json();
const post = (caminho, corpo) => json(caminho, { method: 'POST', body: JSON.stringify(corpo) });
const lerNota = () => {
  const envio = new FormData();
  envio.append('arquivos', new Blob([fs.readFileSync('exemplos/nota-teste-entrada.xml')], { type: 'text/xml' }),
    'nota-teste-entrada.xml');
  return json('/api/ler-nota', { method: 'POST', body: envio });
};

const sobras = await apagarFornecedorDeTeste();
if (sobras) console.log(`  (apaguei ${sobras} fornecedor de teste que sobrou de outra rodada)`);
const historicoAntes = (await json('/api/historico?limite=1')).historico?.[0]?.id;
const apagarDoHistorico = [];

try {
  // =========================================================================
  console.log('\n=== 1. Sem fornecedor no Solus a nota nao grava ===');
  const leitura = await lerNota();
  conferir('a nota foi lida', leitura.ok === true, leitura.erro);
  const f = leitura.conferencia.fornecedor;
  conferir('o fornecedor da nota nao esta no Solus', !f.codigoNoSolus, `${f.nome} ${f.cnpj}`);
  conferir('o XML trouxe cidade e UF para o cadastro', f.cidade === 'BAURU' && f.uf === 'SP', `${f.cidade}/${f.uf}`);

  const decisoes = leitura.conferencia.itens.map((i) => ({ acao: i.acao }));
  const semFornecedor = await post('/api/aplicar', { id: leitura.id, decisoes, operador: 'teste' });
  conferir('gravar sem fornecedor e recusado', semFornecedor.ok !== true && /fornecedor/i.test(semFornecedor.erro),
    semFornecedor.erro);
  conferir('  e isso NAO vira "tentativa com erro" no historico',
    (await json('/api/historico?limite=1')).historico?.[0]?.id === historicoAntes);

  // =========================================================================
  console.log('\n=== 2. CNPJ da propria loja ===');
  const daLoja = String((await consultar('SELECT FIRST 1 CPFCNPJ FROM PARAMETRO'))[0]?.CPFCNPJ || '').replace(/\D/g, '');
  const loja = await json('/api/fornecedores/cnpj/' + daLoja);
  conferir('o CNPJ da loja e recusado, explicando', loja.ok !== true && /pr[oó]pria loja/i.test(loja.erro), loja.erro);

  // =========================================================================
  console.log('\n=== 3. Procurar no Solus ===');
  const busca = await json('/api/fornecedores?busca=compre facil');
  conferir('procurar pelo nome acha o fornecedor', busca.fornecedores?.some((x) => x.codigo === '59'),
    busca.fornecedores?.map((x) => `${x.codigo} ${x.nome}`).join(' | '));
  const porCnpj = await json('/api/fornecedores?busca=' + encodeURIComponent('58.055.343'));
  conferir('procurar pelo comeco do CNPJ tambem', porCnpj.fornecedores?.length >= 1,
    porCnpj.fornecedores?.map((x) => x.nome).join(' | '));

  // =========================================================================
  console.log('\n=== 4. Escolher um cadastrado SEM CNPJ ===');
  const semCnpj = (await consultar(
    `SELECT FIRST 1 CODIGO, CPFCNPJ FROM FORNECEDOR WHERE CPFCNPJ IS NOT NULL
       AND REPLACE(REPLACE(REPLACE(REPLACE(CPFCNPJ, '.', ''), '/', ''), '-', ''), ' ', '') IN ('', '00000000000000')`))[0];
  if (!semCnpj) {
    console.log('  (banco sem fornecedor sem CNPJ: pulando)');
  } else {
    const codigo = String(semCnpj.CODIGO).trim();
    try {
      const escolheu = await post('/api/conferencia/fornecedor', { id: leitura.id, codigo });
      conferir('a nota ficou ligada a ele', escolheu.ok && escolheu.fornecedor.codigoNoSolus === codigo, escolheu.erro);
      const agora = (await consultar('SELECT CPFCNPJ FROM FORNECEDOR WHERE CODIGO = ?', [codigo]))[0].CPFCNPJ;
      conferir('o cadastro dele recebeu o CNPJ da nota', escolheu.cnpjGravado === true && agora === CNPJ_NO_SOLUS, agora);
    } finally {
      await consultar('UPDATE FORNECEDOR SET CPFCNPJ = ? WHERE CODIGO = ?', [semCnpj.CPFCNPJ, codigo]);
    }
  }
  const outro = await post('/api/conferencia/fornecedor', { id: leitura.id, codigo: '59' });
  conferir('escolher um que TEM outro CNPJ liga, mas nao mexe no CNPJ dele', outro.ok && outro.cnpjGravado === false,
    outro.erro || `ligado ao ${outro.fornecedor?.codigoNoSolus}`);

  // =========================================================================
  console.log('\n=== 5. Cadastrar com os dados do XML ===');
  const contador = Number((await consultar('SELECT FIRST 1 CODIGO FROM CODFORNECEDOR'))[0].CODIGO);
  const dados = {
    cnpj: CNPJ_DA_NOTA_DE_TESTE, razaoSocial: f.nome, fantasia: f.fantasia, inscricaoEstadual: '123.456.789.110',
    rua: 'RUA DOS TESTES', numero: '1-23', bairro: 'CENTRO', cep: '17000000', cidade: f.cidade, uf: f.uf,
    telefone: '14 32260000',
  };
  const novo = await post('/api/conferencia/fornecedor/novo', { id: leitura.id, dados });
  conferir('cadastrou (CNPJ do XML vale mesmo sem passar na conta da Receita)', novo.ok && !novo.jaExistia,
    novo.erro || `codigo ${novo.codigo}`);
  conferir('a nota ficou ligada ao novo', novo.fornecedor?.codigoNoSolus === novo.codigo);
  const linha = (await consultar(
    `SELECT CODIGO, CAST(NOME AS VARCHAR(50) CHARACTER SET OCTETS) AS NOME, CPFCNPJ, TIPOFORN, INSCRICAO, CEP,
            NUMERO, UF, CAST(CIDADE AS VARCHAR(30) CHARACTER SET OCTETS) AS CIDADE, RUA, BAIRRO, FANTASIA
       FROM FORNECEDOR WHERE CODIGO = ?`, [novo.codigo]))[0];
  conferir('gravado como o Solus grava', linha && linha.CPFCNPJ === CNPJ_NO_SOLUS && linha.TIPOFORN === 'JURIDICA'
    && linha.INSCRICAO === '123456789110' && linha.CEP === '17000-000' && String(linha.UF).trim() === 'SP',
    linha && `${linha.CPFCNPJ} ${linha.TIPOFORN} IE ${linha.INSCRICAO} CEP ${linha.CEP} ${linha.CIDADE.toString('latin1')}/${linha.UF}`);
  const vazios = ['NUMERO', 'RUA', 'BAIRRO', 'FANTASIA'].filter((c) => linha?.[c] === null);
  conferir('nenhum campo que o Solus sempre preenche ficou NULL', !vazios.length, vazios.join(' '));
  conferir('o contador do Solus andou', Number((await consultar('SELECT FIRST 1 CODIGO FROM CODFORNECEDOR'))[0].CODIGO)
    === Number(novo.codigo) + 1 && Number(novo.codigo) >= contador);

  const deNovo = await post('/api/conferencia/fornecedor/novo', { id: leitura.id, dados });
  conferir('cadastrar o mesmo CNPJ de novo nao duplica', deNovo.ok && deNovo.jaExistia && deNovo.codigo === novo.codigo,
    deNovo.erro || deNovo.codigo);

  // =========================================================================
  console.log('\n=== 6. CNPJ digitado errado ===');
  const errado = await post('/api/conferencia/fornecedor/novo', { id: leitura.id, dados: { ...dados, cnpj: '11222333000100' } });
  conferir('CNPJ digitado (que nao e o do XML) passa pela conta da Receita', errado.ok !== true && /inv[aá]lido/i.test(errado.erro),
    errado.erro);

  // =========================================================================
  console.log('\n=== 7. Com o fornecedor ligado ===');
  const tudoIgnorado = leitura.conferencia.itens.map(() => ({ acao: 'ignorar' }));
  const segue = await post('/api/aplicar', { id: leitura.id, decisoes: tudoIgnorado, operador: 'teste' });
  conferir('a gravacao passa da trava do fornecedor', !/fornecedor/i.test(segue.erro || ''), segue.erro);
  const ultimo = (await json('/api/historico?limite=1')).historico?.[0];
  if (ultimo?.id && ultimo.id !== historicoAntes) apagarDoHistorico.push(ultimo.id);

  const outraNota = await lerNota();
  conferir('a proxima nota desse fornecedor ja vem ligada sozinha',
    outraNota.conferencia?.fornecedor?.codigoNoSolus === novo.codigo, outraNota.conferencia?.fornecedor?.codigoNoSolus);
} finally {
  await apagarFornecedorDeTeste();
  for (const id of apagarDoHistorico) {
    try { fs.unlinkSync(path.join(pastaDaLoja('historico'), `${id}.json`)); } catch { /* ja nao existe */ }
  }
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
