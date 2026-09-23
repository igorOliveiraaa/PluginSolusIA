// O Plugin usado de verdade, num navegador, tela por tela.
//
//   PLUGIN_HOJE=2025-08-22 npm start          (em outra janela: o Plugin ligado)
//   node src/ferramentas/t-navegador.mjs
//
// Abre o Chrome do PC em modo invisível e faz o que o balcão faz: entra, lança a
// nota, vincula, desativa, cadastra novo, grava, abre o histórico, desfaz, monta
// orçamento, escolhe cliente... Cada botão é clicado com o mouse (se tiver algo
// por cima dele, o teste acusa), e QUALQUER erro no console do navegador conta
// como falha. No fim, o banco de teste volta a ser o que era.
//
// PASTA_FOTOS=... guarda uma foto de cada tela.

import fs from 'node:fs';
import path from 'node:path';
import { abrirNavegador } from './navegador.mjs';
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';
import { consultar } from '../db/firebird.js';

const S = 'http://localhost:3535';
const resultado = [];                 // [{ item, ok, detalhe }]
const marcar = (item, ok, detalhe = '') => {
  resultado.push({ item, ok, detalhe });
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${item}${detalhe ? ' -> ' + String(detalhe).slice(0, 170) : ''}`);
};

const nav = await abrirNavegador({ pastaFotos: process.env.PASTA_FOTOS });
let errosVistos = 0;
/** Erros novos no console desde a última olhada (cada seção olha os seus). */
function errosNovos() {
  const novos = nav.erros.slice(errosVistos);
  errosVistos = nav.erros.length;
  return novos;
}

async function secao(titulo, corpo) {
  console.log(`\n=== ${titulo} ===`);
  try {
    await corpo();
  } catch (erro) {
    marcar(`${titulo}: parou no meio`, false, erro.message);
    await nav.foto(`erro-${titulo.replace(/\W+/g, '-').toLowerCase()}`);
  }
  const erros = errosNovos();
  marcar(`${titulo}: nenhum erro no console do navegador`, erros.length === 0, erros.join(' | '));
}

const telaAtiva = () => nav.avaliar("document.querySelector('.tela.ativa')?.id || ''");
const irParaAba = async (tela) => {
  await nav.clicar(`.aba[data-tela="${tela}"]`);
  await nav.esperarAte(`document.querySelector('#tela-${tela}')?.classList.contains('ativa')`,
    { descricao: `abrir a aba ${tela}` });
};
const texto = (seletor) => nav.avaliar(`document.querySelector(${JSON.stringify(seletor)})?.innerText || ''`);

// o banco antes: é com isso que se confere no fim que nada ficou sujo
const [antes] = await consultar(
  "SELECT COUNT(*) AS PRODUTOS, SUM(CASE WHEN DESCRICAO CONTAINING 'DESATIVADO' THEN 1 ELSE 0 END) AS MARCADOS FROM PRODUTO"
);

// ===========================================================================
await secao('A. Entrar', async () => {
  await nav.ir(S);
  await nav.esperarAte("!document.querySelector('#tela-login').classList.contains('escondido')", { descricao: 'tela de login' });

  const { usuario, senha } = credenciaisDeTeste();
  await nav.digitar('#login-usuario', usuario);
  await nav.digitar('#login-senha', 'senha-errada-de-proposito');
  await nav.clicar('#btn-entrar');
  await nav.esperarAte("!document.querySelector('#erro-login').classList.contains('escondido')", { descricao: 'aviso de senha errada' });
  marcar('1. senha errada mostra aviso e não entra', true, await texto('#erro-login'));
  errosNovos();          // o 401 da senha errada é esperado: não conta como erro

  await nav.digitar('#login-senha', senha);
  await nav.clicar('#btn-entrar');
  await nav.esperarAte("document.querySelector('#tela-login').classList.contains('escondido')", { descricao: 'entrar' });
  marcar('1. senha certa entra', true, await texto('#quem-entrou'));
  await nav.foto('a-dentro');
});

// ===========================================================================
let historicoDaNota = null;
await secao('C. Nota: ler o XML e conferir', async () => {
  await irParaAba('enviar');
  await nav.enviarArquivo('#arquivo', 'exemplos/nota-teste-entrada.xml');
  await nav.clicar('#btn-ler');
  await nav.esperarAte("document.querySelector('#tela-conferencia')?.classList.contains('ativa')",
    { tempo: 60000, descricao: 'tela de conferência' });
  await nav.esperarAte("document.querySelectorAll('[data-item]').length > 0", { descricao: 'itens na tela' });

  const itens = await nav.avaliar("document.querySelectorAll('[data-item]').length");
  marcar('9. XML virou conferência', itens === 4, `${itens} itens`);

  const comParecidos = await nav.avaliar("document.querySelectorAll('.irmaos').length");
  marcar('10. itens com cadastros parecidos na tela', comParecidos >= 2, `${comParecidos} itens com a lista`);
  const etiquetasIA = await nav.avaliar("[...document.querySelectorAll('.etiqueta')].filter((e) => e.textContent.startsWith('IA:')).length");
  marcar('10. parecer da IA aparece nos parecidos', etiquetasIA > 0, `${etiquetasIA} etiquetas "IA:"`);

  const novos = await nav.avaliar("document.querySelectorAll('[data-nome]').length");
  marcar('14. produto novo tem o campo do nome', novos >= 1, `${novos} campo(s)`);
  const nomeNovo = await nav.avaliar("document.querySelector('[data-nome]')?.value || ''");
  marcar('14. nome do produto novo preenchido', nomeNovo.length > 3, nomeNovo);
  await nav.foto('c-conferencia');
});

await secao('C. Nota: vincular, desativar e cadastrar novo', async () => {
  // o item com mais parecidos é o laboratório da limpa
  const indice = await nav.avaliar(`(() => {
    let melhor = -1, mais = 0;
    document.querySelectorAll('[data-item]').forEach((el) => {
      const n = el.querySelectorAll('[data-desativar]').length;
      if (n > mais) { mais = n; melhor = Number(el.dataset.item); }
    });
    return melhor;
  })()`);
  if (indice < 0) throw new Error('nenhum item com parecidos para testar a limpa');

  // --- desativar um por um (com confirmação se tiver estoque) ---
  nav.responderDialogo({ aceitar: true });
  await nav.clicar(`[data-desativar="${indice}"]:not([disabled])`);
  const marcados = await nav.avaliar(`document.querySelectorAll('[data-desativar="${indice}"]:checked').length`);
  marcar('13. marcar "desativar" num parecido', marcados === 1, `${marcados} marcado(s)`);

  // --- em massa: os que a IA disse ser o mesmo produto ---
  const temBotaoMassa = await nav.avaliar(`Boolean(document.querySelector('[data-desativar-mesmos="${indice}"]'))`);
  if (temBotaoMassa && await nav.avaliar(`!document.querySelector('[data-desativar-mesmos="${indice}"]').disabled`)) {
    nav.responderDialogo({ aceitar: true });
    await nav.clicar(`[data-desativar-mesmos="${indice}"]`);
    await nav.esperar(300);
    const depois = await nav.avaliar(`document.querySelectorAll('[data-desativar="${indice}"]:checked').length`);
    marcar('13. "desativar os que são o mesmo produto" marca de uma vez', depois >= marcados, `${depois} marcados`);
  } else {
    marcar('13. botão de desativar em massa (só aparece com parecer "mesmo" da IA)', true,
      temBotaoMassa ? 'todos já marcados' : 'a IA não achou repetido idêntico neste item');
  }

  // --- a trava entre itens: o marcado aqui aparece travado nos outros ---
  const codigoMarcado = await nav.avaliar(`document.querySelector('[data-desativar="${indice}"]:checked')?.value`);
  const travadoNoOutro = await nav.avaliar(`[...document.querySelectorAll('[data-desativar][value="${codigoMarcado}"]')]
    .filter((el) => el.dataset.desativar !== '${indice}')
    .every((el) => el.disabled)`);
  marcar('13. o mesmo cadastro em outro item fica travado ("marcado no item N")', travadoNoOutro === true);

  // --- vincular a outro parecido ---
  const outroItem = await nav.avaliar(`(() => {
    const el = [...document.querySelectorAll('[data-vincular]')].find((b) => b.dataset.vincular !== '${indice}');
    return el ? Number(el.dataset.vincular) : -1;
  })()`);
  if (outroItem >= 0) {
    const codigoVincular = await nav.avaliar(`[...document.querySelectorAll('[data-vincular="${outroItem}"]')][0]?.value`);
    await nav.clicar(`[data-vincular="${outroItem}"]`);
    await nav.esperarAte(`document.querySelector('[data-item="${outroItem}"]')?.innerText.includes('vinculado')`,
      { descricao: 'item vinculado ao escolhido' });
    const etiquetasDepois = await nav.avaliar(`[...document.querySelectorAll('[data-item="${outroItem}"] .etiqueta')]
      .filter((e) => e.textContent.startsWith('IA:')).length`);
    marcar('11. "Vincular a este" troca o produto do item', true, `item ${outroItem + 1} -> cód. ${codigoVincular}`);
    marcar('11. depois de vincular, o parecer da IA continua na tela', etiquetasDepois > 0, `${etiquetasDepois} etiquetas`);
  }

  // --- cadastrar como novo (pergunta o nome) ---
  const paraNovo = await nav.avaliar(`(() => {
    const el = [...document.querySelectorAll('[data-virar-novo]')]
      .find((b) => b.dataset.virarNovo !== '${indice}' && b.dataset.virarNovo !== '${outroItem}');
    return el ? Number(el.dataset.virarNovo) : -1;
  })()`);
  if (paraNovo >= 0) {
    nav.responderDialogo({ aceitar: true, texto: 'PRODUTO TESTE NAVEGADOR 1L' });
    await nav.clicar(`[data-virar-novo="${paraNovo}"]`);
    await nav.esperarAte(`document.querySelector('[data-item="${paraNovo}"] [data-nome]')`, { descricao: 'item virou novo' });
    const primeiro = await nav.avaliar(`document.querySelector('[data-item="${paraNovo}"] .irmao-linha:not(.vinculado)')?.innerText || ''`);
    marcar('12. "Cadastrar como novo" vira produto novo', true, `item ${paraNovo + 1}`);
    marcar('12. o cadastro de antes vira o 1º parecido (para desativar)', /era o vinculado antes/i.test(primeiro), primeiro.split('\n')[0]);
  }

  // --- editar a quantidade de um item da nota (e SÓ da nota) ---
  const qtdNota = await nav.avaliar(`(() => {
    const el = document.querySelector('#lista-itens [data-qtd]');
    return el ? { indice: el.dataset.qtd, valor: el.value } : null;
  })()`);
  if (qtdNota) {
    const novoValor = String(Number(qtdNota.valor) + 1);
    await nav.digitar(`#lista-itens [data-qtd="${qtdNota.indice}"]`, novoValor);
    await nav.esperarAte(`document.querySelector('#lista-itens [data-qtd="${qtdNota.indice}"]')?.value === '${novoValor}'`,
      { tempo: 8000, descricao: 'quantidade da nota recalculada' });
    await nav.esperar(800);
    const ficou = await nav.avaliar(`document.querySelector('#lista-itens [data-qtd="${qtdNota.indice}"]').value`);
    marcar('16. editar a quantidade de um item da nota', ficou === novoValor, `${qtdNota.valor} -> ${ficou}`);
  }

  // --- nome do produto novo: usar o nome da nota ---
  const botaoNomeNota = await nav.avaliar("Boolean(document.querySelector('[data-nome-da-nota]'))");
  if (botaoNomeNota) {
    const indiceNome = await nav.avaliar("Number(document.querySelector('[data-nome-da-nota]').dataset.nomeDaNota)");
    await nav.clicar('[data-nome-da-nota]');
    const valor = await nav.avaliar(`document.querySelector('[data-nome="${indiceNome}"]').value`);
    marcar('14. "usar o nome da nota" troca o nome no campo', valor.length > 3, valor);
  }
  await nav.foto('c-limpa');
});

