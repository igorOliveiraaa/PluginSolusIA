// Faz login e devolve uma funcao de fetch que ja leva a sessao.
// Usada pelos scripts de teste, que agora precisam entrar como um operador.
//
// O usuario e a senha NAO ficam aqui: vem de dados/teste.json ou das variaveis
// PLUGIN_USUARIO / PLUGIN_SENHA (ver credenciais-de-teste.mjs).
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';

const SERVIDOR = 'http://localhost:3535';

export async function entrarComoTeste(usuario, senha) {
  if (!usuario || !senha) ({ usuario, senha } = credenciaisDeTeste());
  const resposta = await fetch(SERVIDOR + '/api/entrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha }),
  });
  const dados = await resposta.json();
  if (!dados.ok) throw new Error('Nao consegui entrar para testar: ' + dados.erro);

  return (caminho, opcoes = {}) => {
    const headers = { ...(opcoes.headers || {}), 'x-sessao': dados.token };
    if (opcoes.body && !(opcoes.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(SERVIDOR + caminho, { ...opcoes, headers });
  };
}
