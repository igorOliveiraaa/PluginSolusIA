import fs from 'node:fs';
import { gerarDanfe, lerNotaParaDanfe } from '../danfe.js';

const original = fs.readFileSync(fs.readdirSync('C:/Solus/nfe').map((n) => 'C:/Solus/nfe/' + n).find((n) => n.endsWith('.xml')), 'utf8');
fs.mkdirSync('dados/exportados', { recursive: true });

const contarFolhas = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// 1) nota real, 1 item
const nota = lerNotaParaDanfe(original);
console.log('lida:', nota.numero, '| chave', nota.chave, '| protocolo', nota.protocolo, '| itens', nota.itens.length, '| total', nota.totais.nota);
const pdf1 = await gerarDanfe(original);
fs.writeFileSync('dados/exportados/danfe-1-item.pdf', pdf1);
console.log('PDF 1 item:', (pdf1.length / 1024).toFixed(1), 'KB,', contarFolhas(pdf1), 'folha(s)');

// 2) mesma nota com 60 itens, para testar quebra de folha
const det = original.match(/<det nItem="1">[\s\S]*?<\/det>/)[0];
const muitos = Array.from({ length: 60 }, (_, i) => det.replace('nItem="1"', `nItem="${i + 1}"`)
  .replace(/<xProd>[^<]*<\/xProd>/, `<xProd>PRODUTO DE TESTE NUMERO ${i + 1} COM UMA DESCRICAO BEM COMPRIDA PARA QUEBRAR A LINHA</xProd>`)).join('');
const comprida = original.replace(det, muitos);
const pdf2 = await gerarDanfe(comprida);
fs.writeFileSync('dados/exportados/danfe-60-itens.pdf', pdf2);
console.log('PDF 60 itens:', (pdf2.length / 1024).toFixed(1), 'KB,', contarFolhas(pdf2), 'folha(s)');

// 3) carimbo de cancelada
const pdf3 = await gerarDanfe(original, { situacao: 'cancelada' });
console.log('PDF cancelada:', contarFolhas(pdf3), 'folha(s)');
process.exit(0);