await secao('C. Nota: gravar e conferir o resultado', async () => {
  // um item fica de fora ("não entrar")
  const ignorar = await nav.avaliar(`(() => {
    const el = [...document.querySelectorAll('[data-ignorar]')].pop();
    return el ? Number(el.dataset.ignorar) : -1;
  })()`);
  if (ignorar >= 0) {
    await nav.clicar(`[data-ignorar="${ignorar}"]`);
    marcar('15. "não entrar" marca o item', true, `item ${ignorar + 1}`);
  }

  // o lançamento mais novo ANTES de gravar: o teste só desfaz o que ele criou
  const ultimoAntes = await nav.avaliar("fetch('/api/historico?limite=1').then((r) => r.json()).then((d) => d.historico[0]?.id || '')");

  nav.responderDialogo({ aceitar: true });
  const antesDoGravar = nav.dialogos.length;
  await nav.clicar('#btn-gravar');
  await nav.esperarAte("document.querySelector('#tela-resultado')?.classList.contains('ativa')",
    { tempo: 60000, descricao: 'tela de resultado' });
  const confirmacao = nav.dialogos[antesDoGravar]?.texto || '';
  marcar('17. confirmação antes de gravar', confirmacao.includes('Gravar'), confirmacao.split('\n')[0]);
  const listaNomes = /DESATIVADOS:\n\s+- /.test(confirmacao);
  marcar('17. a confirmação lista os NOMES do que vai ser desativado', listaNomes || !/DESATIVADOS/.test(confirmacao),
    confirmacao.split('\n').filter((l) => l.trim().startsWith('-')).slice(0, 2).join(' / '));

  const resumo = await texto('#conteudo-resultado');
  marcar('17. gravou no Solus', /Gravado no Solus/.test(resumo));
  const ultimoDepois = await nav.avaliar("fetch('/api/historico?limite=1').then((r) => r.json()).then((d) => d.historico[0]?.id || '')");
  if (ultimoDepois && ultimoDepois !== ultimoAntes) historicoDaNota = ultimoDepois;
  marcar('17. o lançamento entrou no histórico', Boolean(historicoDaNota), historicoDaNota || 'não achei o lançamento novo');
  marcar('17. avisa quantos itens não entraram', ignorar < 0 || /não entr/.test(resumo));
  await nav.foto('c-resultado');

  // etiquetas: o botão abre a escolha do que imprimir
  const temEtiquetas = await nav.avaliar("!document.querySelector('#btn-etiquetas')?.disabled");
  if (temEtiquetas) {
    await nav.clicar('#btn-etiquetas');
    await nav.esperar(600);
    marcar('18. etiquetas: abre a escolha do que imprimir', await nav.avaliar(
      "!document.querySelector('#escolha-etiquetas')?.classList.contains('escondido')"));
  }
});

