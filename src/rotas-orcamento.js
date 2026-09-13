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
import { montarOrcamento, recalcularItem } from './logica/orcamento.js';
import { buscarPorCodigo, buscarPorDescricao, buscarPorBarras } from './db/produtos.js';
import { gravarOrcamento, apagarOrcamento } from './db/orcamento.js';
import { gerarPdfOrcamento, textoDoWhatsApp, dadosDaLoja } from './pdf-orcamento.js';

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
  emAndamento.set(id, { dados, criadoEm: Date.now() });
  for (const [chave, valor] of emAndamento) {
    if (Date.now() - valor.criadoEm > DUAS_HORAS) emAndamento.delete(chave);
  }
  return id;
}

function pegar(id) {
  const guardado = emAndamento.get(id);
  if (!guardado) throw new Error('Esse orcamento expirou. Monte de novo.');
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
    res.json({ ok: true, operadores: await listarOperadores() });
  } catch (e) { erro(res, e); }
});

rotas.post('/api/entrar', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const origem = req.ip || req.socket?.remoteAddress || '';
    res.json({ ok: true, ...(await autenticar(usuario, senha, origem)) });
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

    item.produto = produto;
    item.precisaEscolher = false;
    item.certeza = 'alta';
    item.comoAchou = 'escolhido na tela';
    item.precoTabela = produto.vendaAtual;
    item.precoUnitario = produto.vendaAtual;
    item.custo = req.operador.permissoes.verCusto ? produto.custoAtual : null;
    item.incluir = true;
    item.total = Math.round(produto.vendaAtual * item.quantidade * 100) / 100;
    item.avisos = produto.estoque < item.quantidade
      ? [{ tipo: 'estoque', texto: `O cliente pediu ${item.quantidade} e tem ${produto.estoque} em estoque.` }]
      : [];

    res.json({ ok: true, item, resumo: recalcularResumo(orcamento) });
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
    orcamento.itens.push({
      numero: orcamento.itens.length + 1,
      textoOriginal: '(adicionado na tela)',
      descricao: produto.descricao,
      quantidade: qtd,
      produto,
      opcoes: [produto],
      certeza: 'alta',
      comoAchou: 'adicionado na tela',
      precisaEscolher: false,
      precoUnitario: produto.vendaAtual,
      precoTabela: produto.vendaAtual,
      custo: req.operador.permissoes.verCusto ? produto.custoAtual : null,
      total: Math.round(produto.vendaAtual * qtd * 100) / 100,
      avisos: [],
      incluir: true,
    });

    res.json({ ok: true, orcamento, resumo: recalcularResumo(orcamento) });
  } catch (e) { erro(res, e); }
});

/** Grava o orcamento no Solus. */
rotas.post('/api/orcamento/gravar', exigirLogin, exigirPermissao('fazerOrcamento'), async (req, res) => {
  try {
    const { id, observacao } = req.body;
    const orcamento = pegar(id);
    if (observacao !== undefined) orcamento.observacao = String(observacao);

    const resultado = await gravarOrcamento({ orcamento, operador: req.operador });
    orcamento.numero = resultado.numero;

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
      .reduce((soma, i) => soma + (i.total || 0), 0);

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
    res.json({ ok: true, produtos: await buscarPorDescricao(termo, 15) });
  } catch (e) { erro(res, e); }
});

function recalcularResumo(orcamento) {
  const incluidos = orcamento.itens.filter((i) => i.incluir && i.produto);
  orcamento.resumo = {
    totalItens: orcamento.itens.length,
    precisamEscolha: orcamento.itens.filter((i) => i.precisaEscolher).length,
    semEstoque: orcamento.itens.filter((i) => i.produto && i.produto.estoque <= 0).length,
    total: Math.round(incluidos.reduce((s, i) => s + (i.total || 0), 0) * 100) / 100,
  };
  return orcamento.resumo;
}
