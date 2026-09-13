/* Telas de Orcamento e de Cliente. */

import {
  $, $$, api, dinheiro, escapar, numeroBR, dataBR, avisar, mostrarTela, aoDigitar, sessao,
} from './comum.js';
import { icone } from './icones.js';

const estado = {
  arquivos: [],
  cliente: null,
  orcamento: null,
  id: null,
  itemEmEscolha: null,
  gravado: null,
};

// ---------------------------------------------------------------------------
// Cliente do orcamento
// ---------------------------------------------------------------------------

aoDigitar($('#busca-cliente'), buscarClientes);

async function buscarClientes() {
  const termo = $('#busca-cliente').value.trim();
  const area = $('#resultado-clientes');
  if (termo.length < 2) { area.innerHTML = ''; return; }

  area.innerHTML = '<p class="ajuda">Procurando...</p>';
  try {
    const { clientes } = await api('/api/clientes?q=' + encodeURIComponent(termo));
    if (!clientes.length) {
      const digitos = termo.replace(/\D/g, '');
      area.innerHTML = digitos.length === 14
        ? `<p class="ajuda">Nao achei esse CNPJ no Solus.</p>
           <button class="botao principal largura-total" id="btn-cadastrar-desse">
             Buscar na Receita e cadastrar
           </button>`
        : '<p class="ajuda">Nenhum cliente encontrado.</p>';
      $('#btn-cadastrar-desse')?.addEventListener('click', () => {
        mostrarTela('cliente');
        $('#cnpj-consulta').value = termo;
        consultarCnpj();
      });
      return;
    }

    area.innerHTML = clientes.map((c) => `
      <button data-cliente="${escapar(c.codigo)}">
        <strong>${escapar(c.nome)}</strong>
        ${c.fantasia ? `<br><em>${escapar(c.fantasia)}</em>` : ''}
        <br>cod. ${escapar(c.codigo)} ${c.cpfCnpj ? '· ' + escapar(c.cpfCnpj) : ''}
        ${c.cidade ? '· ' + escapar(c.cidade) + '/' + escapar(c.uf) : ''}
      </button>`).join('');

    area.querySelectorAll('[data-cliente]').forEach((botao) => {
      botao.addEventListener('click', () => escolherCliente(botao.dataset.cliente));
    });
  } catch (erro) {
    area.innerHTML = `<p class="ajuda">${escapar(erro.message)}</p>`;
  }
}

