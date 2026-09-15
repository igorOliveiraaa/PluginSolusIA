// Gravacao no Solus: atualiza estoque/custo/preco e cadastra produto novo.
// Regras de seguranca desta camada:
//  - so grava em coluna que existe de verdade no banco (versoes diferentes do Solus);
//  - numeros vao no formato de texto do Solus ("1844,50");
//  - tudo dentro de uma transacao: ou grava a nota inteira, ou nao grava nada;
//  - devolve o "antes" de cada campo para o historico conseguir desfazer.

import { emTransacao, paraNumero, paraTextoBR, gravarTexto, campoTexto, lerTexto } from './firebird.js';
import { estruturaDe, proximoCodigoProduto, empresaAtual } from './produtos.js';
import {
  camposFiscaisDoBanco, oQueFaltaPreencher, padroesParaProdutoNovo,
} from '../logica/padroes-fiscais.js';
// depois de gravar, o indice de busca esta velho: produto novo, nome mudado,
// produto desativado. Aqui ele e esquecido para ser montado de novo na proxima busca.
import { invalidarCatalogo } from './catalogo.js';

/** Monta "CAMPO = ?" so para as colunas que existem, ignorando o resto. */
function montarAtribuicoes(colunas, valores) {
  const partes = [];
  const params = [];
  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === undefined || !colunas.has(campo)) continue;
    partes.push(campo + ' = ?');
    params.push(valor);
  }
  return { partes, params };
}

function dataSolus(data = new Date()) {
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + data.getFullYear();
}

/**
 * Aplica uma nota inteira. `itens` sao os itens ja conferidos na tela.
 * Cada item precisa de: acao ('atualizar' | 'criar' | 'ignorar'),
 * quantidadeUnidades, custoUnitario, precoVenda e (quando atualizar) o produto.
 */
export async function aplicarNota({ itens, atualizarEstoque = true }) {
  const estrutura = await estruturaDe('PRODUTO');
  const colunas = estrutura.nomes;
  // CST, IBS/CBS, "acessa valores"... que o produto precisa ter para vender com nota
  const camposFiscais = camposFiscaisDoBanco(estrutura);
  const empresa = empresaAtual();
  const campoEstoqueEmpresa = 'ESTOQUEEMP' + empresa;
  const usaEstoqueEmpresa = colunas.has(campoEstoqueEmpresa) && empresa !== '1';

  return emTransacao(async (executar) => {
    const aplicados = [];

    for (const item of itens) {
      if (item.acao === 'ignorar') continue;

      if (item.acao === 'criar') {
        aplicados.push(await criarProduto(executar, colunas, item, camposFiscais));
      } else {
        aplicados.push(await atualizarProduto(executar, colunas, item, {
          atualizarEstoque,
          usaEstoqueEmpresa,
          campoEstoqueEmpresa,
          camposFiscais,
        }));

        // Produtos repetidos (mesmo nome ou mesmo codigo de barras).
        // Duas coisas, as duas so quando o operador marcou na tela:
        //   1. igualar o preco de venda dos outros cadastros;
        //   2. desativar os outros, deixando um como principal.
        // O estoque NUNCA e mexido aqui: so o cadastro que recebeu a mercadoria.
        const irmaos = Array.isArray(item.irmaos) ? item.irmaos : [];
        const paraDesativar = new Set(item.desativarIrmaos || []);

        for (const irmao of irmaos) {
          if (paraDesativar.has(irmao.codigo)) {
            aplicados.push(await desativarProduto(executar, colunas, irmao));
          } else if (item.igualarIrmaos) {
            aplicados.push(await igualarPrecoDoIrmao(executar, colunas, irmao, item.precoVenda));
          }
        }
      }
    }

    return aplicados;
  }).finally(invalidarCatalogo);
}

