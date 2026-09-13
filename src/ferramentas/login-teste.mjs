// Faz login e devolve uma funcao de fetch que ja leva a sessao.
// Usada pelos scripts de teste, que agora precisam entrar como um operador.
const SERVIDOR = 'http://localhost:3535';

export async function entrarComoTeste(usuario = 'ELAINE', senha = '1304') {
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
