// Afazeres da loja (aba Tarefas): escrever com ou sem IA, editar, concluir, excluir.
//
//   node src/ferramentas/t-afazeres.mjs     (o Plugin precisa estar ligado; usa a IA)
//
// Apaga no fim tudo o que criou.
import { entrarComoTeste } from './login-teste.mjs';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 160) : ''}`);
  if (!ok) falhas += 1;
};
const chamar = await entrarComoTeste();
const json = async (caminho, opcoes) => (await chamar(caminho, opcoes)).json();
const enviar = (metodo, caminho, corpo) => json(caminho, { method: metodo, body: JSON.stringify(corpo || {}) });

const dois = (n) => String(n).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const hoje = new Date();
const amanha = isoDe(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1));
const criadas = [];

try {
  console.log('\n=== 1. Texto livre com a IA ===');
  const comIA = await enviar('POST', '/api/afazeres', {
    texto: 'TESTE ligar pra aylag amanha as 10h pedir desinfetante lavanda e TESTE conferir o boleto da quimiart', usarIA: true,
  });
  criadas.push(...(comIA.criadas || []).map((t) => t.id));
  conferir('a IA separou em 2 tarefas', comIA.ok && comIA.comIA && comIA.criadas.length === 2,
    (comIA.criadas || []).map((t) => t.titulo).join(' | ') || comIA.erro);
  const ligar = (comIA.criadas || []).find((t) => /aylag/i.test(t.titulo + t.detalhe));
  conferir('"amanha as 10h" virou data e hora', ligar?.data === amanha && ligar?.hora === '10:00', `${ligar?.data} ${ligar?.hora}`);
  conferir('o que pedir ficou no detalhe ou no titulo', /desinfetante/i.test(`${ligar?.titulo} ${ligar?.detalhe}`));

  const urgente = await enviar('POST', '/api/afazeres', { texto: 'TESTE urgente mandar orcamento da dona maria hoje de tarde', usarIA: true });
  criadas.push(...(urgente.criadas || []).map((t) => t.id));
  conferir('"urgente ... hoje de tarde" = urgente, hoje, 14:00',
    urgente.criadas?.[0]?.prioridade === 'alta' && urgente.criadas?.[0]?.data === isoDe(hoje) && urgente.criadas?.[0]?.hora === '14:00',
    `${urgente.criadas?.[0]?.prioridade} ${urgente.criadas?.[0]?.data} ${urgente.criadas?.[0]?.hora}`);

  console.log('\n=== 2. Sem a IA ===');
  const semIA = await enviar('POST', '/api/afazeres', { texto: 'TESTE repor saco de lixo amanha', usarIA: false });
  criadas.push(...(semIA.criadas || []).map((t) => t.id));
  conferir('entra exatamente como foi escrito (sem data inventada)', semIA.criadas?.[0]?.titulo === 'TESTE repor saco de lixo amanha'
    && !semIA.criadas?.[0]?.data);
  const vazio = await enviar('POST', '/api/afazeres', { texto: '   ', usarIA: false });
  conferir('texto vazio e recusado, explicando', vazio.ok !== true && /escreva/i.test(vazio.erro), vazio.erro);

  console.log('\n=== 3. Editar, concluir, desfazer, excluir ===');
  const id = semIA.criadas?.[0]?.id;
  const editada = await enviar('PUT', `/api/afazeres/${id}`, {
    titulo: 'TESTE repor saco de lixo 100L', detalhe: '5 pacotes', data: amanha, hora: '9:05', prioridade: 'alta',
  });
  conferir('editar muda tudo (e acerta a hora "9:05" para 09:05)', editada.tarefa?.titulo === 'TESTE repor saco de lixo 100L'
    && editada.tarefa?.detalhe === '5 pacotes' && editada.tarefa?.data === amanha && editada.tarefa?.hora === '09:05'
    && editada.tarefa?.prioridade === 'alta', JSON.stringify(editada.tarefa || editada.erro));
  const dataRuim = await enviar('PUT', `/api/afazeres/${id}`, { titulo: 'TESTE x', data: '2026-02-31' });
  conferir('data que nao existe (31/02) fica sem data', dataRuim.tarefa?.data === '', dataRuim.tarefa?.data);
  const feita = await enviar('POST', `/api/afazeres/${id}/concluir`, { feita: true });
  conferir('concluir marca como feita, com quem fez', feita.tarefa?.feita === true && Boolean(feita.tarefa?.feitaPor), feita.tarefa?.feitaPor);
  const desfeita = await enviar('POST', `/api/afazeres/${id}/concluir`, { feita: false });
  conferir('desmarcar volta a pendente', desfeita.tarefa?.feita === false);
  const excluida = await json(`/api/afazeres/${id}`, { method: 'DELETE' });
  const lista = await json('/api/afazeres');
  conferir('excluir tira da lista', excluida.ok && !lista.tarefas.some((t) => t.id === id));
  const deNovo = await enviar('POST', `/api/afazeres/${id}/concluir`, { feita: true });
  conferir('mexer numa que ja foi excluida explica', deNovo.ok !== true && /n[aã]o existe/i.test(deNovo.erro), deNovo.erro);
  conferir('a lista diz se a IA esta disponivel', typeof lista.comIA === 'boolean');
} finally {
  for (const id of criadas) await json(`/api/afazeres/${id}`, { method: 'DELETE' }).catch(() => {});
}

console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
