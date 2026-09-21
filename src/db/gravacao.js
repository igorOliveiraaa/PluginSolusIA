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
export async function aplicarNota({ itens, atualizarEstoque = true, fornecedor = null }) {
  const estrutura = await estruturaDe('PRODUTO');
  const tamanhos = estrutura.tamanhos;
  // o fornecedor da nota no cadastro do Solus (codigo + nome), quando foi achado
  const doFornecedor = fornecedor?.codigoNoSolus
    ? { codigo: String(fornecedor.codigoNoSolus), nome: String(fornecedor.nomeNoSolus || fornecedor.nome || '') }
    : null;
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
        const criado = await criarProduto(executar, colunas, item, camposFiscais, { doFornecedor, tamanhos });
        criado.vinculoCriado = await vincularAoFornecedor(executar, item, criado, doFornecedor);
        aplicados.push(criado);
      } else {
        const atualizado = await atualizarProduto(executar, colunas, item, {
          atualizarEstoque,
          usaEstoqueEmpresa,
          campoEstoqueEmpresa,
          camposFiscais,
          doFornecedor,
          tamanhos,
        });
        atualizado.vinculoCriado = await vincularAoFornecedor(executar, item, atualizado, doFornecedor);
        aplicados.push(atualizado);

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

  // o que a NOTA sabe do produto vai para o cadastro: NCM, CEST, fornecedor...
  // e produto marcado " - DESATIVADO" que recebeu mercadoria volta a ser ativo
  const daNota = await dadosDaNota(executar, codigo, item, colunas, opcoes);
  Object.assign(valores, daNota.gravar);

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
  // desfazer devolve os campos fiscais ao vazio de antes, e o NCM/fornecedor/nome
  // ao que eram
  Object.assign(antes, fiscal.antes, daNota.antes);
  // o barras preenchido agora volta a ficar vazio no desfazer
  if (valores.BARRAS !== undefined) antes.BARRAS = anterior.barras || '';

  return {
    acao: 'atualizado',
    codigo,
    descricao: daNota.nomeFinal || anterior.descricao,
    fiscalPreenchido: fiscal.nomes,
    atualizadoPelaNota: daNota.nomes,
    reativado: daNota.reativado,
    antes,
    depois: { estoque: estoqueNovo, custo: custoNovo, venda: vendaNova },
    // e isto que diz se a etiqueta da prateleira precisa ser trocada
    vendaAntes: anterior.vendaAtual,
    vendaDepois: vendaNova,
    precoMudou: Math.abs((anterior.vendaAtual || 0) - (vendaNova || 0)) >= 0.005,
  };
}

export const MARCA_DESATIVADO_REGEX = /\s*-\s*DESATIVADO\s*$/i;
const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

/**
 * O que a nota traz sobre o produto e deve valer no cadastro.
 *
 *  - NCM e CEST: SEMPRE os da nota (e o fornecedor quem classifica; NCM errado
 *    no cadastro faz a nota de venda ser recusada);
 *  - fornecedor: o desta nota passa a ser o ultimo fornecedor do produto;
 *  - unidade de compra: como este fornecedor vende (CX, FD, UN...);
 *  - referencia: o codigo do fornecedor, se o produto ainda nao tinha nenhuma;
 *  - produto que estava marcado " - DESATIVADO" (parado, ou repetido que foi
 *    desligado) e recebeu mercadoria agora: tira a marca e volta a ser ativo.
 *
 * O NOME do produto NAO e trocado pelo da nota: e o nome que a loja usa no
 * balcao, na etiqueta e no historico de venda. E o codigo de barras so e
 * preenchido quando o produto nao tinha - a venda guarda o barras, e trocar
 * perderia o historico de preco de cada cliente.
 */
async function dadosDaNota(executar, codigo, item, colunas, opcoes = {}) {
  const vazio = { gravar: {}, antes: {}, nomes: [], reativado: false, nomeFinal: '' };
  const quero = ['NCM', 'CEST', 'REFERENCIA', 'FORNECEDOR', 'NOMEFOR', 'UNCOMPRA', 'DESCRICAO', 'STATUS']
    .filter((c) => colunas.has(c));
  if (!quero.length) return vazio;

  const linhas = await executar(
    `SELECT ${quero.map((c) => campoTexto(c, c === 'DESCRICAO' ? 70 : 60)).join(', ')}
       FROM PRODUTO WHERE TRIM(CODIGO) = ?`,
    [codigo]
  );
  if (!linhas[0]) return vazio;
  const atual = {};
  for (const c of quero) atual[c] = lerTexto(linhas[0][c] ?? linhas[0][c.toLowerCase()]);

  const tamanho = (coluna) => opcoes.tamanhos?.get(coluna) || 0;
  const cabe = (coluna, valor) => (tamanho(coluna) ? String(valor).slice(0, tamanho(coluna)) : String(valor));
  const gravar = {};
  const antes = {};
  const nomes = [];
  const trocar = (coluna, valor, nome, paraBanco = (v) => v) => {
    if (!quero.includes(coluna) || valor === undefined || valor === null) return;
    const novo = cabe(coluna, valor);
    if (novo === atual[coluna]) return;
    gravar[coluna] = paraBanco(novo);
    antes[coluna] = atual[coluna];
    nomes.push(nome);
  };

  const ncm = soDigitos(item.ncm);
  if (ncm.length === 8) trocar('NCM', ncm, 'NCM');
  const cest = soDigitos(item.cest);
  if (cest.length === 7) trocar('CEST', cest, 'CEST');

  if (!atual.REFERENCIA && item.codigoFornecedor) {
    trocar('REFERENCIA', String(item.codigoFornecedor).trim(), 'referência do fornecedor');
  }
  if (opcoes.doFornecedor?.codigo) {
    trocar('FORNECEDOR', opcoes.doFornecedor.codigo, 'fornecedor');
    if (opcoes.doFornecedor.nome) trocar('NOMEFOR', opcoes.doFornecedor.nome, 'nome do fornecedor', gravarTexto);
  }
  const unidadeDaNota = String(item.unidadeComercial || '').trim().toUpperCase();
  if (unidadeDaNota) trocar('UNCOMPRA', unidadeDaNota, 'unidade de compra');

  // volta a ser ativo: tira a marca do nome e o CANCELADO do status
  let reativado = false;
  let nomeFinal = '';
  if (MARCA_DESATIVADO_REGEX.test(atual.DESCRICAO || '')) {
    nomeFinal = atual.DESCRICAO.replace(MARCA_DESATIVADO_REGEX, '').trim();
    gravar.DESCRICAO = gravarTexto(nomeFinal);
    antes.DESCRICAO = atual.DESCRICAO;        // texto legivel: o desfazer converte
    reativado = true;
  }
  if (String(atual.STATUS || '').trim().toUpperCase() === 'CANCELADO') {
    gravar.STATUS = '';
    antes.STATUS = atual.STATUS;
    reativado = true;
  }
  if (reativado) nomes.push('reativado (tirou o DESATIVADO)');

  return { gravar, antes, nomes, reativado, nomeFinal };
}

