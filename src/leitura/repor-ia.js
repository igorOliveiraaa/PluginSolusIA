// A IA olhando as ÚLTIMAS COMPRAS para decidir se vale sugerir reposição.
//
// POR QUE A CONTA NÃO BASTA
// O ritmo médio ("ele leva a cada 6 dias") não enxerga o tamanho da compra nem
// o jeito que ela acontece:
//   - levou 20 caixas na última vez: tem estoque, não precisa repor em 6 dias;
//   - comprou 3 vezes numa semana e sumiu dois meses: a média mente;
//   - vinha levando 10, depois 5, depois 2: está saindo, não esquecendo.
//
// Então o CÓDIGO faz a peneira (quem comprou há pouco nunca chega aqui - é
// trava dura, em `logica/sugestoes.js`) e a IA olha o histórico de cada
// candidato para dizer "vale sugerir?" e por quê, em português de balcão.
//
// Sem chave, sem crédito ou com erro, fica só a conta - que já é o que a loja
// tinha antes. A IA aqui só tira sugestão ruim e escreve melhor o motivo.

import { chamarGemini, configEconomica, textoDaResposta, MODELO_ECONOMICO } from './gemini.js';
import { podeUsarIAnosParecidos } from './parecidos-ia.js';

const FORMATO = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          sugerir: { type: 'boolean' },
          motivo: { type: 'string' },
        },
        required: ['numero', 'sugerir'],
      },
    },
  },
  required: ['itens'],
};

const INSTRUCOES = `Uma loja de material de limpeza esta montando o orcamento de um
cliente. Para cada produto abaixo, o cliente COMPRA COM ROTINA e ja passou do tempo
normal de repor. Olhe as ultimas compras dele e diga se vale sugerir esse produto
hoje.

DIGA "sugerir: false" quando:
- a ultima compra foi MUITO maior que as outras (ele se abasteceu e ainda tem);
- as compras vem diminuindo de tamanho (ele esta deixando de levar);
- as compras sao muito irregulares (tudo junto num mes e nada depois): a media
  nao quer dizer nada.

DIGA "sugerir: true" quando o cliente leva quantidades parecidas, de tempos em
tempos, e ja passou do tempo dele.

"motivo": UMA frase curta, em portugues de balcao, do jeito que se fala com quem
esta atendendo. Exemplos:
  "leva 2 toda semana e esta ha 23 dias sem levar"
  "comprou 20 da ultima vez, deve ter estoque ainda"
  "vinha levando 10, depois 5, depois 2 - esta saindo"
Nunca invente numero que nao esta no historico.`;

/**
 * Decide, produto a produto, se vale sugerir a reposição.
 * `itens`: [{ nome, ritmoDias, diasDesdeAUltima, compras: [{ data, quantidade }] }]
 * Devolve [{ sugerir, motivo }] na mesma ordem (vazio = a IA não respondeu).
 */
export async function valeSugerirRepor(itens) {
  if (!itens.length || !podeUsarIAnosParecidos()) return [];

  const pedido = itens.map((item, numero) => ({
    numero,
    produto: String(item.nome || '').slice(0, 60),
    compraACada: `${item.ritmoDias} dias`,
    semLevarHa: `${item.diasDesdeAUltima} dias`,
    ultimasCompras: (item.compras || []).slice(0, 6).map((c) => ({
      quando: new Date(c.data).toISOString().slice(0, 10),
      quantidade: c.quantidade,
    })),
  }));

  const dados = await chamarGemini({
    contents: [{ parts: [{ text: `${INSTRUCOES}\n\nPRODUTOS:\n${JSON.stringify(pedido)}` }] }],
    generationConfig: configEconomica({
      maximoDeResposta: 2048,
      responseMimeType: 'application/json',
      responseSchema: FORMATO,
    }),
    preferir: MODELO_ECONOMICO,
  });

  const texto = textoDaResposta(dados);
  const resposta = texto ? JSON.parse(texto) : null;

  const decisoes = itens.map(() => null);
  for (const item of resposta?.itens || []) {
    const numero = Number(item.numero);
    if (!Number.isInteger(numero) || !itens[numero]) continue;
    decisoes[numero] = {
      sugerir: item.sugerir !== false,
      motivo: String(item.motivo || '').trim().slice(0, 90),
    };
  }
  return decisoes;
}
