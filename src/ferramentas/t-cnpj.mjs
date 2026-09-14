// Confere a consulta de CNPJ nas bases publicas.
//
// Use um CNPJ de empresa conhecida, nunca o da loja: este arquivo vai para o Git.
// Da para passar outro na linha de comando:
//   node src/ferramentas/t-cnpj.mjs 00000000000191

import { consultarCnpj } from '../leitura/cnpj.js';

const cnpj = (process.argv[2] || '47960950000121').replace(/\D/g, '');

try {
  const d = await consultarCnpj(cnpj);
  console.log('Razao social:', d.razaoSocial);
  console.log('Fantasia   :', d.fantasia);
  console.log('Inscricao  :', d.inscricaoEstadual || '(vazia)');
  console.log('Endereco   :', d.rua, d.numero, '-', d.bairro, '-', d.cidade, d.uf, d.cep);
  console.log('Telefone   :', d.telefone, '| Situacao:', d.situacao, '| ativa:', d.ativa);
  console.log('CNPJ fmt   :', d.cnpj);
  console.log('Completo para a nota:', d.enderecoCompleto, d.faltando?.length ? '| falta: ' + d.faltando.join(', ') : '');
} catch (e) { console.log('FALHOU:', e.message); }
process.exit(0);
