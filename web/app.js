/* Tela de entrada de nota: ler a nota, conferir item a item e gravar no Solus. */

import {
  $, $$, api, dinheiro, escapar, mostrarTela, avisar, sessao,
  animarSeForAPrimeiraVez, permitirAnimarDeNovo,
} from './comum.js';
import { icone, aplicarIcones } from './icones.js';
import { abrirConfiguracaoDeLojas } from './login.js';
import { mostrarProgressoNoCartao } from './progresso.js';
import { ligarColar } from './colar.js';
import { fecharModal } from './efeitos.js';
import { cartaoDoHistorico, corpoDoDetalhe, prazoEmPalavras } from './historico-visual.js';

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

// foto ou print da nota copiado: Ctrl+V e ele entra, sem salvar em pasta
ligarColar({ tela: 'enviar', aoColar: adicionarArquivos, destacar: areaArquivo });

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
  const temObservacao = Boolean($('#observacao').value.trim());

  $('#erro-leitura').classList.add('escondido');
  $('#btn-ler').disabled = true;
  const pararProgresso = mostrarProgressoNoCartao($('#carregando'), {
    titulo: temXml ? 'Lendo a nota' : 'A IA está lendo a nota',
    etapas: [
      temXml ? 'Abrindo o XML da nota' : 'Lendo a foto/PDF da nota',
      'Separando os itens e convertendo caixa em unidade',
      'Procurando cada produto no Solus',
      'Calculando o custo com frete e impostos',
      ...(temObservacao ? ['Aplicando a sua observação'] : []),
      'Conferindo os cadastros parecidos com a IA',
      'Montando a conferência',
    ],
    // XML sai em 1 ou 2 segundos; leitura por IA leva bem mais
    segundosPorEtapa: temXml ? 1.8 : 5,
    dicas: temXml ? [
      'A IA confere se o cadastro parecido é o mesmo produto ou outro tamanho.',
      'Nada é gravado agora — você confere tudo antes.',
    ] : [
      'Foto nítida, de frente e com boa luz é lida mais rápido.',
      'Com o XML a leitura é exata e não gasta IA.',
      'Nada é gravado agora — você confere tudo antes.',
    ],
  });

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
      // produto novo: o nome que vai para o cadastro (a IA já arrumou, dá para editar)
      descricao: item.descricao,
    }));

    desenharConferencia(resultado.jaAplicada);
    mostrarTela('conferencia');
  } catch (erro) {
    $('#erro-leitura').innerHTML = `<strong>Não deu certo:</strong><br>${escapar(erro.message)}`;
    if (/cr[eé]dito da conta/i.test(erro.message)) document.dispatchEvent(new CustomEvent('ia-falhou', { detail: erro.message }));
    $('#erro-leitura').classList.remove('escondido');
  } finally {
    pararProgresso();
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

  const ajustes = resumoDaObservacao(nota);

  // a IA conferiu os cadastros parecidos? quando não deu, a pessoa precisa saber
  // que a comparação foi só por texto (é aí que mora o engano de tamanho)
  const ia = nota.conferenciaIA;
  const conferenciaIA = ia?.usou
    ? `<p class="ajuda" style="margin:10px 0 0">
         A IA conferiu os cadastros parecidos de ${ia.itens}
         ${ia.itens === 1 ? 'item' : 'itens'} — cada um diz se é o mesmo produto.
       </p>`
    : ia?.falhou
      ? `<div class="item-aviso">
           <strong>A IA não conseguiu conferir os cadastros parecidos</strong>
           (${escapar(ia.motivo || 'erro')}). A comparação abaixo é só por texto:
           confira com atenção tamanho e marca antes de gravar.
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
    ${conferencia}${ajustes}${conferenciaIA}`;

  desenharItens();
}

/**
 * "O que fiz com a sua observação": o resumo que abre a tela de conferência.
 * Diz com números o que entrou no custo (ex.: o DIFAL de 6% calculado em cima
 * de cada produto) - e, quando nada entrou, diz isso também, em vez de calar.
 */
