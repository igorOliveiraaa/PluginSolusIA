// Configuracao da ferramenta. Fica num arquivo JSON simples (dados/config.json)
// para dar para mudar pela tela de Ajustes, sem mexer em codigo.
//
// O PC servidor pode ter MAIS DE UM Solus (um por CNPJ). Por isso a configuracao
// tem duas partes:
//   - o que vale para o Plugin todo: chave da IA, regras de preco, porta;
//   - o que e de cada loja: o banco, os dados da loja no PDF, a pasta das notas.
//
// O arquivo fica assim:
//   { "ia": {...}, "regras": {...}, "servidor": {...},
//     "lojas": [ { "id": "loja-a", "nome": "LOJA A", "banco": {...}, ... } ] }
//
// Arquivos antigos (antes das varias lojas) tinham "banco" solto no topo; eles
// continuam funcionando como uma loja so, chamada "principal".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lojaAtualId } from './loja-atual.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'dados', 'config.json');

export const PASTAS = {
  raiz: RAIZ,
  dados: path.join(RAIZ, 'dados'),
  uploads: path.join(RAIZ, 'dados', 'uploads'),
  historico: path.join(RAIZ, 'dados', 'historico'),
  web: path.join(RAIZ, 'web'),
};

// o que e de cada loja
const CHAVES_DA_LOJA = ['banco', 'loja', 'notas', 'empresa'];

const PADRAO_GLOBAL = {
  ia: {
    chave: '',                        // chave do Google Gemini (tela de Ajustes)
    modelo: 'gemini-flash-latest',    // le foto e PDF; e o mais barato da familia
  },
  regras: {
    manterMargem: true,         // sugerir preco que mantem a mesma margem de hoje
    arredondarPara: 0.90,       // termina o preco em ,90 (0 = nao arredondar)
    margemNovoProduto: 30,      // margem % usada quando o produto ainda nao existe
    avisarAumentoAcima: 10,     // destacar quando o custo sobe/cai mais que 10%
    margemMinima: 0,            // avisar quando a margem cair abaixo disso
    somarFrete: true,           // frete e despesas entram no custo
    somarIPI: true,             // IPI entra no custo
    somarST: true,              // ICMS-ST entra no custo
  },
  servidor: {
    porta: 3535,
    abrirNavegador: true,       // abre o Plugin sozinho quando o servidor liga
  },
};

// O usuario e a senha do Firebird saem do .env quando existir; o que fica aqui e
// so o padrao de fabrica do proprio Firebird, para a ferramenta conectar de
// primeira numa instalacao nova. Quem quiser trocar, troca em dados/config.json.
const USUARIO_FIREBIRD = process.env.SOLUS_USUARIO || 'SYSDBA';
const SENHA_FIREBIRD = process.env.SOLUS_SENHA || 'masterkey';

const PADRAO_LOJA = {
  banco: {
    host: 'localhost',          // o Firebird roda no proprio PC servidor
    porta: 3050,
    caminho: '',                // escolhido na tela de configuracao das lojas
    usuario: USUARIO_FIREBIRD,
    senha: SENHA_FIREBIRD,
  },
  notas: {
    // pastas onde o ACBr/Solus salvam o XML e o PDF das notas emitidas, uma por linha.
    // Quando a emissao e em outro PC, use o caminho de rede do PC do certificado.
    pastas: '',
  },
  // aparecem no cabecalho do PDF do orcamento (se vazio, usa o cadastro do Solus)
  loja: {
    nome: '', razao: '', cnpj: '', endereco: '', bairro: '',
    cidade: '', uf: '', cep: '', telefone: '', email: '',
  },
  empresa: {
    codigo: '1',
    // 'simples' = Simples Nacional (nao aproveita credito de ICMS -> custo cheio)
    // 'normal'  = Lucro Presumido/Real (aproveita credito de ICMS)
    regime: 'simples',
  },
};

function juntarFundo(padrao, salvo) {
  const resultado = { ...padrao };
  for (const chave of Object.keys(padrao)) {
    const valorPadrao = padrao[chave];
    const valorSalvo = salvo?.[chave];
    if (valorPadrao && typeof valorPadrao === 'object' && !Array.isArray(valorPadrao)) {
      resultado[chave] = juntarFundo(valorPadrao, valorSalvo ?? {});
    } else if (valorSalvo !== undefined) {
      resultado[chave] = valorSalvo;
    }
  }
  return resultado;
}

function lerArquivo() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return {};   // ainda nao configurou
  }
}

function gravarArquivo(dados) {
  fs.mkdirSync(PASTAS.dados, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), 'utf8');
}

