import { buscarPorDescricao } from '../db/produtos.js';
for (const termo of ['SABAO EM PEDRA YPE', 'SABÃO EM PEDRA YPE', 'ISQUEIRO BIC MAXI']) {
  const r = await buscarPorDescricao(termo);
  console.log(`"${termo}" -> ${r.length} achados`);
  r.slice(0, 2).forEach(p => console.log('    ', p.descricao));
}
process.exit(0);
