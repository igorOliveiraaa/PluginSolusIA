// A IA conferindo os cadastros parecidos.
//
// POR QUE EXISTE
// A busca por texto (`db/catalogo.js`) acha "nome parecido" contando palavras.
// Ela erra nos dois sentidos: "DET. YPÊ 500" e "DETERGENTE YPE 500ML" são o MESMO
// produto e ela dá pouca semelhança; "ÁGUA SANITÁRIA 1L" e "ÁGUA SANITÁRIA 5L" são
// produtos DIFERENTES e ela dá 100%. Quem sabe ler isso é a IA.
//
// COMO FUNCIONA (e por que é barato)
//   1. o código continua fazendo a peneira: o índice do catálogo escolhe os
//      candidatos (rápido e de graça);
//   2. a IA entra UMA vez por nota (em blocos), só para CLASSIFICAR o que já foi
//      escolhido: cada candidato é "o mesmo produto", "variação" ou "outro";
//   3. o código usa isso para ordenar, explicar na tela e avisar quando o vínculo
//      parece errado. **A IA não escolhe nada e não grava nada** - quem decide é
//      quem está conferindo a nota.
//
// Se não houver chave, se acabar o crédito ou se a IA demorar, tudo continua
// funcionando do jeito de antes (só com o texto). Nada aqui pode derrubar a nota.

import { chamarGemini, configEconomica, textoDaResposta, MODELO_ECONOMICO } from './gemini.js';
import { carregarConfig } from '../config.js';

const ITENS_POR_CHAMADA = 8;        // no maximo; o bloco encolhe para caber numa leva de 4 (ver abaixo)
const CANDIDATOS_POR_ITEM = 6;

const FORMATO = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          avaliacoes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                codigo: { type: 'string' },
                relacao: { type: 'string', enum: ['mesmo', 'variacao', 'outro'] },
                motivo: { type: 'string' },
              },
              required: ['codigo', 'relacao'],
            },
          },
        },
        required: ['numero', 'avaliacoes'],
      },
    },
  },
  required: ['itens'],
};

const ABERTURA = {
  nota: 'Para cada ITEM que chegou na nota do fornecedor, diga o que cada CADASTRO da loja e:',
  pedido: 'Para cada ITEM que o cliente PEDIU, diga o que cada CADASTRO da loja e:',
};

const INSTRUCOES = `Voce trabalha no estoque de uma loja de material de limpeza e descartaveis.
{ABERTURA}

- "mesmo": e o mesmo produto. Abreviacao, acento, erro de digitacao, ordem das
  palavras e marca escrita diferente NAO mudam nada:
  "DET. YPE 500" e "DETERGENTE YPE 500ML" sao o mesmo produto.
- "variacao": mesma familia de produto, mas algo diferente: outro tamanho/volume
  (1L x 5L), outra quantidade na embalagem (C/12 x C/24), outro perfume, outra
  cor, outra marca, outro material (rodo de madeira x rodo de plastico), outro
  tamanho de roupa/luva.
- "outro": e outra coisa mesmo, de outra categoria (vassoura x detergente).
  Na duvida entre "variacao" e "outro", escolha "variacao".

DECIDA NESTA ORDEM, uma pergunta de cada vez:
1) E o MESMO TIPO de produto? (agua sanitaria x alcool = tipos diferentes,
   detergente x desinfetante = tipos diferentes, papel higienico x papel toalha
   = tipos diferentes). Se NAO for o mesmo tipo, responda "outro" e pare aqui -
   nao importa se o tamanho, o volume ou a marca forem iguais.
   ATENCAO: detalhe a mais no nome do cadastro NAO muda o tipo. "PAPEL TOALHA
   INTERFOLHA", "PAPEL TOALHA BOBINA" e "PAPEL TOALHA SOCIAL" sao todos papel
   toalha para um pedido de "papel toalha". So e "outro" quando o cadastro e
   OUTRA COISA: um acessorio ou aparelho para aquele produto ("DISPENSER PAPEL
   TOALHA", "SUPORTE PARA RODO", "REFIL DE MOP") nao e o produto em si.
2) Sendo o mesmo tipo: tamanho, volume, quantidade na embalagem, marca, cor ou
   material sao diferentes? Entao "variacao".
3) So se passar pelas duas: "mesmo".

REGRAS QUE NAO PODEM SER QUEBRADAS:
- Tamanho/volume/quantidade DIFERENTE nunca e "mesmo", e sempre "variacao".
  1L nao e 5L. C/12 nao e C/24. 180g nao e 200g.
- O que o PEDIDO nao disser, nao conta contra o cadastro. Pedido generico
  ("porta filtro", "botina usafe") casa com o cadastro detalhado do mesmo tipo
  ("PORTA FILTRO CAFE 103", "BOTINA USAFE BICO PVC"): isso e "mesmo".
  So e "variacao" quando o pedido DIZ uma coisa e o cadastro diz outra.
- Marca diferente nunca e "mesmo". MAS se o pedido nao disser a marca
  ("agua sanitaria 5 litros"), qualquer marca daquele tamanho e "mesmo".
- Nome popular conta como o mesmo produto, e ele diz o TIPO:
  "qboa" e agua sanitaria (nao e alcool), "bombril" e la de aco,
  "veja" e limpador multiuso, "pinho sol" e desinfetante.
- Produto sem tamanho escrito em nenhum dos dois lados pode ser "mesmo".
- Use SOMENTE os codigos que eu mandei. Nao invente cadastro nem codigo.
- "motivo" em portugues simples, no maximo 6 palavras ("mesma marca e tamanho",
  "5 litros contra 1 litro").
- Responda TODOS os itens e TODOS os cadastros de cada item.`;

