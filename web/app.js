/* Tela de entrada de nota: ler a nota, conferir item a item e gravar no Solus. */

import { $, $$, dinheiro, escapar, mostrarTela, avisar } from './comum.js';
import { icone } from './icones.js';
import { abrirConfiguracaoDeLojas } from './login.js';

const estado = {
  arquivos: [],
  conferencia: null,
  idConferencia: null,
  decisoes: [],
  filtro: 'todos',
  itemEmBusca: null,
};

// ---------------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------------

// estas duas telas buscam dados do servidor toda vez que sao abertas
document.addEventListener('abriu-tela', (evento) => {
  if (evento.detail === 'historico') carregarHistorico();
  if (evento.detail === 'config') carregarConfig();
});

/** Chamada pelo inicio.js so para deixar clara a ordem de carregamento. */
export function iniciarTelaDeNota() {
  desenharArquivos();
}

// ---------------------------------------------------------------------------
// Escolha de arquivos
// ---------------------------------------------------------------------------

const areaArquivo = $('#area-arquivo');
const entradaArquivo = $('#arquivo');

areaArquivo.addEventListener('click', () => entradaArquivo.click());
entradaArquivo.addEventListener('change', (e) => adicionarArquivos(e.target.files));

$('#btn-camera').addEventListener('click', () => $('#camera').click());
$('#camera').addEventListener('change', (e) => adicionarArquivos(e.target.files));

['dragenter', 'dragover'].forEach((evento) =>
  areaArquivo.addEventListener(evento, (e) => {
    e.preventDefault();
    areaArquivo.classList.add('arrastando');
  }));

['dragleave', 'drop'].forEach((evento) =>
  areaArquivo.addEventListener(evento, (e) => {
    e.preventDefault();
    areaArquivo.classList.remove('arrastando');
  }));

areaArquivo.addEventListener('drop', (e) => adicionarArquivos(e.dataTransfer.files));

function adicionarArquivos(lista) {
  for (const arquivo of lista) {
    if (estado.arquivos.some((a) => a.name === arquivo.name && a.size === arquivo.size)) continue;
    estado.arquivos.push(arquivo);
  }
  desenharArquivos();
}

function desenharArquivos() {
  const ul = $('#lista-arquivos');
  ul.innerHTML = estado.arquivos
    .map((arquivo, indice) => `
      <li>
        <span>${icone(arquivo.name.toLowerCase().endsWith('.xml') ? 'certo' : 'documento', 16)}
          ${escapar(arquivo.name)} <em>(${(arquivo.size / 1024).toFixed(0)} KB)</em></span>
        <button data-remover="${indice}" title="Remover" aria-label="Remover">${icone('fechar', 17)}</button>
      </li>`)
    .join('');

  ul.querySelectorAll('[data-remover]').forEach((botao) => {
    botao.addEventListener('click', () => {
      estado.arquivos.splice(Number(botao.dataset.remover), 1);
      desenharArquivos();
    });
  });

  $('#btn-ler').disabled = estado.arquivos.length === 0;
}

// ---------------------------------------------------------------------------
// Ler a nota
// ---------------------------------------------------------------------------

