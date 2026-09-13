// Gera os icones PNG do aplicativo a partir do mesmo desenho do icone.svg.
//
// Por que PNG e nao so o SVG: o Chrome do Android so oferece "instalar
// aplicativo" quando o manifesto tem um icone PNG de 192 e outro de 512; com
// SVG ele simplesmente nao mostra a opcao. O iPhone tambem ignora SVG no
// apple-touch-icon. Era por isso que dava para instalar no PC e nao no celular.
//
// Nao ha biblioteca de imagem no projeto: o desenho e feito pixel a pixel
// (com 3x de suavizacao nas bordas) e o PNG e montado na mao com zlib.
//
// Rodar:  node src/ferramentas/gerar-icones.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..', '..', 'web');

const TEAL = [15, 118, 110];
const TEAL_CLARO = [20, 184, 166];
const BRANCO = [255, 255, 255];
const CINZA = [148, 163, 184];

// ---------------------------------------------------------------------------
// formas (coordenadas na escala 0..192, igual ao icone.svg)
// ---------------------------------------------------------------------------

const dentroDoRetanguloArredondado = (x, y, rx, ry, largura, altura, raio) => {
  if (x < rx || y < ry || x > rx + largura || y > ry + altura) return false;
  const dx = Math.max(rx + raio - x, 0, x - (rx + largura - raio));
  const dy = Math.max(ry + raio - y, 0, y - (ry + altura - raio));
  return dx * dx + dy * dy <= raio * raio;
};

/** Distancia de um ponto ate um segmento de reta (para desenhar o "certo"). */
function distanciaDaLinha(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const tamanho = dx * dx + dy * dy;
  let t = tamanho ? ((x - x1) * dx + (y - y1) * dy) / tamanho : 0;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

/**
 * Cor do desenho em um ponto. `margem` afasta o desenho da borda: o icone
 * "maskable" do Android pode ser cortado em circulo, entao o conteudo fica menor.
 */
function corNoPonto(x, y, { comFundo = true, escala = 1 } = {}) {
  // aplica a escala em volta do centro
  const cx = 96 + (x - 96) / escala;
  const cy = 96 + (y - 96) / escala;

  const folha = dentroDoRetanguloArredondado(cx, cy, 52, 38, 88, 112, 8);
  if (folha) {
    // linhas de texto da folha
    if (dentroDoRetanguloArredondado(cx, cy, 66, 58, 60, 7, 3.5)) return TEAL;
    if (dentroDoRetanguloArredondado(cx, cy, 66, 76, 60, 7, 3.5)) return CINZA;
    if (dentroDoRetanguloArredondado(cx, cy, 66, 94, 42, 7, 3.5)) return CINZA;
    // o "certo" (duas linhas grossas)
    const meio = Math.min(
      distanciaDaLinha(cx, cy, 74, 120, 88, 134),
      distanciaDaLinha(cx, cy, 88, 134, 118, 104)
    );
    if (meio <= 5.5) return TEAL;
    return BRANCO;
  }

  if (!comFundo) return null;

  // fundo: quadrado arredondado com um degrade leve, como o topo do app
  if (dentroDoRetanguloArredondado(x, y, 0, 0, 192, 192, 42)) {
    const t = (x + y) / 384;
    return [
      Math.round(TEAL[0] + (TEAL_CLARO[0] - TEAL[0]) * t * 0.55),
      Math.round(TEAL[1] + (TEAL_CLARO[1] - TEAL[1]) * t * 0.55),
      Math.round(TEAL[2] + (TEAL_CLARO[2] - TEAL[2]) * t * 0.55),
    ];
  }
  return null;   // transparente
}

// ---------------------------------------------------------------------------
// desenho com suavizacao
// ---------------------------------------------------------------------------

const AMOSTRAS = 3;   // 3x3 pontos por pixel, para a borda nao ficar serrilhada

function desenhar(tamanho, opcoes = {}) {
  const pixels = Buffer.alloc(tamanho * tamanho * 4);
  const passo = 192 / tamanho;

  for (let py = 0; py < tamanho; py += 1) {
    for (let px = 0; px < tamanho; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let opacos = 0;

      for (let ay = 0; ay < AMOSTRAS; ay += 1) {
        for (let ax = 0; ax < AMOSTRAS; ax += 1) {
          const x = (px + (ax + 0.5) / AMOSTRAS) * passo;
          const y = (py + (ay + 0.5) / AMOSTRAS) * passo;
          const cor = corNoPonto(x, y, opcoes);
          if (!cor) continue;
          r += cor[0]; g += cor[1]; b += cor[2];
          opacos += 1;
        }
      }

      const total = AMOSTRAS * AMOSTRAS;
      const i = (py * tamanho + px) * 4;
      if (!opacos) continue;                    // fica transparente
      pixels[i] = Math.round(r / opacos);
      pixels[i + 1] = Math.round(g / opacos);
      pixels[i + 2] = Math.round(b / opacos);
      pixels[i + 3] = Math.round((opacos / total) * 255);
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// PNG na mao
// ---------------------------------------------------------------------------

function pedaco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = TABELA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function montarPng(pixels, tamanho) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(tamanho, 0);
  cabecalho.writeUInt32BE(tamanho, 4);
  cabecalho[8] = 8;      // 8 bits por canal
  cabecalho[9] = 6;      // RGBA
  cabecalho[10] = 0; cabecalho[11] = 0; cabecalho[12] = 0;

  // cada linha comeca com o byte do filtro (0 = nenhum)
  const cru = Buffer.alloc(tamanho * (tamanho * 4 + 1));
  for (let y = 0; y < tamanho; y += 1) {
    cru[y * (tamanho * 4 + 1)] = 0;
    pixels.copy(cru, y * (tamanho * 4 + 1) + 1, y * tamanho * 4, (y + 1) * tamanho * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', zlib.deflateSync(cru, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const arquivos = [
  // o normal, usado no manifesto e pelo iPhone
  { nome: 'icone-192.png', tamanho: 192, opcoes: {} },
  { nome: 'icone-512.png', tamanho: 512, opcoes: {} },
  // o "maskable" do Android pode ser cortado em circulo: desenho menor por dentro
  { nome: 'icone-maskable-512.png', tamanho: 512, opcoes: { escala: 0.72 } },
];

for (const { nome, tamanho, opcoes } of arquivos) {
  const png = montarPng(desenhar(tamanho, opcoes), tamanho);
  fs.writeFileSync(path.join(WEB, nome), png);
  console.log(`  ${nome.padEnd(26)} ${tamanho}x${tamanho}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log('\nIcones gerados em web/.');