async function atualizarProduto(executar, colunas, item, opcoes) {
  const anterior = item.produto;            // como estava antes (lido na conferencia)
  const codigo = anterior.codigo;

  const estoqueNovo = opcoes.atualizarEstoque
    ? anterior.estoque + Number(item.quantidadeUnidades || 0)
    : anterior.estoque;

  const custoNovo = Number(item.custoUnitario || 0);
  const vendaNova = Number(item.precoVenda || 0);
  const margemNova = custoNovo > 0 ? ((vendaNova - custoNovo) / custoNovo) * 100 : 0;

  const valores = {
    // o custo que estava valendo agora vira "ultimo custo"
    UPRECOCUSTO: anterior.custoAtual,
    UPC: paraTextoBR(anterior.custoAtual),
    PRECOCUSTO: custoNovo,
    PC: paraTextoBR(custoNovo),
    PRECOVENDA: vendaNova,
    PV: paraTextoBR(vendaNova),
    MARGEM: paraTextoBR(margemNova),
    ULTIMACOMPRA: dataSolus(),
  };

  if (opcoes.atualizarEstoque) {
    // 2 casas: e o formato que o Solus da loja usa ("51,00")
    valores.ESTOQUEATUAL = paraTextoBR(estoqueNovo, 2);
    valores.ESTOQUETOTAL = paraTextoBR(estoqueNovo, 2);
    if (opcoes.usaEstoqueEmpresa) {
      valores[opcoes.campoEstoqueEmpresa] = paraTextoBR(estoqueNovo, 2);
    }
  }

  // codigo de barras: so preenche se o produto ainda nao tinha
  if (item.codigoBarras && !anterior.barras && colunas.has('BARRAS')) {
    valores.BARRAS = String(item.codigoBarras);
  }

  // campos fiscais vazios recebem o padrao da loja (o que ja tem valor fica)
  const fiscal = await fiscalQueFalta(executar, codigo, opcoes.camposFiscais);
  Object.assign(valores, fiscal.preencher);

  const { partes, params } = montarAtribuicoes(colunas, valores);
  if (!partes.length) return { codigo, semAlteracao: true };

  await executar(
    'UPDATE PRODUTO SET ' + partes.join(', ') + ' WHERE TRIM(CODIGO) = ?',
    [...params, codigo]
  );

  const antes = {
    ESTOQUEATUAL: paraTextoBR(anterior.estoque, 2),
    ESTOQUETOTAL: paraTextoBR(anterior.estoque, 2),
    PRECOCUSTO: anterior.custoAtual,
    PC: paraTextoBR(anterior.custoAtual),
    PRECOVENDA: anterior.vendaAtual,
    PV: paraTextoBR(anterior.vendaAtual),
    UPRECOCUSTO: anterior.custoAnterior,
    UPC: paraTextoBR(anterior.custoAnterior),
    MARGEM: paraTextoBR(anterior.margemAtual),
  };
  if (opcoes.usaEstoqueEmpresa) {
    antes[opcoes.campoEstoqueEmpresa] = paraTextoBR(anterior.estoque, 2);
  }
  // desfazer devolve os campos fiscais ao vazio de antes
  Object.assign(antes, fiscal.antes);

  return {
    acao: 'atualizado',
    codigo,
    descricao: anterior.descricao,
    fiscalPreenchido: fiscal.nomes,
    antes,
    depois: { estoque: estoqueNovo, custo: custoNovo, venda: vendaNova },
    // e isto que diz se a etiqueta da prateleira precisa ser trocada
    vendaAntes: anterior.vendaAtual,
    vendaDepois: vendaNova,
    precoMudou: Math.abs((anterior.vendaAtual || 0) - (vendaNova || 0)) >= 0.005,
  };
}

/** Le os campos fiscais atuais do produto (na mesma transacao) e diz o que falta. */
async function fiscalQueFalta(executar, codigo, campos) {
  if (!campos?.length) return { preencher: {}, antes: {}, nomes: [] };
  const linhas = await executar(
    `SELECT ${campos.map((c) => campoTexto(c.coluna, 30)).join(', ')}
       FROM PRODUTO WHERE TRIM(CODIGO) = ?`,
    [codigo]
  );
  const linha = linhas[0];
  if (!linha) return { preencher: {}, antes: {}, nomes: [] };

  const atual = {};
  for (const campo of campos) {
    // o driver devolve o apelido em maiusculo ou minusculo conforme a versao
    const bruto = linha[campo.coluna] ?? linha[campo.coluna.toLowerCase()];
    atual[campo.coluna] = bruto === null || bruto === undefined ? null : lerTexto(bruto);
  }
  return oQueFaltaPreencher(campos, atual);
}

