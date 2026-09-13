// Faz perguntas de verdade ao assistente, com o Gemini e o banco de teste.
import { perguntar } from '../ia/assistente.js';

const operador = { nome: 'ELAINE', permissoes: { verCusto: true } };
const perguntas = [
  'Quantos produtos ativos a loja tem e quantos estao com estoque negativo?',
  'Para quem vendemos sabao em pedra ype pela ultima vez e por quanto?',
  'Como mudou o preco do sabao em pedra ype 5x200?',
  'Quais os 5 produtos com o estoque mais negativo?',
];

for (const pergunta of perguntas) {
  const inicio = Date.now();
  try {
    const r = await perguntar({ pergunta, operador });
    console.log('\n=== ' + pergunta);
    console.log('consultou:', r.consultas.map((c) => c.ferramenta).join(', ') || '(nada)', `| ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
    console.log(r.resposta.slice(0, 700));
  } catch (e) {
    console.log('\n=== ' + pergunta + '\nFALHOU: ' + e.message);
  }
}
process.exit(0);
