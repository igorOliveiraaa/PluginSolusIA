// Onde estao os arquivos da nota fiscal (XML e PDF).
//
// Quem emite a nota e o ACBrMonitor, chamado pelo Solus, no PC que tem o
// certificado digital. Ele guarda o XML autorizado com o nome da chave
// ("3525...1235-nfe.xml") numa pasta daquele PC - normalmente
// C:\ACBrMonitorPLUS\Logs - e o caminho fica gravado em NF.XML no banco.
//
// O Plugin roda no PC servidor, entao para enxergar esses arquivos a pasta do PC
// do certificado precisa estar COMPARTILHADA na rede (ex.: \\CAIXA1\ACBrMonitorPLUS\Logs)
// e cadastrada na aba Ajustes. Aqui a gente procura em todas as pastas conhecidas.

import fs from 'node:fs';
import path from 'node:path';
import { carregarConfig } from './config.js';

// lugares onde o ACBr e o Solus costumam salvar, quando e o mesmo PC
const PASTAS_PADRAO = [
  'C:/ACBrMonitorPLUS/Logs',
  'C:/ACBrMonitorPLUS/PDF',
  'C:/Solus/nfe',
  'C:/Solus/Nfepdf',
];

/** Deixa so os 44 digitos da chave. */
export function limparChave(chave) {
  const digitos = String(chave || '').replace(/\D/g, '');
  return digitos.length === 44 ? digitos : '';
}

/** Pastas onde procurar: as configuradas primeiro, depois as padrao. */
export function pastasDasNotas(caminhoGravadoNoBanco = '') {
  const cfg = carregarConfig();
  const configuradas = String(cfg.notas?.pastas || '')
    .split(/[\n;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const lista = [...configuradas];

  // a pasta que o proprio ACBr gravou no banco (vale quando e este mesmo PC)
  if (caminhoGravadoNoBanco) {
    lista.push(path.win32.dirname(String(caminhoGravadoNoBanco).trim()));
  }

  lista.push(...PASTAS_PADRAO);

  // sem repetidos, comparando sem diferenca de barra e maiuscula
  const vistas = new Set();
  return lista.filter((pasta) => {
    const chave = pasta.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

function arquivosDaPasta(pasta) {
  try {
    return fs.readdirSync(pasta);
  } catch {
    return null;       // pasta nao existe ou a rede nao respondeu
  }
}

/**
 * Procura o XML e o PDF da nota pela chave.
 * Devolve os caminhos encontrados e em quais pastas procurou (para explicar na tela
 * quando nao achar).
 */
export function localizarArquivosDaNota(chave, caminhoGravadoNoBanco = '') {
  const chaveLimpa = limparChave(chave);
  const resultado = { xml: null, pdf: null, pastasProcuradas: [], pastasInacessiveis: [] };
  if (!chaveLimpa) return resultado;

  // 1) o caminho exato gravado no banco, quando ele existe aqui
  if (caminhoGravadoNoBanco) {
    const exato = String(caminhoGravadoNoBanco).trim();
    if (exato.toLowerCase().endsWith('.xml') && fs.existsSync(exato)) resultado.xml = exato;
  }

  for (const pasta of pastasDasNotas(caminhoGravadoNoBanco)) {
    if (resultado.xml && resultado.pdf) break;

    const arquivos = arquivosDaPasta(pasta);
    if (arquivos === null) {
      resultado.pastasInacessiveis.push(pasta);
      continue;
    }
    resultado.pastasProcuradas.push(pasta);

    for (const nome of arquivos) {
      if (!nome.includes(chaveLimpa)) continue;
      const minusculo = nome.toLowerCase();
      // o ACBr tambem salva arquivos de cancelamento/evento com a chave no nome;
      // o que interessa e o da nota ("-nfe.xml" ou so a chave)
      if (!resultado.xml && minusculo.endsWith('.xml') && !/(can|eve|ped|sit)/.test(minusculo.replace(chaveLimpa, ''))) {
        resultado.xml = path.join(pasta, nome);
      }
      if (!resultado.pdf && minusculo.endsWith('.pdf')) {
        resultado.pdf = path.join(pasta, nome);
      }
    }
  }

  return resultado;
}

/** Confere uma pasta digitada na tela de Ajustes. */
export function testarPasta(pasta) {
  const arquivos = arquivosDaPasta(String(pasta || '').trim());
  if (arquivos === null) {
    return { ok: false, mensagem: 'Nao consegui abrir essa pasta. Confira o caminho e se ela esta compartilhada na rede.' };
  }
  const xmls = arquivos.filter((a) => /^\d{44}.*\.xml$/i.test(a)).length;
  const pdfs = arquivos.filter((a) => /\d{44}.*\.pdf$/i.test(a)).length;
  return {
    ok: true,
    mensagem: `Pasta aberta: ${xmls} XML e ${pdfs} PDF de nota encontrados.`,
    xmls,
    pdfs,
  };
}
