// "Esse cliente costuma levar também..." — o que provavelmente faltou no pedido.
//
// A PERGUNTA DIFÍCIL (foi o Igor quem levantou): e se ele comprou semana passada
// e hoje veio só repor duas coisas? Sugerir o que ele acabou de levar é o jeito
// mais rápido de a ferramenta parecer boba.
//
// Então nada aqui é "ele sempre leva isso". O que manda é o RITMO de cada
// produto para AQUELE cliente:
//
//   intervalo típico = (última compra - primeira compra) ÷ (nº de compras - 1)
//   está na hora     = faz pelo menos 80% desse intervalo desde a última
//
// Quem compra água sanitária a cada 30 dias e levou há 7 não aparece. Quem levou
// há 45 aparece como "atrasado". Só produto com 3 compras ou mais entra, senão
// não há intervalo em que dê para confiar.
//
// Isso é conta, não IA: não gasta nada e não inventa nada.

import { ritmoDeCompra, comprasPorProduto } from '../db/clientes.js';
import { mapaDeChaves } from '../db/catalogo.js';
import { buscarVariosPorCodigo } from '../db/produtos.js';
import { valeSugerirRepor } from '../leitura/repor-ia.js';
import { podeUsarIAnosParecidos } from '../leitura/parecidos-ia.js';

const DIA = 24 * 60 * 60 * 1000;

// abaixo disso não há intervalo confiável (1 compra não diz nada, 2 dizem pouco)
const COMPRAS_MINIMAS = 3;
// produto que ele compra uma vez por semestre não é reposição de rotina
const INTERVALO_MAXIMO_DIAS = 120;
// "está na hora" a partir de 80% do intervalo típico dele
const PONTO_DE_REPOR = 0.8;
// passou de 4 ciclos sem comprar? ele não esqueceu: parou de levar (ou achou
// mais barato em outro lugar). "Leva a cada 15 dias, última há 22 meses" é o
// tipo de sugestão que faz a ferramenta parecer boba.
const CICLOS_ATE_DESISTIR = 4;
// e nada que ele não compra há mais de um ano entra como "esqueceu"
const ESQUECIDO_DEMAIS_DIAS = 365;
const QUANTAS_SUGERIR = 5;

/** "a cada ~30 dias", "a cada ~2 semanas" - do jeito que se fala. */
function ritmoEmPalavras(dias) {
  if (dias <= 10) return `a cada ${Math.round(dias)} dias`;
  if (dias <= 45) {
    const semanas = Math.round(dias / 7);
    return semanas <= 1 ? 'toda semana' : `a cada ${semanas} semanas`;
  }
  const meses = Math.round(dias / 30.44);
  return meses <= 1 ? 'todo mês' : `a cada ${meses} meses`;
}

function fazQuantoTempo(dias) {
  const inteiro = Math.round(dias);
  if (inteiro <= 0) return 'hoje';
  if (inteiro === 1) return 'ontem';
  if (inteiro < 30) return `há ${inteiro} dias`;
  const meses = Math.round(dias / 30.44);
  return meses <= 1 ? 'há 1 mês' : `há ${meses} meses`;
}

/**
 * O que este cliente provavelmente esqueceu de pedir.
 *
 * `jaNoOrcamento`: códigos que já estão na lista (não se sugere o que já foi pedido).
 * Devolve no máximo 5, do mais atrasado para o menos.
 */
/**
 * "Hoje". Na loja é hoje mesmo. Para testar com a CÓPIA do banco - que parou no
 * dia do backup - dá para fixar a data: PLUGIN_HOJE=2025-08-22 npm start.
 * Sem isso, todo cliente da cópia pareceria ter sumido há mais de um ano.
 */
function hoje() {
  const fixo = Date.parse(process.env.PLUGIN_HOJE || '');
  return Number.isFinite(fixo) ? fixo : Date.now();
}