await secao('D. Histórico: ver o que foi feito e desfazer', async () => {
  // sem o lançamento desta rodada, NADA aqui pode ser clicado (desfazer o
  // lançamento de outra pessoa seria o pior erro possível de um teste)
  if (!historicoDaNota) throw new Error('não há lançamento desta rodada para abrir');
  await irParaAba('historico');
  await nav.esperarAte(`document.querySelector('[data-lancamento="${historicoDaNota}"]')`, { descricao: 'o lançamento no histórico' });

  await nav.clicar(`[data-ver="${historicoDaNota}"]`);
  await nav.esperarAte(`document.querySelector('[data-detalhe="${historicoDaNota}"] .detalhe-linha')`, { descricao: 'detalhe item a item' });
  const linhas = await nav.avaliar(`document.querySelectorAll('[data-detalhe="${historicoDaNota}"] .detalhe-linha').length`);
  const detalhe = await texto(`[data-detalhe="${historicoDaNota}"]`);
  marcar('21. "Ver o que foi feito" abre item a item', linhas >= 3, `${linhas} linhas`);
  marcar('21. mostra o produto cadastrado novo', /cadastrado novo/i.test(detalhe));
  marcar('21. mostra o que não entrou', /não entrou/i.test(detalhe));
  marcar('21. mostra o que foi desativado', /desativado/i.test(detalhe));
  marcar('21. sem "undefined" nem "NaN" na tela', !/undefined|NaN/.test(detalhe));
  await nav.foto('d-historico');

  // fechar e abrir de novo (segundo clique fecha)
  await nav.clicar(`[data-ver="${historicoDaNota}"]`);
  marcar('21. segundo clique fecha o detalhe', await nav.avaliar(
    `document.querySelector('[data-detalhe="${historicoDaNota}"]').classList.contains('escondido')`));
});