/**
 * Ensina o Solus que "o codigo X deste fornecedor e o nosso produto Y"
 * (tabela PRODUTOFORNE). Na proxima nota desse fornecedor o produto e achado
 * sozinho, mesmo sem codigo de barras. Devolve o que foi feito, para desfazer.
 */
async function vincularAoFornecedor(executar, item, registro, doFornecedor) {
  const codigoNoFornecedor = String(item.codigoFornecedor || '').trim().slice(0, 50);
  if (!doFornecedor?.codigo || !codigoNoFornecedor || !registro?.codigo) return null;
  const barras = String(item.produto?.barrasNoBanco || item.produto?.barras || item.codigoBarras || registro.codigo)
    .trim().slice(0, 20);
  const codfor = String(doFornecedor.codigo).trim().slice(0, 10);

  try {
    const existente = await executar(
      'SELECT FIRST 1 BARRAS FROM PRODUTOFORNE WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?',
      [codigoNoFornecedor, codfor]
    );
    if (existente.length) {
      const barrasAntes = String(existente[0].BARRAS || '').trim();
      if (barrasAntes === barras) return null;
      // o vinculo apontava para outro produto: a pessoa ligou a este na tela
      await executar(
        'UPDATE PRODUTOFORNE SET BARRAS = ? WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?',
        [barras, codigoNoFornecedor, codfor]
      );
      return { codigo: codigoNoFornecedor, codfor, barrasAntes };
    }
    await executar(
      'INSERT INTO PRODUTOFORNE (CODIGO, CODFOR, DESCRICAO, BARRAS) VALUES (?, ?, ?, ?)',
      [codigoNoFornecedor, codfor, gravarTexto(String(item.descricao || '').slice(0, 70)), barras]
    );
    return { codigo: codigoNoFornecedor, codfor, novo: true };
  } catch {
    return null;        // banco sem a tabela PRODUTOFORNE: segue sem o vinculo
  }
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

async function criarProduto(executar, colunas, item, camposFiscais = [], opcoes = {}) {
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
    // quem vendeu: o fornecedor desta nota (quando ele esta cadastrado no Solus)
    FORNECEDOR: opcoes.doFornecedor?.codigo ? String(opcoes.doFornecedor.codigo).slice(0, 5) : undefined,
    NOMEFOR: opcoes.doFornecedor?.nome ? gravarTexto(String(opcoes.doFornecedor.nome).slice(0, 50)) : undefined,
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
async function desfazerVinculo(executar, vinculo) {
  if (!vinculo?.codigo || !vinculo?.codfor) return;
  try {
    if (vinculo.novo) {
      await executar('DELETE FROM PRODUTOFORNE WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?',
        [vinculo.codigo, vinculo.codfor]);
    } else if (vinculo.barrasAntes !== undefined) {
      await executar('UPDATE PRODUTOFORNE SET BARRAS = ? WHERE TRIM(CODIGO) = ? AND TRIM(CODFOR) = ?',
        [vinculo.barrasAntes, vinculo.codigo, vinculo.codfor]);
    }
  } catch { /* banco sem a tabela: nada a desfazer */ }
}

export async function desfazer(registros) {
  const colunas = (await estruturaDe('PRODUTO')).nomes;
  return emTransacao(async (executar) => {
    const desfeitos = [];
    for (const registro of registros) {
      // o vinculo 'codigo do fornecedor -> nosso produto' criado pela nota
      await desfazerVinculo(executar, registro.vinculoCriado);

      if (registro.acao === 'criado') {
        await executar('DELETE FROM PRODUTO WHERE TRIM(CODIGO) = ?', [registro.codigo]);
        desfeitos.push({ codigo: registro.codigo, resultado: 'produto novo removido' });
        continue;
      }
      if (!registro.antes) continue;

      // a descricao foi guardada como texto legivel; para voltar ao banco ela
      // precisa virar bytes de novo, senao o acento volta quebrado
      const antes = { ...registro.antes };
      for (const coluna of ['DESCRICAO', 'NOMEFOR']) {
        if (antes[coluna] !== undefined) antes[coluna] = gravarTexto(antes[coluna]);
      }

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
