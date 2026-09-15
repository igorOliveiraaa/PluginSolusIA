// "Monta um orçamento para o fulano de 10 detergente e 2 água sanitária."
//
// Esta é a única ferramenta do assistente que FAZ alguma coisa; todas as outras
// só leem. Mesmo assim ela **não grava nada no Solus**: monta o orçamento e
// deixa aberto na aba Orçamento, exatamente como se a pessoa tivesse mandado a
// lista por lá. Quem confere preço e quem manda gravar continua sendo a pessoa —
// orçamento errado vira preço errado na frente do cliente.
//
// Duas recusas de propósito:
//   - sem permissão de orçamento no Solus, não monta;
//   - com o nome do cliente batendo em vários cadastros, devolve a lista e deixa
//     a IA perguntar qual é, em vez de escolher um.

import { lerListaDigitada } from '../leitura/lista-texto.js';
import { montarOrcamento } from '../logica/orcamento.js';
import { buscarClientePorNome, buscarClientePorCodigo } from '../db/clientes.js';
import { guardarOrcamento } from '../orcamentos-abertos.js';

const dinheiro = (valor) => 'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');

/** Acha o cliente pelo que a pessoa falou. Devolve o que encontrou e o que fazer. */
async function acharCliente(texto) {
  const procurado = String(texto || '').trim();
  if (!procurado) return { cliente: null };

  // código puro: vai direto
  if (/^\d+$/.test(procurado)) {
    const porCodigo = await buscarClientePorCodigo(procurado);
    if (porCodigo) return { cliente: porCodigo };
  }

  const achados = await buscarClientePorNome(procurado, 8);
  if (!achados.length) return { cliente: null, naoAchei: procurado };
  if (achados.length === 1) return { cliente: achados[0] };

  // nome exato entre vários resolve a dúvida
  const exato = achados.filter((c) => c.nome.trim().toUpperCase() === procurado.toUpperCase());
  if (exato.length === 1) return { cliente: exato[0] };

  return {
    cliente: null,
    varios: achados.map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      cidade: [c.cidade, c.uf].filter(Boolean).join('/'),
      cpfCnpj: c.cpfCnpj,
    })),
  };
}

/**
 * Monta o orçamento pedido no chat.
 * `contexto.operador` decide permissão e se pode ver custo.
 */
export async function montarOrcamentoPeloChat({ itens, cliente }, contexto = {}) {
  const operador = contexto.operador;

  if (!operador?.permissoes?.fazerOrcamento) {
    return { erro: 'Esse usuário não tem permissão de fazer orçamento no Solus.' };
  }

  const lista = lerListaDigitada(String(itens || ''));
  if (!lista.itens.length) {
    return {
      erro: 'Não entendi os itens. Escreva um por linha, com a quantidade na frente '
        + '(ex.: "10 detergente ypê 500ml").',
    };
  }
  if (lista.itens.length > 60) {
    return { erro: 'Lista grande demais para o chat. Use a aba Orçamento e mande a lista por lá.' };
  }

  const busca = await acharCliente(cliente);
  if (busca.varios) {
    return {
      precisaEscolherCliente: busca.varios,
      aviso: 'Achei mais de um cliente com esse nome. Pergunte qual é antes de montar.',
    };
  }

  const montado = await montarOrcamento({
    lista,
    cliente: busca.cliente,
    // nome que nao tem cadastro: no Solus entra como consumidor, mas o PDF e o
    // Excel saem com o nome (e o que a loja pediu)
    nomeCliente: busca.cliente ? '' : (busca.naoAchei || ''),
    mostrarCusto: Boolean(operador.permissoes.verCusto),
  });
  const id = guardarOrcamento(montado);

  return {
    id,
    cliente: busca.cliente?.nome || montado.nomeCliente || 'CONSUMIDOR',
    clienteNaoEncontrado: busca.naoAchei || null,
    semCadastro: Boolean(!busca.cliente && busca.naoAchei),
    total: montado.resumo.total,
    totalEscrito: dinheiro(montado.resumo.total),
    itensParaEscolher: montado.resumo.precisamEscolha,
    itens: montado.itens.map((item) => ({
      pedido: item.textoOriginal,
      quantidade: item.quantidade,
      produto: item.produto?.descricao || null,
      preco: item.produto ? dinheiro(item.precoUnitario) : null,
      total: item.produto ? dinheiro(item.total) : null,
      estoque: item.produto?.estoque,
      precisaEscolher: item.precisaEscolher,
      opcoes: item.precisaEscolher ? item.opcoes.slice(0, 3).map((o) => o.descricao) : undefined,
      jaComprouAntes: item.comoAchou === 'esse cliente já levou' || undefined,
      pagouAntes: item.ultimoPrecoCliente ? dinheiro(item.ultimoPrecoCliente.preco) : undefined,
    })),
    aviso: 'O orçamento está montado e aberto na aba Orçamento para conferência. '
      + 'NADA foi gravado no Solus ainda — quem confere e grava é a pessoa.',
  };
}

/** A declaração que vai para o Gemini. */
export const FERRAMENTA_MONTAR_ORCAMENTO = {
  name: 'montar_orcamento',
  description: 'Monta um orcamento com os itens pedidos e deixa aberto na aba Orcamento '
    + 'para a pessoa conferir. NAO grava no Solus e NAO define preco final sozinho. '
    + 'Use quando pedirem "faz um orcamento", "monta um orcamento para o fulano de tal coisa". '
    + 'Depois de montar, diga o total, quais itens precisam de escolha, e avise para '
    + 'abrir a aba Orcamento e conferir antes de gravar. '
    + 'Se o cliente nao tiver cadastro (semCadastro), avise que o PDF e o Excel saem com '
    + 'o nome dele, mas no Solus o orcamento entra como CONSUMIDOR. '
    + 'Se voltar precisaEscolherCliente, PERGUNTE qual e (mostrando cidade/CNPJ) antes de montar de novo. '
    + 'Se a lista estiver vaga (sem quantidade, produto que pode ser varios), pergunte antes de montar.',
  parameters: {
    type: 'object',
    properties: {
      itens: {
        type: 'string',
        description: 'Os itens, UM POR LINHA, com a quantidade na frente. '
          + 'Ex.: "10 detergente ype 500ml\n2 agua sanitaria 5l". '
          + 'Copie o que a pessoa pediu, sem inventar item nem quantidade.',
      },
      cliente: {
        type: 'string',
        description: 'Nome ou codigo do cliente. Deixe vazio se ela nao disse (sai como consumidor).',
      },
    },
    required: ['itens'],
  },
  executar: montarOrcamentoPeloChat,
};
