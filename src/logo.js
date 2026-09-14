// O logo da loja, que sai no PDF do orcamento.
//
// Fica guardado na pasta da propria loja (`dados/lojas/<id>/logo.png`), porque
// cada CNPJ tem o seu. Nao vai para o Git junto com o codigo.
//
// So PNG e JPG: sao os dois formatos que o gerador de PDF sabe desenhar. Se
// alguem mandar outra coisa (WEBP do celular, por exemplo), o arquivo e recusado
// com uma explicacao em vez de quebrar o PDF na hora de gerar.

import fs from 'node:fs';
import path from 'node:path';
import { pastaDaLoja } from './config.js';

const TAMANHO_MAXIMO = 3 * 1024 * 1024;    // 3 MB ja e bem mais do que precisa

/** Descobre o formato pelos primeiros bytes, nao pelo nome do arquivo. */
export function formatoDaImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}

const arquivos = () => ['logo.png', 'logo.jpg'].map((nome) => path.join(pastaDaLoja(), nome));

/** Caminho do logo desta loja, se existir. */
export function caminhoDoLogo() {
  for (const caminho of arquivos()) {
    if (fs.existsSync(caminho)) return caminho;
  }
  return null;
}

/** O logo pronto para desenhar no PDF (ou null, se a loja nao tem). */
export function lerLogo() {
  const caminho = caminhoDoLogo();
  if (!caminho) return null;
  try {
    return {
      dados: fs.readFileSync(caminho),
      tipo: caminho.endsWith('.png') ? 'image/png' : 'image/jpeg',
      quando: fs.statSync(caminho).mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Guarda o logo da loja. Devolve o formato aceito.
 * Apaga o formato antigo para nao ficarem dois logos brigando.
 */
export function guardarLogo(buffer) {
  if (!buffer?.length) throw new Error('Nenhuma imagem recebida.');
  if (buffer.length > TAMANHO_MAXIMO) {
    throw new Error('A imagem e grande demais. Use uma de ate 3 MB.');
  }

  const formato = formatoDaImagem(buffer);
  if (!formato) {
    throw new Error('Formato nao aceito. Salve o logo como PNG ou JPG e mande de novo.');
  }

  apagarLogo();
  const destino = path.join(pastaDaLoja(), `logo.${formato}`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buffer);
  return { formato, caminho: destino };
}

export function apagarLogo() {
  let apagou = false;
  for (const caminho of arquivos()) {
    if (!fs.existsSync(caminho)) continue;
    try { fs.unlinkSync(caminho); apagou = true; } catch { /* em uso: ignora */ }
  }
  return apagou;
}
