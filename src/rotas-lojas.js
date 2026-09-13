// Rotas das lojas: quais existem, e a configuracao de qual Solus cada uma usa.
//
// Escolher o banco nao exige login - senao cai no problema do ovo e da galinha
// (o login consulta o banco que ainda esta errado). Em troca, so funciona NO
// PROPRIO PC SERVIDOR, ou para um gerente ja logado. Assim ninguem no WiFi da loja
// consegue apontar o Plugin para outro banco.

import express from 'express';
import { lojasConfiguradas, salvarLojas, criarIdDaLoja } from './config.js';
import { reiniciarConexao } from './db/firebird.js';
import { limparCacheColunas } from './db/produtos.js';
import { operadorDaSessao } from './db/operadores.js';
import { procurarInstalacoes, testarBanco } from './instalacoes-solus.js';
import { ipsDaMaquina } from './https-local.js';

export const rotasLojas = express.Router();

/** A requisicao veio deste mesmo PC (o servidor)? */
export function ehDoProprioServidor(req) {
  const origem = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ['127.0.0.1', '::1', 'localhost', ...ipsDaMaquina()].includes(origem);
}

function podeConfigurar(req) {
  if (ehDoProprioServidor(req)) return true;
  const operador = operadorDaSessao(req.headers['x-sessao']);
  return Boolean(operador?.gerente);
}

function exigirConfigurador(req, res, next) {
  if (podeConfigurar(req)) return next();
  res.status(403).json({
    ok: false,
    erro: 'A configuracao das lojas so pode ser feita no PC servidor, ou por um gerente logado.',
  });
}

function erro(res, e, status = 400) {
  console.error('[lojas]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

/** Lojas para a tela de login (sem caminho de banco nem senha). */
rotasLojas.get('/api/lojas', (req, res) => {
  const lojas = lojasConfiguradas().map((l) => ({ id: l.id, nome: l.nome, cnpj: l.cnpj }));
  res.json({
    ok: true,
    lojas,
    precisaConfigurar: lojas.length === 0,
    podeConfigurar: podeConfigurar(req),
  });
});

/** Lojas com os detalhes do banco, para a tela de configuracao. */
rotasLojas.get('/api/instalacao/lojas', exigirConfigurador, (req, res) => {
  res.json({
    ok: true,
    lojas: lojasConfiguradas().map((l) => ({
      id: l.id,
      nome: l.nome,
      cnpj: l.cnpj,
      caminho: l.banco.caminho,
      host: l.banco.host,
    })),
  });
});

/** Procura os Solus instalados neste PC. */
rotasLojas.get('/api/instalacao/procurar', exigirConfigurador, async (req, res) => {
  try {
    const resultado = await procurarInstalacoes({
      usuarioProcurado: String(req.query.usuario || '').trim(),
      caminhosExtras: lojasConfiguradas().map((l) => l.banco.caminho),
    });
    const doSolus = resultado.instalacoes.filter((i) => i.ehSolus);
    res.json({
      ok: true,
      instalacoes: doSolus,
      ignorados: resultado.instalacoes.length - doSolus.length,
      buscaIncompleta: resultado.buscaIncompleta,
      segundos: resultado.segundos,
    });
  } catch (e) { erro(res, e); }
});

/** Testa um caminho digitado na mao. */
rotasLojas.post('/api/instalacao/testar', exigirConfigurador, async (req, res) => {
  try {
    const caminho = String(req.body.caminho || '').trim();
    if (!caminho) throw new Error('Informe o caminho do banco.');
    const resultado = await testarBanco(
      { caminho, host: req.body.host || 'localhost', porta: Number(req.body.porta) || 3050 },
      String(req.body.usuario || '')
    );
    if (!resultado.abriu) throw new Error(resultado.erro || 'Nao consegui abrir esse banco.');
    res.json({ ok: true, banco: resultado });
  } catch (e) { erro(res, e); }
});

/**
 * Salva as lojas escolhidas.
 * Recebe [{ nome, cnpj, caminho, host? }]. Testa cada banco antes de gravar.
 */
rotasLojas.post('/api/instalacao/lojas', exigirConfigurador, async (req, res) => {
  try {
    const lista = Array.isArray(req.body.lojas) ? req.body.lojas : [];
    if (!lista.length) throw new Error('Escolha ao menos um Solus.');

    const caminhos = new Set();
    const ids = [];
    const validadas = [];

    for (const item of lista) {
      const caminho = String(item.caminho || '').trim();
      if (!caminho) throw new Error('Tem loja sem o caminho do banco.');

      const chave = caminho.replace(/\\/g, '/').toLowerCase();
      if (caminhos.has(chave)) throw new Error('O mesmo banco foi escolhido duas vezes.');
      caminhos.add(chave);

      const teste = await testarBanco({ caminho, host: item.host || 'localhost', porta: 3050 });
      if (!teste.abriu) {
        throw new Error(`Nao consegui abrir o banco ${caminho}: ${teste.erro || 'erro desconhecido'}`);
      }

      const nome = String(item.nome || teste.empresa?.fantasia || teste.empresa?.razao || 'Loja').trim();
      validadas.push({
        id: item.id || undefined,
        nome,
        cnpj: String(item.cnpj || teste.empresa?.cnpj || '').trim(),
        banco: { caminho, host: item.host || 'localhost', porta: 3050 },
      });
      ids.push(item.id || criarIdDaLoja(nome, ids));
    }

    const salvas = salvarLojas(validadas);
    reiniciarConexao();
    limparCacheColunas();

    res.json({ ok: true, lojas: salvas.map((l) => ({ id: l.id, nome: l.nome, cnpj: l.cnpj })) });
  } catch (e) { erro(res, e); }
});