export async function oQueCostumaLevar({ cliente, jaNoOrcamento = [], agora = hoje() }) {
  if (!cliente?.codigo) return [];
  // "CONSUMIDOR" é o balcão inteiro, não uma pessoa: o ritmo dele não quer dizer nada
  if (/^CONSUMIDOR/i.test(String(cliente.nome || '').trim())) return [];

  let ritmo;
  try {
    ritmo = await ritmoDeCompra(cliente.codigo);
  } catch {
    return [];              // sem histórico o orçamento sai igual, só sem sugestão
  }

  const rotina = ritmo.filter((r) => r.vezes >= COMPRAS_MINIMAS && r.primeira && r.ultima);
  if (!rotina.length) return [];

  // chave da venda (código de barras) -> código do produto no cadastro.
  // Tem que ser o MAPA, não a lista: a lista pula o que não achou e tira
  // repetido, e aí o ritmo de um produto casaria com o código de outro.
  const porChave = await mapaDeChaves(rotina.map((r) => r.chave)).catch(() => new Map());
  const fora = new Set(jaNoOrcamento.map(String));

  const candidatos = [];
  rotina.forEach((item) => {
    const codigo = porChave.get(item.chave);
    if (!codigo || fora.has(String(codigo))) return;

    const periodo = (new Date(item.ultima).getTime() - new Date(item.primeira).getTime()) / DIA;
    const intervalo = periodo / (item.vezes - 1);
    if (!(intervalo > 0) || intervalo > INTERVALO_MAXIMO_DIAS) return;

    const desdeAUltima = (agora - new Date(item.ultima).getTime()) / DIA;
    // ELE COMPROU HÁ POUCO: não precisa disso hoje. É a trava principal.
    if (desdeAUltima < intervalo * PONTO_DE_REPOR) return;
    // e o outro extremo: sumiu faz tempo demais, não é esquecimento
    if (desdeAUltima > intervalo * CICLOS_ATE_DESISTIR) return;
    if (desdeAUltima > ESQUECIDO_DEMAIS_DIAS) return;

    candidatos.push({
      codigo: String(codigo),
      // a chave EXATA da venda (código de barras como ficou gravado). É com ela
      // que se buscam as últimas compras - remontar a partir do produto errava
      // quando o barras da venda tinha zero à esquerda ou pontos.
      chave: item.chave,
      vezes: item.vezes,
      intervaloDias: Math.round(intervalo),
      diasDesdeAUltima: Math.round(desdeAUltima),
      atraso: desdeAUltima / intervalo,
      ultima: item.ultima,
    });
  });

  if (!candidatos.length) return [];

  candidatos.sort((a, b) => b.atraso - a.atraso);
  const melhores = candidatos.slice(0, QUANTAS_SUGERIR * 2);

  const produtos = await buscarVariosPorCodigo(melhores.map((c) => c.codigo)).catch(() => []);
  const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));

  const prontos = melhores
    .map((candidato) => {
      const produto = porCodigo.get(candidato.codigo);
      if (!produto || produto.cancelado) return null;
      return {
        ...candidato,
        produto,
        motivo: `ele leva ${ritmoEmPalavras(candidato.intervaloDias)}`
          + ` · última ${fazQuantoTempo(candidato.diasDesdeAUltima)}`
          + ` · ${candidato.vezes} compras`,
        // passou de 1,5x o ritmo dele: e o que mais chama atencao na tela
        atrasado: candidato.atraso >= 1.5,
      };
    })
    .filter(Boolean);

  return peneirarComIA(cliente, prontos);
}

/**
 * A IA olha as ÚLTIMAS COMPRAS e tira o que não faz sentido sugerir.
 *
 * A conta acima já garantiu o principal (quem comprou há pouco não chega aqui).
 * O que a conta NÃO vê é o tamanho da compra: quem levou 20 caixas na última vez
 * ainda tem estoque, mesmo "no tempo" de repor. Sem IA, fica só a conta.
 */
async function peneirarComIA(cliente, sugestoes) {
  if (!sugestoes.length || !podeUsarIAnosParecidos()) return sugestoes.slice(0, QUANTAS_SUGERIR);

  try {
    const compras = await comprasPorProduto(cliente.codigo, sugestoes.map((s) => s.chave));

    const paraIA = sugestoes.map((s) => ({
      nome: s.produto.descricao,
      ritmoDias: s.intervaloDias,
      diasDesdeAUltima: s.diasDesdeAUltima,
      compras: compras.get(String(s.chave)) || [],
    }));

    const decisoes = await valeSugerirRepor(paraIA);
    if (!decisoes.length) return sugestoes.slice(0, QUANTAS_SUGERIR);

    return sugestoes
      .map((sugestao, i) => {
        const decisao = decisoes[i];
        if (!decisao) return sugestao;                    // a IA não falou deste
        if (!decisao.sugerir) return null;                // ela achou que não vale
        return {
          ...sugestao,
          // a frase da IA em cima; os números da conta continuam embaixo,
          // porque é neles que dá para confiar
          motivo: decisao.motivo || sugestao.motivo,
          detalhe: decisao.motivo ? sugestao.motivo : '',
          conferidoPelaIA: true,
        };
      })
      .filter(Boolean)
      .slice(0, QUANTAS_SUGERIR);
  } catch (erro) {
    console.error('[sugestoes-ia]', erro.message);
    return sugestoes.slice(0, QUANTAS_SUGERIR);
  }
}
