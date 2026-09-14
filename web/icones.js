/* Icones em SVG, traco fino e cantos arredondados.
   Desenhados aqui mesmo: nenhum download, nenhuma fonte de icone, nada de emoji.
   Todos herdam a cor do texto por volta (currentColor) e o tamanho vem do CSS. */

const CAMINHOS = {
  // documento / nota
  documento: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 12h6"/><path d="M9 16h4"/>',

  // camera
  camera: '<path d="M14.5 4h-5L8 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-1.5-2Z"/><circle cx="12" cy="12.5" r="3.5"/>',

  // lista / recibo
  lista: '<path d="M8 6h9"/><path d="M8 12h9"/><path d="M8 18h6"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',

  // clipe de anexo
  anexo: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',

  // fechar
  fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',

  // enviar (seta para cima)
  enviar: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',

  // conversa
  conversa: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"/>',

  // planilha
  planilha: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/><path d="M3 15h18"/>',

  // pdf / arquivo de texto
  pdf: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 13h6"/><path d="M9 17h6"/>',

  // impressora
  imprimir: '<path d="M6 9V3h12v6"/><path d="M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1"/><rect x="7" y="14" width="10" height="7" rx="1"/>',

  // compartilhar
  compartilhar: '<path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5"/>',

  // mais
  mais: '<path d="M12 5v14"/><path d="M5 12h14"/>',

  // aviso
  aviso: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',

  // conferido
  certo: '<path d="M20 6 9 17l-5-5"/>',

  // caixa / estoque
  caixa: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',

  // pessoa / cliente
  pessoa: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',

  // relogio / historico
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',

  // engrenagem
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',

  // lupa
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',

  // etiqueta de preco
  preco: '<path d="M20.6 13.4 12 4.8V3H5a2 2 0 0 0-2 2v7h1.8l8.6 8.6a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',

  // grafico
  grafico: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 14 3-4 3 3 4-6"/>',

  // seta para baixo (baixar)
  baixar: '<path d="M12 4v11"/><path d="m7 12 5 5 5-5"/><path d="M4 19h16"/>',

  // cadeado
  cadeado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',

  // faisca (IA)
  ia: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M5.6 5.6 7.8 7.8"/><path d="m16.2 16.2 2.2 2.2"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 18.4 7.8 16.2"/><path d="m16.2 7.8 2.2-2.2"/><circle cx="12" cy="12" r="3"/>',

  // imagem (o logo da loja)
  imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
};

/**
 * Devolve o SVG do icone.
 * `tamanho` em pixels; a cor vem do elemento de fora.
 */
export function icone(nome, tamanho = 20) {
  const caminho = CAMINHOS[nome];
  if (!caminho) return '';
  return `<svg class="icone" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminho}</svg>`;
}

/** Coloca os icones nos lugares marcados com data-icone no HTML. */
export function aplicarIcones(raiz = document) {
  raiz.querySelectorAll('[data-icone]').forEach((elemento) => {
    const nome = elemento.dataset.icone;
    const tamanho = Number(elemento.dataset.iconeTamanho) || 20;
    const svg = icone(nome, tamanho);
    if (svg) elemento.insertAdjacentHTML('afterbegin', svg);
    elemento.removeAttribute('data-icone');
  });
}