/** O que vai para a IA: o texto pedido + os cadastros candidatos daquele item. */
function montarPedido(itens) {
  return itens.map((item, numero) => ({
    numero,
    item: String(item.descricaoNaNota || '').slice(0, 90),
    unidade: item.unidadeDaNota || '',
    cadastros: (item.candidatos || []).slice(0, CANDIDATOS_POR_ITEM).map((c) => ({
      codigo: String(c.codigo),
      nome: String(c.descricao || '').slice(0, 90),
      unidade: c.unidade || '',
    })),
  })).filter((i) => i.cadastros.length);
}

async function classificarBloco(bloco, origem = 'nota') {
  const pedido = montarPedido(bloco);
  if (!pedido.length) return new Map();

  const instrucoes = INSTRUCOES.replace('{ABERTURA}', ABERTURA[origem] || ABERTURA.nota);
  const dados = await chamarGemini({
    contents: [{ parts: [{ text: `${instrucoes}\n\nITENS:\n${JSON.stringify(pedido)}` }] }],
    generationConfig: configEconomica({
      maximoDeResposta: 8192,
      responseMimeType: 'application/json',
      responseSchema: FORMATO,
    }),
  });

  const texto = textoDaResposta(dados);
  const resposta = texto ? JSON.parse(texto) : null;

  // numero do item -> (codigo do cadastro -> { relacao, motivo })
  const porItem = new Map();
  for (const avaliado of resposta?.itens || []) {
    const numero = Number(avaliado.numero);
    if (!Number.isInteger(numero) || !bloco[numero]) continue;
    const porCodigo = new Map();
    for (const nota of avaliado.avaliacoes || []) {
      const codigo = String(nota.codigo || '').trim();
      if (!codigo) continue;
      porCodigo.set(codigo, {
        relacao: ['mesmo', 'variacao', 'outro'].includes(nota.relacao) ? nota.relacao : 'variacao',
        motivo: String(nota.motivo || '').slice(0, 60),
      });
    }
    porItem.set(numero, porCodigo);
  }
  return porItem;
}

