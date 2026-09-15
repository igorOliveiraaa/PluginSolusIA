/* Colar imagem com Ctrl+V.
 *
 * Copiou o print do WhatsApp ou a foto da nota? E so apertar Ctrl+V com a tela
 * aberta - a imagem entra como se tivesse escolhido o arquivo. Poupa salvar a
 * imagem numa pasta so para depois ir procurar ela.
 *
 * So age na tela que pediu (a que esta aberta) e so quando o que foi copiado e
 * ARQUIVO: colar texto dentro de um campo continua funcionando normal.
 */

import { avisar } from './comum.js';

const TIPOS = /^(image\/|application\/pdf$|text\/xml$|application\/xml$)/;

/** Arquivos que estao na area de transferencia deste evento. */
function arquivosColados(evento) {
  const itens = [...(evento.clipboardData?.items || [])];
  const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  return itens
    .filter((item) => item.kind === 'file' && TIPOS.test(item.type))
    .map((item, indice) => {
      const arquivo = item.getAsFile();
      if (!arquivo) return null;
      // print colado sempre se chama "image.png": sem renomear, o segundo print
      // parece repetido e some da lista
      const extensao = (arquivo.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '');
      const nome = /^image\.\w+$/i.test(arquivo.name) || !arquivo.name
        ? `colado-${hora}${indice ? '-' + indice : ''}.${extensao}`
        : arquivo.name;
      return new File([arquivo], nome, { type: arquivo.type, lastModified: Date.now() });
    })
    .filter(Boolean);
}

/**
 * Liga o Ctrl+V de uma tela.
 *  tela: o id da secao sem "tela-" (ex.: 'enviar', 'orcamento')
 *  aoColar(arquivos): recebe a lista de File
 */
export function ligarColar({ tela, aoColar, destacar }) {
  document.addEventListener('paste', (evento) => {
    if (!document.querySelector(`#tela-${tela}.ativa`)) return;
    const arquivos = arquivosColados(evento);
    if (!arquivos.length) return;              // era texto: deixa colar no campo

    evento.preventDefault();
    aoColar(arquivos);
    avisar(arquivos.length === 1 ? 'Imagem colada.' : `${arquivos.length} arquivos colados.`, 'ok');

    // um brilho rapido na area de arquivo, para ver onde a imagem entrou
    if (destacar) {
      destacar.classList.remove('recebeu');
      void destacar.offsetWidth;
      destacar.classList.add('recebeu');
    }
  });
}
