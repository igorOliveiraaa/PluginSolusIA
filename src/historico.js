// Historico das notas aplicadas.
//
// Cada nota aplicada vira um arquivo JSON com o "antes" e o "depois" de cada produto.
// E isso que permite DESFAZER uma importacao inteira se alguem errar - a rede de
// seguranca mais importante da ferramenta.

import fs from 'node:fs';
import path from 'node:path';
import { pastaDaLoja } from './config.js';

function caminhoDo(id) {
  return path.join(pastaDaLoja('historico'), `${id}.json`);
}

function gerarId() {
  const agora = new Date();
  const carimbo = agora.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const sufixo = Math.random().toString(36).slice(2, 6);
  return `${carimbo}-${sufixo}`;
}

/** Guarda o resultado de uma nota aplicada. */
export function salvarAplicacao({ nota, registros, operador = '', observacao = '' }) {
  const id = gerarId();

  const registro = {
    id,
    quando: new Date().toISOString(),
    operador,
    observacao,
    desfeita: false,
    nota: {
      origem: nota.origem,
      numero: nota.numero,
      serie: nota.serie,
      chave: nota.chave,
      emissao: nota.emissao,
      fornecedor: nota.fornecedor,
      totais: nota.totais,
    },
    resumo: {
      produtosAtualizados: registros.filter((r) => r.acao === 'atualizado').length,
      produtosCriados: registros.filter((r) => r.acao === 'criado').length,
      precosIgualados: registros.filter((r) => r.acao === 'preco-igualado').length,
      produtosDesativados: registros.filter((r) => r.acao === 'desativado').length,
    },
    registros,
  };

  fs.writeFileSync(caminhoDo(id), JSON.stringify(registro, null, 2), 'utf8');
  return registro;
}

/** Lista as ultimas notas aplicadas (mais novas primeiro). */
export function listarHistorico(limite = 50) {
  const arquivos = fs
    .readdirSync(pastaDaLoja('historico'))
    .filter((nome) => nome.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limite);

  return arquivos
    .map((nome) => {
      try {
        const dados = JSON.parse(fs.readFileSync(path.join(pastaDaLoja('historico'), nome), 'utf8'));
        return {
          id: dados.id,
          quando: dados.quando,
          operador: dados.operador,
          desfeita: dados.desfeita,
          nota: dados.nota,
          resumo: dados.resumo,
        };
      } catch {
        return null;      // arquivo corrompido nao derruba a listagem
      }
    })
    .filter(Boolean);
}

export function lerAplicacao(id) {
  const arquivo = caminhoDo(String(id).replace(/[^\w-]/g, ''));
  if (!fs.existsSync(arquivo)) return null;
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

/** Marca como desfeita (depois que os valores antigos ja voltaram para o banco). */
export function marcarComoDesfeita(id, resultado) {
  const dados = lerAplicacao(id);
  if (!dados) return null;
  dados.desfeita = true;
  dados.desfeitaEm = new Date().toISOString();
  dados.resultadoDoDesfazer = resultado;
  fs.writeFileSync(caminhoDo(dados.id), JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

/** Evita aplicar a mesma nota duas vezes por engano. */
export function notaJaAplicada({ chave, numero, cnpjFornecedor }) {
  const anteriores = listarHistorico(300);
  return (
    anteriores.find((registro) => {
      if (registro.desfeita) return false;
      const n = registro.nota || {};
      if (chave && n.chave) return n.chave === chave;
      if (numero && n.numero === numero && cnpjFornecedor) {
        return (n.fornecedor?.cnpj || '') === cnpjFornecedor;
      }
      return false;
    }) || null
  );
}
