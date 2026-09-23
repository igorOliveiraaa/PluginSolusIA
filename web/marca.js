/* A cara da loja no Plugin: o logo no menu e as cores dele no fundo.
 *
 * As cores saem do PROPRIO logo (cadastrado em Ajustes): a imagem e desenhada
 * num quadradinho escondido, os pixels sao agrupados por matiz e as tres cores
 * mais fortes viram o degrade do menu, do botao principal e a aurora do fundo.
 * Sem logo, fica uma paleta padrao (indigo, teal e rosa).
 *
 * As cores ficam guardadas no navegador: na proxima abertura a tela ja nasce
 * com elas, sem piscar a paleta padrao antes.
 */

import { $, sessao } from './comum.js';

const PADRAO = [[79, 70, 229], [13, 148, 136], [219, 39, 119]];
const CHAVE = () => `solus-marca-${sessao.operador?.loja?.id || 'principal'}`;
let urlAtual = '';

// ---------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------

function paraHsl([r, g, b]) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function paraRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

/**
 * Deixa a cor boa para fundo de menu/botao com letra branca: nem clara demais
 * (letra some) nem escura demais (vira preto), e com saturacao de verdade.
 */
function ajustarParaMarca(rgb) {
  const [h, s, l] = paraHsl(rgb);
  return paraRgb([h, Math.min(Math.max(s, 0.55), 0.9), Math.min(Math.max(l, 0.36), 0.5)]);
}

/** As 3 cores mais marcantes da imagem (ignora branco, preto e cinza). */
function coresDaImagem(imagem) {
  const lado = 64;
  const tela = document.createElement('canvas');
  tela.width = lado;
  tela.height = lado;
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imagem, 0, 0, lado, lado);
  const { data } = ctx.getImageData(0, 0, lado, lado);

  const grupos = new Map();          // faixa de matiz -> soma
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;                      // transparente
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = paraHsl(rgb);
    if (s < 0.28 || l > 0.9 || l < 0.12) continue;        // branco, preto, cinza
    const faixa = Math.round(h / 24) % 15;
    const grupo = grupos.get(faixa) || { peso: 0, r: 0, g: 0, b: 0 };
    const peso = s * (1 - Math.abs(l - 0.5));
    grupo.peso += peso;
    grupo.r += rgb[0] * peso;
    grupo.g += rgb[1] * peso;
    grupo.b += rgb[2] * peso;
    grupos.set(faixa, grupo);
  }

  const fortes = [...grupos.values()]
    .filter((g) => g.peso > 1.5)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 3)
    .map((g) => ajustarParaMarca([g.r / g.peso, g.g / g.peso, g.b / g.peso]));

  if (!fortes.length) return null;
  // logo de uma cor so: as outras duas nascem dela, girando o matiz
  while (fortes.length < 3) {
    const [h, s, l] = paraHsl(fortes[0]);
    fortes.push(paraRgb([(h + (fortes.length === 1 ? 38 : -42) + 360) % 360, s, l]));
  }
  return fortes;
}

function aplicarCores(cores) {
  const raiz = document.documentElement.style;
  (cores || PADRAO).forEach((rgb, i) => {
    raiz.setProperty(`--marca-${i + 1}-rgb`, rgb.join(', '));
    raiz.setProperty(`--marca-${i + 1}`, `rgb(${rgb.join(', ')})`);
  });
  // a barra do navegador no celular acompanha
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${(cores || PADRAO)[0].join(', ')})`);
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/** Endereco (blob) do logo ja carregado - a previa de Ajustes usa o mesmo. */
export function urlDoLogo() {
  return urlAtual;
}

function mostrarLogo(url) {
  const img = $('#marca-logo');
  const icone = $('#marca-icone');
  if (!img || !icone) return;
  img.hidden = !url;
  icone.hidden = Boolean(url);
  if (url) img.src = url;
}

/**
 * Busca o logo da loja em que a pessoa entrou e pinta o Plugin com as cores dele.
 * A imagem vem com o cabecalho da sessao (um <img src> simples nao manda e o
 * servidor recusava - era por isso que a previa em Ajustes podia sair quebrada).
 */
export async function carregarMarca() {
  // primeiro o que ja estava guardado: a tela nao pisca a cor padrao
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE()) || 'null');
    if (guardado?.cores) aplicarCores(guardado.cores);
  } catch { /* sem armazenamento */ }

  const nomeLoja = sessao.operador?.loja?.nome;
  if ($('#marca-nome')) $('#marca-nome').textContent = nomeLoja || 'Plugin IA Solus';

  if (!sessao.token) { mostrarLogo(''); return; }

  try {
    const resposta = await fetch('/api/logo', { headers: { 'x-sessao': sessao.token } });
    // 204 = a loja ainda não tem logo (não é erro); o resto que não for ok, também não mostra
    if (!resposta.ok || resposta.status === 204) throw new Error('sem logo');
    const blob = await resposta.blob();
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = URL.createObjectURL(blob);
    mostrarLogo(urlAtual);

    const imagem = new Image();
    imagem.src = urlAtual;
    await imagem.decode();
    const cores = coresDaImagem(imagem);
    aplicarCores(cores);
    try { localStorage.setItem(CHAVE(), JSON.stringify({ cores: cores || PADRAO })); } catch { /* ok */ }
  } catch {
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = '';
    mostrarLogo('');
    aplicarCores(PADRAO);
    try { localStorage.removeItem(CHAVE()); } catch { /* ok */ }
  }
}

document.addEventListener('entrou', carregarMarca);
document.addEventListener('logo-mudou', carregarMarca);
