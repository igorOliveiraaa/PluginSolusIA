// O assistente que conversa sobre a loja.
//
// Como funciona: a IA NAO responde de cabeca. Ela escolhe uma das ferramentas
// abaixo, a ferramenta consulta o banco do Solus, e so entao a IA escreve a
// resposta com os numeros que voltaram. Assim ela nao inventa dado.
//
// Quase todas as ferramentas sao de LEITURA: o assistente nao altera nada na loja.
// A unica excecao e `montar_orcamento`, e mesmo ela nao grava no Solus - so deixa
// o orcamento pronto na aba Orcamento para a pessoa conferir e decidir.

import { chamarGemini, configEconomica } from '../leitura/gemini.js';
import * as consultas from './consultas.js';
import { consultaLivre, MAPA_DO_BANCO } from './sql-seguro.js';
import { FERRAMENTA_MONTAR_ORCAMENTO } from './montar-pelo-chat.js';

const MAX_RODADAS = 6;        // quantas consultas seguidas ela pode fazer numa pergunta
// Teto de tempo de UMA pergunta. Cada rodada ja tem o seu limite, mas seis
// rodadas emendadas num dia em que o Google esta cheio deixariam a pessoa
// esperando por minutos sem nenhuma resposta. Passando disso, responde com o
// que ja conseguiu apurar.
const TEMPO_DA_PERGUNTA_MS = 150000;

// ---------------------------------------------------------------------------
// As ferramentas que a IA pode usar
// ---------------------------------------------------------------------------

const texto = (descricao) => ({ type: 'string', description: descricao });
const numero = (descricao) => ({ type: 'integer', description: descricao });

