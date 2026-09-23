// A resposta da Sefaz explicada em português de gente.
//
// O Solus guarda o texto cru que veio da Receita:
//   "Rejeicao: 610 - Total da NF difere do somatorio dos valores compõe o valor total"
// Quem está no balcão lê isso e não sabe o que fazer. Aqui isso vira:
//   "O total da nota não bate com a soma dos itens. Confira desconto e frete."
//
// Como é feito, nesta ordem:
//   1. TABELA: as rejeições comuns já estão escritas aqui - não gasta IA nenhuma;
//   2. MEMÓRIA: o que a IA já explicou uma vez fica guardado em arquivo e não é
//      pago de novo (a tela das Tarefas pergunta a cada 45 segundos);
//   3. IA: só o que sobrou, numa chamada só, no modelo mais barato.
//
// Se a IA falhar, aparece o texto original - nunca fica sem resposta.

import fs from 'node:fs';
import path from 'node:path';
import { PASTAS } from '../config.js';
import { chamarGemini, configEconomica, textoDaResposta, MODELO_ECONOMICO } from './gemini.js';
import { podeUsarIAnosParecidos } from './parecidos-ia.js';

// as que mais aparecem no dia a dia de uma loja (codigo da Sefaz -> o que fazer)
const TABELA = {
  204: 'Essa nota já foi enviada antes (duplicidade). Confira no Solus se ela não está autorizada.',
  206: 'Já existe uma nota com esse número autorizada. Use o próximo número.',
  207: 'O CNPJ do cliente está errado ou não existe na Receita. Confira o cadastro.',
  209: 'A inscrição estadual do cliente está inválida. Confira o cadastro.',
  225: 'A nota saiu com um campo fora do formato. Quase sempre é endereço ou CEP incompleto.',
  228: 'A data de emissão é muito antiga. Emita de novo com a data de hoje.',
  229: 'A inscrição estadual do cliente não confere com o CNPJ dele.',
  301: 'O cliente está irregular no estado dele (inscrição suspensa ou baixada).',
  501: 'A nota foi cancelada fora do prazo (24 horas). Não dá mais para cancelar.',
  502: 'A chave da nota não bate com os dados dela. Gere a nota de novo.',
  508: 'Essa nota já foi cancelada.',
  539: 'Já existe uma nota com esse número, mas com conteúdo diferente. Use outro número.',
  610: 'O total da nota não bate com a soma dos itens. Confira desconto, frete e IPI.',
  778: 'O NCM de um produto não existe na tabela oficial. Corrija o NCM no cadastro.',
  898: 'A data de saída está antes da data de emissão.',
};

// O Solus/ACBr grava a rejeição SEM o número na maioria das vezes - foi o que o
// banco de verdade mostrou: "Rejeicao: Duplicidade de NF-e, com diferenca na
// Chave de Acesso", "Rejeição: Informado NCM inexistente [nItem:3]". Então a
// tabela que mais trabalha é esta, pelo TEXTO (sem acento e sem maiúscula).
const POR_TEXTO = [
  {
    procura: /duplicidade de nf-?e/,
    explica: () => 'Essa nota já tinha sido enviada antes (duplicidade). Confira no Solus se ela '
      + 'já não está autorizada; se não estiver, emita com o próximo número.',
  },
  {
    procura: /ie do destinatario nao informada/,
    explica: () => 'Falta a inscrição estadual do cliente. Complete o cadastro dele (ou marque '
      + 'como isento / não contribuinte) e emita de novo.',
  },
  {
    procura: /ie do destinatario (invalida|nao vinculada|nao cadastrada)/,
    explica: () => 'A inscrição estadual do cliente está errada ou não bate com o CNPJ dele. '
      + 'Confira o cadastro do cliente.',
  },
  {
    procura: /ncm inexistente(?:\s*\[nitem:(\d+)\])?/,
    explica: (achado) => `O NCM ${achado[1] ? `do item ${achado[1]} ` : ''}não existe na tabela `
      + 'oficial. Corrija o NCM desse produto no cadastro e emita de novo.',
  },
  {
    procura: /codigo regime tributario/,
    explica: () => 'O regime tributário da empresa (Simples / Normal) está diferente do que a '
      + 'Sefaz tem. Confira nos parâmetros do Solus.',
  },
  {
    procura: /nao informad[ao] vbcstret|vicmssubstituto|vicmssub/,
    explica: () => 'Falta o valor do ICMS-ST já retido de um produto com substituição '
      + 'tributária. Confira a tributação desse produto no cadastro.',
  },
  {
    procura: /total da nf(-?e)? difere/,
    explica: () => TABELA[610],
  },
  {
    procura: /cnpj do destinatario invalido/,
    explica: () => TABELA[207],
  },
  {
    procura: /cancelamento .*fora do prazo|prazo de cancelamento/,
    explica: () => TABELA[501],
  },
];