// ---------------------------------------------------------------------------
// O parecer da IA, lembrado: cada par (pedido, produto) é julgado UMA vez
// ---------------------------------------------------------------------------
//
// Sem temperatura zero, a mesma pergunta em contexto diferente podia ter
// resposta diferente: "papel toalha" x "PAPEL TOALHA INTERFOLHA" saía "o mesmo"
// com o cliente escolhido antes e "outro" com ele escolhido depois - e o
// orçamento mudava. Guardando o parecer, a resposta fica a mesma o dia inteiro
// (e a IA é paga uma vez só por par).
const PARECERES = new Map();                 // chave -> { relacao, motivo, quando }
const VALIDADE_DO_PARECER_MS = 12 * 60 * 60 * 1000;
const MAXIMO_DE_PARECERES = 20000;

const semAcentoMinusculo = (texto) => String(texto || '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const chaveDoParecer = (origem, pedido, codigo) => `${origem}|${semAcentoMinusculo(pedido)}|${codigo}`;

function parecerGuardado(origem, pedido, codigo) {
  const guardado = PARECERES.get(chaveDoParecer(origem, pedido, codigo));
  if (!guardado) return null;
  if (Date.now() - guardado.quando > VALIDADE_DO_PARECER_MS) return null;
  return { relacao: guardado.relacao, motivo: guardado.motivo };
}

function guardarParecer(origem, pedido, codigo, parecer) {
  if (PARECERES.size >= MAXIMO_DE_PARECERES) {
    // cheio: sai o mais antigo (o Map guarda na ordem em que entrou)
    PARECERES.delete(PARECERES.keys().next().value);
  }
  PARECERES.set(chaveDoParecer(origem, pedido, codigo), { ...parecer, quando: Date.now() });
}

/** Para os testes: começar sem nada lembrado. */
export function esquecerPareceres() {
  PARECERES.clear();
}

/**
 * Classifica os parecidos de vários itens de uma vez.
 * `itens`: [{ descricaoNaNota, unidadeDaNota, candidatos: [{codigo, descricao, unidade}] }]
 * Devolve: [Map(codigo -> { relacao, motivo })] na mesma ordem (Map vazio = sem resposta).
 */
export async function classificarParecidos(itens, origem = 'nota') {
  const resultado = itens.map(() => new Map());
  if (!itens.length) return resultado;

  // o que já foi julgado não volta para a IA; só vai o que falta
  const faltam = [];
  itens.forEach((item, posicao) => {
    const desconhecidos = [];
    for (const candidato of (item.candidatos || []).slice(0, CANDIDATOS_POR_ITEM)) {
      const parecer = parecerGuardado(origem, item.descricaoNaNota, candidato.codigo);
      if (parecer) resultado[posicao].set(String(candidato.codigo), parecer);
      else desconhecidos.push(candidato);
    }
    if (desconhecidos.length) faltam.push({ posicao, item: { ...item, candidatos: desconhecidos } });
  });
  if (!faltam.length) return resultado;

  // os blocos vao JUNTOS, nao em fila: numa nota de 60 itens a espera caiu de
  // 14s para 7s. Quatro ao mesmo tempo (mais que isso comeca a tomar limite).
  // o tamanho do bloco se ajusta para caber tudo em UMA leva de 4 chamadas
  // (20 itens = 4 blocos de 5, todos de uma vez); só nota grande passa de uma leva
  const porBloco = Math.min(ITENS_POR_CHAMADA, Math.max(3, Math.ceil(faltam.length / 4)));
  const blocos = [];
  for (let inicio = 0; inicio < faltam.length; inicio += porBloco) {
    blocos.push({ inicio, faltam: faltam.slice(inicio, inicio + porBloco) });
  }

  let erros = 0;
  let ultimoErro = null;

  for (let i = 0; i < blocos.length; i += 4) {
    const juntos = blocos.slice(i, i + 4);
    // allSettled: um bloco que falha (resposta cortada, limite de tempo) nao
    // apaga o trabalho dos outros - a nota fica conferida em parte
    const respostas = await Promise.allSettled(
      juntos.map((b) => classificarBloco(b.faltam.map((f) => f.item), origem))
    );
    respostas.forEach((resposta, ordem) => {
      if (resposta.status !== 'fulfilled') {
        erros += 1;
        ultimoErro = resposta.reason;
        return;
      }
      for (const [numero, avaliacoes] of resposta.value) {
        const falta = juntos[ordem].faltam[numero];
        if (!falta) continue;
        for (const [codigo, parecer] of avaliacoes) {
          resultado[falta.posicao].set(codigo, parecer);
          guardarParecer(origem, falta.item.descricaoNaNota, codigo, parecer);
        }
      }
    });
  }

  // todos falharam E não havia nada lembrado: quem chamou precisa saber (a tela
  // avisa que a comparação foi só por texto)
  const temAlgum = resultado.some((mapa) => mapa.size);
  if (erros === blocos.length && !temAlgum) throw ultimoErro || new Error('a IA nao respondeu');
  return resultado;
}

// ---------------------------------------------------------------------------
// "Não achei nada": a IA diz de que outro jeito a loja chamaria isso
// ---------------------------------------------------------------------------

const FORMATO_NOMES = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          nomes: { type: 'array', items: { type: 'string' } },
        },
        required: ['numero', 'nomes'],
      },
    },
  },
  required: ['itens'],
};