const FERRAMENTAS = [
  {
    name: 'procurar_produto',
    description: 'Procura produtos pelo nome, codigo ou codigo de barras. Devolve estoque, preco de venda, custo e margem.',
    parameters: {
      type: 'object',
      properties: { termo: texto('nome, codigo ou codigo de barras'), quantos: numero('quantos trazer (ate 50)') },
      required: ['termo'],
    },
    executar: consultas.procurarProduto,
  },
  {
    name: 'ultimas_vendas_do_produto',
    description: 'Ultimas vendas de um produto: para qual cliente, quando, quanto e por qual preco. Use para "para quem vendemos isso", "quando foi a ultima venda".',
    parameters: {
      type: 'object',
      properties: { termo: texto('nome ou codigo do produto'), quantos: numero('quantas vendas') },
      required: ['termo'],
    },
    executar: consultas.ultimasVendasDoProduto,
  },
  {
    name: 'ultimas_compras_do_produto',
    description: 'Ultimas compras do produto no fornecedor: de quem a loja comprou, quando e por quanto.',
    parameters: {
      type: 'object',
      properties: { termo: texto('nome ou codigo do produto'), quantos: numero('quantas compras') },
      required: ['termo'],
    },
    executar: consultas.ultimasComprasDoProduto,
  },
  {
    name: 'historico_de_preco',
    description: 'Como o preco de venda do produto mudou ao longo do tempo: data, quem alterou, preco antes e depois.',
    parameters: {
      type: 'object',
      properties: { termo: texto('nome ou codigo do produto'), quantos: numero('quantas alteracoes') },
      required: ['termo'],
    },
    executar: consultas.historicoDePreco,
  },
  {
    name: 'ultima_venda_para_cliente',
    description: 'Quando um cliente levou um produto e por quanto pagou. Use para "quanto o fulano pagou nisso da ultima vez". '
      + 'Procura em TODOS os cadastros com aquele nome (a mesma rede tem varios CNPJs, um por cidade) '
      + 'e diz de qual deles foi cada compra. Em item vendido por metro quadrado (tapete personalizado) '
      + 'devolve tambem os metros e o preco do m2.',
    parameters: {
      type: 'object',
      properties: {
        termo: texto('nome ou codigo do produto'),
        cliente: texto('nome ou codigo do cliente'),
        quantos: numero('quantas vezes listar'),
      },
      required: ['termo', 'cliente'],
    },
    executar: consultas.ultimaVendaParaCliente,
  },
  {
    name: 'compras_do_cliente',
    description: 'O que um cliente comprou, com data, quantidade e preco pago. '
      + 'Procura em todos os cadastros com aquele nome e diz de qual cidade/CNPJ foi cada compra.',
    parameters: {
      type: 'object',
      properties: { cliente: texto('nome ou codigo do cliente'), quantos: numero('quantos itens') },
      required: ['cliente'],
    },
    executar: consultas.comprasDoCliente,
  },
  {
    name: 'desde_quando_tem_o_produto',
    description: 'Desde quando a loja trabalha com o produto (primeira compra e primeira venda registradas).',
    parameters: {
      type: 'object',
      properties: { termo: texto('nome ou codigo do produto') },
      required: ['termo'],
    },
    executar: consultas.desdeQuandoTemOProduto,
  },
  {
    name: 'produtos_com_estoque_ruim',
    description: 'Produtos zerados ou com estoque negativo. Estoque negativo indica erro de lancamento.',
    parameters: {
      type: 'object',
      properties: {
        quantos: numero('quantos listar'),
        apenasNegativo: { type: 'boolean', description: 'true = so os negativos' },
      },
    },
    executar: consultas.produtosComEstoqueRuim,
  },
  {
    name: 'mais_vendidos',
    description: 'Produtos que mais venderam num periodo, por quantidade e valor.',
    parameters: {
      type: 'object',
      properties: { dias: numero('periodo em dias'), quantos: numero('quantos listar') },
    },
    executar: consultas.maisVendidos,
  },
  {
    name: 'melhores_clientes',
    description: 'Clientes que mais compraram num periodo.',
    parameters: {
      type: 'object',
      properties: { dias: numero('periodo em dias'), quantos: numero('quantos listar') },
    },
    executar: consultas.melhoresClientes,
  },
  {
    name: 'produtos_parados',
    description: 'Produtos que tem estoque mas nao vendem ha muito tempo (dinheiro parado na prateleira).',
    parameters: {
      type: 'object',
      properties: { dias: numero('sem vender ha quantos dias'), quantos: numero('quantos listar') },
    },
    executar: consultas.produtosParados,
  },
  {
    name: 'produtos_repetidos',
    description: 'Produtos cadastrados mais de uma vez com o mesmo nome.',
    parameters: { type: 'object', properties: { quantos: numero('quantos listar') } },
    executar: consultas.produtosRepetidos,
  },
  {
    name: 'lucro_do_periodo',
    description: 'Quanto a loja lucrou num periodo: faturamento, custo da mercadoria, '
      + 'lucro bruto, margem, o que deu mais lucro e o que saiu ABAIXO do custo. '
      + 'Use para "qual foi meu lucro", "quanto lucrei no mes passado", "deu lucro?". '
      + 'Passe mes+ano para um mes fechado, ou dias para um periodo corrido.',
    parameters: {
      type: 'object',
      properties: {
        dias: numero('periodo corrido em dias (padrao 30)'),
        mes: numero('mes fechado, 1 a 12'),
        ano: numero('ano do mes fechado'),
        quantos: numero('quantos produtos listar'),
      },
    },
    executar: consultas.lucroDoPeriodo,
  },
  {
    name: 'resumo_da_loja',
    description: 'Numeros gerais: quantos produtos, clientes, fornecedores, vendas dos ultimos 30 dias.',
    parameters: { type: 'object', properties: {} },
    executar: consultas.resumoDaLoja,
  },
  {
    name: 'consulta_livre',
    description: 'Para perguntas que as outras ferramentas nao respondem. Monte uma consulta SQL de LEITURA (SELECT) no banco Firebird do Solus. So use quando nenhuma outra ferramenta servir.',
    parameters: {
      type: 'object',
      properties: {
        sql: texto('a consulta SELECT, seguindo o mapa do banco'),
        explicacao: texto('em uma frase, o que essa consulta busca'),
      },
      required: ['sql'],
    },
    executar: consultaLivre,
  },

  // a unica que FAZ algo (e mesmo assim nao grava no Solus)
  FERRAMENTA_MONTAR_ORCAMENTO,
];

const PELO_NOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));

// formato que o Gemini espera (sem o campo "executar", que e so nosso)
const DECLARACOES = FERRAMENTAS.map(({ name, description, parameters }) => ({
  name, description, parameters,
}));

// ---------------------------------------------------------------------------

