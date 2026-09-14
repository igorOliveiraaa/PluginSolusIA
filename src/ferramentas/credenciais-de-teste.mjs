// Usuario e senha que os testes usam para entrar.
//
// Por que existe: antes isso estava escrito dentro de cada teste ("ELAINE" /
// "1304"). Era a senha DE VERDADE de uma funcionaria da loja, num repositorio
// que pode virar publico a qualquer momento. Senha de gente real nao mora no
// codigo - nem em teste.
//
// De onde ele le, nesta ordem:
//   1. as variaveis PLUGIN_USUARIO e PLUGIN_SENHA do ambiente;
//   2. o arquivo `dados/teste.json` (a pasta dados/ nao vai para o Git):
//        { "usuario": "SEU_USUARIO", "senha": "SUA_SENHA" }
//
// Nao achando nenhum dos dois, para e explica o que fazer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARQUIVO = path.join(RAIZ, 'dados', 'teste.json');

const EXPLICACAO = `
Os testes precisam de um usuario do Solus para entrar, e ele NAO fica no codigo.

Escolha um dos dois jeitos:

  1. Crie o arquivo dados/teste.json com:
       { "usuario": "SEU_USUARIO", "senha": "SUA_SENHA" }

  2. Ou rode com as variaveis:
       PLUGIN_USUARIO=SEU_USUARIO PLUGIN_SENHA=SUA_SENHA node src/ferramentas/...

A pasta dados/ esta no .gitignore, entao nada disso vai para o GitHub.
`;

/** Devolve { usuario, senha } ou explica e encerra. */
export function credenciaisDeTeste() {
  const doAmbiente = {
    usuario: (process.env.PLUGIN_USUARIO || '').trim(),
    senha: (process.env.PLUGIN_SENHA || '').trim(),
  };
  if (doAmbiente.usuario && doAmbiente.senha) return doAmbiente;

  try {
    const arquivo = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    const usuario = String(arquivo.usuario || '').trim();
    const senha = String(arquivo.senha || '').trim();
    if (usuario && senha) return { usuario, senha };
  } catch { /* sem arquivo: cai na explicacao abaixo */ }

  console.error(EXPLICACAO);
  process.exit(1);
  return null;                                  // so para o editor nao reclamar
}

/** Usuario de OUTRA loja, para os testes de duas lojas. */
export function credenciaisDaOutraLoja() {
  const usuario = (process.env.PLUGIN_USUARIO2 || '').trim();
  const senha = (process.env.PLUGIN_SENHA2 || '').trim();
  if (usuario && senha) return { usuario, senha };

  try {
    const arquivo = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    const outra = arquivo.outraLoja || {};
    if (outra.usuario && outra.senha) {
      return { usuario: String(outra.usuario).trim(), senha: String(outra.senha).trim() };
    }
  } catch { /* sem arquivo */ }

  return null;      // quem chama decide se pula o teste
}
