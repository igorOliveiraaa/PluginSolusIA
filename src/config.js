// Configuracao da ferramenta. Fica num arquivo JSON simples (dados/config.json)
// para o Igor poder mudar pela tela de Configuracao, sem mexer em codigo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'dados', 'config.json');

export const PASTAS = {
  raiz: RAIZ,
  dados: path.join(RAIZ, 'dados'),
  uploads: path.join(RAIZ, 'dados', 'uploads'),
  historico: path.join(RAIZ, 'dados', 'historico'),
  web: path.join(RAIZ, 'web'),
};

const PADRAO = {
  banco: {
    host: 'localhost',          // na loja: IP do PC servidor, ex. 192.168.0.10
    porta: 3050,
    caminho: 'C:/Solus/Solussis/BANCO/BANCO.FDB',
    usuario: 'SYSDBA',
    senha: 'masterkey',
  },
  ia: {
    chave: '',                        // chave do Google Gemini (tela de Configuracao)
    modelo: 'gemini-2.5-flash',       // le foto e PDF; e o mais barato da familia
  },
  regras: {
    // Como sugerir o preco novo quando o custo muda
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
  },
  // aparecem no cabecalho do PDF do orcamento
  loja: {
    nome: '',
    razao: '',
    cnpj: '',
    endereco: '',
    bairro: '',
    cidade: '',
    uf: '',
    cep: '',
    telefone: '',
    email: '',
  },
  empresa: {
    codigo: '1',                // codigo da empresa dentro do Solus (multi-loja)
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

export function carregarConfig() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8');
    return juntarFundo(PADRAO, JSON.parse(bruto));
  } catch {
    return { ...PADRAO };   // ainda nao configurou: usa os valores de fabrica
  }
}

export function salvarConfig(novo) {
  const atual = carregarConfig();
  const completo = juntarFundo(atual, novo);
  fs.mkdirSync(PASTAS.dados, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(completo, null, 2), 'utf8');
  return completo;
}

export function garantirPastas() {
  for (const pasta of [PASTAS.dados, PASTAS.uploads, PASTAS.historico]) {
    fs.mkdirSync(pasta, { recursive: true });
  }
}