async function escolherCliente(codigo) {
  try {
    const { cliente, compras } = await api('/api/clientes/' + encodeURIComponent(codigo));
    estado.cliente = cliente;
    $('#resultado-clientes').innerHTML = '';
    $('#busca-cliente').value = '';
    desenharClienteEscolhido(compras);
    carregarOpcoesDePagamento();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

function desenharClienteEscolhido(compras = []) {
  const area = $('#cliente-escolhido');
  if (!estado.cliente) {
    area.innerHTML = '';
    area.classList.add('escondido');
    return;
  }

  const c = estado.cliente;
  area.classList.remove('escondido');
  area.innerHTML = `
    <div class="cliente-cartao">
      <div>
        <strong>${escapar(c.nome)}</strong><br>
        <span class="ajuda">cod. ${escapar(c.codigo)}
          ${c.cpfCnpj ? '· ' + escapar(c.cpfCnpj) : ''}
          ${c.cidade ? '· ' + escapar(c.cidade) + '/' + escapar(c.uf) : ''}</span>
        ${compras.length
          ? `<br><span class="etiqueta ok">${compras.length} compras no histórico</span>`
          : '<br><span class="etiqueta">sem compras anteriores</span>'}
      </div>
      <button class="botao secundario" id="btn-tirar-cliente">Trocar</button>
    </div>`;

  $('#btn-tirar-cliente').addEventListener('click', () => {
    estado.cliente = null;
    desenharClienteEscolhido();
  });
}

// ---------------------------------------------------------------------------
// Envio da lista
// ---------------------------------------------------------------------------

const areaLista = $('#area-lista');
areaLista.addEventListener('click', () => $('#arquivo-lista').click());
$('#arquivo-lista').addEventListener('change', (e) => adicionarArquivos(e.target.files));
$('#btn-foto-lista').addEventListener('click', () => $('#camera-lista').click());
$('#camera-lista').addEventListener('change', (e) => adicionarArquivos(e.target.files));

['dragenter', 'dragover'].forEach((evento) =>
  areaLista.addEventListener(evento, (e) => { e.preventDefault(); areaLista.classList.add('arrastando'); }));
['dragleave', 'drop'].forEach((evento) =>
  areaLista.addEventListener(evento, (e) => { e.preventDefault(); areaLista.classList.remove('arrastando'); }));
areaLista.addEventListener('drop', (e) => adicionarArquivos(e.dataTransfer.files));

function adicionarArquivos(lista) {
  for (const arquivo of lista) {
    if (estado.arquivos.some((a) => a.name === arquivo.name && a.size === arquivo.size)) continue;
    estado.arquivos.push(arquivo);
  }
  desenharArquivosLista();
}

function desenharArquivosLista() {
  $('#arquivos-lista').innerHTML = estado.arquivos.map((a, i) => `
    <li><span>${icone('anexo', 16)} ${escapar(a.name)}</span>
    <button data-tirar="${i}" aria-label="Remover">${icone('fechar', 17)}</button></li>`).join('');

  $$('#arquivos-lista [data-tirar]').forEach((botao) => {
    botao.addEventListener('click', () => {
      estado.arquivos.splice(Number(botao.dataset.tirar), 1);
      desenharArquivosLista();
    });
  });
  atualizarBotaoMontar();
}

$('#texto-lista').addEventListener('input', atualizarBotaoMontar);

function atualizarBotaoMontar() {
  $('#btn-montar').disabled = !estado.arquivos.length && !$('#texto-lista').value.trim();
}

$('#btn-montar').addEventListener('click', async () => {
  const dados = new FormData();
  estado.arquivos.forEach((a) => dados.append('arquivos', a));
  dados.append('texto', $('#texto-lista').value);
  dados.append('observacao', $('#obs-lista').value);
  if (estado.cliente) dados.append('cliente', estado.cliente.codigo);

  $('#montando').classList.remove('escondido');
  $('#btn-montar').disabled = true;

  try {
    const resposta = await api('/api/orcamento/montar', { method: 'POST', body: dados });
    estado.orcamento = resposta.orcamento;
    estado.id = resposta.id;
    estado.gravado = null;
    desenharOrcamento();
    carregarOpcoesDePagamento();
    mostrarTela('conferir-orcamento');
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    $('#montando').classList.add('escondido');
    atualizarBotaoMontar();
  }
});

// ---------------------------------------------------------------------------
// Conferencia do orcamento
// ---------------------------------------------------------------------------

function desenharOrcamento() {
  const orc = estado.orcamento;
  const resumo = orc.resumo;
  const podeVerCusto = sessao.operador?.permissoes?.verCusto;

  $('#cabecalho-orcamento').innerHTML = `
    <h2>${escapar(orc.cliente?.nome || 'Consumidor')}</h2>
    <p class="ajuda" style="margin:0">
      ${resumo.totalItens} ${resumo.totalItens === 1 ? 'item' : 'itens'} na lista
      ${resumo.precisamEscolha ? ` · <strong style="color:var(--aviso)">${resumo.precisamEscolha} precisam que você escolha o produto</strong>` : ''}
    </p>
    ${orc.observacoesDaLista
      ? `<div class="item-aviso info" style="margin-top:10px">Observação da leitura: ${escapar(orc.observacoesDaLista)}</div>`
      : ''}`;

  $('#itens-orcamento').innerHTML = orc.itens
    .map((item, indice) => desenharItemOrcamento(item, indice, podeVerCusto)).join('');

  ligarEventosOrcamento();
  atualizarTotal();
}

function desenharItemOrcamento(item, indice, podeVerCusto) {
  const escolhido = Boolean(item.produto);
  const fora = !item.incluir;

  let classe = 'item';
  if (fora) classe += ' ignorado';
  else if (!escolhido) classe += ' atencao';

  const avisos = (item.avisos || []).map((a) => `
    <div class="item-aviso${a.tipo === 'cancelado' ? ' erro' : a.tipo === 'historico' ? ' info' : ''}">
      ${escapar(a.texto)}
    </div>`).join('');

  if (!escolhido) {
    const opcoes = item.opcoes?.length
      ? item.opcoes.map((p) => `
          <button class="opcao-produto" data-escolher="${indice}" data-codigo="${escapar(p.codigo)}">
            <strong>${escapar(p.descricao)}</strong><br>
            <span class="ajuda">${dinheiro(p.vendaAtual)} · estoque ${numeroBR(p.estoque)}
              ${p.estoque <= 0 ? ' · <span style="color:var(--perigo)">sem estoque</span>' : ''}</span>
          </button>`).join('')
      : '<p class="ajuda">Não achei nada parecido no estoque.</p>';

    return `
      <div class="${classe}" data-indice="${indice}">
        <div class="item-topo">
          <div>
            <div class="item-nome">"${escapar(item.textoOriginal)}"</div>
            <div class="comparacao-detalhe">
              o cliente pediu ${numeroBR(item.quantidade)}
              ${item.unidade ? escapar(item.unidade) : ''}
            </div>
          </div>
        </div>
        ${avisos}
        <div class="escolha-titulo">Qual desses é?</div>
        <div class="opcoes-produto">${opcoes}</div>
        <div class="item-acoes">
          <button class="botao secundario" data-procurar="${indice}">Procurar outro</button>
          <button class="botao secundario" data-tirar-item="${indice}">Tirar da lista</button>
        </div>
      </div>`;
  }

  const custo = podeVerCusto && item.custo
    ? `<div class="comparacao-bloco">
         <div class="comparacao-titulo">Custo / margem</div>
         <div class="comparacao-valor">${dinheiro(item.custo)}</div>
         <div class="comparacao-detalhe ${item.margem < 15 ? 'subiu' : ''}">
           margem ${item.margem != null ? item.margem.toFixed(0) + '%' : '-'}
         </div>
       </div>`
    : '';

  const historico = item.ultimoPrecoCliente
    ? `<div class="comparacao-bloco">
         <div class="comparacao-titulo">Esse cliente pagou</div>
         <div class="comparacao-valor">${dinheiro(item.ultimoPrecoCliente.preco)}</div>
         <div class="comparacao-detalhe">em ${dataBR(item.ultimoPrecoCliente.data)}</div>
       </div>`
    : item.ultimoPrecoLoja
      ? `<div class="comparacao-bloco">
           <div class="comparacao-titulo">Última venda na loja</div>
           <div class="comparacao-valor">${dinheiro(item.ultimoPrecoLoja.preco)}</div>
           <div class="comparacao-detalhe">em ${dataBR(item.ultimoPrecoLoja.data)}</div>
         </div>`
      : '';

  return `
    <div class="${classe}" data-indice="${indice}">
      <div class="item-topo">
        <div>
          <div class="item-nome">${escapar(item.produto.descricao)}</div>
          <div class="comparacao-detalhe">
            pedido como "${escapar(item.textoOriginal)}"
            ${item.comoAchou ? ' · ' + escapar(item.comoAchou) : ''}
          </div>
        </div>
      </div>
      ${avisos}

      <div class="comparacao">
        <div class="comparacao-bloco">
          <div class="comparacao-titulo">Preço de tabela</div>
          <div class="comparacao-valor">${dinheiro(item.precoTabela)}</div>
          <div class="comparacao-detalhe">estoque ${numeroBR(item.produto.estoque)}</div>
        </div>
        ${historico || custo}
      </div>

      <div class="linha-quantidade">
        <label class="campo">
          <span>Quantidade</span>
          <input type="number" step="0.01" min="0" data-qtd="${indice}" value="${item.quantidade}">
        </label>
        <label class="campo">
          <span>Preço unitário</span>
          <input type="number" step="0.01" min="0" data-preco="${indice}" value="${Number(item.precoUnitario).toFixed(2)}">
        </label>
        <div class="campo">
          <span>Total do item</span>
          <div class="total-item">${dinheiro(item.total)}</div>
        </div>
      </div>

      <div class="item-acoes">
        <button class="botao secundario" data-procurar="${indice}">Trocar produto</button>
        <button class="botao secundario" data-tirar-item="${indice}">
          ${fora ? 'Voltar a incluir' : 'Tirar da lista'}
        </button>
      </div>
    </div>`;
}

function ligarEventosOrcamento() {
  $$('[data-escolher]').forEach((botao) => {
    botao.addEventListener('click', () =>
      escolherProduto(Number(botao.dataset.escolher), botao.dataset.codigo));
  });

  $$('[data-qtd]').forEach((campo) => {
    campo.addEventListener('change', () =>
      ajustar(Number(campo.dataset.qtd), { quantidade: Number(campo.value) }));
  });

  $$('[data-preco]').forEach((campo) => {
    campo.addEventListener('change', () =>
      ajustar(Number(campo.dataset.preco), { precoUnitario: Number(campo.value) }));
  });

  $$('[data-tirar-item]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const indice = Number(botao.dataset.tirarItem);
      ajustar(indice, { incluir: !estado.orcamento.itens[indice].incluir });
    });
  });

  $$('[data-procurar]').forEach((botao) => {
    botao.addEventListener('click', () => abrirProcuraProduto(Number(botao.dataset.procurar)));
  });
}

