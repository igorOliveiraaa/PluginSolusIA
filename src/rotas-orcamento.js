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
  nomeDoClienteDoOrcamento, nomeDoArquivoDoOrcamento,
} from './logica/orcamento.js';
import { gerarExcelOrcamento } from './excel-orcamento.js';
import {
  buscarPorCodigo, buscarPorDescricao, buscarPorBarras, semCustoParaQuemNaoPodeVer,
} from './db/produtos.js';
import { gravarOrcamento, apagarOrcamento } from './db/orcamento.js';
import { gerarPdfOrcamento, textoDoWhatsApp, dadosDaLoja } from './pdf-orcamento.js';
import { acompanharOrcamento } from './tarefas.js';
import { guardarOrcamento, pegarOrcamento } from './orcamentos-abertos.js';
import { ehAudio, transcreverAudios } from './leitura/audio.js';

export const rotas = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const TIPOS_ACEITOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Os orcamentos em andamento (entre montar e gravar) moram em
// `orcamentos-abertos.js`, porque o assistente da aba Perguntar tambem monta
// orcamento e os dois precisam enxergar a mesma lista.
const guardar = guardarOrcamento;
const pegar = pegarOrcamento;

/** Custo e margem so vao na resposta para quem pode ver custo no Solus. */
const esconderCusto = (produtos, req) =>
  semCustoParaQuemNaoPodeVer(produtos, Boolean(req.operador?.permissoes?.verCusto));

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
    const nomeCliente = String(req.body.nomeCliente || '').trim();

    const enviados = req.files || [];
    const arquivos = enviados
      .filter((a) => TIPOS_ACEITOS.includes(a.mimetype))
      .map((a) => ({ base64: a.buffer.toString('base64'), tipo: a.mimetype }));

    // ÁUDIO: metade dos pedidos chega por áudio no WhatsApp. Ele é transcrito
    // e entra como se a pessoa tivesse digitado ("me vê dez detergente...").
    const audios = enviados.filter((a) => ehAudio(a.mimetype, a.originalname));
    let oQueFoiFalado = '';
    if (audios.length) {
      oQueFoiFalado = await transcreverAudios(
        audios.map((a) => ({ buffer: a.buffer, tipo: a.mimetype, nome: a.originalname }))
      );
      if (!oQueFoiFalado && !arquivos.length && !textoDigitado) {
        throw new Error('Não consegui entender o que foi falado no áudio. Tente um áudio mais claro ou digite os itens.');
      }
    }

    const textoTotal = [textoDigitado, oQueFoiFalado].filter(Boolean).join('\n');

    if (!arquivos.length && !textoTotal) {
      throw new Error('Envie uma foto/PDF da lista, um áudio ou digite os itens.');
    }

    // lista so digitada nao precisa de IA: a leitura aqui e exata e de graca.
    // A IA entra quando tem foto, PDF ou áudio (fala vem bagunçada: "umas duas
    // água sanitária de cinco litros" não é uma lista de compras arrumada).
    const lista = arquivos.length || oQueFoiFalado
      ? await lerListaDeCompras(arquivos, textoTotal, observacao)
      : lerListaDigitada(textoTotal);
    if (oQueFoiFalado) lista.oQueFoiFalado = oQueFoiFalado;
    if (!lista.itens.length) {
      throw new Error('Nao consegui identificar nenhum item na lista.');
    }

    const cliente = codigoCliente ? await buscarClientePorCodigo(codigoCliente) : null;
    const orcamento = await montarOrcamento({
      lista,
      cliente,
      nomeCliente,
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
    const { id, codigoCliente, nomeCliente } = req.body;
    const orcamento = pegar(id);

    const cliente = codigoCliente ? await buscarClientePorCodigo(codigoCliente) : null;
    if (codigoCliente && !cliente) throw new Error('Cliente nao encontrado.');

    await trocarClienteDoOrcamento(orcamento, cliente, req.operador.permissoes.verCusto, nomeCliente);
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
    // entrou na lista: sai do "costuma levar também" (a tela e o servidor
    // precisam concordar, senão reabrir o orçamento sugeria de novo)
    orcamento.sugestoes = (orcamento.sugestoes || []).filter((s) => s.produto?.codigo !== produto.codigo);

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

    // sem cadastro, no Solus entra como CONSUMIDOR - o nome vai na observacao
    // para dar para achar esse orcamento na lista do Solus depois
    if (!orcamento.cliente && orcamento.nomeCliente
      && !dadosPagamento.observacao.toUpperCase().includes(orcamento.nomeCliente.toUpperCase())) {
      dadosPagamento.observacao = `Cliente: ${orcamento.nomeCliente}`
        + (dadosPagamento.observacao ? ` - ${dadosPagamento.observacao}` : '');
    }

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
      // na aba Tarefas aparece "Dona Maria", nao um monte de CONSUMIDOR iguais
      cliente: orcamento.cliente ? resultado.cliente : nomeDoClienteDoOrcamento(orcamento),
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

    const nome = nomeDoArquivoDoOrcamento(orcamento, 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${nome}"`);
    res.send(pdf);
  } catch (e) { erro(res, e); }
});

/** Planilha do Excel (.xlsx) do orcamento - tem cliente que prefere receber assim. */
rotas.get('/api/orcamento/:id/excel', exigirLogin, async (req, res) => {
  try {
    const orcamento = pegar(req.params.id);
    const planilha = await gerarExcelOrcamento({
      orcamento,
      operador: req.operador,
      loja: await dadosDaLoja(),
      validadeDias: Number(orcamento.pagamento?.validadeDias || req.query.validade) || 7,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${nomeDoArquivoDoOrcamento(orcamento, 'xlsx')}"`);
    res.send(planilha);
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
      if (porBarras) return res.json({ ok: true, produtos: esconderCusto([porBarras], req) });
    }

    // com o orcamento aberto, o que esse cliente ja comprou vem na frente
    let preferir = [];
    try {
      if (req.query.id) preferir = pegar(String(req.query.id)).preferidos || [];
    } catch { /* orcamento expirado: a busca continua, so sem a preferencia */ }

    const achados = await buscarPorDescricao(termo, 15, { preferir });
    res.json({ ok: true, produtos: esconderCusto(achados, req) });
  } catch (e) { erro(res, e); }
});

/**
 * Abre um orcamento que ja esta montado na memoria.
 * E o que liga o assistente a tela: ele monta pelo chat, guarda, e a aba
 * Orcamento busca por aqui para a pessoa conferir.
 *
 * Fica DEPOIS de /api/orcamento/buscar-produto de proposito: o Express casa as
 * rotas na ordem em que foram escritas, e ":id" pegaria "buscar-produto".
 */
rotas.get('/api/orcamento/:id', exigirLogin, (req, res) => {
  try {
    res.json({ ok: true, id: req.params.id, orcamento: pegar(req.params.id) });
  } catch (e) { erro(res, e, 404); }
});

function recalcularResumo(orcamento) {
  orcamento.resumo = resumir(orcamento.itens);
  return orcamento.resumo;
}