function resumoDaObservacao(nota) {
  const ajuste = nota.ajustes;
  if (!ajuste) return '';

  if (ajuste.falhou) {
    return `
      <div class="resumo-observacao alerta">
        <div class="resumo-observacao-icone">${icone('aviso', 20)}</div>
        <div>
          <strong>Não consegui ler a sua observação</strong>
          <p>A IA não respondeu agora, então <strong>nada do que você escreveu entrou no custo</strong>.
             Se era um imposto ou taxa, confira os valores antes de gravar ou mande a nota de novo daqui a pouco.</p>
        </div>
      </div>`;
  }

  const itens = nota.itens || [];
  const soma = (campo) => itens.reduce((total, i) => total + (Number(i.ajusteValores?.[campo]) || 0), 0);
  const quantos = (campo) => itens.filter((i) => Number(i.ajusteValores?.[campo])).length;
  const linhas = [];

  if (ajuste.percentualNaNota || quantos('percentual')) {
    const nome = ajuste.nomeDoPercentual || 'Acréscimo';
    const pct = ajuste.percentualNaNota
      ? String(ajuste.percentualNaNota).replace('.', ',') + '%' : 'a porcentagem';
    linhas.push(`<li><strong>${escapar(nome)} de ${escapar(pct)}</strong> calculado em cima de cada produto:
      <strong>+ ${dinheiro(soma('percentual'))}</strong> no total, em ${quantos('percentual')}
      ${quantos('percentual') === 1 ? 'item' : 'itens'}. Já está no custo de cada um.</li>`);
  }
  if (quantos('daNota')) {
    const valor = soma('daNota');
    linhas.push(`<li><strong>${valor >= 0 ? '+' : '-'} ${dinheiro(Math.abs(valor))}</strong> da nota inteira,
      dividido entre ${quantos('daNota')} itens na proporção do valor de cada um.</li>`);
  }
  if (quantos('doItem')) {
    linhas.push(`<li>Valor lançado em <strong>${quantos('doItem')}
      ${quantos('doItem') === 1 ? 'item específico' : 'itens específicos'}</strong>.</li>`);
  }
  const caixas = (ajuste.porItem || []).filter((a) => a.unidadesPorCaixa > 1);
  if (caixas.length) {
    linhas.push(`<li>Quantidade por caixa corrigida em <strong>${caixas.length}
      ${caixas.length === 1 ? 'item' : 'itens'}</strong> (o custo por unidade foi refeito).</li>`);
  }

  const semMudanca = !linhas.length;
  return `
    <div class="resumo-observacao${semMudanca ? ' neutro' : ''}">
      <div class="resumo-observacao-icone">${icone(semMudanca ? 'conversa' : 'calculadora', 20)}</div>
      <div>
        <strong>O que fiz com a sua observação</strong>
        ${ajuste.entendi ? `<p class="resumo-observacao-entendi">“${escapar(ajuste.entendi)}”</p>` : ''}
        ${semMudanca
          ? '<p>Nenhum valor foi mudado — entendi como um recado.</p>'
          : `<ul>${linhas.join('')}</ul>`}
        ${ajuste.naoEntendi ? `<p class="ajuda">Não usei esta parte: ${escapar(ajuste.naoEntendi)}</p>` : ''}
        ${semMudanca ? '' : '<p class="ajuda">A conta foi feita pelo sistema, não pela IA. O detalhe está em cada item abaixo.</p>'}
      </div>
    </div>`;
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
  // anima so na primeira montagem: redesenhar a cada ajuste piscaria a tela toda
  animarSeForAPrimeiraVez(lista);
  ligarEventosDosItens();
}

/**
 * O que a IA achou de um cadastro parecido, em uma etiqueta.
 * Sem resposta da IA (sem chave, sem crédito, ou ela falhou) não aparece nada —
 * a tela continua igual à de antes.
 */