const INSTRUCOES_NOMES = `Uma loja de material de limpeza e descartaveis procurou no
estoque o que o cliente pediu e NAO achou nada. Quase sempre e porque o cliente usou
o nome popular ou a marca, e a loja cadastrou de outro jeito.

Para cada pedido, escreva ate 3 outros nomes com que o mesmo produto poderia estar
cadastrado. Exemplos:
  "qboa 5 litros"      -> ["agua sanitaria 5 litros", "cloro 5 litros"]
  "bombril"            -> ["la de aco", "esponja de aco"]
  "veja multiuso"      -> ["limpador multiuso", "limpa tudo"]
  "papel toalha"       -> ["papel toalha interfolha", "bobina papel toalha"]

REGRAS:
- So o nome do produto, sem quantidade e sem preco.
- NAO mude o tamanho nem o volume que o cliente pediu: mantenha "5 litros".
- Se nao souber de outro nome, devolva uma lista vazia. NAO invente produto.`;

/**
 * Outros nomes para procurar de novo no catálogo.
 * `pedidos`: ["qboa 5 litros", ...] → [["agua sanitaria 5 litros", ...], ...]
 */
export async function outrosNomesDoProduto(pedidos) {
  const lista = pedidos.map((texto, numero) => ({ numero, pedido: String(texto || '').slice(0, 90) }))
    .filter((p) => p.pedido.length >= 3);
  if (!lista.length) return pedidos.map(() => []);

  const dados = await chamarGemini({
    contents: [{ parts: [{ text: `${INSTRUCOES_NOMES}\n\nPEDIDOS:\n${JSON.stringify(lista)}` }] }],
    generationConfig: configEconomica({
      maximoDeResposta: 2048,
      responseMimeType: 'application/json',
      responseSchema: FORMATO_NOMES,
    }),
    // tarefa pequena: o modelo mais barato da conta
    preferir: MODELO_ECONOMICO,
  });

  const texto = textoDaResposta(dados);
  const resposta = texto ? JSON.parse(texto) : null;

  const porItem = pedidos.map(() => []);
  for (const item of resposta?.itens || []) {
    const numero = Number(item.numero);
    if (!Number.isInteger(numero) || !pedidos[numero]) continue;
    porItem[numero] = (item.nomes || [])
      .map((n) => String(n || '').trim())
      .filter((n) => n.length >= 3)
      .slice(0, 3);
  }
  return porItem;
}

// ---------------------------------------------------------------------------
// O nome do produto novo, no padrão da loja
// ---------------------------------------------------------------------------

const FORMATO_NOME = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          nome: { type: 'string' },
        },
        required: ['numero', 'nome'],
      },
    },
  },
  required: ['itens'],
};