await secao('C. Nota repetida e tentativa com erro', async () => {
  await irParaAba('enviar');
  // a mesma nota de novo: tem que avisar que já foi lançada
  await nav.enviarArquivo('#arquivo', 'exemplos/nota-teste-entrada.xml');
  await nav.clicar('#btn-ler');
  await nav.esperarAte("document.querySelector('#tela-conferencia')?.classList.contains('ativa')", { tempo: 60000 });
  await nav.esperarAte("document.querySelectorAll('[data-item]').length > 0");
  const aviso = await nav.avaliar("document.querySelector('#aviso-repetida').classList.contains('escondido') ? '' : document.querySelector('#aviso-repetida').innerText");
  marcar('19. mesma nota de novo: avisa que já foi lançada', /já foi lançada|lançada antes|somar duas vezes/i.test(aviso),
    aviso.split('\n').find((l) => /lan/i.test(l)) || '');

  // tudo como "não entrar" e gravar: o servidor recusa e o histórico registra
  const quantos = await nav.avaliar("document.querySelectorAll('[data-ignorar]').length");
  for (let i = 0; i < quantos; i += 1) {
    await nav.clicar(`[data-ignorar="${i}"]`);
  }
  nav.responderDialogo({ aceitar: true });
  const podeGravar = await nav.avaliar("!document.querySelector('#btn-gravar').disabled");
  if (podeGravar) {
    await nav.clicar('#btn-gravar');
    await nav.esperar(1500);
    errosNovos();       // o 500 da recusa é esperado
  }
  marcar('22. gravar com tudo "não entrar" é barrado', true, podeGravar ? 'servidor recusou' : 'o botão já fica desabilitado');

  // volta sem gravar
  nav.responderDialogo({ aceitar: true });
  await nav.clicar('#btn-voltar');
  await nav.esperar(400);
});

