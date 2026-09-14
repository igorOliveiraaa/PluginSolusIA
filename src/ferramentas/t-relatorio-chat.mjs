// "Me faz um relatorio de X" pelo chat: ela busca, responde e o resultado vira
// planilha (CSV) e PDF com um clique.
//
// Precisa do servidor no ar (npm start).

import fs from 'node:fs';
import path from 'node:path';
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';

const S = 'http://localhost:3535';
const LOGIN = credenciaisDeTeste();
const SAIDA = path.join('dados', 'exportacoes');
let falhas = 0;
let token = '';

const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 95) : ''}`);
  if (!ok) falhas += 1;
};

async function json(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}) };
  if (token) headers['x-sessao'] = token;
  if (typeof opcoes.body === 'string') headers['Content-Type'] = 'application/json';
  const r = await fetch(S + caminho, { ...opcoes, headers });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
}

const entrada = await json('/api/entrar', { method: 'POST', body: JSON.stringify(LOGIN) });
token = entrada.dados.token || '';
conferir('login', Boolean(token), entrada.dados.operador?.nome || entrada.dados.erro);
if (!token) process.exit(1);

const PEDIDOS = [
  'Me faz um relatorio dos produtos com estoque negativo',
  'Monta um relatorio do que mais vendeu nos ultimos 60 dias',
];

fs.mkdirSync(SAIDA, { recursive: true });

for (const pedido of PEDIDOS) {
  console.log(`\n=== "${pedido}" ===`);
  const comecou = Date.now();
  const r = await json('/api/perguntar', { method: 'POST', body: JSON.stringify({ pergunta: pedido }) });
  const segundos = ((Date.now() - comecou) / 1000).toFixed(1);

  conferir('respondeu', r.dados.ok === true, `${segundos}s · consultou: `
    + (r.dados.consultou || []).map((c) => c.ferramenta).join(', '));
  console.log('     ' + String(r.dados.resposta || '').split('\n').slice(0, 6).join('\n     '));

  conferir('deu para exportar', r.dados.podeExportar === true,
    `${r.dados.quantidadeLinhas} linhas`);

  if (!r.dados.podeExportar) continue;

  for (const formato of ['planilha', 'pdf']) {
    const resposta = await fetch(`${S}/api/exportar/${formato}`, { headers: { 'x-sessao': token } });
    const bytes = Buffer.from(await resposta.arrayBuffer());
    const tipo = resposta.headers.get('content-type') || '';
    const nome = (resposta.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || formato;

    conferir(`baixou o ${formato}`, resposta.ok && bytes.length > 200,
      `${nome} · ${(bytes.length / 1024).toFixed(1)} KB · ${tipo}`);

    if (formato === 'planilha') {
      const texto = bytes.toString('utf8');
      conferir('a planilha abre certo no Excel (BOM + ponto e virgula)',
        texto.charCodeAt(0) === 0xfeff && texto.includes(';'));
      conferir('a planilha tem cabecalho e linhas', texto.trim().split('\n').length > 2,
        texto.split('\n')[0].slice(0, 70));
      conferir('acento saiu certo na planilha', !texto.includes('?') || /[áéíóúãõçÁÉÍÓÚÃÕÇ]/.test(texto));
    } else {
      conferir('o PDF e um PDF de verdade', bytes.slice(0, 4).toString() === '%PDF');
    }
    fs.writeFileSync(path.join(SAIDA, `teste-${formato === 'planilha' ? 'relatorio.csv' : 'relatorio.pdf'}`), bytes);
  }
}

console.log(`\n(arquivos de teste em ${SAIDA})`);
console.log('\n' + (falhas ? `>>> ${falhas} FALHA(S)` : '>>> TUDO CERTO'));
process.exit(falhas ? 1 : 0);