function instrucoes(operador) {
  return `Voce e o assistente do Plugin IA Solus, dentro de uma loja de material de
limpeza e utilidades no interior de Sao Paulo. Quem esta falando com voce e
${operador?.nome || 'um funcionario da loja'}.

COMO VOCE TRABALHA:
- Voce NUNCA responde numero de cabeca. Sempre use uma ferramenta para buscar no
  sistema e responda com o que voltou.
- Se a pergunta for ambigua (ex.: existem varios produtos com nome parecido),
  mostre as opcoes e pergunte qual e, em vez de escolher sozinho.
- Se a ferramenta nao achar nada, diga isso com todas as letras. Nunca invente.
- Pode usar varias ferramentas seguidas para responder uma pergunta so.

QUANDO PEDIREM UM ORCAMENTO ("faz um orcamento de...", "monta pro fulano..."):
- Use a ferramenta montar_orcamento. Copie os itens do jeito que a pessoa pediu,
  um por linha, com a quantidade na frente. Nunca invente item nem quantidade.
- Se a pessoa nao disser a quantidade de algum item, PERGUNTE antes de montar.
- Se a ferramenta devolver "precisaEscolherCliente", mostre os clientes achados e
  pergunte qual e. Nao escolha por conta propria.
- Depois de montar, responda curto: o total, quantos itens ficaram esperando
  escolha, e diga para abrir a aba Orcamento e conferir. Deixe claro que
  NADA foi gravado no Solus: gravar e sempre a pessoa quem faz.
- Nunca prometa que gravou, faturou ou emitiu nota. Voce nao faz nada disso.

CLIENTE COM VARIOS CNPJs (acontece direto nesta loja):
- A mesma rede tem um cadastro por cidade. As consultas ja olham em TODOS.
- Na resposta, diga de QUAL cidade/CNPJ foi cada compra. Nunca junte tudo como
  se fosse um cliente so, e nunca diga "nunca comprou" sem olhar todos.

QUANDO PERGUNTAREM DE LUCRO:
- Use lucro_do_periodo. O numero que volta e LUCRO BRUTO: venda menos o custo da
  mercadoria. DIGA ISSO com todas as letras na resposta, e diga que NAO estao
  descontados imposto, aluguel, folha, taxa de cartao e as outras despesas.
  Se a pessoa achar que e o que sobrou no bolso, a conta dela vai sair errada.
- Mostre faturamento, custo, lucro bruto e margem. Se vier avisoDeConfianca,
  repita esse aviso.
- Se houver produto vendido ABAIXO do custo, avise: e dinheiro saindo.

TAPETE E O QUE E VENDIDO POR METRO QUADRADO:
- A venda fica gravada como a PECA inteira ("TAPETE PERSONALIZADO KAPAZI 3.70 X
  2.10" por R$ 2.952,60). O numero que interessa para orcar e o do METRO: a
  consulta ja devolve em precoPorMetroQuadrado.
- Responda sempre os dois: o valor da peca E o valor do m2, com a medida.
- Se o m2 de uma venda estiver diferente do preco de tabela de hoje, diga isso.

COMO VOCE ESCREVE:
- Em portugues do Brasil, simples e direto, como quem trabalha no balcao.
  Quem le nao e tecnico: nada de jargao de banco de dados.
- Valores em reais no formato R$ 12,90. Datas como 05/09/2025.
- Resposta curta. Se forem varios itens, use lista ou tabela em markdown.
- Seja simpatico e leve, mas sem enrolacao: primeiro a resposta, depois o detalhe.
- Quando notar algo que merece atencao (estoque negativo, produto parado,
  margem baixa, preco abaixo do custo), comente em uma linha no fim.

SOBRE O DINHEIRO DA LOJA:
${operador?.permissoes?.verCusto
    ? '- Esse usuario PODE ver custo e margem.'
    : '- Esse usuario NAO pode ver custo nem margem. Nao mostre custo, margem nem lucro. Se perguntarem, diga que o usuario dele nao tem essa permissao no Solus.'}

MAPA DO BANCO (para a ferramenta consulta_livre):
${MAPA_DO_BANCO}

Hoje e ${new Date().toLocaleDateString('pt-BR')}.`;
}

/** Chama o Gemini (com nova tentativa e modelo reserva, ver leitura/gemini.js). */
function chamarIA({ conteudos, operador }) {
  return chamarGemini({
    systemInstruction: { parts: [{ text: instrucoes(operador) }] },
    contents: conteudos,
    tools: [{ functionDeclarations: DECLARACOES }],
    // 'pensar' pouco: o suficiente para escolher a consulta certa, sem gastar a toa
    generationConfig: configEconomica({ temperature: 0.2, pensar: 512, maximoDeResposta: 2048 }),
    // cada rodada da conversa e diferente da anterior: guardar nao ajudaria
  }, { lembrar: false });
}

/**
 * Responde uma pergunta.
 * `historico` e a conversa anterior, para ela entender "e do mes passado?".
 * Devolve tambem os dados crus das consultas, para virar planilha ou PDF depois.
 */