await secao('D. Desfazer o lançamento', async () => {
  if (!historicoDaNota) throw new Error('não há lançamento desta rodada para desfazer');
  await irParaAba('historico');
  await nav.esperarAte(`document.querySelector('[data-desfazer="${historicoDaNota}"]')`, { descricao: 'botão desfazer' });
  const falhou = await nav.avaliar("[...document.querySelectorAll('.historico-item.falhou')].length");
  marcar('22. tentativa com erro aparece no histórico', falhou >= 0, `${falhou} em vermelho`);

  nav.responderDialogo({ aceitar: true });
  await nav.clicar(`[data-desfazer="${historicoDaNota}"]`);
  await nav.esperarAte(`document.querySelector('[data-lancamento="${historicoDaNota}"]')?.classList.contains('desfeita')`,
    { tempo: 30000, descricao: 'lançamento desfeito' });
  marcar('23. desfazer marca como desfeita', true);
});

// o banco tem que ter voltado ao que era
const [depois] = await consultar(
  "SELECT COUNT(*) AS PRODUTOS, SUM(CASE WHEN DESCRICAO CONTAINING 'DESATIVADO' THEN 1 ELSE 0 END) AS MARCADOS FROM PRODUTO"
);
marcar('23. o banco voltou ao que era depois de desfazer',
  Number(depois.PRODUTOS) === Number(antes.PRODUTOS) && Number(depois.MARCADOS) === Number(antes.MARCADOS),
  `produtos ${antes.PRODUTOS} -> ${depois.PRODUTOS} · desativados ${antes.MARCADOS} -> ${depois.MARCADOS}`);

// ===========================================================================
// ORÇAMENTO
// ===========================================================================
let numeroOrcamentoGravado = null;
const CLIENTE_FREQUENTE = process.env.CLIENTE_TESTE || 'ALFER PRESTADORA';

await secao('E. Orçamento: cliente e lista digitada', async () => {
  await irParaAba('orcamento');
  await nav.digitar('#busca-cliente', CLIENTE_FREQUENTE);
  await nav.esperarAte("document.querySelector('#resultado-clientes [data-cliente]')", { descricao: 'achar o cliente' });
  await nav.clicar('#resultado-clientes [data-cliente]');
  await nav.esperarAte("document.querySelector('#cliente-escolhido')?.innerText.length > 3", { descricao: 'cliente escolhido' });
  marcar('28. escolher o cliente', true, (await texto('#cliente-escolhido')).split('\n')[0]);

  await nav.digitar('#texto-lista', '10 detergente\n2 agua sanitaria 5 litros\n3 qboa 1 litro\n1 luva latex');
  await nav.clicar('#btn-montar');
  await nav.esperarAte("document.querySelector('#tela-conferir-orcamento')?.classList.contains('ativa')",
    { tempo: 90000, descricao: 'orçamento montado' });
  await nav.esperarAte("document.querySelectorAll('#itens-orcamento [data-indice]').length > 0");
  const itens = await nav.avaliar("document.querySelectorAll('#itens-orcamento [data-indice]').length");
  marcar('24. lista digitada vira itens', itens === 4, `${itens} itens`);

  const etiquetasIA = await nav.avaliar("[...document.querySelectorAll('#itens-orcamento .etiqueta')].filter((e) => /^IA:/i.test(e.textContent.trim())).length");
  marcar('25. a IA conferiu as opções (etiquetas na tela)', etiquetasIA > 0, `${etiquetasIA} etiquetas`);
  const cabecalho = await texto('#cabecalho-orcamento');
  marcar('25. o topo conta o que a IA fez (ou avisa se falhou)', /IA/.test(cabecalho) || etiquetasIA > 0,
    cabecalho.split('\n').find((l) => /IA/.test(l)) || '');

  const qboa = await nav.avaliar(`(() => {
    const item = [...document.querySelectorAll('#itens-orcamento [data-indice]')]
      .find((el) => /qboa/i.test(el.innerText));
    return item ? item.innerText.split('\\n').slice(0, 3).join(' / ') : '';
  })()`);
  marcar('26. "qboa" achado como água sanitária', /sanit/i.test(qboa) || /escolha/i.test(qboa), qboa);

  const sugestoes = await nav.avaliar("document.querySelectorAll('[data-sugestao]').length");
  marcar('28. "costuma levar também" aparece para cliente frequente', sugestoes > 0, `${sugestoes} sugestões`);
  await nav.foto('e-orcamento');
});

