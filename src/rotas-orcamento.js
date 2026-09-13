// Rotas de login, cliente e orcamento.
// Ficam separadas do servidor.js so para nao virar um arquivo gigante.

import express from 'express';
import multer from 'multer';

import { autenticar, encerrarSessao, listarOperadores, exigirLogin, exigirPermissao } from './db/operadores.js';
import { consultarCnpj, limparCnpj } from './leitura/cnpj.js';
import {
  buscarPorDocumento, buscarClientePorNome, buscarClientePorCodigo,
  cadastrarCliente, ultimasCompras,
} from './db/clientes.js';
import { lerListaDeCompras } from './leitura/ia.js';
import { lerListaDigitada } from './leitura/lista-texto.js';
import {
  montarOrcamento, recalcularItem, montarItemComProduto, trocarClienteDoOrcamento, resumir,
} from './logica/orcamento.js';
import { buscarPorCodigo, buscarPorDescricao, buscarPorBarras } from './db/produtos.js';
import { gravarOrcamento, apagarOrcamento } from './db/orcamento.js';
import { gerarPdfOrcamento, textoDoWhatsApp, dadosDaLoja } from './pdf-orcamento.js';
import { acompanharOrcamento } from './tarefas.js';

import { lojaAtualId } from './loja-atual.js';

export const rotas = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const TIPOS_ACEITOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// orcamentos em andamento (entre montar e gravar)
const emAndamento = new Map();
const DUAS_HORAS = 2 * 60 * 60 * 1000;

function guardar(dados) {
  const id = Math.random().toString(36).slice(2, 10);
  // guarda de qual loja e: um orcamento nunca pode ser gravado no banco da outra
  emAndamento.set(id, { dados, lojaId: lojaAtualId(), criadoEm: Date.now() });
  for (const [chave, valor] of emAndamento) {
    if (Date.now() - valor.criadoEm > DUAS_HORAS) emAndamento.delete(chave);
  }
  return id;
}

function pegar(id) {
  const guardado = emAndamento.get(id);
  if (!guardado) throw new Error('Esse orcamento expirou. Monte de novo.');
  if (guardado.lojaId !== lojaAtualId()) throw new Error('Esse orcamento e de outra loja.');
  return guardado.dados;
}

