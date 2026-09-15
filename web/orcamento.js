/* Telas de Orcamento e de Cliente. */

import {
  $, $$, api, dinheiro, escapar, numeroBR, dataBR, avisar, mostrarTela, aoDigitar, sessao,
  animarSeForAPrimeiraVez, permitirAnimarDeNovo,
} from './comum.js';
import { icone } from './icones.js';
import { mostrarProgressoNoCartao } from './progresso.js';
import { ligarColar } from './colar.js';
import { fecharModal } from './efeitos.js';

const estado = {
  arquivos: [],
  cliente: null,
  nomeLivre: '',          // nome de quem nao tem cadastro (sai no PDF/Excel)
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
    const digitos = termo.replace(/\D/g, '');
    // nome digitado (nao CPF/CNPJ) pode virar o nome do orcamento sem cadastrar
    const podeUsarSoONome = digitos.length < 11 && termo.length >= 3;
    const botaoSoNome = podeUsarSoONome
      ? `<button class="usar-so-nome" id="btn-so-nome">
           ${icone('pessoa', 18)}
           <span><strong>Usar só o nome “${escapar(termo)}”</strong>
           <em>sem cadastrar — sai no PDF e no Excel; no Solus entra como consumidor</em></span>
         </button>`
      : '';

    if (!clientes.length) {
      area.innerHTML = (digitos.length === 14
        ? `<p class="ajuda">Nao achei esse CNPJ no Solus.</p>
           <button class="botao principal largura-total" id="btn-cadastrar-desse">
             Buscar na Receita e cadastrar
           </button>`
        : '<p class="ajuda">Nenhum cliente cadastrado com esse nome.</p>') + botaoSoNome;
      $('#btn-cadastrar-desse')?.addEventListener('click', () => {
        mostrarTela('cliente');
        $('#cnpj-consulta').value = termo;
        consultarCnpj();
      });
      $('#btn-so-nome')?.addEventListener('click', () => usarSoONome(termo));
      return;
    }

    area.innerHTML = clientes.map((c) => `
      <button data-cliente="${escapar(c.codigo)}">
        <strong>${escapar(c.nome)}</strong>
        ${c.fantasia ? `<br><em>${escapar(c.fantasia)}</em>` : ''}
        <br>cod. ${escapar(c.codigo)} ${c.cpfCnpj ? '· ' + escapar(c.cpfCnpj) : ''}
        ${c.cidade ? '· ' + escapar(c.cidade) + '/' + escapar(c.uf) : ''}
      </button>`).join('') + botaoSoNome;

    area.querySelectorAll('[data-cliente]').forEach((botao) => {
      botao.addEventListener('click', () => escolherCliente(botao.dataset.cliente));
    });
    $('#btn-so-nome')?.addEventListener('click', () => usarSoONome(termo));
  } catch (erro) {
    area.innerHTML = `<p class="ajuda">${escapar(erro.message)}</p>`;
  }
}

/**
 * Orcamento para quem nao tem cadastro ("Dona Maria", "Escola X").
 * Cadastrar so para mandar um orcamento da trabalho e suja o Solus de cliente
 * que talvez nunca compre. O nome sai no PDF, no Excel e no nome do arquivo.
 */
async function usarSoONome(nome) {
  estado.cliente = null;
  estado.nomeLivre = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  $('#resultado-clientes').innerHTML = '';
  $('#busca-cliente').value = '';
  desenharClienteEscolhido();
  carregarOpcoesDePagamento();
  await aplicarClienteNoOrcamento();
}