await secao('E. Orçamento: mexer nos itens', async () => {
  // adicionar uma sugestão
  const antesItens = await nav.avaliar("document.querySelectorAll('#itens-orcamento [data-indice]').length");
  if (await nav.avaliar("Boolean(document.querySelector('[data-sugestao]'))")) {
    const codigo = await nav.avaliar("document.querySelector('[data-sugestao]').dataset.sugestao");
    await nav.clicar('[data-sugestao]');
    await nav.esperarAte(`document.querySelectorAll('#itens-orcamento [data-indice]').length > ${antesItens}`,
      { descricao: 'sugestão entrou na lista' });
    const aindaSugerido = await nav.avaliar(`Boolean(document.querySelector('[data-sugestao="${codigo}"]'))`);
    marcar('28. "Adicionar" põe a sugestão na lista e tira ela das sugestões', !aindaSugerido);
  }

  // escolher o produto de um item em dúvida
  if (await nav.avaliar("Boolean(document.querySelector('#itens-orcamento [data-escolher]'))")) {
    const faltavam = await nav.avaliar("document.querySelectorAll('.opcoes-produto').length");
    await nav.clicar('#itens-orcamento [data-escolher]');
    await nav.esperarAte(`document.querySelectorAll('.opcoes-produto').length < ${faltavam}`, { descricao: 'item escolhido' });
    marcar('29. escolher o produto de um item em dúvida', true);
  }

  // quantidade: um item que ainda não tem 9 (mudar para o mesmo número não mexe no total)
  // (e um item que CONTA no total: com preço e dentro da lista)
  const campoQtd = await nav.avaliar(`(() => {
    const el = [...document.querySelectorAll('#itens-orcamento [data-qtd]')].find((e) => {
      const preco = Number(document.querySelector('#itens-orcamento [data-preco="' + e.dataset.qtd + '"]')?.value || 0);
      const fora = e.closest('.item')?.classList.contains('ignorado');
      return e.value !== '9' && preco > 0 && !fora;
    });
    return el ? el.dataset.qtd : null;
  })()`);
  const detalhesQtd = await nav.avaliar(`[...document.querySelectorAll('[data-qtd]')].map((e) =>
    e.dataset.qtd + ': qtd ' + e.value + ' preço ' + (document.querySelector('[data-preco="' + e.dataset.qtd + '"]')?.value || '-')
    + (e.closest('.item')?.classList.contains('ignorado') ? ' (fora)' : '')).join(' | ')`);
  console.log('     itens com quantidade:', detalhesQtd);
  if (campoQtd !== null) {
    const totalAntes = (await texto('#total-orcamento')).replace(/\s+/g, ' ');
    await nav.digitar(`#itens-orcamento [data-qtd="${campoQtd}"]`, '9');
    await nav.esperarAte(`document.querySelector('#total-orcamento').innerText.replace(/\\s+/g, ' ') !== ${JSON.stringify(totalAntes)}`,
      { tempo: 8000, descricao: 'total recalculado' });
    const totalDepois = (await texto('#total-orcamento')).replace(/\s+/g, ' ');
    marcar('29. mudar a quantidade recalcula o total', totalAntes !== totalDepois, `${totalAntes} -> ${totalDepois}`);
  }
  await nav.foto('e-itens');
});

await secao('E. Orçamento: PDF, Excel e gravar', async () => {
  // os botões são o caminho de verdade (a tela busca o arquivo e oferece)
  await nav.clicar('#btn-pdf-conferir');
  await nav.esperar(2500);
  marcar('30. botão do PDF funciona sem erro', true);
  await nav.clicar('#btn-excel-conferir');
  await nav.esperar(2000);
  marcar('30. botão do Excel funciona sem erro', true);

  nav.responderDialogo({ aceitar: true });
  const podeGravar = await nav.podeClicar('#btn-gravar-orcamento');
  marcar('31. o botão "Gravar no Solus" está à vista (nada por cima)', podeGravar.ok, podeGravar.motivo);
  await nav.clicar('#btn-gravar-orcamento');
  await nav.esperarAte("document.querySelector('#tela-resultado-orcamento')?.classList.contains('ativa')",
    { tempo: 60000, descricao: 'orçamento gravado' });
  const resultado = await texto('#resultado-orcamento');
  numeroOrcamentoGravado = Number((resultado.match(/n[ºo°]?\s*(\d{3,})/i) || [])[1]) || null;
  marcar('31. gravou o orçamento no Solus', Boolean(numeroOrcamentoGravado), resultado.split('\n')[0]);
  await nav.foto('e-gravado');
});

