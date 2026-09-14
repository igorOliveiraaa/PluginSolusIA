import fs from 'node:fs';
import { gerarPdfOrcamento, textoDoWhatsApp } from '../pdf-orcamento.js';
import { buscarClientePorCodigo } from '../db/clientes.js';
import { buscarPorDescricao } from '../db/produtos.js';

const cliente = await buscarClientePorCodigo('861');
const achados = await buscarPorDescricao('SACO DE LIXO', 4);
const itens = achados.map((p, i) => ({
  produto: p, quantidade: (i + 1) * 2, precoUnitario: p.vendaAtual,
  total: Math.round(p.vendaAtual * (i + 1) * 2 * 100) / 100, incluir: true,
}));

const pdf = await gerarPdfOrcamento({
  orcamento: { cliente, itens },
  numero: 156343,
  operador: { nome: 'OPERADOR DE TESTE' },
  observacao: 'Entrega em ate 3 dias uteis. Pagamento em boleto 28 dias.',
});

fs.mkdirSync('dados/orcamentos', { recursive: true });
fs.writeFileSync('dados/orcamentos/teste.pdf', pdf);
console.log('PDF gerado:', (pdf.length / 1024).toFixed(1), 'KB em dados/orcamentos/teste.pdf');
console.log('Comeca com PDF?', pdf.slice(0, 5).toString() === '%PDF-' ? 'OK' : 'FALHOU');
const total = itens.reduce((s, i) => s + i.total, 0);
console.log('\n--- texto do WhatsApp ---');
console.log(textoDoWhatsApp({ orcamento: { itens }, numero: 156343, total, loja: { nome: 'LOJA TESTE' } }));
process.exit(0);