export async function perguntar({ pergunta, historico = [], operador }) {
  const conteudos = [
    ...historico.map((m) => ({ role: m.papel === 'ia' ? 'model' : 'user', parts: [{ text: m.texto }] })),
    { role: 'user', parts: [{ text: String(pergunta) }] },
  ];

  const consultasFeitas = [];
  const comecou = Date.now();

  for (let rodada = 0; rodada < MAX_RODADAS; rodada += 1) {
    if (Date.now() - comecou > TEMPO_DA_PERGUNTA_MS) break;
    const dados = await chamarIA({ conteudos, operador });
    const partes = dados?.candidates?.[0]?.content?.parts || [];

    const chamadas = partes.filter((p) => p.functionCall).map((p) => p.functionCall);

    // sem chamada de ferramenta = e a resposta final
    if (!chamadas.length) {
      const resposta = partes.map((p) => p.text).filter(Boolean).join('\n').trim();
      return {
        resposta: resposta || 'Nao consegui montar uma resposta para isso.',
        consultas: consultasFeitas,
        dadosParaExportar: escolherDadosParaExportar(consultasFeitas),
        orcamentoMontado: orcamentoQueFoiMontado(consultasFeitas),
      };
    }

    // roda as ferramentas pedidas
    // Devolve a fala do modelo EXATAMENTE como veio. Os Gemini novos mandam uma
    // "thoughtSignature" junto de cada chamada de ferramenta e recusam a conversa
    // (erro 400) se ela nao voltar. Remontar as partes na mao perdia essa assinatura.
    conteudos.push({ role: 'model', parts: partes });

    const respostasDasFerramentas = [];
    for (const chamada of chamadas) {
      const ferramenta = PELO_NOME.get(chamada.name);
      let resultado;

      if (!ferramenta) {
        resultado = { erro: `Ferramenta ${chamada.name} nao existe.` };
      } else {
        try {
          resultado = await ferramenta.executar(chamada.args || {}, { operador });
        } catch (erro) {
          resultado = { erro: erro.message };
        }
      }

      consultasFeitas.push({ ferramenta: chamada.name, argumentos: chamada.args || {}, resultado });
      respostasDasFerramentas.push({
        functionResponse: { name: chamada.name, response: { resultado } },
      });
    }

    conteudos.push({ role: 'user', parts: respostasDasFerramentas });
  }

  const demorou = Date.now() - comecou > TEMPO_DA_PERGUNTA_MS;
  return {
    resposta: demorou
      ? 'A IA esta demorando demais agora (o servico do Google costuma estar cheio nesse horario). '
        + 'Tente de novo em um minuto, ou pergunte de um jeito mais direto.'
      : 'Essa pergunta ficou complicada demais e precisei parar no meio. Tente perguntar de um jeito mais direto.',
    consultas: consultasFeitas,
    dadosParaExportar: escolherDadosParaExportar(consultasFeitas),
    orcamentoMontado: orcamentoQueFoiMontado(consultasFeitas),
  };
}

/**
 * Escolhe, entre tudo que foi consultado, a lista mais "cheia" - e ela que vira
 * a planilha ou o PDF quando a pessoa clica em exportar.
 */
function escolherDadosParaExportar(consultasFeitas) {
  let melhor = null;

  for (const consulta of consultasFeitas) {
    const resultado = consulta.resultado || {};
    // procura o primeiro campo que seja uma lista de objetos
    for (const [campo, valor] of Object.entries(resultado)) {
      if (!Array.isArray(valor) || !valor.length) continue;
      if (typeof valor[0] !== 'object') continue;
      if (!melhor || valor.length > melhor.linhas.length) {
        melhor = { origem: consulta.ferramenta, campo, linhas: valor };
      }
    }
  }

  return melhor;
}

export { FERRAMENTAS };

/**
 * Se a IA montou um orcamento nesta pergunta, devolve o codigo dele.
 * E o que faz aparecer o botao "Abrir o orcamento" embaixo da resposta.
 */
function orcamentoQueFoiMontado(consultasFeitas) {
  for (let i = consultasFeitas.length - 1; i >= 0; i -= 1) {
    const feita = consultasFeitas[i];
    if (feita.ferramenta !== 'montar_orcamento') continue;
    const r = feita.resultado || {};
    if (!r.id) continue;
    return {
      id: r.id,
      cliente: r.cliente,
      total: r.total,
      quantidadeItens: (r.itens || []).length,
      itensParaEscolher: r.itensParaEscolher || 0,
    };
  }
  return null;
}
