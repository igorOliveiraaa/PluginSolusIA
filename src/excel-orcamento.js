// O orcamento em planilha do Excel, para o cliente que prefere receber assim.
//
// Mesmo conteudo do PDF (loja, cliente, itens, total, condicoes, validade), mas
// com o total de cada linha e o total geral em FORMULA: se o cliente mudar uma
// quantidade na planilha dele, a conta acompanha.

import { montarXlsx, ESTILO as S } from './xlsx.js';

const dataBR = (data = new Date()) => new Date(data).toLocaleDateString('pt-BR');

export async function gerarExcelOrcamento({ orcamento, operador, loja = {}, validadeDias = 7 }) {
  const itens = (orcamento.itens || []).filter((i) => i.incluir && i.produto);
  if (!itens.length) throw new Error('O orçamento não tem nenhum item para a planilha.');

  const frete = Number(orcamento.pagamento?.frete) > 0 ? Number(orcamento.pagamento.frete) : 0;
  const nomeCliente = orcamento.cliente?.nome || orcamento.nomeCliente || 'CONSUMIDOR';
  const validade = new Date();
  validade.setDate(validade.getDate() + Number(validadeDias || 7));

  const linhas = [];
  const alturas = {};
  const linhaAtual = () => linhas.length + 1;

  // ---- loja --------------------------------------------------------------
  const titulo = `ORÇAMENTO${orcamento.numero ? ' Nº ' + orcamento.numero : ''}`;
  linhas.push([{ v: loja.nome || 'Orçamento', s: S.titulo }]);
  alturas[1] = 24;

  const dadosLoja = [
    loja.razao && loja.razao !== loja.nome ? loja.razao : '',
    loja.cnpj ? `CNPJ ${loja.cnpj}` : '',
    [loja.endereco, loja.bairro, [loja.cidade, loja.uf].filter(Boolean).join('/')].filter(Boolean).join(' - '),
    [loja.telefone, loja.email].filter(Boolean).join('  ·  '),
  ].filter(Boolean);
  for (const texto of dadosLoja) linhas.push([{ v: texto, s: S.cinza }]);

  linhas.push([]);

  // ---- titulo, data e cliente -------------------------------------------
  linhas.push([{ v: titulo, s: S.negrito }, null, null, null, { v: 'Data', s: S.cinza }, { v: dataBR(), s: S.normal }]);
  linhas.push([{ v: 'Cliente', s: S.cinza }]);
  linhas.push([{ v: nomeCliente, s: S.negrito }]);
  const c = orcamento.cliente;
  const detalhes = [
    c?.cpfCnpj ? `CNPJ/CPF ${c.cpfCnpj}` : '',
    [c?.cidade, c?.uf].filter(Boolean).join('/'),
    c?.telefone || c?.celular || '',
  ].filter(Boolean).join('  ·  ');
  if (detalhes) linhas.push([{ v: detalhes, s: S.cinza }]);

  linhas.push([]);

  // ---- itens ------------------------------------------------------------
  const cabecalho = linhaAtual();
  linhas.push(['#', 'Código', 'Produto', 'Unid.', 'Qtd', 'Unitário', 'Total']
    .map((v) => ({ v, s: S.cabecalho })));
  alturas[cabecalho] = 20;

  const primeiraLinhaDeItem = linhaAtual();
  itens.forEach((item, indice) => {
    const n = linhaAtual();
    const quantidade = Number(item.quantidade) || 0;
    const unitario = Number(item.precoUnitario) || 0;
    linhas.push([
      { v: indice + 1, s: S.inteiro },
      { v: String(item.produto.codigo || ''), s: S.celula },
      { v: item.produto.descricao, s: S.celulaQuebra },
      { v: item.produto.unidade || 'UN', s: S.celula },
      { v: quantidade, s: item.fracionado ? S.decimal : S.inteiro },
      { v: unitario, s: S.dinheiro },
      { f: `E${n}*F${n}`, v: Math.round(quantidade * unitario * 100) / 100, s: S.dinheiroNegrito },
    ]);
  });
  const ultimaLinhaDeItem = linhaAtual() - 1;

  // ---- total ------------------------------------------------------------
  const totalItens = itens.reduce((soma, i) => soma + (Number(i.total) || 0), 0);
  linhas.push([]);

  const linhaProdutos = linhaAtual();
  linhas.push([null, null, null, null, null, { v: 'Produtos', s: S.rotuloTotal },
    { f: `SUM(G${primeiraLinhaDeItem}:G${ultimaLinhaDeItem})`, v: totalItens, s: S.dinheiro }]);

  let formulaTotal = `G${linhaProdutos}`;
  if (frete > 0) {
    const linhaFrete = linhaAtual();
    linhas.push([null, null, null, null, null, { v: 'Frete', s: S.rotuloTotal }, { v: frete, s: S.dinheiro }]);
    formulaTotal += `+G${linhaFrete}`;
  }

  const linhaTotal = linhaAtual();
  linhas.push([null, null, null, null, null, { v: 'TOTAL', s: S.rotuloTotal },
    { f: formulaTotal, v: totalItens + frete, s: S.totalGrande }]);
  alturas[linhaTotal] = 22;

  linhas.push([]);

  // ---- condicoes e observacao -------------------------------------------
  const pagamento = String(orcamento.pagamento?.formaDePagamento || '').trim();
  if (pagamento) linhas.push([{ v: `Pagamento: ${pagamento}`, s: S.normal }]);
  if (orcamento.pagamento?.entrega) linhas.push([{ v: `Entrega: ${orcamento.pagamento.entrega}`, s: S.normal }]);
  const observacao = String(orcamento.observacao || '').trim();
  if (observacao) {
    linhas.push([{ v: 'Observações', s: S.cinza }]);
    linhas.push([{ v: observacao, s: S.normal }]);
  }
  linhas.push([{
    v: `Orçamento válido até ${dataBR(validade)}. Preços sujeitos a alteração e à disponibilidade de estoque.`,
    s: S.cinza,
  }]);
  if (operador?.nome) linhas.push([{ v: `Atendimento: ${operador.nome}`, s: S.cinza }]);

  return montarXlsx({
    nomeDaAba: orcamento.numero ? `Orçamento ${orcamento.numero}` : 'Orçamento',
    linhas,
    larguras: [5, 11, 48, 7, 8, 14, 16],
    mesclar: ['A1:G1'],
    alturas,
  });
}
