import { buscarPorBarras } from '../db/produtos.js';
const p = await buscarPorBarras('7896098905913');
const d = p.descricao;
console.log('JSON:', JSON.stringify(d));
console.log('codigos:', [...d.slice(0,6)].map(c => c.charCodeAt(0)).join(','));
console.log('tem A-til (195 ou 227)?', d.includes('Ã'), d.includes('ã'));
console.log('tem caractere de erro (65533)?', d.includes('�'));
process.exit(0);