/** Transforma um nome em identificador simples: "Loja Centro" -> "loja-centro". */
export function criarIdDaLoja(nome, existentes = []) {
  const base = String(nome || 'loja')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'loja';
  let id = base;
  let n = 2;
  while (existentes.includes(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Lojas configuradas. Arquivo antigo (banco solto no topo) vira uma loja so.
 * Instalacao nova, sem nada, devolve lista vazia: ai a tela pede para escolher.
 */
export function lojasConfiguradas() {
  const arquivo = lerArquivo();

  if (Array.isArray(arquivo.lojas)) {
    return arquivo.lojas.map((l) => ({ ...juntarFundo(PADRAO_LOJA, l), id: l.id, nome: l.nome, cnpj: l.cnpj || '' }));
  }

  if (arquivo.banco?.caminho) {
    return [{
      ...juntarFundo(PADRAO_LOJA, arquivo),
      id: 'principal',
      nome: arquivo.loja?.nome || 'Loja principal',
      cnpj: arquivo.loja?.cnpj || '',
    }];
  }

  return [];
}

/**
 * Configuracao completa de UMA loja, no mesmo formato de sempre
 * ({ banco, loja, notas, empresa, ia, regras, servidor }).
 * Sem loja informada, usa a loja da requisicao atual; se nao houver, a primeira.
 */
export function carregarConfig(lojaId = lojaAtualId()) {
  const arquivo = lerArquivo();
  const global = juntarFundo(PADRAO_GLOBAL, arquivo);
  const lojas = lojasConfiguradas();

  const loja = (lojaId && lojas.find((l) => l.id === lojaId)) || lojas[0] || null;
  const daLoja = loja ? juntarFundo(PADRAO_LOJA, loja) : juntarFundo(PADRAO_LOJA, {});

  return {
    ...global,
    ...daLoja,
    lojaId: loja?.id || null,
    lojaNome: loja?.nome || '',
  };
}

/**
 * Salva ajustes. O que e global vai para o topo; o que e da loja vai so para a
 * loja da requisicao (ou a informada).
 */
export function salvarConfig(novo, lojaId = lojaAtualId()) {
  const arquivo = lerArquivo();

  for (const chave of Object.keys(PADRAO_GLOBAL)) {
    if (novo[chave] !== undefined) {
      arquivo[chave] = juntarFundo(juntarFundo(PADRAO_GLOBAL, arquivo)[chave], novo[chave]);
    }
  }

  const parteDaLoja = Object.fromEntries(CHAVES_DA_LOJA.filter((c) => novo[c] !== undefined).map((c) => [c, novo[c]]));

  if (Object.keys(parteDaLoja).length) {
    if (Array.isArray(arquivo.lojas) && arquivo.lojas.length) {
      const alvo = arquivo.lojas.find((l) => l.id === lojaId) || arquivo.lojas[0];
      for (const [chave, valor] of Object.entries(parteDaLoja)) {
        alvo[chave] = juntarFundo(juntarFundo(PADRAO_LOJA, alvo)[chave], valor);
      }
    } else {
      // formato antigo: uma loja so, com os dados no topo
      for (const [chave, valor] of Object.entries(parteDaLoja)) {
        arquivo[chave] = juntarFundo(juntarFundo(PADRAO_LOJA, arquivo)[chave], valor);
      }
    }
  }

  gravarArquivo(arquivo);
  return carregarConfig(lojaId);
}

/**
 * Grava a lista de lojas (tela de configuracao das lojas).
 * Cada item: { id?, nome, cnpj, banco: { caminho, host?, porta?, usuario?, senha? } }.
 * Mantem o que ja existia de cada loja (dados do PDF, pasta das notas).
 */
export function salvarLojas(lista) {
  const arquivo = lerArquivo();
  const atuais = lojasConfiguradas();
  const ids = [];

  const novas = lista.map((item) => {
    const anterior = atuais.find((l) => l.id === item.id)
      || atuais.find((l) => l.banco?.caminho && l.banco.caminho === item.banco?.caminho);
    const id = anterior?.id || criarIdDaLoja(item.nome, ids);
    ids.push(id);

    const base = anterior ? { ...anterior } : {};
    return {
      ...base,
      id,
      nome: String(item.nome || anterior?.nome || 'Loja').trim(),
      cnpj: String(item.cnpj || anterior?.cnpj || '').trim(),
      banco: juntarFundo(PADRAO_LOJA.banco, { ...(anterior?.banco || {}), ...(item.banco || {}) }),
    };
  });

  // sai do formato antigo: os dados da loja agora moram dentro de "lojas"
  for (const chave of CHAVES_DA_LOJA) delete arquivo[chave];
  arquivo.lojas = novas;

  gravarArquivo(arquivo);
  return lojasConfiguradas();
}

/**
 * Pasta de dados de uma loja (historico, acompanhamento).
 * A loja "principal" (instalacao antiga) continua usando as pastas de sempre,
 * para nao sumir o historico que ja existia.
 */
export function pastaDaLoja(subpasta = '', lojaId = lojaAtualId()) {
  const id = lojaId || carregarConfig().lojaId || 'principal';
  const base = id === 'principal' ? PASTAS.dados : path.join(PASTAS.dados, 'lojas', id);
  const pasta = subpasta ? path.join(base, subpasta) : base;
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

export function garantirPastas() {
  for (const pasta of [PASTAS.dados, PASTAS.uploads, PASTAS.historico]) {
    fs.mkdirSync(pasta, { recursive: true });
  }
}
