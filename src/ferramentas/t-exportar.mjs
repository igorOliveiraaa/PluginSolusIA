import fs from 'node:fs';
import { gerarCsv, gerarPdfTabela, nomeDeArquivo } from '../ia/exportar.js';
import * as consultas from '../ia/consultas.js';

// usa dados reais: produtos com estoque negativo
const dados = await consultas.produtosComEstoqueRuim({ quantos: 12, apenasNegativo: true });
console.log('linhas vindas do banco:', dados.produtos.length);

const csv = gerarCsv(dados.produtos);
fs.mkdirSync('dados/exportados', { recursive: true });
fs.writeFileSync('dados/exportados/teste.csv', csv);

const texto = csv.toString('utf8');
console.log('\n--- primeiras linhas do CSV ---');
texto.split('\r\n').slice(0, 4).forEach(l => console.log('  ' + l));
console.log('  tem BOM (acento certo no Excel)?', texto.charCodeAt(0) === 0xFEFF ? 'sim' : 'NAO');
console.log('  separador ponto e virgula?', texto.includes(';') ? 'sim' : 'NAO');

const pdf = await gerarPdfTabela({
  titulo: 'Produtos com estoque negativo',
  subtitulo: 'Listagem tirada do Solus',
  linhas: dados.produtos,
  rodape: 'Gerado pelo Plugin IA Solus.',
});
fs.writeFileSync('dados/exportados/teste.pdf', pdf);
console.log('\nPDF:', (pdf.length / 1024).toFixed(1), 'KB | comeca com %PDF?', pdf.slice(0,5).toString() === '%PDF-' ? 'sim' : 'NAO');
console.log('nome de arquivo gerado:', nomeDeArquivo('Quais produtos estão com estoque negativo?', 'csv'));
process.exit(0);
