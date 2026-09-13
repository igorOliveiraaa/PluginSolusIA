import { consultarCnpj } from '../leitura/cnpj.js';
try {
  const d = await consultarCnpj('59868230000110');   // CNPJ do proprio Igor, do XML
  console.log('Razao social:', d.razaoSocial);
  console.log('Fantasia   :', d.fantasia);
  console.log('Endereco   :', d.rua, d.numero, '-', d.bairro, '-', d.cidade, d.uf, d.cep);
  console.log('Telefone   :', d.telefone, '| Situacao:', d.situacao, '| ativa:', d.ativa);
  console.log('CNPJ fmt   :', d.cnpj);
} catch (e) { console.log('FALHOU:', e.message); }
process.exit(0);