/**
 * Iguala o preco de venda de um cadastro repetido ao preco decidido na tela.
 * Mexe SOMENTE em preco de venda e margem. Nao toca em estoque nem em custo,
 * porque cada cadastro tem o seu proprio historico de compra.
 */
async function igualarPrecoDoIrmao(executar, colunas, irmao, precoVenda) {
  const venda = Number(precoVenda || 0);
  if (!venda || !irmao?.codigo) return { codigo: irmao?.codigo, semAlteracao: true };

  const margem = irmao.custoAtual > 0 ? ((venda - irmao.custoAtual) / irmao.custoAtual) * 100 : 0;

  const valores = {
    PRECOVENDA: venda,
    PV: paraTextoBR(venda),
    MARGEM: paraTextoBR(margem),
  };

  const { partes, params } = montarAtribuicoes(colunas, valores);
  if (!partes.length) return { codigo: irmao.codigo, semAlteracao: true };

  await executar(
    'UPDATE PRODUTO SET ' + partes.join(', ') + ' WHERE TRIM(CODIGO) = ?',
    [...params, irmao.codigo]
  );

  return {
    acao: 'preco-igualado',
    codigo: irmao.codigo,
    descricao: irmao.descricao,
    vendaAntes: irmao.vendaAtual,
    vendaDepois: venda,
    precoMudou: Math.abs((irmao.vendaAtual || 0) - (venda || 0)) >= 0.005,
    antes: {
      PRECOVENDA: irmao.vendaAtual,
      PV: paraTextoBR(irmao.vendaAtual),
      MARGEM: paraTextoBR(irmao.margemAtual),
    },
    depois: { venda, estoque: irmao.estoque, custo: irmao.custoAtual },
  };
}

const MARCA_DESATIVADO = ' - DESATIVADO';

/**
 * Desativa um cadastro repetido, deixando o outro como o principal.
 * NAO apaga nada: o produto continua no banco com todo o historico de compra e
 * venda dos clientes. O que muda e:
 *   - escreve " - DESATIVADO" no fim do nome (e o que aparece no historico);
 *   - marca STATUS = 'CANCELADO', que e como o proprio Solus desativa produto.
 * Estoque, custo e preco ficam exatamente como estavam.
 */
async function desativarProduto(executar, colunas, produto) {
  if (!produto?.codigo) return { semAlteracao: true };

  // nao carimbar duas vezes se ja estiver marcado
  const jaMarcado = produto.descricao.toUpperCase().includes('DESATIVADO');
  const novoNome = jaMarcado
    ? produto.descricao
    : (produto.descricao + MARCA_DESATIVADO).slice(0, 70);

  const valores = {
    DESCRICAO: gravarTexto(novoNome),
    STATUS: 'CANCELADO',
  };

  const { partes, params } = montarAtribuicoes(colunas, valores);
  if (!partes.length) return { codigo: produto.codigo, semAlteracao: true };

  await executar(
    'UPDATE PRODUTO SET ' + partes.join(', ') + ' WHERE TRIM(CODIGO) = ?',
    [...params, produto.codigo]
  );

  return {
    acao: 'desativado',
    codigo: produto.codigo,
    descricao: novoNome,
    antes: {
      DESCRICAO: produto.descricao,          // volta ao nome original se desfizer
      STATUS: produto.status || '',
    },
    depois: { estoque: produto.estoque, custo: produto.custoAtual, venda: produto.vendaAtual },
  };
}