$('#btn-ler').addEventListener('click', async () => {
  const dados = new FormData();
  estado.arquivos.forEach((arquivo) => dados.append('arquivos', arquivo));
  dados.append('observacao', $('#observacao').value);

  const temXml = estado.arquivos.some((a) => a.name.toLowerCase().endsWith('.xml'));
  $('#texto-carregando').textContent = temXml
    ? 'Lendo o XML da nota...'
    : 'A IA esta lendo a nota...';

  $('#carregando').classList.remove('escondido');
  $('#erro-leitura').classList.add('escondido');
  $('#btn-ler').disabled = true;

  try {
    const resposta = await fetch('/api/ler-nota', { method: 'POST', body: dados });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    estado.conferencia = resultado.conferencia;
    estado.idConferencia = resultado.id;
    estado.decisoes = resultado.conferencia.itens.map((item) => ({
      acao: item.acao,
      quantidadeUnidades: item.quantidadeUnidades,
      custoUnitario: item.custoUnitario,
      precoVenda: item.precoVenda,
      igualarIrmaos: false,
      desativarIrmaos: [],
      origemPreco: item.analise.recomendacao,
    }));

    desenharConferencia(resultado.jaAplicada);
    mostrarTela('conferencia');
  } catch (erro) {
    $('#erro-leitura').innerHTML = `<strong>Não deu certo:</strong><br>${escapar(erro.message)}`;
    $('#erro-leitura').classList.remove('escondido');
  } finally {
    $('#carregando').classList.add('escondido');
    $('#btn-ler').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Conferencia
// ---------------------------------------------------------------------------

function desenharConferencia(jaAplicada) {
  const nota = estado.conferencia;
  const resumo = nota.resumo;

  $('#cabecalho-nota').innerHTML = `
    <h2>Nota ${escapar(nota.numero || 'sem número')}${nota.serie ? ' / série ' + escapar(nota.serie) : ''}</h2>
    <p class="ajuda" style="margin:0">
      ${escapar(nota.fornecedor?.nome || 'Fornecedor não identificado')}<br>
      ${nota.emissao ? 'Emissão: ' + escapar(nota.emissao) + ' · ' : ''}
      Lida ${nota.origem === 'xml' ? 'do XML (valores exatos)' : 'por IA a partir da imagem'}
    </p>`;

  if (jaAplicada) {
    const quando = new Date(jaAplicada.quando).toLocaleString('pt-BR');
    $('#aviso-repetida').innerHTML =
      `<strong>Atenção:</strong> essa nota já foi lançada em ${quando}` +
      `${jaAplicada.operador ? ' por ' + escapar(jaAplicada.operador) : ''}.
       Se gravar de novo, o estoque vai somar duas vezes.`;
    $('#aviso-repetida').classList.remove('escondido');
  } else {
    $('#aviso-repetida').classList.add('escondido');
  }

  const conferencia = resumo.totalDaNota > 0
    ? (resumo.conferiuComATotal
        ? `<div class="item-aviso" style="background:var(--sucesso-fundo);color:var(--sucesso)">
             A soma dos itens bate com o total da nota (${dinheiro(resumo.totalDaNota)}).
           </div>`
        : `<div class="item-aviso">
             A soma dos custos (${dinheiro(resumo.somaDosCustos)}) está
             ${dinheiro(Math.abs(resumo.diferencaParaNota))}
             ${resumo.diferencaParaNota > 0 ? 'acima' : 'abaixo'} do total da nota
             (${dinheiro(resumo.totalDaNota)}). Costuma ser frete ou imposto — confira.
           </div>`)
    : '';

  const ajustes = nota.ajustes
    ? `<div class="item-aviso info" style="margin-top:10px">
         <strong>Entendi da sua observação:</strong> ${escapar(nota.ajustes.entendi)}
         ${nota.ajustes.naoEntendi
           ? '<br><em>Não usei esta parte: ' + escapar(nota.ajustes.naoEntendi) + '</em>' : ''}
         <br><em>A conta foi feita pelo sistema; confira os itens abaixo.</em>
       </div>`
    : '';

  $('#resumo-nota').innerHTML = `
    <div class="resumo-grade">
      <div class="resumo-item">
        <div class="resumo-numero">${resumo.totalItens}</div>
        <div class="resumo-rotulo">itens na nota</div>
      </div>
      <div class="resumo-item${resumo.produtosNovos ? ' destaque' : ''}">
        <div class="resumo-numero">${resumo.produtosNovos}</div>
        <div class="resumo-rotulo">produtos novos</div>
      </div>
      <div class="resumo-item${resumo.itensConvertidosDeCaixa ? ' destaque' : ''}">
        <div class="resumo-numero">${resumo.itensConvertidosDeCaixa}</div>
        <div class="resumo-rotulo">vieram em caixa</div>
      </div>
      <div class="resumo-item${resumo.itensComAtencao ? ' destaque' : ''}">
        <div class="resumo-numero">${resumo.itensComAtencao}</div>
        <div class="resumo-rotulo">precisam de atenção</div>
      </div>
    </div>
    ${conferencia}${ajustes}`;

  desenharItens();
}

function desenharItens() {
  const lista = $('#lista-itens');
  const itens = estado.conferencia.itens;

  const visiveis = itens
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => {
      if (estado.filtro === 'atencao') return item.precisaAtencao;
      if (estado.filtro === 'novos') return !item.produto;
      if (estado.filtro === 'caixa') return item.convertido || item.unidadesPorCaixa > 0;
      return true;
    });

  if (!visiveis.length) {
    lista.innerHTML = '<div class="cartao ajuda">Nenhum item nesse filtro.</div>';
    return;
  }

  lista.innerHTML = visiveis.map(({ item, indice }) => desenharItem(item, indice)).join('');
  ligarEventosDosItens();
}

function desenharItem(item, indice) {
  const decisao = estado.decisoes[indice];
  const analise = item.analise;
  const novo = !item.produto;
  const ignorado = decisao.acao === 'ignorar';

  let classe = 'item';
  if (ignorado) classe += ' ignorado';
  else if (analise.alertas.some((a) => a.tipo === 'prejuizo')) classe += ' problema';
  else if (novo) classe += ' novo';
  else if (item.precisaAtencao) classe += ' atencao';

  // etiquetas
  const etiquetas = [];
  if (novo) etiquetas.push('<span class="etiqueta info">produto novo</span>');
  else etiquetas.push(`<span class="etiqueta ok">cód. ${escapar(item.produto.codigo)}</span>`);
  if (item.convertido) etiquetas.push('<span class="etiqueta aviso">convertido de caixa</span>');
  if (item.comoAchou && !novo) etiquetas.push(`<span class="etiqueta">achado por ${escapar(item.comoAchou)}</span>`);
  if (item.confianca === 'baixa') etiquetas.push('<span class="etiqueta erro">leitura duvidosa</span>');

  // avisos
  const avisos = [];
  if (item.explicacao) {
    avisos.push(`<div class="item-aviso">${escapar(item.explicacao)}</div>`);
  }
  if (item.observacaoIA) {
    avisos.push(`<div class="item-aviso info">Observação da IA: ${escapar(item.observacaoIA)}</div>`);
  }
  for (const alerta of analise.alertas) {
    const tipo = ['prejuizo', 'cancelado'].includes(alerta.tipo) ? ' erro'
      : alerta.tipo === 'novo' ? ' info' : '';
    avisos.push(`<div class="item-aviso${tipo}">${escapar(alerta.texto)}</div>`);
  }

  // comparacao de custo
  const variacao = analise.variacaoCusto;
  const seta = variacao > 0 ? '▲' : variacao < 0 ? '▼' : '';
  const classeVariacao = variacao > 0 ? 'subiu' : variacao < 0 ? 'caiu' : '';

  const blocoCusto = novo
    ? `<div class="comparacao-bloco">
         <div class="comparacao-titulo">Custo novo</div>
         <div class="comparacao-valor">${dinheiro(item.custoUnitario)}</div>
         <div class="comparacao-detalhe">por unidade</div>
       </div>
       <div class="comparacao-bloco">
         <div class="comparacao-titulo">Quantidade</div>
         <div class="comparacao-valor">${item.quantidadeUnidades}</div>
         <div class="comparacao-detalhe">unidades entrando</div>
       </div>`
    : `<div class="comparacao-bloco">
         <div class="comparacao-titulo">Custo</div>
         <div class="comparacao-valor">
           ${dinheiro(analise.custoAntigo)} → ${dinheiro(analise.custoNovo)}
         </div>
         <div class="comparacao-detalhe ${classeVariacao}">
           ${variacao ? `${seta} ${Math.abs(variacao).toFixed(1)}%` : 'sem mudança'}
         </div>
       </div>
       <div class="comparacao-bloco">
         <div class="comparacao-titulo">Vende hoje por</div>
         <div class="comparacao-valor">${dinheiro(analise.vendaAtual)}</div>
         <div class="comparacao-detalhe">margem de ${analise.margemAnterior.toFixed(1)}%</div>
       </div>`;

  // opcoes de preco
  const manterEscolhido = decisao.origemPreco === 'manter';
  const sugeridoEscolhido = decisao.origemPreco === 'sugerido';
  const manualEscolhido = decisao.origemPreco === 'manual';

  const opcaoManter = novo ? '' : `
    <button class="opcao-preco ${manterEscolhido ? 'escolhida' : ''}"
            data-preco="manter" data-indice="${indice}">
      <div class="opcao-preco-rotulo">Continuar com o preço de hoje</div>
      <div class="opcao-preco-valor">${dinheiro(analise.vendaAtual)}</div>
      <div class="opcao-preco-margem">margem cai para ${analise.margemSeManterPreco.toFixed(1)}%</div>
    </button>`;

  const opcaoSugerido = `
    <button class="opcao-preco ${sugeridoEscolhido ? 'escolhida' : ''}"
            data-preco="sugerido" data-indice="${indice}">
      <div class="opcao-preco-rotulo">${novo ? 'Preço sugerido' : 'Manter a mesma margem'}</div>
      <div class="opcao-preco-valor">${dinheiro(analise.precoSugerido)}</div>
      <div class="opcao-preco-margem">margem de ${analise.margemDoSugerido.toFixed(1)}%</div>
    </button>`;

  const opcaoManual = `
    <div class="opcao-preco ${manualEscolhido ? 'escolhida' : ''}" style="cursor:default">
      <div class="opcao-preco-rotulo">Outro preço</div>
      <div class="preco-manual">
        <input type="number" step="0.01" min="0" data-preco-manual="${indice}"
               value="${manualEscolhido ? decisao.precoVenda.toFixed(2) : ''}"
               placeholder="digite">
      </div>
    </div>`;

  // produtos repetidos (mesmo nome ou mesmo código de barras)
  const desativar = decisao.desativarIrmaos || [];
  const blocoIrmaos = item.irmaos?.length ? `
    <div class="irmaos">
      <div class="irmaos-titulo">
        ⚠ Encontrei ${item.irmaos.length + 1} cadastros do mesmo produto
      </div>
      <div class="irmao-linha">
        <span><strong>cód. ${escapar(item.produto.codigo)}</strong>
          <span class="etiqueta ok">principal</span><br>
          barras ${escapar(item.produto.barras || '-')}</span>
        <span style="text-align:right">${dinheiro(item.produto.vendaAtual)}<br>
          <em>estoque ${item.produto.estoque}</em></span>
      </div>
      ${item.irmaos.map((irmao) => `
        <div class="irmao-linha">
          <span>cód. ${escapar(irmao.codigo)}
            <em>(${escapar(irmao.motivo || 'repetido')})</em><br>
            barras ${escapar(irmao.barras || '-')}
            ${irmao.estoque < 0
              ? '<span class="etiqueta erro">estoque negativo</span>' : ''}</span>
          <span style="text-align:right">${dinheiro(irmao.vendaAtual)}<br>
            <em>estoque ${irmao.estoque}</em></span>
        </div>`).join('')}

      <label>
        <input type="checkbox" data-irmaos="${indice}" ${decisao.igualarIrmaos ? 'checked' : ''}>
        <span>Deixar todos com o mesmo preço de venda
          (${dinheiro(decisao.precoVenda)}).
          <em>O estoque entra só no principal — os outros não são mexidos.</em></span>
      </label>

      <div style="margin-top:10px">
        <div style="font-weight:600;font-size:13px">Desativar os repetidos:</div>
        <div class="ajuda" style="margin:2px 0 6px">
          Escreve "DESATIVADO" no nome e marca como cancelado no Solus.
          Nada é apagado — o histórico de compra dos clientes continua lá.
        </div>
        ${item.irmaos.map((irmao) => `
          <label>
            <input type="checkbox" data-desativar="${indice}"
                   value="${escapar(irmao.codigo)}"
                   ${desativar.includes(irmao.codigo) ? 'checked' : ''}>
            <span>Desativar o cód. ${escapar(irmao.codigo)}
              ${irmao.estoque !== 0
                ? `<em style="color:var(--aviso)">— atenção: ainda tem ${irmao.estoque} em estoque</em>`
                : ''}</span>
          </label>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="${classe}" data-item="${indice}">
      <div class="item-topo">
        <div>
          <div class="item-nome">${escapar(item.descricao)}</div>
          ${!novo && item.produto.descricao !== item.descricao
            ? `<div class="comparacao-detalhe">No Solus: ${escapar(item.produto.descricao)}</div>` : ''}
        </div>
      </div>

      <div class="item-etiquetas">${etiquetas.join('')}</div>
      ${avisos.join('')}

      <div class="comparacao">${blocoCusto}</div>

      <div class="linha-quantidade">
        <label class="campo">
          <span>Quantidade (unidades)</span>
          <input type="number" step="0.01" min="0" data-qtd="${indice}"
                 value="${decisao.quantidadeUnidades}">
        </label>
        ${item.unidadeOriginal && item.unidadeOriginal !== 'UN' ? `
        <label class="campo">
          <span>Unid. por ${escapar(item.unidadeOriginal)}</span>
          <input type="number" step="1" min="0" data-caixa="${indice}"
                 value="${item.unidadesPorCaixa || ''}" placeholder="?">
        </label>` : ''}
        <label class="campo">
          <span>Custo por unidade</span>
          <input type="number" step="0.0001" min="0" data-custo="${indice}"
                 value="${Number(decisao.custoUnitario).toFixed(4)}">
        </label>
      </div>

      <div class="escolha-preco">${opcaoManter}${opcaoSugerido}${opcaoManual}</div>

      ${item.explicacaoCusto
        ? `<div class="comparacao-detalhe" style="margin-top:8px">Custo: ${escapar(item.explicacaoCusto)}</div>`
        : ''}
      ${item.ajusteAplicado
        ? `<div class="item-aviso info">Ajuste da sua observação: ${escapar(item.ajusteAplicado)}</div>`
        : ''}

      ${blocoIrmaos}

      <div class="item-acoes">
        <button class="botao secundario" data-trocar="${indice}">
          ${novo ? 'Vincular a um produto' : 'Trocar produto'}
        </button>
        <button class="botao secundario" data-ignorar="${indice}">
          ${ignorado ? 'Voltar a incluir' : 'Não lançar este'}
        </button>
      </div>
    </div>`;
}

function ligarEventosDosItens() {
  // escolha de preco
  $$('[data-preco]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const indice = Number(botao.dataset.indice);
      const item = estado.conferencia.itens[indice];
      const decisao = estado.decisoes[indice];
      decisao.origemPreco = botao.dataset.preco;
      decisao.precoVenda = botao.dataset.preco === 'manter'
        ? item.analise.vendaAtual
        : item.analise.precoSugerido;
      desenharItens();
    });
  });

  $$('[data-preco-manual]').forEach((campo) => {
    campo.addEventListener('change', () => {
      const indice = Number(campo.dataset.precoManual);
      const valor = Number(campo.value);
      if (valor > 0) {
        estado.decisoes[indice].precoVenda = valor;
        estado.decisoes[indice].origemPreco = 'manual';
        desenharItens();
      }
    });
  });

  // quantidade / unidades por caixa / custo
  $$('[data-qtd]').forEach((campo) => {
    campo.addEventListener('change', () =>
      recalcular(Number(campo.dataset.qtd), { quantidadeUnidades: Number(campo.value) }));
  });

  $$('[data-caixa]').forEach((campo) => {
    campo.addEventListener('change', () =>
      recalcular(Number(campo.dataset.caixa), { unidadesPorCaixa: Number(campo.value) }));
  });

  $$('[data-custo]').forEach((campo) => {
    campo.addEventListener('change', () =>
      recalcular(Number(campo.dataset.custo), { custoUnitario: Number(campo.value) }));
  });

  // igualar produtos repetidos
  $$('[data-irmaos]').forEach((caixa) => {
    caixa.addEventListener('change', () => {
      estado.decisoes[Number(caixa.dataset.irmaos)].igualarIrmaos = caixa.checked;
    });
  });

  // desativar cadastros repetidos
  $$('[data-desativar]').forEach((caixa) => {
    caixa.addEventListener('change', () => {
      const indice = Number(caixa.dataset.desativar);
      const decisao = estado.decisoes[indice];
      decisao.desativarIrmaos = decisao.desativarIrmaos || [];

      const irmao = estado.conferencia.itens[indice].irmaos
        .find((x) => x.codigo === caixa.value);

      if (caixa.checked) {
        // desativar produto com estoque pede confirmacao: some do PDV
        if (irmao && irmao.estoque !== 0) {
          const segue = confirm(
            `O cadastro ${irmao.codigo} ainda tem ${irmao.estoque} em estoque.\n\n` +
            'Desativando, ele deixa de aparecer para venda e esse estoque fica parado nele.\n\n' +
            'Confirma desativar mesmo assim?'
          );
          if (!segue) { caixa.checked = false; return; }
        }
        if (!decisao.desativarIrmaos.includes(caixa.value)) {
          decisao.desativarIrmaos.push(caixa.value);
        }
      } else {
        decisao.desativarIrmaos = decisao.desativarIrmaos.filter((c) => c !== caixa.value);
      }
    });
  });

  // nao lancar
  $$('[data-ignorar]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const indice = Number(botao.dataset.ignorar);
      const decisao = estado.decisoes[indice];
      decisao.acao = decisao.acao === 'ignorar'
        ? (estado.conferencia.itens[indice].produto ? 'atualizar' : 'criar')
        : 'ignorar';
      desenharItens();
    });
  });

  // trocar produto
  $$('[data-trocar]').forEach((botao) => {
    botao.addEventListener('click', () => abrirBusca(Number(botao.dataset.trocar)));
  });
}

async function recalcular(indice, mudancas) {
  try {
    const resposta = await fetch('/api/recalcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: estado.idConferencia, indice, ...mudancas }),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    estado.conferencia.itens[indice] = resultado.item;
    const decisao = estado.decisoes[indice];
    decisao.quantidadeUnidades = resultado.item.quantidadeUnidades;
    decisao.custoUnitario = resultado.item.custoUnitario;
    // preco manual digitado a mao e respeitado; o resto acompanha o novo custo
    if (decisao.origemPreco !== 'manual') {
      decisao.precoVenda = decisao.origemPreco === 'manter'
        ? resultado.item.analise.vendaAtual
        : resultado.item.analise.precoSugerido;
    }
    desenharItens();
  } catch (erro) {
    avisar('Não deu para recalcular: ' + erro.message, 'erro');
  }
}

// filtros
$$('.filtro').forEach((botao) => {
  botao.addEventListener('click', () => {
    $$('.filtro').forEach((f) => f.classList.remove('ativo'));
    botao.classList.add('ativo');
    estado.filtro = botao.dataset.filtro;
    desenharItens();
  });
});

// ---------------------------------------------------------------------------
// Modal de busca de produto
// ---------------------------------------------------------------------------

function abrirBusca(indice) {
  estado.itemEmBusca = indice;
  const item = estado.conferencia.itens[indice];
  $('#busca-produto').value = item.descricao.split(' ').slice(0, 2).join(' ');
  $('#modal-busca').classList.remove('escondido');
  buscarProdutos();
  $('#busca-produto').focus();
}

$('#btn-fechar-modal').addEventListener('click', () => {
  $('#modal-busca').classList.add('escondido');
});

let temporizadorBusca;
$('#busca-produto').addEventListener('input', () => {
  clearTimeout(temporizadorBusca);
  temporizadorBusca = setTimeout(buscarProdutos, 350);
});

async function buscarProdutos() {
  const termo = $('#busca-produto').value.trim();
  const area = $('#resultado-busca');
  if (termo.length < 2) { area.innerHTML = ''; return; }

  area.innerHTML = '<p class="ajuda">Procurando...</p>';
  try {
    const resposta = await fetch('/api/produtos?q=' + encodeURIComponent(termo));
    const resultado = await resposta.json();
    if (!resultado.produtos.length) {
      area.innerHTML = '<p class="ajuda">Nenhum produto encontrado.</p>';
      return;
    }
    area.innerHTML = resultado.produtos.map((produto) => `
      <button data-escolher="${escapar(produto.codigo)}">
        <strong>${escapar(produto.descricao)}</strong><br>
        cód. ${escapar(produto.codigo)} · barras ${escapar(produto.barras || '-')} ·
        custo ${dinheiro(produto.custoAtual)} · venda ${dinheiro(produto.vendaAtual)} ·
        estoque ${produto.estoque}
        ${produto.cancelado ? ' · <span style="color:var(--perigo)">CANCELADO</span>' : ''}
      </button>`).join('');

    area.querySelectorAll('[data-escolher]').forEach((botao) => {
      botao.addEventListener('click', () => escolherProduto(botao.dataset.escolher));
    });
  } catch (erro) {
    area.innerHTML = `<p class="ajuda">Erro na busca: ${escapar(erro.message)}</p>`;
  }
}

async function escolherProduto(codigo) {
  try {
    const resposta = await fetch('/api/trocar-produto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: estado.idConferencia,
        indice: estado.itemEmBusca,
        codigoProduto: codigo,
      }),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    const indice = estado.itemEmBusca;
    estado.conferencia.itens[indice] = resultado.item;
    estado.decisoes[indice] = {
      acao: 'atualizar',
      quantidadeUnidades: resultado.item.quantidadeUnidades,
      custoUnitario: resultado.item.custoUnitario,
      precoVenda: resultado.item.precoVenda,
      igualarIrmaos: false,
      desativarIrmaos: [],
      origemPreco: resultado.item.analise.recomendacao,
    };

    $('#modal-busca').classList.add('escondido');
    desenharItens();
  } catch (erro) {
    avisar('Não deu para trocar: ' + erro.message, 'erro');
  }
}

// ---------------------------------------------------------------------------
// Gravar
// ---------------------------------------------------------------------------

$('#btn-voltar').addEventListener('click', () => {
  if (confirm('Cancelar esta nota? O que foi conferido será perdido.')) {
    estado.conferencia = null;
    estado.arquivos = [];
    desenharArquivos();
    mostrarTela('enviar');
  }
});

$('#btn-gravar').addEventListener('click', async () => {
  const vaoGravar = estado.decisoes.filter((d) => d.acao !== 'ignorar').length;
  const novos = estado.decisoes.filter((d) => d.acao === 'criar').length;
  const igualados = estado.decisoes.filter((d) => d.igualarIrmaos).length;
  const desativados = estado.decisoes.reduce((t, d) => t + (d.desativarIrmaos?.length || 0), 0);

  let mensagem = `Gravar ${vaoGravar} ${vaoGravar === 1 ? 'item' : 'itens'} no Solus?\n\n`;
  mensagem += `• ${vaoGravar - novos} produtos terão estoque, custo e preço atualizados\n`;
  if (novos) mensagem += `• ${novos} produtos serão cadastrados novos\n`;
  if (igualados) mensagem += `• ${igualados} itens vão igualar o preço dos cadastros repetidos\n`;
  if (desativados) mensagem += `• ${desativados} cadastros repetidos serão DESATIVADOS\n`;
  mensagem += '\nDá para desfazer depois pelo Histórico.';

  if (!confirm(mensagem)) return;

  $('#btn-gravar').disabled = true;
  $('#btn-gravar').textContent = 'Gravando...';

  try {
    const resposta = await fetch('/api/aplicar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: estado.idConferencia,
        decisoes: estado.decisoes,
        operador: $('#operador').value,
      }),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    mostrarResultado(resultado);
  } catch (erro) {
    alert('Não deu para gravar: ' + erro.message + '\n\nNada foi alterado no Solus.');
  } finally {
    $('#btn-gravar').disabled = false;
    $('#btn-gravar').textContent = 'Gravar no Solus';
  }
});

function mostrarResultado(resultado) {
  const r = resultado.resumo;
  $('#conteudo-resultado').innerHTML = `
    <div class="alerta-sucesso" style="padding:14px;border-radius:9px;margin-bottom:14px">
      <strong>Pronto! Gravado no Solus.</strong>
    </div>
    <div class="resumo-grade">
      <div class="resumo-item">
        <div class="resumo-numero">${r.produtosAtualizados}</div>
        <div class="resumo-rotulo">atualizados</div>
      </div>
      <div class="resumo-item">
        <div class="resumo-numero">${r.produtosCriados}</div>
        <div class="resumo-rotulo">cadastrados novos</div>
      </div>
      <div class="resumo-item">
        <div class="resumo-numero">${r.precosIgualados}</div>
        <div class="resumo-rotulo">preços igualados</div>
      </div>
      <div class="resumo-item">
        <div class="resumo-numero">${r.produtosDesativados || 0}</div>
        <div class="resumo-rotulo">repetidos desativados</div>
      </div>
    </div>
    <p class="ajuda" style="margin-top:14px">
      Se algo entrou errado, você pode desfazer tudo pelo Histórico.
    </p>
    <button class="botao principal largura-total" id="btn-nova-nota">Lançar outra nota</button>`;

  $('#btn-nova-nota').addEventListener('click', () => {
    estado.arquivos = [];
    estado.conferencia = null;
    $('#observacao').value = '';
    desenharArquivos();
    mostrarTela('enviar');
  });

  mostrarTela('resultado');
}

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

async function carregarHistorico() {
  const area = $('#lista-historico');
  area.innerHTML = '<div class="cartao ajuda">Carregando...</div>';
  try {
    const resposta = await fetch('/api/historico');
    const resultado = await resposta.json();
    if (!resultado.historico.length) {
      area.innerHTML = '<div class="cartao ajuda">Nenhuma nota lançada ainda.</div>';
      return;
    }

    area.innerHTML = resultado.historico.map((registro) => {
      const quando = new Date(registro.quando).toLocaleString('pt-BR');
      return `
        <div class="historico-item ${registro.desfeita ? 'desfeita' : ''}">
          <div class="historico-topo">
            <div>
              <strong>Nota ${escapar(registro.nota?.numero || '-')}</strong><br>
              <span class="historico-data">${escapar(registro.nota?.fornecedor?.nome || '')}</span>
            </div>
            <div class="historico-data" style="text-align:right">
              ${quando}<br>${escapar(registro.operador || '')}
            </div>
          </div>
          <div class="ajuda" style="margin:8px 0 0">
            ${registro.resumo.produtosAtualizados} atualizados ·
            ${registro.resumo.produtosCriados} novos ·
            ${registro.resumo.precosIgualados} preços igualados
          </div>
          ${registro.desfeita
            ? '<div class="etiqueta aviso" style="margin-top:8px;display:inline-block">desfeita</div>'
            : `<button class="botao secundario largura-total" data-desfazer="${escapar(registro.id)}">
                 Desfazer este lançamento
               </button>`}
        </div>`;
    }).join('');

    area.querySelectorAll('[data-desfazer]').forEach((botao) => {
      botao.addEventListener('click', () => desfazerLancamento(botao.dataset.desfazer));
    });
  } catch (erro) {
    area.innerHTML = `<div class="cartao alerta-erro">Erro: ${escapar(erro.message)}</div>`;
  }
}

async function desfazerLancamento(id) {
  if (!confirm('Desfazer este lançamento?\n\nO estoque, o custo e o preço voltam a como estavam antes, e os produtos criados por ele são apagados.')) return;
  try {
    const resposta = await fetch('/api/desfazer/' + id, { method: 'POST' });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);
    avisar('Desfeito. ' + resultado.resultado.length + ' produtos voltaram ao que eram.');
    carregarHistorico();
  } catch (erro) {
    avisar('Não deu para desfazer: ' + erro.message, 'erro');
  }
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

async function carregarConfig() {
  try {
    const resposta = await fetch('/api/config');
    const { config } = await resposta.json();

    $('#loja-dos-ajustes').textContent = config.lojaNome
      ? `Os ajustes abaixo valem para a loja ${config.lojaNome}.`
      : 'Os ajustes abaixo valem para a loja em que você entrou.';
    $('#cfg-chave-ia').value = config.ia.chave || '';
    $('#cfg-arredondar').value = config.regras.arredondarPara ?? 0.9;
    $('#cfg-margem-novo').value = config.regras.margemNovoProduto ?? 30;
    $('#cfg-avisar').value = config.regras.avisarAumentoAcima ?? 10;
    $('#cfg-regime').value = config.empresa.regime || 'simples';
    $('#cfg-loja-nome').value = config.loja?.nome || '';
    $('#cfg-loja-cnpj').value = config.loja?.cnpj || '';
    $('#cfg-loja-endereco').value = config.loja?.endereco || '';
    $('#cfg-loja-cidade').value = config.loja?.cidade || '';
    $('#cfg-loja-uf').value = config.loja?.uf || '';
    $('#cfg-loja-telefone').value = config.loja?.telefone || '';
    $('#cfg-pastas-notas').value = config.notas?.pastas || '';
    $('#cfg-frete').checked = config.regras.somarFrete !== false;
    $('#cfg-ipi').checked = config.regras.somarIPI !== false;
    $('#cfg-st').checked = config.regras.somarST !== false;

    const seletor = $('#cfg-modelo-ia');
    seletor.innerHTML = `<option value="${escapar(config.ia.modelo)}">${escapar(config.ia.modelo)}</option>`;
    if (config.ia.temChave) carregarModelos(config.ia.modelo);
  } catch (erro) {
    console.error(erro);
  }
}

async function carregarModelos(atual) {
  try {
    const resposta = await fetch('/api/modelos-ia');
    const resultado = await resposta.json();
    if (!resultado.ok || !resultado.modelos?.length) return;
    $('#cfg-modelo-ia').innerHTML = resultado.modelos
      .map((m) => `<option value="${escapar(m)}" ${m === atual ? 'selected' : ''}>${escapar(m)}</option>`)
      .join('');
  } catch { /* sem chave valida ainda: fica so o modelo atual na lista */ }
}

$('#btn-salvar-config').addEventListener('click', async () => {
  const novo = {
    ia: {
      chave: $('#cfg-chave-ia').value.trim(),
      modelo: $('#cfg-modelo-ia').value,
    },
    empresa: { regime: $('#cfg-regime').value },
    notas: { pastas: $('#cfg-pastas-notas').value.trim() },
    loja: {
      nome: $('#cfg-loja-nome').value.trim(),
      cnpj: $('#cfg-loja-cnpj').value.trim(),
      endereco: $('#cfg-loja-endereco').value.trim(),
      cidade: $('#cfg-loja-cidade').value.trim(),
      uf: $('#cfg-loja-uf').value.trim().toUpperCase(),
      telefone: $('#cfg-loja-telefone').value.trim(),
    },
    regras: {
      arredondarPara: Number($('#cfg-arredondar').value),
      margemNovoProduto: Number($('#cfg-margem-novo').value),
      avisarAumentoAcima: Number($('#cfg-avisar').value),
      somarFrete: $('#cfg-frete').checked,
      somarIPI: $('#cfg-ipi').checked,
      somarST: $('#cfg-st').checked,
    },
  };

  const area = $('#resultado-config');
  try {
    const resposta = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novo),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);
    mostrarTeste(area, true, 'Ajustes salvos.');
  } catch (erro) {
    mostrarTeste(area, false, erro.message);
  }
});

$('#btn-testar-banco').addEventListener('click', async () => {
  const area = $('#resultado-banco');
  mostrarTeste(area, true, 'Testando...');
  try {
    const resposta = await fetch('/api/testar-banco');
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);
    mostrarTeste(area, true, `Conectou! ${resultado.totalProdutos} produtos no banco.`);
  } catch (erro) {
    mostrarTeste(area, false, erro.message);
  }
});

$('#btn-abrir-lojas').addEventListener('click', () => abrirConfiguracaoDeLojas());

$('#btn-testar-pastas').addEventListener('click', async () => {
  const area = $('#resultado-pastas');
  const pastas = $('#cfg-pastas-notas').value.trim();
  if (!pastas) { mostrarTeste(area, false, 'Escreva ao menos uma pasta.'); return; }

  mostrarTeste(area, true, 'Testando...');
  try {
    const resposta = await fetch('/api/notas/testar-pasta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pastas }),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    const linhas = resultado.resultados.map((r) => `${r.ok ? 'OK' : 'ERRO'} — ${r.pasta}: ${r.mensagem}`);
    mostrarTeste(area, resultado.resultados.every((r) => r.ok), linhas.join(' | '));
  } catch (erro) {
    mostrarTeste(area, false, erro.message);
  }
});

$('#btn-testar-ia').addEventListener('click', async () => {
  const area = $('#resultado-ia');
  mostrarTeste(area, true, 'Testando...');
  try {
    const resposta = await fetch('/api/testar-ia');
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);
    mostrarTeste(area, true, `Chave funcionando. ${resultado.modelosDisponiveis} modelos disponíveis.`);
    carregarModelos($('#cfg-modelo-ia').value);
  } catch (erro) {
    mostrarTeste(area, false, erro.message);
  }
});

function mostrarTeste(area, deuCerto, texto) {
  area.className = 'resultado-teste mostrando ' + (deuCerto ? 'ok' : 'falhou');
  area.textContent = texto;
}

// ---------------------------------------------------------------------------