function etiquetaDaIA(relacao, motivo) {
  if (!relacao) return '';
  const como = {
    mesmo: { classe: 'ok', texto: 'IA: é o mesmo produto' },
    variacao: { classe: 'aviso', texto: 'IA: parecido, mas outro' },
    outro: { classe: 'erro', texto: 'IA: não tem relação' },
  }[relacao];
  if (!como) return '';
  const explicacao = motivo ? ` — ${motivo}` : '';
  return `<span class="etiqueta ${como.classe}" title="${escapar(motivo || '')}">${
    escapar(como.texto + explicacao)}</span>`;
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

  // Cadastros repetidos ou PARECIDOS: a pessoa escolhe UM para receber a
  // mercadoria e marca quais desativar, um por um. Aparece também quando o item
  // vai ser cadastrado novo - o repetido velho costuma estar justamente aí.
  // Quando a IA conferiu, cada linha diz se é O MESMO produto ou outro tamanho.
  const desativar = decisao.desativarIrmaos || [];
  const parecidos = item.irmaos || [];

  // A LIMPA DO CADASTRO: o mesmo cadastro velho costuma aparecer como parecido
  // em vários itens da nota. Marcar duas vezes não adianta e confunde, e pior:
  // dava para marcar "desativar" num item um cadastro que está RECEBENDO a
  // mercadoria em outro. Então aqui cada código sabe onde já foi resolvido.
  const marcadoEmOutroItem = new Map();      // código -> nº do item
  const recebendoMercadoria = new Map();     // código -> nº do item
  estado.decisoes.forEach((outra, i) => {
    if (i !== indice) {
      for (const codigo of outra?.desativarIrmaos || []) marcadoEmOutroItem.set(String(codigo), i + 1);
    }
    const daOutra = estado.conferencia.itens[i];
    if (outra?.acao !== 'ignorar' && daOutra?.produto?.codigo) {
      recebendoMercadoria.set(String(daOutra.produto.codigo), i + 1);
    }
  });
  const blocoIrmaos = parecidos.length ? `
    <div class="irmaos">
      <div class="irmaos-titulo">
        ${icone('aviso', 17)} Achei ${parecidos.length} cadastro${parecidos.length === 1 ? '' : 's'} parecido${parecidos.length === 1 ? '' : 's'}${novo ? '' : ' além do vinculado'}
      </div>
      <p class="ajuda" style="margin:2px 0 10px">
        Escolha qual recebe a mercadoria desta nota e marque os que não são mais usados.
      </p>

      ${novo ? '' : `
      <div class="irmao-linha vinculado">
        <span><strong>${escapar(item.produto.descricao)}</strong>
          <span class="etiqueta ok">vinculado — recebe o estoque</span>
          ${etiquetaDaIA(item.relacaoDoVinculoIA, item.motivoDoVinculoIA)}<br>
          cód. ${escapar(item.produto.codigo)} · barras ${escapar(item.produto.barras || '-')}</span>
        <span style="text-align:right">${dinheiro(item.produto.vendaAtual)}<br>
          <em>estoque ${item.produto.estoque}</em></span>
      </div>`}

      ${parecidos.map((irmao) => {
        const noOutro = marcadoEmOutroItem.get(String(irmao.codigo));
        const recebendo = recebendoMercadoria.get(String(irmao.codigo));
        // já resolvido em outro item da nota: aqui é só informação
        const travado = irmao.cancelado || Boolean(noOutro) || Boolean(recebendo);
        return `
        <div class="irmao-linha ${irmao.relacaoIA === 'mesmo' ? 'mesmo-produto' : ''} ${travado ? 'resolvido' : ''}">
          <span><strong>${escapar(irmao.descricao)}</strong>
            ${etiquetaDaIA(irmao.relacaoIA, irmao.motivoIA)}
            <span class="etiqueta">${escapar(irmao.motivo || 'parecido')}</span>
            ${irmao.cancelado ? '<span class="etiqueta erro">já desativado no Solus</span>' : ''}
            ${noOutro ? `<span class="etiqueta aviso">já marcado para desativar no item ${noOutro}</span>` : ''}
            ${recebendo ? `<span class="etiqueta ok">recebe a mercadoria no item ${recebendo}</span>` : ''}
            ${irmao.parado && !irmao.cancelado ? '<span class="etiqueta aviso">parado</span>' : ''}
            ${irmao.estoque < 0 ? '<span class="etiqueta erro">estoque negativo</span>' : ''}<br>
            cód. ${escapar(irmao.codigo)} · barras ${escapar(irmao.barras || '-')}</span>
          <span style="text-align:right">${dinheiro(irmao.vendaAtual)}<br>
            <em>estoque ${irmao.estoque}</em></span>
          <span class="irmao-acoes">
            ${travado ? '' : `
              <button class="botao secundario" data-vincular="${indice}" value="${escapar(irmao.codigo)}">
                Vincular a este
              </button>`}
            <label class="irmao-desativar">
              <input type="checkbox" data-desativar="${indice}" value="${escapar(irmao.codigo)}"
                     ${desativar.includes(irmao.codigo) ? 'checked' : ''}
                     ${travado ? 'disabled' : ''}>
              <span>${irmao.cancelado ? 'já desativado'
                : noOutro ? 'marcado no item ' + noOutro
                : recebendo ? 'em uso no item ' + recebendo
                : 'desativar'}</span>
            </label>
          </span>
        </div>`;
      }).join('')}

      ${(() => {
        // A limpa do cadastro em massa: marcar um por um numa nota de 40 itens
        // é inviável. Este botão marca só o que a IA confirmou ser O MESMO
        // produto (nunca as variações de tamanho/marca) e que ainda não foi
        // resolvido em outro item.
        const mesmos = parecidos.filter((i) => i.relacaoIA === 'mesmo'
          && !i.cancelado
          && !marcadoEmOutroItem.has(String(i.codigo))
          && !recebendoMercadoria.has(String(i.codigo)));
        const faltam = mesmos.filter((i) => !desativar.includes(i.codigo));
        if (!mesmos.length) return '';
        return `
          <div class="irmaos-atalho">
            <button class="botao secundario" data-desativar-mesmos="${indice}"
                    ${faltam.length ? '' : 'disabled'}>
              ${faltam.length
                ? `Desativar os ${mesmos.length} que são o mesmo produto`
                : `${mesmos.length} já marcados para desativar`}
            </button>
            ${desativar.length ? `<button class="botao-texto" data-limpar-desativar="${indice}">desmarcar todos</button>` : ''}
          </div>`;
      })()}

      ${novo ? '' : `
      <label>
        <input type="checkbox" data-irmaos="${indice}" ${decisao.igualarIrmaos ? 'checked' : ''}>
        <span>Deixar todos com o mesmo preço de venda (${dinheiro(decisao.precoVenda)}).
          <em>O estoque entra só no vinculado — os outros não são mexidos.</em></span>
      </label>`}

      <p class="ajuda" style="margin:8px 0 0">
        Desativar escreve " - DESATIVADO" no nome e marca como cancelado no Solus.
        Nada é apagado: o histórico de compra dos clientes continua lá.
      </p>
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
      ${item.relacaoDoVinculoIA && item.relacaoDoVinculoIA !== 'mesmo' && !novo ? `
        <div class="item-aviso">
          <strong>A IA acha que não é o mesmo produto:</strong>
          ${escapar(item.motivoDoVinculoIA || 'parece outro tamanho ou outra marca')}.
          Confira antes de gravar — a mercadoria vai para o cadastro vinculado.
        </div>`
      : item.precisaConfirmarVinculo && !novo ? `
        <div class="item-aviso">
          <strong>Confira o vínculo:</strong> achei este produto pelo NOME parecido, não pelo código de
          barras. Se não for ele, use "Vincular a este" num dos parecidos abaixo ou
          "Cadastrar como novo".
        </div>` : ''}
      ${item.sugestaoDaIA ? `
        <div class="item-aviso sugestao-ia">
          <strong>A IA achou este cadastro:</strong> ${escapar(item.sugestaoDaIA.descricao)}
          <em>(${escapar(item.sugestaoDaIA.motivo)})</em>.
          <button class="botao secundario" data-vincular="${indice}" value="${escapar(item.sugestaoDaIA.codigo)}">
            Vincular a este
          </button>
        </div>` : ''}
      ${avisos.join('')}
      ${novo ? `
        <label class="campo">
          <span>Nome que vai para o cadastro
            ${item.nomeSugerido ? '<em>(arrumado pela IA — confira)</em>' : ''}</span>
          <input type="text" maxlength="70" data-nome="${indice}"
                 value="${escapar(decisao.descricao ?? item.descricao)}">
        </label>
        ${item.nomeSugerido && item.nomeNaNota ? `
          <p class="ajuda" style="margin:-6px 0 10px">
            Na nota veio "${escapar(item.nomeNaNota)}".
            <button class="botao-texto" data-nome-da-nota="${indice}">usar o nome da nota</button>
          </p>` : ''}` : ''}

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
        ${novo ? '' : `<button class="botao secundario" data-virar-novo="${indice}">Cadastrar como novo</button>`}
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
  // SÓ dentro da lista da nota. A tela de orçamento também tem [data-qtd] e
  // [data-preco], e as duas ficam no documento ao mesmo tempo: procurando na
  // página inteira, mudar a quantidade no orçamento mexia no item de mesmo
  // número da NOTA aberta por baixo (achado pelo teste com navegador).
  const lista = $('#lista-itens');
  const $$ = (seletor) => (lista ? [...lista.querySelectorAll(seletor)] : []);

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

  // limpa do cadastro: marcar de uma vez os que a IA confirmou ser o mesmo produto
  $$('[data-desativar-mesmos]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const indice = Number(botao.dataset.desativarMesmos);
      const decisao = estado.decisoes[indice];
      const jaResolvidos = new Set();
      estado.decisoes.forEach((outra, i) => {
        if (i !== indice) (outra?.desativarIrmaos || []).forEach((c) => jaResolvidos.add(String(c)));
        const daOutra = estado.conferencia.itens[i];
        if (outra?.acao !== 'ignorar' && daOutra?.produto?.codigo) jaResolvidos.add(String(daOutra.produto.codigo));
      });

      const mesmos = (estado.conferencia.itens[indice].irmaos || [])
        .filter((i) => i.relacaoIA === 'mesmo' && !i.cancelado && !jaResolvidos.has(String(i.codigo)));

      const comEstoque = mesmos.filter((i) => i.estoque !== 0);
      if (comEstoque.length) {
        const lista = comEstoque.map((i) => `• ${i.descricao} (estoque ${i.estoque})`).join('\n');
        if (!confirm(`${comEstoque.length} destes ainda têm estoque:\n\n${lista}\n\n`
          + 'Desativando, eles somem do PDV e esse estoque fica parado neles.\n\nConfirma?')) return;
      }

      decisao.desativarIrmaos = [...new Set([
        ...(decisao.desativarIrmaos || []),
        ...mesmos.map((i) => i.codigo),
      ])];
      desenharItens();
      avisar(`${mesmos.length} cadastros marcados para desativar.`, 'ok');
    });
  });

  $$('[data-limpar-desativar]').forEach((botao) => {
    botao.addEventListener('click', () => {
      estado.decisoes[Number(botao.dataset.limparDesativar)].desativarIrmaos = [];
      desenharItens();
    });
  });

  // nome do produto novo (o que vai para o cadastro do Solus)
  $$('[data-nome]').forEach((campo) => {
    campo.addEventListener('input', () => {
      estado.decisoes[Number(campo.dataset.nome)].descricao = campo.value.slice(0, 70);
    });
  });
  $$('[data-nome-da-nota]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const indice = Number(botao.dataset.nomeDaNota);
      const daNota = estado.conferencia.itens[indice].nomeNaNota;
      estado.decisoes[indice].descricao = daNota;
      const campo = lista?.querySelector(`[data-nome="${indice}"]`);
      if (campo) campo.value = daNota;
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

  // vincular a um dos cadastros parecidos (ele passa a receber a mercadoria)
  $$('[data-vincular]').forEach((botao) => {
    botao.addEventListener('click', () => {
      estado.itemEmBusca = Number(botao.dataset.vincular);
      escolherProduto(botao.value);
    });
  });

  // "nao e nenhum desses": vira produto novo
  $$('[data-virar-novo]').forEach((botao) => {
    botao.addEventListener('click', () => virarProdutoNovo(Number(botao.dataset.virarNovo)));
  });
}

/**
 * "Esse não é nenhum dos que já existem": desfaz o vínculo e cadastra novo.
 * Antes, quando o Plugin casava pelo NOME PARECIDO e errava, só dava para
 * trocar por outro produto — e a mercadoria acabava entrando no cadastro errado.
 */
async function virarProdutoNovo(indice) {
  const item = estado.conferencia.itens[indice];
  const nome = prompt('Cadastrar como produto NOVO com que nome?', item.descricao);
  if (nome === null) return;

  try {
    const resposta = await fetch('/api/virar-novo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: estado.idConferencia, indice, descricao: nome.trim() || item.descricao }),
    });
    const resultado = await resposta.json();
    if (!resultado.ok) throw new Error(resultado.erro);

    estado.conferencia.itens[indice] = resultado.item;
    estado.decisoes[indice] = {
      acao: 'criar',
      quantidadeUnidades: resultado.item.quantidadeUnidades,
      custoUnitario: resultado.item.custoUnitario,
      precoVenda: resultado.item.precoVenda,
      igualarIrmaos: false,
      // o que já estava marcado para desativar continua marcado
      desativarIrmaos: estado.decisoes[indice]?.desativarIrmaos || [],
      origemPreco: resultado.item.analise.recomendacao,
      descricao: resultado.item.descricao,
    };
    desenharItens();
    avisar('Vai ser cadastrado como produto novo.', 'ok');
  } catch (erro) {
    avisar('Não deu para mudar: ' + erro.message, 'erro');
  }
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
  fecharModal($('#modal-busca'));
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
      // o que ja estava marcado para desativar continua marcado
      desativarIrmaos: estado.decisoes[indice]?.desativarIrmaos || [],
      origemPreco: resultado.item.analise.recomendacao,
    };

    fecharModal($('#modal-busca'));
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
    permitirAnimarDeNovo($('#lista-itens'));
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
  if (desativados) {
    // desativar é o que mais assusta na limpa do cadastro: os nomes aparecem
    // ANTES de gravar, não só o número
    const nomes = [];
    estado.decisoes.forEach((decisao, i) => {
      for (const codigo of decisao.desativarIrmaos || []) {
        const irmao = (estado.conferencia.itens[i].irmaos || []).find((x) => x.codigo === codigo);
        if (irmao) nomes.push(`   - ${irmao.descricao}${irmao.estoque ? ` (estoque ${irmao.estoque})` : ''}`);
      }
    });
    mensagem += `• ${desativados} cadastros repetidos serão DESATIVADOS:\n${nomes.slice(0, 12).join('\n')}\n`;
    if (nomes.length > 12) mensagem += `   ...e mais ${nomes.length - 12}\n`;
  }
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
    ${resultado.aviso ? `<div class="alerta-erro" style="margin-bottom:14px">${escapar(resultado.aviso)}</div>` : ''}
    ${r.itensIgnorados ? `<p class="ajuda" style="margin:-8px 0 12px">
      ${r.itensIgnorados} ${r.itensIgnorados === 1 ? 'item não entrou' : 'itens não entraram'}
      (marcados como "não entrar"). Abra o Histórico para ver quais.
    </p>` : ''}
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
    ${resumoFiscal(resultado.registros)}
    <div class="cartao-etiquetas">
      <div>
        <strong>Etiquetas de prateleira</strong>
        <span class="ajuda" style="display:block;margin:2px 0 0" id="resumo-etiquetas"></span>
      </div>
      <div class="etiquetas-acoes">
        <button class="botao principal" id="btn-etiquetas" data-icone="imprimir">
          <span>Imprimir etiquetas</span>
        </button>
      </div>
    </div>
    <div id="escolha-etiquetas" class="escondido"></div>

    <p class="ajuda" style="margin-top:14px">
      Se algo entrou errado, você pode desfazer tudo pelo Histórico.
    </p>
    <button class="botao secundario largura-total" id="btn-nova-nota">Lançar outra nota</button>`;

  aplicarIcones($('#conteudo-resultado'));
  ligarEtiquetas(resultado.registros);

  $('#btn-nova-nota').addEventListener('click', () => {
    estado.arquivos = [];
    estado.conferencia = null;
    $('#observacao').value = '';
    permitirAnimarDeNovo($('#lista-itens'));
    desenharArquivos();
    mostrarTela('enviar');
  });

  mostrarTela('resultado');
}