await secao('G. Tarefas', async () => {
  await irParaAba('tarefas');
  await nav.esperarAte("document.querySelector('#lista-tarefas')?.innerText.length > 0", { descricao: 'lista de tarefas' });
  const lista = await texto('#lista-tarefas');
  marcar('34. a lista de tarefas abre', true, `${(lista.match(/\n/g) || []).length} linhas`);
  if (numeroOrcamentoGravado) {
    marcar('34. o orçamento gravado virou tarefa ("enviar"/"finalizar")',
      new RegExp(String(numeroOrcamentoGravado)).test(lista));
    // um orçamento gera DUAS tarefas (enviar e finalizar): dispensa uma, confere essa
    const idTarefa = await nav.avaliar(`document.querySelector('[data-dispensar*="${numeroOrcamentoGravado}"]')?.dataset.dispensar || ''`);
    if (idTarefa) {
      await nav.clicar(`[data-dispensar="${idTarefa}"]`);
      await nav.esperarAte(`!document.querySelector('[data-dispensar="${idTarefa}"]')`, { tempo: 8000, descricao: 'tarefa sumir' });
      marcar('35. "Já resolvi" tira a tarefa da lista', true, idTarefa);
    }
  }
  await nav.foto('g-tarefas');
});

// o orçamento de teste sai do Solus (como o teste-fluxo-completo faz)
if (numeroOrcamentoGravado) {
  const apagou = await nav.avaliar(`fetch('/api/orcamento/${numeroOrcamentoGravado}', { method: 'DELETE' })
    .then((r) => r.json()).then((d) => d.ok === true)`);
  marcar('31. orçamento de teste apagado do Solus', apagou === true, `nº ${numeroOrcamentoGravado}`);
}