async function criarProduto(executar, colunas, item, camposFiscais = []) {
  // usa a MESMA transacao: consultar por fora trava esperando este commit
  const codigo = await proximoCodigoProduto(executar);
  const custo = Number(item.custoUnitario || 0);
  const venda = Number(item.precoVenda || 0);
  const quantidade = Number(item.quantidadeUnidades || 0);
  const margem = custo > 0 ? ((venda - custo) / custo) * 100 : 0;

  const valores = {
    CODIGO: codigo,
    DESCRICAO: gravarTexto(String(item.descricao || '').slice(0, 70)),
    BARRAS: item.codigoBarras ? String(item.codigoBarras).slice(0, 20) : '',
    REFERENCIA: item.referencia ? String(item.referencia).slice(0, 20) : '',
    // produto que nasce pela nota entra sempre como UNIDADE, nunca como caixa:
    // e exatamente o erro que a importacao do Solus comete hoje
    UNIDADE: 'UN',
    UNCOMPRA: item.unidadeCompra ? String(item.unidadeCompra).slice(0, 10) : 'UN',
    VOLUMECAIXA: paraTextoBR(item.unidadesPorCaixa || 0, 2),
    GRUPO: item.grupo ? String(item.grupo) : '1',
    NCM: item.ncm ? String(item.ncm).replace(/\D/g, '').slice(0, 20) : '',
    CEST: item.cest ? String(item.cest).replace(/\D/g, '').slice(0, 10) : '',
    PRECOCUSTO: custo,
    PC: paraTextoBR(custo),
    PRECOVENDA: venda,
    PV: paraTextoBR(venda),
    UPRECOCUSTO: custo,
    UPC: paraTextoBR(custo),
    MARGEM: paraTextoBR(margem),
    ESTOQUEATUAL: paraTextoBR(quantidade, 2),
    ESTOQUETOTAL: paraTextoBR(quantidade, 2),
    ESTOQUEMINIMO: '0,00',
    // CST 102, IBS/CBS 000, classificacao 000001, acessa valores S, baixa estoque S:
    // sem isso o produto novo nao sai em nota de venda
    ...padroesParaProdutoNovo(camposFiscais),
    // STATUS fica vazio de proposito: no Solus, produto ativo tem STATUS vazio
    // e 'CANCELADO' e o que marca produto desativado.
    ULTIMACOMPRA: dataSolus(),
  };

  const campos = [];
  const marcadores = [];
  const params = [];
  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === undefined || !colunas.has(campo)) continue;
    campos.push(campo);
    marcadores.push('?');
    params.push(valor);
  }

  await executar(
    'INSERT INTO PRODUTO (' + campos.join(', ') + ') VALUES (' + marcadores.join(', ') + ')',
    params
  );

  // avanca o contador de codigo do Solus para ele nao repetir o numero depois
  try {
    await executar('UPDATE CODPRODUTO SET CODIGO = ?', [String(paraNumero(codigo) + 1)]);
  } catch {
    /* banco sem a tabela CODPRODUTO: o proximo codigo sai pelo MAX() mesmo */
  }

  return {
    acao: 'criado',
    codigo,
    // guarda o texto legivel (valores.DESCRICAO virou bytes para gravar no banco)
    descricao: String(item.descricao || '').slice(0, 70),
    fiscalPreenchido: camposFiscais.map((c) => c.nome),
    antes: null,
    depois: { estoque: quantidade, custo, venda },
    vendaAntes: null,
    vendaDepois: venda,
    precoMudou: true,          // produto novo nunca teve etiqueta
  };
}

/** Desfaz uma aplicacao: devolve cada campo ao valor que estava antes. */
export async function desfazer(registros) {
  const colunas = (await estruturaDe('PRODUTO')).nomes;
  return emTransacao(async (executar) => {
    const desfeitos = [];
    for (const registro of registros) {
      if (registro.acao === 'criado') {
        await executar('DELETE FROM PRODUTO WHERE TRIM(CODIGO) = ?', [registro.codigo]);
        desfeitos.push({ codigo: registro.codigo, resultado: 'produto novo removido' });
        continue;
      }
      if (!registro.antes) continue;

      // a descricao foi guardada como texto legivel; para voltar ao banco ela
      // precisa virar bytes de novo, senao o acento volta quebrado
      const antes = { ...registro.antes };
      if (antes.DESCRICAO !== undefined) antes.DESCRICAO = gravarTexto(antes.DESCRICAO);

      const { partes, params } = montarAtribuicoes(colunas, antes);
      if (!partes.length) continue;
      await executar(
        'UPDATE PRODUTO SET ' + partes.join(', ') + ' WHERE TRIM(CODIGO) = ?',
        [...params, registro.codigo]
      );
      desfeitos.push({ codigo: registro.codigo, resultado: 'valores antigos restaurados' });
    }
    return desfeitos;
  }).finally(invalidarCatalogo);
}
