// Reproduz o erro relatado: mandar um PDF na aba Orcamento da erro toda vez.
// Gera um PDF de lista de compras igual ao que o cliente mandaria e envia.

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';

const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
const SAIDA = path.join('dados', 'teste-pdf');
let token = '';

fs.mkdirSync(SAIDA, { recursive: true });

/** Um PDF de lista, como o cliente manda. */
function listaEmPdf() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const pedacos = [];
  doc.on('data', (p) => pedacos.push(p));
  const pronto = new Promise((r) => doc.on('end', () => r(Buffer.concat(pedacos))));

  doc.fontSize(16).text('PEDIDO DE COMPRA', { align: 'center' }).moveDown();
  doc.fontSize(12);
  [
    '10 detergente ype 500ml',
    '2 agua sanitaria 5l',
    '5 saco de lixo 100 litros',
    '1 vassoura',
  ].forEach((l) => doc.text(l));
  doc.end();
  return pronto;
}

const entrar = await fetch(S + '/api/entrar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(LOGIN),
}).then((r) => r.json());
token = entrar.token || '';
console.log('login:', token ? 'ok' : 'FALHOU - ' + entrar.erro);
if (!token) process.exit(1);

const pdf = await listaEmPdf();
fs.writeFileSync(path.join(SAIDA, 'lista.pdf'), pdf);
console.log('PDF de teste:', (pdf.length / 1024).toFixed(1), 'KB');

const formulario = new FormData();
formulario.append('arquivos', new Blob([pdf], { type: 'application/pdf' }), 'lista.pdf');

console.log('\nenviando para /api/orcamento/montar ...');
const comecou = Date.now();
const resposta = await fetch(S + '/api/orcamento/montar', {
  method: 'POST', body: formulario, headers: { 'x-sessao': token },
});
const bruto = await resposta.text();
console.log(`status ${resposta.status} em ${((Date.now() - comecou) / 1000).toFixed(1)}s`);

let dados;
try { dados = JSON.parse(bruto); } catch { dados = null; }

if (!dados) {
  console.log('NAO devolveu JSON:', bruto.slice(0, 300));
} else if (!dados.ok) {
  console.log('ERRO:', dados.erro);
} else {
  console.log('MONTOU:', dados.orcamento.itens.length, 'itens');
  dados.orcamento.itens.forEach((i) => console.log(
    `   "${i.textoOriginal}" -> ${i.produto ? i.produto.descricao : i.opcoes.length + ' opcoes'}`));
}
process.exit(0);