async function escolherProduto(indice, codigo) {
  try {
    const { item, resumo } = await api('/api/orcamento/escolher', {
      method: 'POST',
      body: JSON.stringify({ id: estado.id, indice, codigoProduto: codigo }),
    });
    estado.orcamento.itens[indice] = item;
    estado.orcamento.resumo = resumo;
    desenharOrcamento();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

async function ajustar(indice, mudancas) {
  try {
    const { item, resumo } = await api('/api/orcamento/ajustar', {
      method: 'POST',
      body: JSON.stringify({ id: estado.id, indice, ...mudancas }),
    });
    estado.orcamento.itens[indice] = item;
    estado.orcamento.resumo = resumo;
    desenharOrcamento();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

function atualizarTotal() {
  const resumo = estado.orcamento.resumo;
  $('#total-orcamento').innerHTML = `
    <div>
      <div class="ajuda">Total do orçamento</div>
      <div class="valor-total">${dinheiro(resumo.total)}</div>
    </div>`;
  $('#btn-gravar-orcamento').disabled = resumo.total <= 0;
}

// ---------------------------------------------------------------------------
// Procurar produto (trocar ou adicionar)
// ---------------------------------------------------------------------------

function abrirProcuraProduto(indice) {
  estado.itemEmEscolha = indice;
  const item = indice >= 0 ? estado.orcamento.itens[indice] : null;
  $('#procura-produto').value = item ? item.descricao : '';
  $('#modal-produto').classList.remove('escondido');
  procurarProduto();
  $('#procura-produto').focus();
}

$('#btn-fechar-produto').addEventListener('click', () =>
  $('#modal-produto').classList.add('escondido'));

$('#btn-adicionar-item').addEventListener('click', () => abrirProcuraProduto(-1));

aoDigitar($('#procura-produto'), procurarProduto);

async function procurarProduto() {
  const termo = $('#procura-produto').value.trim();
  const area = $('#resultado-produtos');
  if (termo.length < 2) { area.innerHTML = ''; return; }

  area.innerHTML = '<p class="ajuda">Procurando...</p>';
  try {
    const { produtos } = await api('/api/orcamento/buscar-produto?q=' + encodeURIComponent(termo));
    if (!produtos.length) {
      area.innerHTML = '<p class="ajuda">Nenhum produto encontrado.</p>';
      return;
    }
    area.innerHTML = produtos.map((p) => `
      <button data-usar="${escapar(p.codigo)}">
        <strong>${escapar(p.descricao)}</strong><br>
        cod. ${escapar(p.codigo)} · ${dinheiro(p.vendaAtual)} · estoque ${numeroBR(p.estoque)}
        ${p.cancelado ? ' · <span style="color:var(--perigo)">CANCELADO</span>' : ''}
      </button>`).join('');

    area.querySelectorAll('[data-usar]').forEach((botao) => {
      botao.addEventListener('click', () => usarProduto(botao.dataset.usar));
    });
  } catch (erro) {
    area.innerHTML = `<p class="ajuda">${escapar(erro.message)}</p>`;
  }
}

async function usarProduto(codigo) {
  try {
    if (estado.itemEmEscolha >= 0) {
      await escolherProduto(estado.itemEmEscolha, codigo);
    } else {
      const quantidade = Number($('#qtd-novo-item').value) || 1;
      const { orcamento, resumo } = await api('/api/orcamento/adicionar', {
        method: 'POST',
        body: JSON.stringify({ id: estado.id, codigoProduto: codigo, quantidade }),
      });
      estado.orcamento = orcamento;
      estado.orcamento.resumo = resumo;
      desenharOrcamento();
    }
    $('#modal-produto').classList.add('escondido');
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

// ---------------------------------------------------------------------------
// Pagamento e entrega
// ---------------------------------------------------------------------------

/**
 * Busca as formas de pagamento do Solus e ja sugere a que esse cliente costuma usar.
 * E o "inteligente" aqui: em vez de perguntar do zero, vem preenchido com o
 * historico do proprio cliente, e a pessoa so confirma.
 */
async function carregarOpcoesDePagamento() {
  const seletor = $('#forma-pagamento');
  if (!seletor) return;

  try {
    const codigo = estado.cliente?.codigo || '';
    const dados = await api('/api/pagamento/opcoes' + (codigo ? '?cliente=' + encodeURIComponent(codigo) : ''));
    estado.formasDePagamento = dados.formas || [];

    const sugerida = dados.sugestao?.formaDePagamento || '';
    seletor.innerHTML = '<option value="">— escolha —</option>'
      + estado.formasDePagamento.map((f) =>
        `<option value="${escapar(f.nome)}" ${f.nome === sugerida ? 'selected' : ''}>${escapar(f.rotulo)}</option>`).join('');

    const aviso = $('#aviso-pagamento');
    if (dados.sugestao) {
      aviso.textContent = `Da última vez esse cliente pagou em ${dados.sugestao.formaDePagamento.trim()}`
        + (dados.sugestao.frete > 0 ? ` e teve frete de ${dinheiro(dados.sugestao.frete)}.` : '.');
      aviso.className = 'item-aviso info';
      if (dados.sugestao.frete > 0 && !$('#valor-frete').value) {
        $('#valor-frete').value = dados.sugestao.frete.toFixed(2);
        $('#modalidade-frete').value = dados.sugestao.modalidadeFrete || '0';
      }
    } else {
      aviso.className = 'item-aviso escondido';
    }

    // se a observação já disser a forma de pagamento ou o frete, aproveita
    aproveitarObservacao();
  } catch {
    seletor.innerHTML = '<option value="">— escolha —</option>';
  }
}

/**
 * Lê o que foi escrito na observação e preenche o que der ("boleto 28 dias",
 * "frete 50"). Quem calcula continua sendo o sistema; isto só evita redigitar.
 */
function aproveitarObservacao() {
  const texto = ((estado.orcamento?.observacao || '') + ' ' + ($('#obs-orcamento')?.value || '')).toLowerCase();
  if (!texto.trim()) return;

  if (!$('#forma-pagamento').value) {
    const achada = (estado.formasDePagamento || []).find((f) => {
      const nome = f.rotulo.toLowerCase();
      return texto.includes(nome) || (nome.startsWith('cartao') && texto.includes('cartão'));
    });
    if (achada) $('#forma-pagamento').value = achada.nome;
  }

  if (!$('#valor-frete').value) {
    const frete = texto.match(/frete\s*(?:de\s*)?r?\$?\s*([\d.,]+)/);
    if (frete) {
      const valor = Number(frete[1].replace(/./g, '').replace(',', '.'));
      if (valor > 0) {
        $('#valor-frete').value = valor.toFixed(2);
        if ($('#modalidade-frete').value === '9') $('#modalidade-frete').value = '0';
      }
    }
  }

  if (!$('#prazo-entrega').value) {
    const prazo = texto.match(/(\d+)\s*dias?\s*(?:uteis|úteis)?/);
    if (prazo && texto.includes('entrega')) $('#prazo-entrega').value = prazo[0];
  }
}

function lerPagamentoDaTela() {
  return {
    formaDePagamento: $('#forma-pagamento')?.value || '',
    frete: Number($('#valor-frete')?.value) || 0,
    modalidadeFrete: $('#modalidade-frete')?.value || '9',
    entrega: $('#prazo-entrega')?.value || '',
    validadeDias: Number($('#validade-orcamento')?.value) || 7,
    observacao: $('#obs-orcamento')?.value || '',
    vendedor: sessao.operador?.nome || '',
    codigoVendedor: sessao.operador?.codigoVendedor || '',
  };
}

// ---------------------------------------------------------------------------
// Gravar, PDF e compartilhar
// ---------------------------------------------------------------------------

$('#btn-gravar-orcamento').addEventListener('click', async () => {
  const resumo = estado.orcamento.resumo;
  const forcar = resumo.precisamEscolha > 0
    ? confirm(`${resumo.precisamEscolha} ${resumo.precisamEscolha === 1 ? 'item ainda não foi escolhido' : 'itens ainda não foram escolhidos'} e ${resumo.precisamEscolha === 1 ? 'vai ficar' : 'vão ficar'} de fora do orçamento.\n\nGravar assim mesmo?`)
    : confirm(`Gravar o orçamento de ${dinheiro(resumo.total)} no Solus?\n\nEle vai aparecer na tela de orçamentos do Solus, para você finalizar a venda por lá.`);

  if (!forcar) return;

  const botao = $('#btn-gravar-orcamento');
  botao.disabled = true;
  botao.textContent = 'Gravando...';

  try {
    const resultado = await api('/api/orcamento/gravar', {
      method: 'POST',
      body: JSON.stringify({
        id: estado.id,
        observacao: $('#obs-orcamento').value,
        pagamento: lerPagamentoDaTela(),
      }),
    });
    estado.gravado = resultado;
    estado.orcamento.numero = resultado.numero;
    mostrarResultadoOrcamento(resultado);
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Gravar no Solus';
  }
});

function mostrarResultadoOrcamento(resultado) {
  $('#resultado-orcamento').innerHTML = `
    <div class="alerta-sucesso" style="padding:14px;border-radius:9px;margin-bottom:14px">
      <strong>Orçamento nº ${resultado.numero} gravado no Solus.</strong><br>
      <span class="ajuda">Ele já aparece na tela de orçamentos do Solus.
      Para faturar, é só abrir lá e finalizar a venda normalmente.</span>
    </div>

    <div class="resumo-grade">
      <div class="resumo-item">
        <div class="resumo-numero">${resultado.quantidadeItens}</div>
        <div class="resumo-rotulo">itens</div>
      </div>
      <div class="resumo-item">
        <div class="resumo-numero" style="font-size:18px">${dinheiro(resultado.total)}</div>
        <div class="resumo-rotulo">total</div>
      </div>
    </div>

    <div class="acoes-pdf">
      <button class="botao principal" id="btn-compartilhar">${icone('compartilhar', 18)}<span>Enviar no WhatsApp</span></button>
      <button class="botao secundario" id="btn-baixar-pdf">${icone('baixar', 18)}<span>Baixar PDF</span></button>
      <button class="botao secundario" id="btn-imprimir">${icone('imprimir', 18)}<span>Imprimir</span></button>
    </div>
    <button class="botao secundario largura-total" id="btn-novo-orcamento">Fazer outro orçamento</button>`;

  $('#btn-compartilhar').addEventListener('click', compartilhar);
  $('#btn-baixar-pdf').addEventListener('click', baixarPdf);
  $('#btn-imprimir').addEventListener('click', imprimir);
  $('#btn-novo-orcamento').addEventListener('click', recomecar);

  mostrarTela('resultado-orcamento');
}

async function pegarPdf() {
  const resposta = await fetch(`/api/orcamento/${estado.id}/pdf`, {
    headers: { 'x-sessao': sessao.token },
  });
  if (!resposta.ok) throw new Error('Nao consegui gerar o PDF.');
  return resposta.blob();
}

function nomeDoArquivo() {
  return `orcamento-${estado.gravado?.numero || 'sem-numero'}.pdf`;
}

async function baixarPdf() {
  try {
    const blob = await pegarPdf();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeDoArquivo();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

async function imprimir() {
  try {
    const blob = await pegarPdf();
    const url = URL.createObjectURL(blob);
    const janela = window.open(url, '_blank');
    if (!janela) {
      avisar('O navegador bloqueou a janela de impressao. Libere e tente de novo.', 'erro');
      return;
    }
    janela.addEventListener('load', () => janela.print(), { once: true });
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

async function compartilhar() {
  try {
    const blob = await pegarPdf();
    const arquivo = new File([blob], nomeDoArquivo(), { type: 'application/pdf' });
    const { texto } = await api(`/api/orcamento/${estado.id}/texto`);

    // o jeito bom: abre o compartilhamento do celular e a pessoa escolhe o contato
    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], text: texto, title: 'Orçamento' });
      return;
    }

    // sem compartilhamento (PC, ou acesso sem HTTPS): baixa o PDF e abre o WhatsApp
    // com o texto pronto, para a pessoa anexar o arquivo
    await baixarPdf();
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    avisar('PDF baixado. Anexe ele na conversa do WhatsApp que abriu.', 'ok');
  } catch (erro) {
    if (erro.name === 'AbortError') return;         // a pessoa fechou o menu
    avisar(erro.message, 'erro');
  }
}

function recomecar() {
  estado.arquivos = [];
  estado.orcamento = null;
  estado.id = null;
  estado.gravado = null;
  $('#texto-lista').value = '';
  $('#obs-lista').value = '';
  $('#obs-orcamento').value = '';
  desenharArquivosLista();
  mostrarTela('orcamento');
}

$('#btn-voltar-orcamento').addEventListener('click', () => {
  if (confirm('Cancelar este orçamento? O que foi conferido será perdido.')) recomecar();
});

// ---------------------------------------------------------------------------
// Cadastro de cliente por CNPJ
// ---------------------------------------------------------------------------

$('#btn-consultar-cnpj').addEventListener('click', consultarCnpj);
$('#cnpj-consulta').addEventListener('keydown', (e) => { if (e.key === 'Enter') consultarCnpj(); });

async function consultarCnpj() {
  const cnpj = $('#cnpj-consulta').value.replace(/\D/g, '');
  const area = $('#dados-cnpj');

  if (cnpj.length !== 14) {
    avisar('Digite os 14 numeros do CNPJ.', 'erro');
    return;
  }

  area.innerHTML = '<p class="ajuda">Consultando na Receita...</p>';
  try {
    const { dados, jaCadastrado } = await api('/api/consultar-cnpj/' + cnpj);

    if (jaCadastrado) {
      area.innerHTML = `
        <div class="item-aviso info">
          Esse CNPJ já está cadastrado no Solus:
          <strong>${escapar(jaCadastrado.nome)}</strong> (cód. ${escapar(jaCadastrado.codigo)}).
        </div>
        <button class="botao principal largura-total" id="btn-usar-existente">
          Usar esse cliente no orçamento
        </button>`;
      $('#btn-usar-existente').addEventListener('click', () => {
        escolherCliente(jaCadastrado.codigo);
        mostrarTela('orcamento');
      });
      return;
    }

    area.innerHTML = `
      ${!dados.ativa
        ? `<div class="item-aviso erro">Atenção: essa empresa está <strong>${escapar(dados.situacao)}</strong> na Receita.</div>`
        : ''}
      <div class="dados-empresa">
        <div><span>Razão social</span><strong>${escapar(dados.razaoSocial)}</strong></div>
        ${dados.fantasia ? `<div><span>Nome fantasia</span><strong>${escapar(dados.fantasia)}</strong></div>` : ''}
        <div><span>CNPJ</span><strong>${escapar(dados.cnpj)}</strong></div>
        ${dados.inscricaoEstadual ? `<div><span>Inscrição estadual</span><strong>${escapar(dados.inscricaoEstadual)}</strong></div>` : ''}
        <div><span>Endereço</span><strong>${escapar([dados.rua, dados.numero].filter(Boolean).join(', ') || '(não informado)')}</strong></div>
        <div><span>Bairro / Cidade</span><strong>${escapar([dados.bairro, dados.cidade + '/' + dados.uf].filter(Boolean).join(' - '))}</strong></div>
        <div><span>CEP</span><strong>${escapar(dados.cep)}</strong></div>
        ${dados.telefone ? `<div><span>Telefone</span><strong>${escapar(dados.telefone)}</strong></div>` : ''}
        ${dados.email ? `<div><span>E-mail</span><strong>${escapar(dados.email)}</strong></div>` : ''}
        <div><span>Atividade</span><strong>${escapar(dados.atividade)}</strong></div>
      </div>
      <label class="campo">
        <span>Celular / WhatsApp <em>(a Receita não informa)</em></span>
        <input type="tel" id="celular-cliente" placeholder="(14) 99999-9999">
      </label>
      <label class="campo">
        <span>Contato <em>(nome de quem compra)</em></span>
        <input type="text" id="contato-cliente" placeholder="opcional">
      </label>
      <button class="botao principal largura-total" id="btn-salvar-cliente">
        Cadastrar no Solus
      </button>`;

    $('#btn-salvar-cliente').addEventListener('click', () => salvarCliente(dados));
  } catch (erro) {
    area.innerHTML = `<div class="item-aviso erro">${escapar(erro.message)}</div>`;
  }
}

async function salvarCliente(dados) {
  const botao = $('#btn-salvar-cliente');
  botao.disabled = true;
  botao.textContent = 'Cadastrando...';

  try {
    const resposta = await api('/api/clientes', {
      method: 'POST',
      body: JSON.stringify({
        ...dados,
        celular: $('#celular-cliente')?.value || '',
        contato: $('#contato-cliente')?.value || '',
      }),
    });

    avisar(resposta.jaExistia
      ? 'Esse cliente já existia no Solus.'
      : `Cliente cadastrado com o código ${resposta.cliente.codigo}.`);

    $('#dados-cnpj').innerHTML = `
      <div class="alerta-sucesso" style="padding:12px;border-radius:9px">
        <strong>${escapar(resposta.cliente.nome)}</strong><br>
        código ${escapar(resposta.cliente.codigo)} no Solus
      </div>
      <button class="botao principal largura-total" id="btn-usar-novo">
        Usar no orçamento
      </button>`;

    $('#btn-usar-novo').addEventListener('click', () => {
      escolherCliente(resposta.cliente.codigo);
      mostrarTela('orcamento');
    });
  } catch (erro) {
    avisar(erro.message, 'erro');
    botao.disabled = false;
    botao.textContent = 'Cadastrar no Solus';
  }
}

export { recomecar };