/**
 * Quais produtos estavam sem CST/IBS-CBS/"acessa valores" e receberam o padrao.
 * Aparece so quando algo foi preenchido - e o que evita a nota de venda
 * ser recusada depois por produto com campo fiscal vazio.
 */
function resumoFiscal(registros = []) {
  const preenchidos = registros.filter((r) => r.fiscalPreenchido?.length);
  if (!preenchidos.length) return '';
  const campos = [...new Set(preenchidos.flatMap((r) => r.fiscalPreenchido))];
  return `
    <div class="resumo-observacao neutro">
      <div class="resumo-observacao-icone">${icone('certo', 20)}</div>
      <div>
        <strong>Dados fiscais completados em ${preenchidos.length}
          ${preenchidos.length === 1 ? 'produto' : 'produtos'}</strong>
        <p>Estavam vazios e receberam o padrão da loja
           (CST 102, CST Cbs/Ibs 000, classificação 000001, acessa valores S, baixa estoque S):
           ${escapar(campos.join(', '))}. O que já estava preenchido não foi mexido.</p>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Etiquetas de prateleira
// ---------------------------------------------------------------------------

/**
 * Prepara as etiquetas dos produtos que acabaram de entrar.
 *
 * É UMA ETIQUETA POR PRODUTO, não por unidade: 20 águas sanitárias de 5L viram
 * UMA etiqueta da de 5L — e outra, separada, para a de 1L.
 *
 * E nem todo produto precisa de etiqueta nova: se o preço continuou o mesmo, a
 * que está na prateleira ainda serve. Por isso a tela separa os que mudaram de
 * preço dos que ficaram iguais, e o botão já vem apontando para os que mudaram —
 * é o que economiza papel adesivo de verdade.
 */
let etiquetasDaNota = [];

function ligarEtiquetas(registros) {
  const botao = $('#btn-etiquetas');
  if (!botao) return;

  // um por código: o mesmo produto pode aparecer em duas linhas da nota
  const porCodigo = new Map();
  for (const registro of registros || []) {
    if (!registro?.codigo || registro.semAlteracao) continue;
    if (registro.acao === 'desativado') continue;      // etiqueta de desativado não serve
    // item que não entrou (ou tentativa que deu erro) não gera etiqueta
    if (registro.acao === 'ignorado' || registro.acao === 'nao-gravado') continue;
    porCodigo.set(String(registro.codigo), {
      codigo: String(registro.codigo),
      descricao: registro.descricao || '',
      novo: registro.acao === 'criado',
      precoMudou: registro.precoMudou !== false,
      vendaAntes: registro.vendaAntes,
      vendaDepois: registro.vendaDepois,
    });
  }
  etiquetasDaNota = [...porCodigo.values()];

  const mudaram = etiquetasDaNota.filter((p) => p.precoMudou).length;
  const iguais = etiquetasDaNota.length - mudaram;

  $('#resumo-etiquetas').innerHTML = etiquetasDaNota.length
    ? `${etiquetasDaNota.length} ${etiquetasDaNota.length === 1 ? 'produto' : 'produtos'} na nota · `
      + `<strong>${mudaram} ${mudaram === 1 ? 'mudou' : 'mudaram'} de preço</strong>`
      + (iguais ? ` · ${iguais} ${iguais === 1 ? 'continuou' : 'continuaram'} igual` : '')
    : 'Nenhum produto para etiquetar nesta nota.';

  if (!etiquetasDaNota.length) {
    botao.disabled = true;
    return;
  }

  botao.addEventListener('click', abrirEscolhaDeEtiquetas);
}

/** A pergunta: imprimir quais? */
function abrirEscolhaDeEtiquetas() {
  const area = $('#escolha-etiquetas');
  const mudaram = etiquetasDaNota.filter((p) => p.precoMudou);
  const iguais = etiquetasDaNota.filter((p) => !p.precoMudou);

  area.classList.remove('escondido');
  area.innerHTML = `
    <div class="cartao">
      <h2>Quais etiquetas imprimir?</h2>
      ${iguais.length
        ? `<p class="ajuda">
             ${iguais.length} ${iguais.length === 1 ? 'produto continuou' : 'produtos continuaram'}
             com o mesmo preço — a etiqueta que está na prateleira ainda serve.
           </p>`
        : '<p class="ajuda">Todos os produtos mudaram de preço nesta nota.</p>'}

      <div class="escolha-grupo">
        <label class="escolha-opcao">
          <input type="radio" name="quais-etiquetas" value="mudaram" ${mudaram.length ? 'checked' : ''}
                 ${mudaram.length ? '' : 'disabled'}>
          <span>
            <strong>Só as que mudaram de preço</strong>
            <em>${mudaram.length} ${mudaram.length === 1 ? 'etiqueta' : 'etiquetas'} — economiza papel</em>
          </span>
        </label>
        <label class="escolha-opcao">
          <input type="radio" name="quais-etiquetas" value="todas" ${mudaram.length ? '' : 'checked'}>
          <span>
            <strong>Todas da nota</strong>
            <em>${etiquetasDaNota.length} ${etiquetasDaNota.length === 1 ? 'etiqueta' : 'etiquetas'}</em>
          </span>
        </label>
        <label class="escolha-opcao">
          <input type="radio" name="quais-etiquetas" value="escolher">
          <span>
            <strong>Escolher uma a uma</strong>
            <em>marque abaixo quais você quer</em>
          </span>
        </label>
      </div>

      <div id="lista-etiquetas" class="lista-etiquetas escondido">
        ${etiquetasDaNota.map((p, i) => `
          <label class="linha-etiqueta">
            <input type="checkbox" data-etiqueta="${i}" ${p.precoMudou ? 'checked' : ''}>
            <span class="linha-etiqueta-nome">${escapar(p.descricao || 'cód. ' + p.codigo)}</span>
            <span class="linha-etiqueta-preco">
              ${p.novo
                ? '<span class="etiqueta info">novo</span>'
                : p.precoMudou
                  ? `<s>${dinheiro(p.vendaAntes)}</s> ${dinheiro(p.vendaDepois)}`
                  : `${dinheiro(p.vendaDepois)} <span class="etiqueta">não mudou</span>`}
            </span>
          </label>`).join('')}
      </div>

      <label class="campo">
        <span>Tamanho da etiqueta</span>
        <select id="tamanho-etiqueta">
          <option value="padrao">Normal — 24 por folha (6,4 × 3,5 cm)</option>
          <option value="grande">Grande — 10 por folha (9,6 × 5,6 cm)</option>
        </select>
      </label>

      <div id="conta-folhas" class="item-aviso info"></div>

      <div class="item-acoes">
        <button class="botao secundario" id="btn-cancelar-etiquetas">Cancelar</button>
        <button class="botao principal" id="btn-gerar-etiquetas" data-icone="imprimir">
          <span>Gerar e imprimir</span>
        </button>
      </div>
    </div>`;

  aplicarIcones(area);

  const atualizar = () => {
    const modo = area.querySelector('[name="quais-etiquetas"]:checked')?.value;
    $('#lista-etiquetas').classList.toggle('escondido', modo !== 'escolher');
    const escolhidas = etiquetasEscolhidas();
    const porFolha = $('#tamanho-etiqueta').value === 'grande' ? 10 : 24;
    const folhas = Math.ceil(escolhidas.length / porFolha) || 0;
    $('#conta-folhas').textContent = escolhidas.length
      ? `${escolhidas.length} ${escolhidas.length === 1 ? 'etiqueta' : 'etiquetas'} · `
        + `${folhas} ${folhas === 1 ? 'folha A4' : 'folhas A4'}`
      : 'Nenhuma etiqueta escolhida.';
    $('#btn-gerar-etiquetas').disabled = !escolhidas.length;
  };

  area.querySelectorAll('[name="quais-etiquetas"]').forEach((r) => r.addEventListener('change', atualizar));
  area.querySelectorAll('[data-etiqueta]').forEach((c) => c.addEventListener('change', atualizar));
  $('#tamanho-etiqueta').addEventListener('change', atualizar);
  $('#btn-cancelar-etiquetas').addEventListener('click', () => area.classList.add('escondido'));
  $('#btn-gerar-etiquetas').addEventListener('click', () =>
    imprimirEtiquetas(etiquetasEscolhidas(), $('#tamanho-etiqueta').value));

  atualizar();
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** O que está marcado agora, conforme a opção escolhida. */
function etiquetasEscolhidas() {
  const modo = document.querySelector('[name="quais-etiquetas"]:checked')?.value || 'mudaram';
  if (modo === 'todas') return etiquetasDaNota.map((p) => ({ codigo: p.codigo }));
  if (modo === 'mudaram') {
    return etiquetasDaNota.filter((p) => p.precoMudou).map((p) => ({ codigo: p.codigo }));
  }
  return [...document.querySelectorAll('[data-etiqueta]:checked')]
    .map((c) => ({ codigo: etiquetasDaNota[Number(c.dataset.etiqueta)].codigo }));
}

async function imprimirEtiquetas(produtos, tamanho = 'padrao') {
  const botao = $('#btn-gerar-etiquetas');
  const textoOriginal = botao?.innerHTML;
  if (botao) { botao.disabled = true; botao.textContent = 'Montando...'; }

  try {
    const resposta = await fetch('/api/etiquetas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtos, tamanho }),
    });

    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      throw new Error(erro.erro || 'Não consegui montar as etiquetas.');
    }

    const folhas = resposta.headers.get('X-Folhas');
    const quantas = resposta.headers.get('X-Etiquetas');
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);

    // abre já na janela de impressão: é para colocar o adesivo e mandar imprimir
    const janela = window.open(url, '_blank');
    if (!janela) {
      avisar('O navegador bloqueou a janela. Libere os pop-ups e tente de novo.', 'erro');
      return;
    }
    janela.addEventListener('load', () => janela.print(), { once: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    avisar(`${quantas} etiquetas em ${folhas} ${folhas === '1' ? 'folha' : 'folhas'}. `
      + 'Ponha o papel adesivo na impressora.', 'ok');
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    if (botao) { botao.disabled = false; botao.innerHTML = textoOriginal; }
  }
}

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

const detalhesDoHistorico = new Map();     // id -> lancamento inteiro (nao busca duas vezes)

async function carregarHistorico() {
  const area = $('#lista-historico');
  area.innerHTML = '<div class="cartao ajuda">Carregando...</div>';
  try {
    const resultado = await api('/api/historico');
    if (!resultado.historico.length) {
      area.innerHTML = '<div class="cartao ajuda">Nenhuma nota lançada ainda.</div>';
      return;
    }

    detalhesDoHistorico.clear();
    area.innerHTML = resultado.historico.map(cartaoDoHistorico).join('');
    aplicarIcones(area);

    area.querySelectorAll('[data-desfazer]').forEach((botao) => {
      botao.addEventListener('click', () => desfazerLancamento(botao.dataset.desfazer));
    });
    area.querySelectorAll('[data-ver]').forEach((botao) => {
      botao.addEventListener('click', () => abrirDetalhe(botao.dataset.ver, botao));
    });
  } catch (erro) {
    area.innerHTML = `<div class="cartao alerta-erro">Erro: ${escapar(erro.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// O detalhe: o que foi feito em CADA produto (e o que deu errado)
// ---------------------------------------------------------------------------

async function abrirDetalhe(id, botao) {
  const area = document.querySelector(`[data-detalhe="${id}"]`);
  if (!area) return;

  // segundo clique fecha
  if (!area.classList.contains('escondido')) {
    area.classList.add('escondido');
    botao.querySelector('span').textContent = 'Ver o que foi feito';
    return;
  }

  botao.querySelector('span').textContent = 'Esconder';
  area.classList.remove('escondido');

  if (!detalhesDoHistorico.has(id)) {
    area.innerHTML = '<div class="ajuda">Abrindo...</div>';
    try {
      const { dados } = await api('/api/historico/' + encodeURIComponent(id));
      detalhesDoHistorico.set(id, dados);
    } catch (erro) {
      area.innerHTML = `<div class="alerta-erro">Não deu para abrir: ${escapar(erro.message)}</div>`;
      return;
    }
  }

  area.innerHTML = corpoDoDetalhe(detalhesDoHistorico.get(id));
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
    $('#cfg-ia-parecidos').checked = config.ia.conferirParecidos !== false;
    $('#cfg-arredondar').value = config.regras.arredondarPara ?? 0.9;
    $('#cfg-margem-novo').value = config.regras.margemNovoProduto ?? 30;
    $('#cfg-avisar').value = config.regras.avisarAumentoAcima ?? 10;
    if ($('#cfg-meses-parado')) $('#cfg-meses-parado').value = String(config.regras.mesesParaParado ?? 12);
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

    $('#nome-da-ia').textContent = config.ia.temChave ? config.ia.nomeDaIA : 'sem chave';
    const seletor = $('#cfg-modelo-ia');
    seletor.innerHTML = opcaoRecomendada(config.ia.modelo)
      + (config.ia.modelo ? `<option value="${escapar(config.ia.modelo)}" selected>${escapar(config.ia.modelo)}</option>` : '');
    if (config.ia.temChave) carregarModelos(config.ia.modelo);

    desenharLogo();
    contarParados();
  } catch (erro) {
    console.error(erro);
  }
}

// ---------------------------------------------------------------------------
// Produtos parados (so gerente) - o prazo vem dos Ajustes
// ---------------------------------------------------------------------------

let paradosCarregados = null;

async function contarParados() {
  const cartao = $('#cartao-parados');
  if (!cartao) return;
  // so gerente marca produto: para os outros o cartao nem aparece
  cartao.classList.toggle('escondido', !sessao.operador?.gerente);
  if (!sessao.operador?.gerente) return;

  $('#resumo-parados').textContent = 'Contando...';
  $('#lista-parados').innerHTML = '';
  try {
    paradosCarregados = await api('/api/parados?limite=300');
    const { total, comEstoque, dias } = paradosCarregados;
    const prazo = prazoEmPalavras(dias);
    $('#prazo-parado').textContent = prazo;
    $('#resumo-parados').innerHTML = total
      ? `<strong>${total.toLocaleString('pt-BR')} produtos</strong> parados há mais de ${prazo}`
        + (comEstoque ? ` — <strong>${comEstoque}</strong> ainda com estoque no sistema.` : '.')
      : 'Nenhum produto parado sem a marca. Tudo em dia.';
    $('#btn-marcar-parados').disabled = !total;
  } catch (erro) {
    $('#resumo-parados').textContent = erro.message;
  }
}

// Mudar o prazo salva na hora e reconta: quem mexe aqui quer ver o efeito.
$('#cfg-meses-parado')?.addEventListener('change', async (evento) => {
  const seletor = evento.currentTarget;
  seletor.disabled = true;
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({ regras: { mesesParaParado: Number(seletor.value) } }),
    });
    avisar(`Agora "parado" é sem movimento há ${prazoEmPalavras(Number(seletor.value) * 30.44)}.`, 'ok');
    await contarParados();
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    seletor.disabled = false;
  }
});