async function escolherCliente(codigo) {
  try {
    const { cliente, compras } = await api('/api/clientes/' + encodeURIComponent(codigo));
    estado.cliente = cliente;
    estado.nomeLivre = '';
    $('#resultado-clientes').innerHTML = '';
    $('#busca-cliente').value = '';
    desenharClienteEscolhido(compras);
    carregarOpcoesDePagamento();
    await aplicarClienteNoOrcamento();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

/**
 * Com o orcamento ja montado, trocar (ou escolher) o cliente refaz o historico de
 * preco de todos os itens no servidor. Sem isto, quem escolhia o cliente depois de
 * montar a lista via "esse cliente pagou" sempre vazio.
 */
async function aplicarClienteNoOrcamento() {
  if (!estado.id || !estado.orcamento) return;
  try {
    const { orcamento } = await api('/api/orcamento/cliente', {
      method: 'POST',
      body: JSON.stringify({
        id: estado.id,
        codigoCliente: estado.cliente?.codigo || '',
        nomeCliente: estado.cliente ? '' : estado.nomeLivre,
      }),
    });
    estado.orcamento = orcamento;
    desenharOrcamento();
    mostrarTela('conferir-orcamento');
    avisar(estado.cliente
      ? `Preços conferidos com o histórico de ${estado.cliente.nome}.`
      : estado.nomeLivre
        ? `Orçamento em nome de ${estado.nomeLivre} (sem cadastro).`
        : 'Orçamento voltou para consumidor.', 'ok');
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

function desenharClienteEscolhido(compras = []) {
  const area = $('#cliente-escolhido');
  if (!estado.cliente && estado.nomeLivre) {
    area.classList.remove('escondido');
    area.innerHTML = `
      <div class="cliente-cartao">
        <div>
          <strong>${escapar(estado.nomeLivre)}</strong><br>
          <span class="etiqueta aviso">sem cadastro</span>
          <span class="ajuda">no Solus entra como consumidor</span>
        </div>
        <button class="botao secundario" id="btn-tirar-cliente">Trocar</button>
      </div>`;
    $('#btn-tirar-cliente').addEventListener('click', async () => {
      estado.nomeLivre = '';
      desenharClienteEscolhido();
      await aplicarClienteNoOrcamento();
    });
    return;
  }
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

  $('#btn-tirar-cliente').addEventListener('click', async () => {
    estado.cliente = null;
    desenharClienteEscolhido();
    carregarOpcoesDePagamento();
    await aplicarClienteNoOrcamento();
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

// print do WhatsApp copiado: Ctrl+V e a imagem entra, sem salvar em pasta
ligarColar({ tela: 'orcamento', aoColar: adicionarArquivos, destacar: areaLista });

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
  else if (estado.nomeLivre) dados.append('nomeCliente', estado.nomeLivre);

  const temFoto = estado.arquivos.length > 0;
  $('#btn-montar').disabled = true;
  const pararProgresso = mostrarProgressoNoCartao($('#montando'), {
    titulo: 'Montando o orçamento',
    etapas: [
      temFoto ? 'A IA está lendo a lista' : 'Lendo a lista',
      'Procurando cada item no catálogo',
      'Colocando na frente o que mais sai',
      ...(estado.cliente ? ['Vendo o que esse cliente já pagou'] : []),
      'Conferindo preço e estoque',
    ],
    segundosPorEtapa: temFoto ? 4 : 1.5,
    dicas: [
      'Produto parado há mais de 2 anos não entra na sugestão.',
      'Quando fico em dúvida entre dois produtos, pergunto em vez de chutar.',
      'Lista digitada é lida na hora e não gasta IA.',
    ],
  });

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
    pararProgresso();
    atualizarBotaoMontar();
  }
});

/**
 * Abre na tela um orçamento que já está montado no servidor.
 *
 * É por aqui que entra o orçamento que o assistente montou pelo chat: ele guarda
 * no servidor e manda só o código; a tela busca e mostra igualzinho ao que veio
 * de uma foto de lista. Conferir e gravar continua sendo feito aqui.
 */
export async function abrirOrcamentoMontado(id) {
  const { orcamento } = await api('/api/orcamento/' + encodeURIComponent(id));

  estado.orcamento = orcamento;
  estado.id = id;
  estado.gravado = null;
  estado.cliente = orcamento.cliente || null;
  estado.nomeLivre = orcamento.cliente ? '' : (orcamento.nomeCliente || '');

  // busca o histórico só para o cartão do cliente não mentir "sem compras anteriores"
  let compras = [];
  if (estado.cliente?.codigo) {
    compras = await api('/api/clientes/' + encodeURIComponent(estado.cliente.codigo))
      .then((r) => r.compras || [])
      .catch(() => []);
  }

  desenharClienteEscolhido(compras);
  permitirAnimarDeNovo($('#itens-orcamento'));
  desenharOrcamento();
  carregarOpcoesDePagamento();
  mostrarTela('conferir-orcamento');
}

// ---------------------------------------------------------------------------
// Conferencia do orcamento
// ---------------------------------------------------------------------------

function desenharOrcamento() {
  const orc = estado.orcamento;
  const resumo = orc.resumo;
  const podeVerCusto = sessao.operador?.permissoes?.verCusto;

  const faltam = resumo.precisamEscolha;
  $('#cabecalho-orcamento').innerHTML = `
    <div class="cliente-cartao">
      <div>
        <h2 style="margin:0">${escapar(orc.cliente?.nome || orc.nomeCliente || 'Consumidor')}</h2>
        <p class="ajuda" style="margin:2px 0 0">
          ${resumo.totalItens} ${resumo.totalItens === 1 ? 'item' : 'itens'} na lista
          ${orc.cliente ? ''
            : orc.nomeCliente ? ' · <span class="etiqueta aviso">sem cadastro</span> no Solus entra como consumidor'
              : ' · sem cliente, não dá para ver o último preço dele'}
        </p>
      </div>
      <button class="botao secundario" id="btn-trocar-cliente-orcamento">
        ${orc.cliente || orc.nomeCliente ? 'Trocar cliente' : 'Escolher cliente'}
      </button>
    </div>
    ${faltam
      ? `<div class="item-aviso" style="margin-top:10px">
           <strong>${faltam} ${faltam === 1 ? 'item precisa' : 'itens precisam'} que você escolha o produto.</strong>
           Eles estão marcados abaixo e só entram no orçamento depois da escolha.
         </div>`
      : ''}
    ${orc.observacoesDaLista
      ? `<div class="item-aviso info" style="margin-top:10px">Observação da leitura: ${escapar(orc.observacoesDaLista)}</div>`
      : ''}`;

  $('#btn-trocar-cliente-orcamento').addEventListener('click', () => {
    mostrarTela('orcamento');
    $('#busca-cliente').focus();
  });

  const lista = $('#itens-orcamento');
  lista.innerHTML = orc.itens
    .map((item, indice) => desenharItemOrcamento(item, indice, podeVerCusto)).join('');

  // a animação de entrada roda só quando a lista aparece pela primeira vez;
  // a cada mudança de quantidade ela ficaria piscando a tela inteira
  animarSeForAPrimeiraVez(lista);

  ligarEventosOrcamento();
  atualizarTotal();
}

/** Um quadradinho de comparacao (rotulo, valor e a explicacao embaixo). */
function bloco(titulo, valor, detalhe = '', classe = '') {
  return `
    <div class="comparacao-bloco">
      <div class="comparacao-titulo">${escapar(titulo)}</div>
      <div class="comparacao-valor">${valor}</div>
      ${detalhe ? `<div class="comparacao-detalhe ${classe}">${detalhe}</div>` : ''}
    </div>`;
}

/**
 * Etiquetas que explicam por que a opcao apareceu.
 * E o que torna a escolha rapida: em vez de ler seis nomes parecidos, a pessoa
 * ve "é o que mais sai" e "esse cliente já levou".
 */
function etiquetasDaOpcao(produto, posicao) {
  const etiquetas = [];
  if (posicao === 0) etiquetas.push('<span class="etiqueta ok">mais provável</span>');
  if (produto.motivo) etiquetas.push(`<span class="etiqueta info">${escapar(produto.motivo)}</span>`);
  if (produto.cancelado) etiquetas.push('<span class="etiqueta erro">cancelado</span>');
  else if (produto.estoque <= 0) etiquetas.push('<span class="etiqueta aviso">sem estoque</span>');
  if (produto.vendaAtual <= 0) etiquetas.push('<span class="etiqueta aviso">sem preço</span>');
  return etiquetas.length ? `<span class="item-etiquetas">${etiquetas.join('')}</span>` : '';
}

function desenharItemOrcamento(item, indice, podeVerCusto) {
  const escolhido = Boolean(item.produto);
  // "fora" e so o item que a pessoa TIROU da lista. Item esperando escolha nao e
  // item apagado - era isso que deixava a tela inteira meio transparente quando
  // a ferramenta ficava em duvida.
  const fora = escolhido && !item.incluir;

  let classe = 'item';
  if (fora) classe += ' ignorado';
  else if (!escolhido) classe += ' atencao';

  const avisos = (item.avisos || []).map((a) => `
    <div class="item-aviso${a.tipo === 'cancelado' ? ' erro' : a.tipo === 'historico' ? ' info' : ''}">
      ${escapar(a.texto)}
    </div>`).join('');

  if (!escolhido) {
    const opcoes = item.opcoes?.length
      ? item.opcoes.map((p, posicao) => `
          <button class="opcao-produto${posicao === 0 ? ' sugerida' : ''}"
                  data-escolher="${indice}" data-codigo="${escapar(p.codigo)}">
            <strong>${escapar(p.descricao)}</strong>
            ${etiquetasDaOpcao(p, posicao)}
            <span class="ajuda">${dinheiro(p.vendaAtual)} · estoque ${numeroBR(p.estoque)}</span>
          </button>`).join('')
      : '<p class="ajuda">Não achei nada parecido no estoque. Use "Procurar outro".</p>';

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
          <span class="etiqueta aviso">escolha o produto</span>
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

  // Os quatro blocos aparecem juntos: preco de tabela, o que ESTE cliente pagou,
  // a ultima venda da loja e o custo com a margem. Antes so um deles aparecia por
  // vez, e quem escolhia o produto na tela nao via nenhum.
  const blocos = [];

  blocos.push(bloco('Preço de tabela', dinheiro(item.precoTabela),
    `estoque ${numeroBR(item.produto.estoque)}`));

  if (item.ultimoPrecoCliente) {
    const diferenca = item.precoTabela > 0 && item.ultimoPrecoCliente.preco > 0
      ? ((item.precoUnitario - item.ultimoPrecoCliente.preco) / item.ultimoPrecoCliente.preco) * 100
      : null;
    blocos.push(bloco(
      'Esse cliente pagou',
      dinheiro(item.ultimoPrecoCliente.preco),
      `em ${dataBR(item.ultimoPrecoCliente.data)}`
        + (diferenca != null && Math.abs(diferenca) >= 1
          ? ` · hoje ${diferenca > 0 ? '+' : ''}${diferenca.toFixed(0)}%` : ''),
      diferenca != null && diferenca > 0 ? 'subiu' : ''
    ));
  } else if (estado.orcamento?.cliente) {
    blocos.push(bloco('Esse cliente pagou', '—', 'nunca levou este item'));
  }

  if (item.ultimoPrecoLoja) {
    blocos.push(bloco('Última venda na loja', dinheiro(item.ultimoPrecoLoja.preco),
      `em ${dataBR(item.ultimoPrecoLoja.data)}`));
  }

  if (podeVerCusto) {
    blocos.push(bloco(
      'Custo / margem',
      item.custo > 0 ? dinheiro(item.custo) : '—',
      item.margem != null ? `margem ${item.margem.toFixed(0)}%` : 'sem custo no cadastro',
      item.margem != null && item.margem < 15 ? 'subiu' : ''
    ));
  }

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

      <div class="comparacao">${blocos.join('')}</div>

      <div class="linha-quantidade">
        <label class="campo">
          <span>Quantidade</span>
          <input type="number" inputmode="${item.fracionado ? 'decimal' : 'numeric'}"
                 step="${item.fracionado ? '0.01' : '1'}" min="${item.fracionado ? '0.01' : '1'}"
                 data-qtd="${indice}" value="${item.quantidade}"
                 title="${item.fracionado ? 'Vendido em pedaço: aceita vírgula' : 'Quantidade em unidades'}">
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
  fecharModal($('#modal-produto')));

$('#btn-adicionar-item').addEventListener('click', () => abrirProcuraProduto(-1));

aoDigitar($('#procura-produto'), procurarProduto);

async function procurarProduto() {
  const termo = $('#procura-produto').value.trim();
  const area = $('#resultado-produtos');
  if (termo.length < 2) { area.innerHTML = ''; return; }

  area.innerHTML = '<p class="ajuda">Procurando...</p>';
  try {
    const { produtos } = await api('/api/orcamento/buscar-produto?q=' + encodeURIComponent(termo)
      + (estado.id ? '&id=' + encodeURIComponent(estado.id) : ''));
    if (!produtos.length) {
      area.innerHTML = '<p class="ajuda">Nenhum produto encontrado.</p>';
      return;
    }
    area.innerHTML = produtos.map((p, posicao) => `
      <button data-usar="${escapar(p.codigo)}">
        <strong>${escapar(p.descricao)}</strong>
        ${etiquetasDaOpcao(p, posicao)}
        <br>cod. ${escapar(p.codigo)} · ${dinheiro(p.vendaAtual)} · estoque ${numeroBR(p.estoque)}
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
    fecharModal($('#modal-produto'));
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
      // "1.234,56" -> 1234.56 e "50" -> 50. (Antes isto era um replace com "." solto,
      // que apagava TODOS os caracteres e o frete escrito na observação nunca entrava.)
      const escrito = frete[1];
      const valor = Number(escrito.includes(',')
        ? escrito.replace(/\./g, '').replace(',', '.')
        : escrito);
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

// Mandar o orçamento ANTES de gravar: o cliente aprova e só então entra no Solus.
// São os mesmos botões da tela de depois de gravar — o PDF sai igual, só que
// ainda sem número de orçamento.
$('#btn-whats-conferir').addEventListener('click', compartilhar);
$('#btn-pdf-conferir').addEventListener('click', baixarPdf);
$('#btn-excel-conferir').addEventListener('click', baixarExcel);
$('#btn-imprimir-conferir').addEventListener('click', imprimir);

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
      <button class="botao secundario" id="btn-baixar-pdf">${icone('pdf', 18)}<span>Baixar PDF</span></button>
      <button class="botao excel" id="btn-baixar-excel">${icone('planilha', 18)}<span>Baixar Excel</span></button>
      <button class="botao secundario" id="btn-imprimir">${icone('imprimir', 18)}<span>Imprimir</span></button>
    </div>
    <button class="botao secundario largura-total" id="btn-novo-orcamento">Fazer outro orçamento</button>`;

  $('#btn-compartilhar').addEventListener('click', compartilhar);
  $('#btn-baixar-pdf').addEventListener('click', baixarPdf);
  $('#btn-baixar-excel').addEventListener('click', baixarExcel);
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

/** "orcamento-123-dona-maria.pdf" - o mesmo nome que o servidor usa. */
function nomeDoArquivo(extensao = 'pdf') {
  const orc = estado.orcamento || {};
  const nome = orc.cliente?.nome || orc.nomeCliente || '';
  const pedaco = nome ? '-' + nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
  return `orcamento-${estado.gravado?.numero || orc.numero || 'sem-numero'}${pedaco}.${extensao}`;
}

function salvarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function baixarPdf() {
  try {
    salvarArquivo(await pegarPdf(), nomeDoArquivo('pdf'));
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

/**
 * Planilha do Excel. No celular abre o menu de compartilhar (da para mandar
 * direto no WhatsApp do cliente); no computador, baixa o arquivo.
 */
async function baixarExcel(evento) {
  const botao = evento?.currentTarget;
  if (botao) botao.disabled = true;
  try {
    const resposta = await fetch(`/api/orcamento/${estado.id}/excel`, {
      headers: { 'x-sessao': sessao.token },
    });
    if (!resposta.ok) {
      const falha = await resposta.json().catch(() => ({}));
      throw new Error(falha.erro || 'Não consegui gerar a planilha.');
    }
    const blob = await resposta.blob();
    const nome = nomeDoArquivo('xlsx');
    const arquivo = new File([blob], nome, { type: blob.type });

    const celular = window.matchMedia?.('(pointer: coarse)').matches;
    if (celular && navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: 'Orçamento' });
      return;
    }
    salvarArquivo(blob, nome);
    avisar('Planilha baixada: ' + nome, 'ok');
  } catch (erro) {
    if (erro.name !== 'AbortError') avisar(erro.message, 'erro');
  } finally {
    if (botao) botao.disabled = false;
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
    const arquivo = new File([blob], nomeDoArquivo('pdf'), { type: 'application/pdf' });
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
  permitirAnimarDeNovo($('#itens-orcamento'));
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

    // Tudo que a nota fiscal exige fica EDITÁVEL e já preenchido. A Receita às
    // vezes não devolve número, CEP ou inscrição estadual — e nota sem endereço
    // completo é recusada pela Sefaz.
    const campo = (id, rotulo, valor, dica = '', tipo = 'text') => `
      <label class="campo">
        <span>${rotulo}</span>
        <input type="${tipo}" id="${id}" value="${escapar(valor || '')}" placeholder="${escapar(dica)}">
      </label>`;

    area.innerHTML = `
      ${!dados.ativa
        ? `<div class="item-aviso erro">Atenção: essa empresa está <strong>${escapar(dados.situacao)}</strong> na Receita.</div>`
        : ''}
      ${dados.faltando?.length
        ? `<div class="item-aviso">A Receita não informou <strong>${escapar(dados.faltando.join(', '))}</strong>.
             Preencha abaixo antes de cadastrar: sem o endereço completo a nota fiscal dá erro na Sefaz.</div>`
        : ''}

      <div class="dados-empresa">
        <div><span>Razão social</span><strong>${escapar(dados.razaoSocial)}</strong></div>
        ${dados.fantasia ? `<div><span>Nome fantasia</span><strong>${escapar(dados.fantasia)}</strong></div>` : ''}
        <div><span>CNPJ</span><strong>${escapar(dados.cnpj)}</strong></div>
        <div><span>Atividade</span><strong>${escapar(dados.atividade)}</strong></div>
      </div>

      <h3 style="font-size:15px;margin:16px 0 0">Dados que saem na nota</h3>
      ${campo('ie-cliente', 'Inscrição estadual <em>(ou ISENTO)</em>', dados.inscricaoEstadual, 'ISENTO')}
      ${campo('rua-cliente', 'Rua / avenida', dados.rua, 'ex.: RUA VOLUNTARIOS DA FRANCA')}
      <div class="linha-dupla">
        ${campo('numero-cliente', 'Número', dados.numero, 'ex.: 1465')}
        ${campo('cep-cliente', 'CEP', dados.cep, '00000-000', 'tel')}
      </div>
      ${campo('complemento-cliente', 'Complemento <em>(opcional)</em>', dados.complemento, 'sala, galpão...')}
      ${campo('bairro-cliente', 'Bairro', dados.bairro, '')}
      <div class="linha-dupla">
        ${campo('cidade-cliente', 'Cidade', dados.cidade, '')}
        ${campo('uf-cliente', 'Estado <em>(UF)</em>', dados.uf, 'SP')}
      </div>

      <h3 style="font-size:15px;margin:16px 0 0">Contato</h3>
      <div class="linha-dupla">
        ${campo('telefone-cliente', 'Telefone', dados.telefone, '', 'tel')}
        ${campo('celular-cliente', 'Celular / WhatsApp <em>(a Receita não informa)</em>', '', '(14) 99999-9999', 'tel')}
      </div>
      ${campo('email-cliente', 'E-mail', dados.email, '', 'email')}
      ${campo('contato-cliente', 'Contato <em>(nome de quem compra)</em>', '', 'opcional')}

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
  const ler = (id) => ($(`#${id}`)?.value || '').trim();

  // o que foi corrigido na tela vale mais do que o que veio da Receita
  const cadastro = {
    ...dados,
    inscricaoEstadual: ler('ie-cliente'),
    rua: ler('rua-cliente'),
    numero: ler('numero-cliente'),
    complemento: ler('complemento-cliente'),
    bairro: ler('bairro-cliente'),
    cidade: ler('cidade-cliente'),
    uf: ler('uf-cliente').toUpperCase(),
    cep: ler('cep-cliente'),
    telefone: ler('telefone-cliente'),
    celular: ler('celular-cliente'),
    email: ler('email-cliente'),
    contato: ler('contato-cliente'),
  };

  const faltando = [
    [cadastro.rua, 'a rua'], [cadastro.numero, 'o número'], [cadastro.bairro, 'o bairro'],
    [cadastro.cidade, 'a cidade'], [cadastro.uf, 'o estado'], [cadastro.cep, 'o CEP'],
  ].filter(([valor]) => !valor).map(([, rotulo]) => rotulo);

  if (faltando.length) {
    const segue = confirm(
      `Ainda falta ${faltando.join(', ')}.\n\n`
      + 'A nota fiscal desse cliente vai dar erro na Sefaz sem isso.\n\nCadastrar assim mesmo?'
    );
    if (!segue) return;
  }

  botao.disabled = true;
  botao.textContent = 'Cadastrando...';

  try {
    const resposta = await api('/api/clientes', {
      method: 'POST',
      body: JSON.stringify(cadastro),
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
