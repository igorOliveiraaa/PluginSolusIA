// "Qual foi meu lucro?" pelo chat.
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';
const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
let token = '', falhas = 0;
const conferir = (t, ok, d = '') => { console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${t}${d ? ' -> ' + String(d).slice(0, 95) : ''}`); if (!ok) falhas += 1; };
const json = async (c, o = {}) => {
  const h = { ...(o.headers || {}) };
  if (token) h['x-sessao'] = token;
  if (typeof o.body === 'string') h['Content-Type'] = 'application/json';
  const r = await fetch(S + c, { ...o, headers: h });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
};

token = (await json('/api/entrar', { method: 'POST', body: JSON.stringify(LOGIN) })).dados.token || '';
conferir('login', Boolean(token));
if (!token) process.exit(1);

const t0 = Date.now();
const r = await json('/api/perguntar', { method: 'POST', body: JSON.stringify({ pergunta: 'Qual foi o lucro da loja em agosto de 2025?' }) });
conferir('respondeu', r.dados.ok === true, ((Date.now() - t0) / 1000).toFixed(1) + 's');
conferir('usou a ferramenta de lucro',
  (r.dados.consultou || []).some((c) => c.ferramenta === 'lucro_do_periodo'),
  (r.dados.consultou || []).map((c) => c.ferramenta).join(', '));

const texto = String(r.dados.resposta || '');
console.log('\n     --- resposta ---\n     ' + texto.split('\n').join('\n     ') + '\n');
conferir('trouxe o numero certo do lucro', /81[.\s]?689|81\.689,88|81689/.test(texto.replace(/\s/g, ' ')));
conferir('avisou que e lucro BRUTO', /brut/i.test(texto));
conferir('avisou que nao desconta despesa',
  /imposto|despesa|aluguel|folha|cart[aã]o|n[aã]o (est[aã]o )?descontad/i.test(texto));

console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
