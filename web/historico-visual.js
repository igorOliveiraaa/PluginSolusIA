/* O histórico na tela: o cartão de cada lançamento e o "o que foi feito" item a item.
 *
 * Só monta HTML a partir do que o servidor mandou — não busca nada e não mexe
 * na tela. É por isso que dá para conferir por fora do navegador
 * (`node src/ferramentas/t-historico-tela.mjs`), que é o que garante que a
 * pessoa vê "de 10 para 22", o motivo de um item não ter entrado e o erro em
 * vermelho quando a nota não entrou.
 */

import { dinheiro, escapar } from './formatos.js';

/** "1 ano", "6 meses", "1 ano e meio" - o prazo escrito como a gente fala. */
export function prazoEmPalavras(dias) {
  const meses = Math.max(1, Math.round((Number(dias) || 365) / 30.44));
  if (meses < 12) return `${meses} meses`;
  const anos = Math.floor(meses / 12);
  const sobra = meses % 12;
  const texto = `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  if (!sobra) return texto;
  if (sobra === 6) return `${texto} e meio`;
  return `${texto} e ${sobra} ${sobra === 1 ? 'mês' : 'meses'}`;
}

/** Como o lançamento aparece na lista: um cartão que ABRE e mostra item a item. */
export function cartaoDoHistorico(registro) {
  const quando = new Date(registro.quando).toLocaleString('pt-BR');
  const r = registro.resumo || {};
  const pedacos = [
    r.produtosCriados ? `<strong>${r.produtosCriados} cadastrados</strong>` : '',
    r.produtosAtualizados ? `${r.produtosAtualizados} atualizados` : '',
    r.precosIgualados ? `${r.precosIgualados} preços igualados` : '',
    r.produtosDesativados ? `${r.produtosDesativados} desativados` : '',
    r.itensIgnorados ? `<strong>${r.itensIgnorados} não entraram</strong>` : '',
  ].filter(Boolean);

  const titulo = registro.nota?.origem === 'parados'
    ? 'Produtos parados'
    : `Nota ${escapar(registro.nota?.numero || '-')}`;

  return `
    <div class="historico-item ${registro.desfeita ? 'desfeita' : ''} ${registro.falhou ? 'falhou' : ''}"
         data-lancamento="${escapar(registro.id)}">
      <div class="historico-topo">
        <div>
          <strong>${titulo}</strong>
          ${registro.falhou ? '<span class="etiqueta erro">deu erro — nada foi gravado</span>' : ''}
          ${registro.desfeita ? '<span class="etiqueta aviso">desfeita</span>' : ''}<br>
          <span class="historico-data">${escapar(registro.nota?.fornecedor?.nome || '')}</span>
        </div>
        <div class="historico-data" style="text-align:right">
          ${quando}<br>${escapar(registro.operador || '')}
        </div>
      </div>

      <div class="ajuda" style="margin:8px 0 0">
        ${registro.falhou
          ? `<span style="color:var(--perigo)">${escapar(registro.erro || 'erro ao gravar')}</span>`
          : (pedacos.join(' · ') || 'Nenhuma alteração.')}
      </div>

      <div class="historico-acoes">
        <button class="botao secundario" data-ver="${escapar(registro.id)}" data-icone="lista">
          <span>Ver o que foi feito</span>
        </button>
        ${registro.desfeita || registro.falhou ? '' : `
          <button class="botao secundario" data-desfazer="${escapar(registro.id)}" data-icone="seta">
            <span>Desfazer</span>
          </button>`}
      </div>

      <div class="historico-detalhe escondido" data-detalhe="${escapar(registro.id)}"></div>
    </div>`;
}

const COMO_APARECE = {
  criado: { texto: 'cadastrado novo', classe: 'ok' },
  atualizado: { texto: 'atualizado', classe: '' },
  'preco-igualado': { texto: 'preço igualado', classe: '' },
  desativado: { texto: 'desativado', classe: 'aviso' },
  ignorado: { texto: 'não entrou', classe: 'aviso' },
  'nao-gravado': { texto: 'não gravou', classe: 'erro' },
};

const numeroCurto = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** "de 10 para 22" só quando mudou; senão fica quieto. */
function deParaNumero(rotulo, antes, depois, comoDinheiro = false) {
  const a = Number(antes) || 0;
  const d = Number(depois) || 0;
  if (Math.abs(a - d) < 0.005) return '';
  const formatar = comoDinheiro ? dinheiro : numeroCurto;
  const subiu = d > a;
  return `<span class="de-para">
    ${rotulo} <em>${formatar(a)}</em>
    <span class="seta ${subiu ? 'sobe' : 'desce'}">→</span>
    <strong>${formatar(d)}</strong>
  </span>`;
}

/** Uma linha do detalhe: o produto e o que aconteceu com ele. */
export function linhaDoRegistro(registro) {
  const como = COMO_APARECE[registro.acao] || { texto: registro.acao || 'feito', classe: '' };
  const antes = registro.antesValores || {};
  const depois = registro.depois || {};

  // histórico antigo não tinha o 'antesValores': aí o número sai do 'antes' do banco
  const numeroDoBanco = (texto) => Number(String(texto ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  const estoqueAntes = antes.estoque ?? numeroDoBanco(registro.antes?.ESTOQUEATUAL);
  const custoAntes = antes.custo ?? numeroDoBanco(registro.antes?.PC);
  const vendaAntes = antes.venda ?? registro.vendaAntes ?? numeroDoBanco(registro.antes?.PV);

  const mudancas = registro.acao === 'criado'
    ? [
        `<span class="de-para">estoque <strong>${numeroCurto(depois.estoque)}</strong></span>`,
        `<span class="de-para">custo <strong>${dinheiro(depois.custo)}</strong></span>`,
        `<span class="de-para">vende por <strong>${dinheiro(depois.venda)}</strong></span>`,
      ]
    : [
        deParaNumero('estoque', estoqueAntes, depois.estoque),
        deParaNumero('custo', custoAntes, depois.custo, true),
        deParaNumero('venda', vendaAntes, depois.venda, true),
      ];

  const marcas = [
    registro.reativado ? '<span class="etiqueta ok">voltou a ser ativo</span>' : '',
    registro.vinculoCriado?.novo ? '<span class="etiqueta">fornecedor ensinado ao Solus</span>' : '',
    registro.fiscalPreenchido?.length
      ? `<span class="etiqueta">${registro.fiscalPreenchido.length} campos fiscais preenchidos</span>` : '',
    registro.atualizadoPelaNota?.length
      ? `<span class="etiqueta">dados da nota: ${escapar(registro.atualizadoPelaNota.join(', '))}</span>` : '',
    registro.precoMudou ? '<span class="etiqueta">preço mudou — etiqueta nova</span>' : '',
    registro.semAlteracao ? '<span class="etiqueta aviso">nada a mudar</span>' : '',
  ].filter(Boolean);

  const naNota = registro.descricaoNaNota && registro.descricaoNaNota !== registro.descricao
    ? `<div class="ajuda">na nota: ${escapar(registro.descricaoNaNota)}${
        registro.quantidade ? ` · ${numeroCurto(registro.quantidade)} un` : ''}</div>`
    : '';

  return `
    <div class="detalhe-linha ${registro.acao}">
      <div class="detalhe-cabeca">
        <span>
          <strong>${escapar(registro.descricao || registro.descricaoNaNota || '(sem nome)')}</strong>
          ${registro.codigo ? `<span class="historico-data">cód. ${escapar(registro.codigo)}</span>` : ''}
        </span>
        <span class="etiqueta ${como.classe}">${como.texto}</span>
      </div>
      ${naNota}
      ${registro.motivo ? `<div class="ajuda">motivo: ${escapar(registro.motivo)}</div>` : ''}
      ${registro.iaFazer
        ? `<div class="ajuda">ia ${escapar(registro.iaFazer === 'criar' ? 'ser cadastrado' : 'ser atualizado')}</div>` : ''}
      ${registro.nomeAntes && registro.nomeAntes !== registro.descricao
        ? `<div class="ajuda">nome: ${escapar(registro.nomeAntes)} → ${escapar(registro.descricao)}</div>` : ''}
      ${mudancas.filter(Boolean).length ? `<div class="detalhe-numeros">${mudancas.filter(Boolean).join('')}</div>` : ''}
      ${marcas.length ? `<div class="item-etiquetas">${marcas.join('')}</div>` : ''}
    </div>`;
}

/** O detalhe inteiro de um lançamento (o que abre no "Ver o que foi feito"). */
export function corpoDoDetalhe(dados) {
  const registros = dados.registros || [];
  const ordem = ['criado', 'atualizado', 'preco-igualado', 'desativado', 'ignorado', 'nao-gravado'];
  const emOrdem = [...registros].sort((a, b) => ordem.indexOf(a.acao) - ordem.indexOf(b.acao));

  return `
    ${dados.falhou ? `
      <div class="alerta-erro">
        <strong>Esta nota NÃO foi gravada.</strong><br>
        ${escapar(dados.erro || '')}<br>
        <span class="ajuda">Nada mudou no Solus: a gravação é tudo ou nada. Abaixo está o que cada
        item ia fazer — corrija na tela de Nota e envie de novo.</span>
      </div>` : ''}
    ${dados.observacao ? `<div class="ajuda"><strong>Observação:</strong> ${escapar(dados.observacao)}</div>` : ''}
    ${dados.desfeita ? `<div class="ajuda"><strong>Desfeita${
      dados.desfeitaEm ? ' em ' + new Date(dados.desfeitaEm).toLocaleString('pt-BR') : ''}</strong>
       — ${(dados.resultadoDoDesfazer || []).length} produtos voltaram ao que eram.</div>` : ''}
    ${emOrdem.length
      ? emOrdem.map(linhaDoRegistro).join('')
      : '<div class="ajuda">Nenhum item neste lançamento.</div>'}`;
}
