// O fornecedor da nota de exemplo (exemplos/nota-teste-entrada.xml) NAO existe no
// Solus de proposito: e assim que os testes passam pelo "cadastrar fornecedor",
// que e obrigatorio antes de gravar. Aqui fica a limpeza: apagar o que o teste
// cadastrou e devolver o contador de codigo, para a copia do banco nao andar.
import { consultar } from '../db/firebird.js';

export const CNPJ_DA_NOTA_DE_TESTE = '12345678000199';
export const CNPJ_NO_SOLUS = '12.345.678/0001-99';

/** Cadastra (pela API, como a tela) o fornecedor da nota lida, para poder gravar. */
export async function cadastrarFornecedorDaNota(chamar, leitura) {
  const daNota = leitura.conferencia.fornecedor;
  const resposta = await (await chamar('/api/conferencia/fornecedor/novo', {
    method: 'POST',
    body: JSON.stringify({ id: leitura.id, dados: { ...daNota, razaoSocial: daNota.nome } }),
  })).json();
  if (!resposta.ok) throw new Error('Nao consegui cadastrar o fornecedor da nota: ' + resposta.erro);
  return resposta;
}

export async function apagarFornecedorDeTeste() {
  const linhas = await consultar('SELECT CODIGO FROM FORNECEDOR WHERE CPFCNPJ = ?', [CNPJ_NO_SOLUS]);
  if (!linhas.length) return 0;
  await consultar('DELETE FROM FORNECEDOR WHERE CPFCNPJ = ?', [CNPJ_NO_SOLUS]);
  const maior = Number((await consultar(
    "SELECT MAX(CAST(CODIGO AS INTEGER)) AS M FROM FORNECEDOR WHERE CODIGO SIMILAR TO '[0-9]+'"))[0].M) || 0;
  await consultar('UPDATE CODFORNECEDOR SET CODIGO = ?', [maior + 1]);
  return linhas.length;
}