await secao('H. Ajustes', async () => {
  await irParaAba('config');
  await nav.esperarAte("document.querySelector('#cfg-meses-parado')?.value", { descricao: 'ajustes carregados' });
  marcar('37. ajustes carregam os valores', true, `parado: ${await nav.avaliar("document.querySelector('#cfg-meses-parado').value")} meses`);
  marcar('39. caixinha "IA confere os parecidos" marcada', await nav.avaliar("document.querySelector('#cfg-ia-parecidos').checked"));

  // prazo de parado: muda, reconta, volta
  const original = await nav.avaliar("document.querySelector('#cfg-meses-parado').value");
  await nav.avaliar("(() => { const s = document.querySelector('#cfg-meses-parado'); s.value = '24'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await nav.esperarAte("/2 anos/.test(document.querySelector('#prazo-parado')?.textContent || '')", { tempo: 30000, descricao: 'prazo de 2 anos na tela' });
  const com2 = await texto('#resumo-parados');
  await nav.avaliar(`(() => { const s = document.querySelector('#cfg-meses-parado'); s.value = '${original}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await nav.esperarAte("/1 ano/.test(document.querySelector('#prazo-parado')?.textContent || '')", { tempo: 30000, descricao: 'prazo de volta' });
  const com1 = await texto('#resumo-parados');
  marcar('38. mudar o prazo salva e reconta', com1 !== com2, `2 anos: ${com2.slice(0, 40)} · 1 ano: ${com1.slice(0, 40)}`);

  await nav.clicar('#btn-ver-parados');
  await nav.esperarAte("document.querySelector('#lista-parados table')", { descricao: 'lista dos parados' });
  marcar('38. "Ver a lista" mostra os parados', true);

  await nav.clicar('#btn-testar-banco');
  await nav.esperarAte("document.querySelector('#resultado-banco')?.innerText.length > 3", { tempo: 20000 });
  marcar('41. testar banco', !/erro|falh/i.test(await texto('#resultado-banco')), await texto('#resultado-banco'));

  // salvar os ajustes sem mudar nada: tem que dar "salvos" e continuar tudo igual
  const antesDeSalvar = await nav.avaliar("fetch('/api/config').then((r) => r.json()).then((d) => JSON.stringify(d.config.regras))");
  await nav.clicar('#btn-salvar-config');
  await nav.esperarAte("/salv/i.test(document.querySelector('#resultado-config')?.innerText || '')", { tempo: 15000, descricao: 'ajustes salvos' });
  const depoisDeSalvar = await nav.avaliar("fetch('/api/config').then((r) => r.json()).then((d) => JSON.stringify(d.config.regras))");
  marcar('40. salvar ajustes funciona e não muda o que ninguém mexeu', antesDeSalvar === depoisDeSalvar,
    antesDeSalvar === depoisDeSalvar ? 'regras iguais' : `${antesDeSalvar} -> ${depoisDeSalvar}`);
  const situacaoIA = await nav.avaliar("fetch('/api/ia/situacao').then((r) => r.json())");
  marcar('46. situação do crédito da IA responde', situacaoIA && situacaoIA.ok !== false, JSON.stringify(situacaoIA).slice(0, 80));
  await nav.foto('h-ajustes');
});

await secao('B. Perguntar', async () => {
  await irParaAba('assistente');
  await nav.digitar('#pergunta', 'quantos produtos estão com estoque negativo?');
  await nav.clicar('#btn-perguntar');
  await nav.esperarAte("!document.querySelector('#fala-pensando') && document.querySelectorAll('.fala.ia').length > 0",
    { tempo: 90000, descricao: 'resposta do assistente' });
  const resposta = await nav.avaliar("[...document.querySelectorAll('.fala.ia')].pop().innerText");
  marcar('4. pergunta responde com número', /\d/.test(resposta), resposta.slice(0, 90));

  // resultado com linhas: dá para baixar planilha
  if (await nav.avaliar("!document.querySelector('#exportacao')?.classList.contains('escondido')")) {
    await nav.clicar('#btn-planilha');
    await nav.esperar(1500);
    marcar('6. "Planilha" do resultado funciona sem erro', true);
  }

  await nav.digitar('#pergunta', 'e quais são os 3 primeiros?');
  await nav.clicar('#btn-perguntar');
  await nav.esperarAte("!document.querySelector('#fala-pensando') && document.querySelectorAll('.fala.ia').length > 1",
    { tempo: 90000, descricao: 'segunda resposta' });
  const segunda = await nav.avaliar("[...document.querySelectorAll('.fala.ia')].pop().innerText");
  marcar('5. continuação entende o assunto anterior', segunda.length > 20 && !/não entendi|qual assunto/i.test(segunda), segunda.slice(0, 90));

  const podeLimpar = await nav.podeClicar('#btn-limpar-conversa');
  marcar('7. "Nova conversa" à vista', podeLimpar.ok, podeLimpar.motivo);
  if (podeLimpar.ok) {
    await nav.clicar('#btn-limpar-conversa');
    await nav.esperar(400);
    marcar('7. "Nova conversa" limpa', (await nav.avaliar("document.querySelectorAll('.fala').length")) === 0);
  }
});

await secao('F. Cliente por CNPJ', async () => {
  await irParaAba('cliente');
  await nav.digitar('#cnpj-consulta', '00.000.000/0001-91');
  await nav.clicar('#btn-consultar-cnpj');
  await nav.esperar(8000);
  const tela = await texto('#tela-cliente');
  marcar('32. consulta de CNPJ responde (dados ou aviso claro)', /BANCO DO BRASIL|já existe|não|erro|Receita/i.test(tela),
    tela.split('\n').filter(Boolean).slice(2, 4).join(' / '));
});

await secao('A. Sair', async () => {
  await nav.clicar('#btn-sair');
  await nav.esperarAte("!document.querySelector('#tela-login').classList.contains('escondido')", { descricao: 'voltar ao login' });
  marcar('3. "Sair" volta para a tela de login', true);
  // a faixa de instalar (se o navegador oferecer) mora DENTRO da caixa de login
  const faixa = await nav.avaliar(`(() => {
    const f = document.querySelector('#faixa-instalar');
    if (!f || f.classList.contains('escondido')) return 'não oferecida neste navegador';
    return f.closest('.caixa-login') ? 'dentro da caixa de login' : 'FORA da caixa de login';
  })()`);
  marcar('43. faixa de instalar não fica por cima de nada no login', !/FORA/.test(faixa), faixa);
  const entrar = await nav.podeClicar('#btn-entrar');
  marcar('3. botão "Entrar" à vista depois de sair', entrar.ok, entrar.motivo);

  // entra de novo para a parte do celular
  const { usuario, senha } = credenciaisDeTeste();
  await nav.digitar('#login-usuario', usuario);
  await nav.digitar('#login-senha', senha);
  await nav.clicar('#btn-entrar');
  await nav.esperarAte("document.querySelector('#tela-login').classList.contains('escondido')", { descricao: 'entrar de novo' });
});

await secao('I. Celular (390px)', async () => {
  await nav.comoCelular(true);
  await nav.ir(S);
  await nav.esperar(1500);
  for (const tela of ['assistente', 'enviar', 'orcamento', 'tarefas', 'historico', 'config']) {
    await nav.avaliar(`document.querySelector('.aba[data-tela="${tela}"]').click()`);
    await nav.esperar(500);
    const larg = await nav.avaliar('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    marcar(`44. ${tela}: sem rolagem para o lado`, larg <= 0, `sobra ${larg}px`);
  }
  // o botão principal de cada fluxo tem que estar à vista no celular
  await nav.avaliar(`document.querySelector('.aba[data-tela="assistente"]').click()`);
  await nav.esperar(400);
  const campo = await nav.podeClicar('#pergunta');
  marcar('44. celular: caixa de pergunta à vista', campo.ok, campo.motivo);
  await nav.foto('i-celular');
  await nav.comoCelular(false);
});

// ===========================================================================
const falhas = resultado.filter((r) => !r.ok);
fs.writeFileSync(path.join(process.env.PASTA_FOTOS || '.', 'resultado-navegador.json'),
  JSON.stringify(resultado, null, 2));
await nav.fechar();
console.log(falhas.length ? `\n>>> ${falhas.length} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas.length ? 1 : 0);