const INSTRUCOES_NOME = `O fornecedor escreve o nome do produto abreviado e sujo
("SAB.PO OMO LAV.PERF 1,6KG"). Esse nome vai virar cadastro numa loja de material de
limpeza, e e ele que aparece na etiqueta da prateleira, no orcamento do cliente e na
busca de quem atende.

Reescreva cada nome no MESMO padrao dos cadastros que a loja ja tem (eu mando exemplos).

REGRAS:
- So reescreva o que ja esta ali: abra abreviacao, arrume espacos e a ordem das
  palavras. NAO invente marca, tamanho nem detalhe.
- NAO pode sobrar ponto de abreviacao no nome:
  "SAB.PO" -> "SABAO EM PO", "LAV.PERF" -> "LAVAGEM PERFEITA",
  "F.DUPLA" -> "FOLHA DUPLA", "TAM.G" -> "TAMANHO G", "DET.LIQ" -> "DETERGENTE LIQUIDO".
  Ponto so continua dentro de numero (1,6KG) e em "C/" de quantidade (C/24).
- MANTENHA marca, tamanho, volume, peso e quantidade exatamente como vieram
  (1,6KG continua 1,6KG; C/12 continua C/12).
- Sem acento e TUDO EM MAIUSCULA, do jeito dos exemplos.
- No maximo 60 letras.
- Se o nome da nota ja estiver bom, devolva ele mesmo.`;

/**
 * Nome no padrão da loja para produtos que vão ser cadastrados.
 * `pedidos`: [{ nomeNaNota, exemplos: ['NOME DE CADASTRO DA LOJA', ...] }]
 * Devolve um array de nomes (string vazia quando não houver sugestão).
 */
export async function nomePadraoDaLoja(pedidos) {
  const lista = pedidos
    .map((p, numero) => ({
      numero,
      nomeNaNota: String(p.nomeNaNota || '').slice(0, 90),
      exemplosDaLoja: (p.exemplos || []).slice(0, 6).map((e) => String(e).slice(0, 70)),
    }))
    .filter((p) => p.nomeNaNota.length >= 3);
  if (!lista.length) return pedidos.map(() => '');

  const dados = await chamarGemini({
    contents: [{ parts: [{ text: `${INSTRUCOES_NOME}\n\nPRODUTOS:\n${JSON.stringify(lista)}` }] }],
    generationConfig: configEconomica({
      maximoDeResposta: 2048,
      responseMimeType: 'application/json',
      responseSchema: FORMATO_NOME,
    }),
    preferir: MODELO_ECONOMICO,
  });

  const texto = textoDaResposta(dados);
  const resposta = texto ? JSON.parse(texto) : null;

  const nomes = pedidos.map(() => '');
  for (const item of resposta?.itens || []) {
    const numero = Number(item.numero);
    if (!Number.isInteger(numero) || !pedidos[numero]) continue;
    const sugerido = String(item.nome || '').trim().toUpperCase().slice(0, 70);
    // a IA sugere, o CODIGO confere: nome que perdeu medida nao entra
    nomes[numero] = manteveOsNumeros(pedidos[numero].nomeNaNota, sugerido) ? sugerido : '';
  }
  return nomes;
}

/**
 * O nome novo manteve todos os números do original?
 *
 * É a trava que impede o pior erro: "DET.LIQ YPE NEUTRO 500ML CX C/24" voltar
 * como "DETERGENTE LIQUIDO YPE NEUTRO CX C/24" - sem o 500ML. Cadastro sem
 * volume some da busca e vira etiqueta errada na prateleira. Perdeu número,
 * a sugestão é descartada e fica o nome da nota.
 */
export function manteveOsNumeros(original, sugerido) {
  if (!sugerido) return false;
  const numerosDe = (texto) => (String(texto).match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => n.replace(',', '.'));
  const noNovo = numerosDe(sugerido);
  return numerosDe(original).every((numero) => noNovo.includes(numero));
}

/** A IA de conferência está ligada e tem chave? (Ajustes pode desligar.) */
export function podeUsarIAnosParecidos(cfg = carregarConfig()) {
  if (cfg.ia?.conferirParecidos === false) return false;
  return Boolean(cfg.ia?.chave || cfg.ia?.chaveGemini);
}