const semAcento = (texto) => String(texto || '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase();

/** A explicação que já está escrita aqui (pelo texto ou pelo número), sem IA. */
export function explicacaoConhecida(texto) {
  const limpo = semAcento(texto);
  for (const regra of POR_TEXTO) {
    const achado = limpo.match(regra.procura);
    if (achado) return regra.explica(achado);
  }
  const codigo = codigoDaRejeicao(texto);
  return codigo && TABELA[codigo] ? TABELA[codigo] : '';
}

const arquivoDaMemoria = () => path.join(PASTAS.dados, 'sefaz-explicado.json');

function lerMemoria() {
  try {
    return JSON.parse(fs.readFileSync(arquivoDaMemoria(), 'utf8'));
  } catch {
    return {};
  }
}

function gravarMemoria(memoria) {
  try {
    fs.writeFileSync(arquivoDaMemoria(), JSON.stringify(memoria, null, 2), 'utf8');
  } catch {
    /* sem poder gravar, no maximo se paga a explicacao de novo amanha */
  }
}

/**
 * O número da rejeição, SÓ quando vem logo depois de "Rejeição" ("Rejeicao: 610 - ...")
 * ou no começo do texto ("610 - ..."). Qualquer outro número (o item, a chave, o
 * protocolo) não é o código e puxaria a explicação errada.
 */
export function codigoDaRejeicao(texto) {
  const limpo = semAcento(texto);
  const achado = limpo.match(/rejeicao\s*:?\s*(\d{3})\b/) || limpo.match(/^\s*(\d{3})\s*[-:]/);
  return achado ? Number(achado[1]) : null;
}

const FORMATO = {
  type: 'object',
  properties: {
    explicacoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          explicacao: { type: 'string' },
        },
        required: ['numero', 'explicacao'],
      },
    },
  },
  required: ['explicacoes'],
};

const INSTRUCOES = `Estas sao respostas da Sefaz (Receita) sobre notas fiscais eletronicas
de uma loja de material de limpeza. Quem vai ler trabalha no balcao e nao entende
termo tecnico.

Para cada uma, escreva UMA frase curta em portugues simples dizendo o que deu errado
e, quando der, o que a pessoa tem que conferir. Exemplos do jeito certo:
  "Rejeicao 610: total da NF difere do somatorio"
    -> "O total da nota nao bate com a soma dos itens. Confira desconto, frete e IPI."
  "Rejeicao 207: CNPJ do destinatario invalido"
    -> "O CNPJ do cliente esta errado. Confira o cadastro dele."

REGRAS:
- No maximo 2 linhas, sem palavra tecnica e sem repetir o codigo.
- NAO invente motivo: se nao der para saber, escreva
  "A Sefaz recusou a nota. Veja a mensagem original no Solus."
- Escreva como quem explica para um colega, sem "prezado" e sem enrolacao.`;

/**
 * Explica várias mensagens da Sefaz de uma vez.
 * Devolve um array na mesma ordem (a mensagem original quando não der para explicar).
 */
export async function explicarSefaz(mensagens) {
  const textos = mensagens.map((m) => String(m || '').trim());
  const resposta = textos.map(() => '');

  const memoria = lerMemoria();
  const paraIA = [];

  textos.forEach((texto, posicao) => {
    if (!texto) return;
    const conhecida = explicacaoConhecida(texto);
    if (conhecida) { resposta[posicao] = conhecida; return; }
    if (memoria[texto]) { resposta[posicao] = memoria[texto]; return; }
    paraIA.push({ numero: paraIA.length, texto, posicao });
  });

  if (!paraIA.length || !podeUsarIAnosParecidos()) {
    // sem IA (ou nada novo): o que sobrou fica com o texto original mesmo
    textos.forEach((texto, posicao) => { if (!resposta[posicao]) resposta[posicao] = texto; });
    return resposta;
  }

  try {
    const dados = await chamarGemini({
      contents: [{
        parts: [{
          text: `${INSTRUCOES}\n\nMENSAGENS:\n${
            JSON.stringify(paraIA.map(({ numero, texto }) => ({ numero, texto })))}`,
        }],
      }],
      generationConfig: configEconomica({
        maximoDeResposta: 1024,
        responseMimeType: 'application/json',
        responseSchema: FORMATO,
      }),
      preferir: MODELO_ECONOMICO,
    });

    const texto = textoDaResposta(dados);
    const lido = texto ? JSON.parse(texto) : null;
    for (const item of lido?.explicacoes || []) {
      const alvo = paraIA[Number(item.numero)];
      const explicacao = String(item.explicacao || '').trim().slice(0, 240);
      if (!alvo || !explicacao) continue;
      resposta[alvo.posicao] = explicacao;
      memoria[alvo.texto] = explicacao;          // nao se paga duas vezes
    }
    gravarMemoria(memoria);
  } catch (erro) {
    console.error('[sefaz-em-portugues]', erro.message);
  }

  textos.forEach((texto, posicao) => { if (!resposta[posicao]) resposta[posicao] = texto; });
  return resposta;
}