$('#btn-ver-parados')?.addEventListener('click', () => {
  const area = $('#lista-parados');
  if (!paradosCarregados?.produtos?.length) { area.innerHTML = ''; return; }
  const linhas = paradosCarregados.produtos.map((p) => `
    <tr>
      <td>${escapar(p.codigo)}</td>
      <td>${escapar(p.descricao)}</td>
      <td style="text-align:right">${String(p.estoque).replace('.', ',')}</td>
      <td>${p.ultimaAtividade ? new Date(p.ultimaAtividade).toLocaleDateString('pt-BR') : 'sem registro'}</td>
    </tr>`).join('');
  const mais = paradosCarregados.total - paradosCarregados.produtos.length;
  area.innerHTML = `
    <div class="tabela-rolagem" style="max-height:360px;overflow:auto">
      <table>
        <thead><tr><th>Cód.</th><th>Produto</th><th>Estoque</th><th>Último movimento</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    ${mais > 0 ? `<p class="ajuda">...e mais ${mais.toLocaleString('pt-BR')} produtos (os mais antigos aparecem primeiro).</p>` : ''}`;
});

$('#btn-marcar-parados')?.addEventListener('click', async (evento) => {
  const total = paradosCarregados?.total || 0;
  if (!total) return;
  const certeza = confirm(
    `Escrever " - DESATIVADO" no nome de ${total.toLocaleString('pt-BR')} produtos parados há mais de `
    + `${prazoEmPalavras(paradosCarregados?.dias)}?\n\n`
    + 'O produto continua no Solus (não é apagado nem bloqueado). Quando chegar nota dele, a marca sai sozinha.\n'
    + 'Dá para desfazer tudo pelo Histórico.'
  );
  if (!certeza) return;

  const botao = evento.currentTarget;
  botao.disabled = true;
  try {
    const resultado = await api('/api/parados/marcar', { method: 'POST', body: JSON.stringify({}) });
    avisar(`${resultado.marcados.toLocaleString('pt-BR')} produtos marcados como DESATIVADO.`, 'ok');
    contarParados();
  } catch (erro) {
    avisar(erro.message, 'erro');
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Logo da loja (sai no PDF do orcamento)
// ---------------------------------------------------------------------------

/**
 * Mostra a prévia do logo com os botões de trocar e tirar.
 * O `?v=` no endereço força o navegador a buscar de novo depois de trocar —
 * sem isso a tela continuaria mostrando o logo antigo.
 */
async function desenharLogo() {
  const area = $('#area-logo');
  if (!area) return;

  let tem = false;
  let quando = 0;
  try {
    const dados = await api('/api/logo/existe');
    tem = dados.tem;
    quando = dados.quando || 0;
  } catch { /* sem resposta: trata como se não tivesse */ }

  area.innerHTML = tem
    ? `<div class="logo-previa">
         <img src="/api/logo?v=${quando}&sessao=${encodeURIComponent(sessao.token)}" alt="Logo da loja">
         <div class="logo-acoes">
           <button class="botao secundario" id="btn-trocar-logo">Trocar imagem</button>
           <button class="botao secundario" id="btn-tirar-logo">Tirar o logo</button>
         </div>
       </div>`
    : `<button class="botao secundario largura-total" id="btn-por-logo" data-icone="imagem">
         <span>Escolher a imagem do logo</span>
       </button>
       <p class="ajuda" style="margin:8px 0 0">PNG ou JPG, até 3 MB. Fundo branco ou transparente fica melhor.</p>`;

  aplicarIcones(area);
  $('#btn-por-logo')?.addEventListener('click', () => $('#arquivo-logo').click());
  $('#btn-trocar-logo')?.addEventListener('click', () => $('#arquivo-logo').click());
  $('#btn-tirar-logo')?.addEventListener('click', tirarLogo);
}

$('#arquivo-logo')?.addEventListener('change', async (evento) => {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';                 // deixa escolher o mesmo arquivo de novo
  if (!arquivo) return;

  const dados = new FormData();
  dados.append('logo', arquivo);
  try {
    await api('/api/logo', { method: 'POST', body: dados });
    avisar('Logo salvo. Ele já sai no próximo orçamento e as cores do Plugin seguem ele.');
    desenharLogo();
    document.dispatchEvent(new CustomEvent('logo-mudou'));
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
});

async function tirarLogo() {
  if (!confirm('Tirar o logo? Os orçamentos voltam a sair só com o nome da loja.')) return;
  try {
    await api('/api/logo', { method: 'DELETE' });
    avisar('Logo removido.');
    desenharLogo();
    document.dispatchEvent(new CustomEvent('logo-mudou'));
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

/** Valor vazio = cada IA usa o modelo que foi testado e escolhido para ela. */
function opcaoRecomendada(atual) {
  return `<option value="" ${atual ? '' : 'selected'}>Recomendado (mais rápido e correto)</option>`;
}

async function carregarModelos(atual) {
  try {
    const resposta = await fetch('/api/modelos-ia');
    const resultado = await resposta.json();
    if (!resultado.ok || !resultado.modelos?.length) return;
    $('#cfg-modelo-ia').innerHTML = opcaoRecomendada(atual) + resultado.modelos
      .map((m) => `<option value="${escapar(m)}" ${m === atual ? 'selected' : ''}>${escapar(m)}</option>`)
      .join('');
  } catch { /* sem chave valida ainda: fica so o modelo atual na lista */ }
}

$('#btn-salvar-config').addEventListener('click', async () => {
  const novo = {
    ia: {
      chave: $('#cfg-chave-ia').value.trim(),
      modelo: $('#cfg-modelo-ia').value,
      conferirParecidos: $('#cfg-ia-parecidos').checked,
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
      mesesParaParado: Number($('#cfg-meses-parado')?.value) || 12,
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
    mostrarTeste(area, true, `Chave funcionando: ${resultado.nomeDaIA || 'IA'}. ${resultado.modelosDisponiveis} modelos disponíveis.`);
    if (resultado.nomeDaIA) $('#nome-da-ia').textContent = resultado.nomeDaIA;
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