function erro(res, e, status = 400) {
  console.error('[erro]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

rotas.get('/api/operadores', async (req, res) => {
  try {
    res.json({ ok: true, operadores: await listarOperadores(String(req.query.loja || '') || null) });
  } catch (e) { erro(res, e); }
});

rotas.post('/api/entrar', async (req, res) => {
  try {
    const { usuario, senha, loja } = req.body;
    const origem = req.ip || req.socket?.remoteAddress || '';
    res.json({ ok: true, ...(await autenticar(usuario, senha, origem, loja || null)) });
  } catch (e) { erro(res, e, 401); }
});

rotas.post('/api/sair', (req, res) => {
  encerrarSessao(req.headers['x-sessao']);
  res.json({ ok: true });
});

rotas.get('/api/eu', exigirLogin, (req, res) => {
  res.json({ ok: true, operador: req.operador });
});

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

rotas.get('/api/clientes', exigirLogin, async (req, res) => {
  try {
    const termo = String(req.query.q || '').trim();
    const digitos = limparCnpj(termo);

    if (digitos.length >= 11) {
      const porDocumento = await buscarPorDocumento(digitos);
      if (porDocumento) return res.json({ ok: true, clientes: [porDocumento] });
    }
    res.json({ ok: true, clientes: await buscarClientePorNome(termo) });
  } catch (e) { erro(res, e); }
});

rotas.get('/api/clientes/:codigo', exigirLogin, async (req, res) => {
  try {
    const cliente = await buscarClientePorCodigo(req.params.codigo);
    if (!cliente) throw new Error('Cliente nao encontrado.');
    const compras = await ultimasCompras(cliente.codigo, 30);
    res.json({ ok: true, cliente, compras });
  } catch (e) { erro(res, e); }
});

/** Consulta o CNPJ na base publica, sem cadastrar ainda. */
rotas.get('/api/consultar-cnpj/:cnpj', exigirLogin, async (req, res) => {
  try {
    const cnpj = limparCnpj(req.params.cnpj);
    const jaCadastrado = await buscarPorDocumento(cnpj);
    const dados = await consultarCnpj(cnpj);
    res.json({ ok: true, dados, jaCadastrado });
  } catch (e) { erro(res, e); }
});

rotas.post('/api/clientes', exigirLogin, exigirPermissao('mexerCliente'), async (req, res) => {
  try {
    const resultado = await cadastrarCliente(req.body, req.operador.nome);
    res.json({ ok: true, ...resultado });
  } catch (e) { erro(res, e, 500); }
});

// ---------------------------------------------------------------------------
// Orcamento
// ---------------------------------------------------------------------------

/** Le a lista do cliente (foto/PDF/texto) e monta o orcamento. */
rotas.post('/api/orcamento/montar', exigirLogin, upload.array('arquivos', 10), async (req, res) => {
  try {
    const textoDigitado = String(req.body.texto || '').trim();
    const observacao = String(req.body.observacao || '').trim();
    const codigoCliente = String(req.body.cliente || '').trim();

    const arquivos = (req.files || [])
      .filter((a) => TIPOS_ACEITOS.includes(a.mimetype))
      .map((a) => ({ base64: a.buffer.toString('base64'), tipo: a.mimetype }));

    if (!arquivos.length && !textoDigitado) {
      throw new Error('Envie uma foto/PDF da lista ou digite os itens.');
    }

    // lista so digitada nao precisa de IA: a leitura aqui e exata e de graca.
    // A IA entra quando tem foto ou PDF para ler.
    const lista = arquivos.length
      ? await lerListaDeCompras(arquivos, textoDigitado, observacao)
      : lerListaDigitada(textoDigitado);
    if (!lista.itens.length) {
      throw new Error('Nao consegui identificar nenhum item na lista.');
    }

    const cliente = codigoCliente ? await buscarClientePorCodigo(codigoCliente) : null;
    const orcamento = await montarOrcamento({
      lista,
      cliente,
      mostrarCusto: req.operador.permissoes.verCusto,
    });
    orcamento.observacao = observacao;

    res.json({ ok: true, id: guardar(orcamento), orcamento });
  } catch (e) { erro(res, e); }
});

/** Escolher o produto certo de um item que ficou em duvida. */
rotas.post('/api/orcamento/escolher', exigirLogin, async (req, res) => {
  try {
    const { id, indice, codigoProduto } = req.body;
    const orcamento = pegar(id);
    const item = orcamento.itens[indice];
    if (!item) throw new Error('Item nao encontrado.');

    const produto = await buscarPorCodigo(codigoProduto);
    if (!produto) throw new Error('Produto nao encontrado.');

    // passa pelo mesmo montador da lista: assim o item escolhido na tela mostra
    // "esse cliente pagou", custo e margem igual aos que a ferramenta achou sozinha
    orcamento.itens[indice] = await montarItemComProduto({
      base: item,
      produto,
      cliente: orcamento.cliente,
      mostrarCusto: req.operador.permissoes.verCusto,
      comoAchou: 'escolhido na tela',
      opcoes: item.opcoes,
    });

    res.json({ ok: true, item: orcamento.itens[indice], resumo: recalcularResumo(orcamento) });
  } catch (e) { erro(res, e); }
});

/** Escolher (ou trocar) o cliente com o orcamento ja montado na tela. */
rotas.post('/api/orcamento/cliente', exigirLogin, async (req, res) => {
  try {
    const { id, codigoCliente } = req.body;
    const orcamento = pegar(id);

    const cliente = codigoCliente ? await buscarClientePorCodigo(codigoCliente) : null;
    if (codigoCliente && !cliente) throw new Error('Cliente nao encontrado.');

    await trocarClienteDoOrcamento(orcamento, cliente, req.operador.permissoes.verCusto);
    res.json({ ok: true, orcamento, resumo: orcamento.resumo });
  } catch (e) { erro(res, e); }
});

/** Mudar quantidade, preco ou tirar item do orcamento. */
rotas.post('/api/orcamento/ajustar', exigirLogin, (req, res) => {
  try {
    const { id, indice, quantidade, precoUnitario, incluir } = req.body;
    const orcamento = pegar(id);
    const item = orcamento.itens[indice];
    if (!item) throw new Error('Item nao encontrado.');

    const atualizado = recalcularItem(item, {
      quantidade, precoUnitario, mostrarCusto: req.operador.permissoes.verCusto,
    });
    if (incluir !== undefined) atualizado.incluir = Boolean(incluir);
    orcamento.itens[indice] = atualizado;

    res.json({ ok: true, item: atualizado, resumo: recalcularResumo(orcamento) });
  } catch (e) { erro(res, e); }
});

/** Adicionar um item que nao estava na lista. */
rotas.post('/api/orcamento/adicionar', exigirLogin, async (req, res) => {
  try {
    const { id, codigoProduto, quantidade } = req.body;
    const orcamento = pegar(id);

    const produto = await buscarPorCodigo(codigoProduto);
    if (!produto) throw new Error('Produto nao encontrado.');

    const qtd = Number(quantidade) > 0 ? Number(quantidade) : 1;
    const novo = await montarItemComProduto({
      base: {
        numero: orcamento.itens.length + 1,
        textoOriginal: '(adicionado na tela)',
        descricao: produto.descricao,
        quantidade: qtd,
      },
      produto,
      cliente: orcamento.cliente,
      mostrarCusto: req.operador.permissoes.verCusto,
      comoAchou: 'adicionado na tela',
      opcoes: [produto],
    });
    orcamento.itens.push(novo);

    res.json({ ok: true, orcamento, resumo: recalcularResumo(orcamento) });
  } catch (e) { erro(res, e); }
});

/** Grava o orcamento no Solus. */
rotas.post('/api/orcamento/gravar', exigirLogin, exigirPermissao('fazerOrcamento'), async (req, res) => {
  try {
    const { id, observacao, pagamento } = req.body;
    const orcamento = pegar(id);
    if (observacao !== undefined) orcamento.observacao = String(observacao);

    const dadosPagamento = { ...(pagamento || {}) };
    if (!dadosPagamento.observacao) dadosPagamento.observacao = orcamento.observacao || '';

    const resultado = await gravarOrcamento({
      orcamento,
      operador: req.operador,
      pagamento: dadosPagamento,
    });
    orcamento.numero = resultado.numero;
    orcamento.pagamento = dadosPagamento;

    // passa a acompanhar: vira tarefa ate a venda ser finalizada e a nota sair
    acompanharOrcamento({
      numero: resultado.numero,
      cliente: resultado.cliente,
      codigoCliente: resultado.codigoCliente,
      celular: orcamento.cliente?.celular || orcamento.cliente?.telefone || '',
      total: resultado.total,
      operador: req.operador.nome,
      validadeDias: Number(dadosPagamento.validadeDias) || 7,
    });

    res.json({ ok: true, ...resultado });
  } catch (e) { erro(res, e, 500); }
});

/** PDF do orcamento (serve para baixar, imprimir e compartilhar). */
rotas.get('/api/orcamento/:id/pdf', exigirLogin, async (req, res) => {
  try {
    const orcamento = pegar(req.params.id);
    const pdf = await gerarPdfOrcamento({
      orcamento,
      numero: orcamento.numero,
      operador: req.operador,
      observacao: orcamento.observacao || '',
      validadeDias: Number(req.query.validade) || 7,
    });

    const nome = `orcamento-${orcamento.numero || 'sem-numero'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${nome}"`);
    res.send(pdf);
  } catch (e) { erro(res, e); }
});

/** Texto pronto para mandar no WhatsApp junto com o PDF. */
rotas.get('/api/orcamento/:id/texto', exigirLogin, async (req, res) => {
  try {
    const orcamento = pegar(req.params.id);
    const total = orcamento.itens
      .filter((i) => i.incluir && i.produto)
      .reduce((soma, i) => soma + (i.total || 0), 0)
      + (Number(orcamento.pagamento?.frete) > 0 ? Number(orcamento.pagamento.frete) : 0);

    res.json({
      ok: true,
      texto: textoDoWhatsApp({
        orcamento, numero: orcamento.numero, total, loja: await dadosDaLoja(),
      }),
    });
  } catch (e) { erro(res, e); }
});

rotas.delete('/api/orcamento/:numero', exigirLogin, exigirPermissao('fazerOrcamento'), async (req, res) => {
  try {
    res.json({ ok: true, ...(await apagarOrcamento(req.params.numero)) });
  } catch (e) { erro(res, e, 500); }
});

/** Busca de produto para adicionar item na mao. */
rotas.get('/api/orcamento/buscar-produto', exigirLogin, async (req, res) => {
  try {
    const termo = String(req.query.q || '').trim();
    if (termo.length < 2) return res.json({ ok: true, produtos: [] });

    const digitos = termo.replace(/\D/g, '');
    if (digitos.length >= 8) {
      const porBarras = await buscarPorBarras(digitos);
      if (porBarras) return res.json({ ok: true, produtos: [porBarras] });
    }

    // com o orcamento aberto, o que esse cliente ja comprou vem na frente
    let preferir = [];
    try {
      if (req.query.id) preferir = pegar(String(req.query.id)).preferidos || [];
    } catch { /* orcamento expirado: a busca continua, so sem a preferencia */ }

    res.json({ ok: true, produtos: await buscarPorDescricao(termo, 15, { preferir }) });
  } catch (e) { erro(res, e); }
});

function recalcularResumo(orcamento) {
  orcamento.resumo = resumir(orcamento.itens);
  return orcamento.resumo;
}
