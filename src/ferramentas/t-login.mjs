import { autenticar, listarOperadores, operadorDaSessao } from '../db/operadores.js';
import { credenciaisDeTeste } from './credenciais-de-teste.mjs';

const { usuario, senha } = credenciaisDeTeste();

console.log('Usuarios ativos:', (await listarOperadores()).slice(0, 8).join(', '));

try {
  const r = await autenticar(usuario, senha);
  console.log('Login OK:', r.operador.nome, '| gerente:', r.operador.gerente);
  console.log('Permissoes:', JSON.stringify(r.operador.permissoes));
  console.log('Sessao valida:', Boolean(operadorDaSessao(r.token)));
} catch (e) { console.log('FALHOU login:', e.message); }

try {
  await autenticar(usuario, 'senha-errada-de-proposito');
  console.log('FALHOU: aceitou senha errada!');
} catch (e) { console.log('OK   senha errada barrada:', e.message); }

try {
  await autenticar('NAOEXISTE', '123');
} catch (e) { console.log('OK   usuario inexistente barrado:', e.message); }
process.exit(0);
