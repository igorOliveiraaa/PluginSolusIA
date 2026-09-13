// Rotas de tarefas, acompanhamento da venda e nota fiscal.

import express from 'express';
import fs from 'node:fs';

import { exigirLogin } from './db/operadores.js';
import { formasDePagamento, comoOClienteCompra, vendedores, situacaoDoPedido, dadosDaNota } from './db/vendas.js';
import { listarTarefas, marcarEnvio, dispensarTarefa } from './tarefas.js';
import { localizarArquivosDaNota, testarPasta } from './notas-arquivos.js';
import { gerarDanfe } from './danfe.js';

export const rotasVendas = express.Router();

function erro(res, e, status = 400) {
  console.error('[vendas]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

// ---------------------------------------------------------------------------
// Pagamento e frete (para montar o orcamento)
// ---------------------------------------------------------------------------

rotasVendas.get('/api/pagamento/opcoes', exigirLogin, async (req, res) => {
  try {
    const cliente = String(req.query.cliente || '').trim();
    const [formas, costume, lista] = await Promise.all([
      formasDePagamento(),
      cliente ? comoOClienteCompra(cliente) : null,
      vendedores(),
    ]);
    res.json({ ok: true, formas, sugestao: costume, vendedores: lista });
  } catch (e) { erro(res, e); }
});

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

rotasVendas.get('/api/tarefas', exigirLogin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await listarTarefas()) });
  } catch (e) { erro(res, e); }
});

rotasVendas.post('/api/tarefas/enviado', exigirLogin, (req, res) => {
  try {
    const { numero, oQue } = req.body;
    const item = marcarEnvio(numero, oQue === 'nota' ? 'nota' : 'orcamento');
    if (!item) throw new Error('Esse orcamento nao esta sendo acompanhado.');
    res.json({ ok: true, item });
  } catch (e) { erro(res, e); }
});

rotasVendas.post('/api/tarefas/dispensar', exigirLogin, (req, res) => {
  try {
    dispensarTarefa(String(req.body.id || ''));
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});

// ---------------------------------------------------------------------------
// Situacao da venda
// ---------------------------------------------------------------------------

rotasVendas.get('/api/vendas/:numero', exigirLogin, async (req, res) => {
  try {
    const pedido = await situacaoDoPedido(req.params.numero);
    if (!pedido) throw new Error('Pedido nao encontrado no Solus.');
    res.json({ ok: true, pedido });
  } catch (e) { erro(res, e); }
});

// ---------------------------------------------------------------------------
// Nota fiscal: PDF e XML
// ---------------------------------------------------------------------------

/** Onde o arquivo da nota esta (ou por que nao achou). */
async function acharNota(numeroNota) {
  const nota = await dadosDaNota(numeroNota);
  if (!nota) throw new Error('Nota nao encontrada no Solus.');
  if (!nota.chave) throw new Error('Essa nota ainda nao tem chave de acesso (pode nao ter sido autorizada).');

  const arquivos = localizarArquivosDaNota(nota.chave, nota.caminhoXml);
  return { nota, arquivos };
}

rotasVendas.get('/api/notas/:numero/pdf', exigirLogin, async (req, res) => {
  try {
    const { nota, arquivos } = await acharNota(req.params.numero);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `${req.query.baixar ? 'attachment' : 'inline'}; filename="nota-${nota.numero}.pdf"`);

    // 1) o PDF que o proprio Solus/ACBr gerou e o melhor
    if (arquivos.pdf) {
      return fs.createReadStream(arquivos.pdf).pipe(res);
    }

    // 2) senao, monta o DANFE a partir do XML autorizado
    if (arquivos.xml) {
      const xml = fs.readFileSync(arquivos.xml, 'utf8');
      const pdf = await gerarDanfe(xml, { situacao: nota.etapa === 'cancelada' ? 'cancelada' : '' });
      return res.send(pdf);
    }

    res.removeHeader('Content-Type');
    res.removeHeader('Content-Disposition');
    throw new Error(
      'Nao achei o arquivo dessa nota. Ele fica no PC que tem o certificado. '
      + 'Compartilhe essa pasta na rede e cadastre o caminho na aba Ajustes. '
      + `Procurei em: ${[...arquivos.pastasProcuradas, ...arquivos.pastasInacessiveis].join(' | ') || '(nenhuma pasta acessivel)'}`
    );
  } catch (e) { erro(res, e); }
});

rotasVendas.get('/api/notas/:numero/xml', exigirLogin, async (req, res) => {
  try {
    const { nota, arquivos } = await acharNota(req.params.numero);
    if (!arquivos.xml) throw new Error('O XML dessa nota nao esta acessivel a partir deste PC.');

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${nota.chave}-nfe.xml"`);
    fs.createReadStream(arquivos.xml).pipe(res);
  } catch (e) { erro(res, e); }
});

/** Texto pronto para mandar a nota no WhatsApp. */
rotasVendas.get('/api/notas/:numero/texto', exigirLogin, async (req, res) => {
  try {
    const nota = await dadosDaNota(req.params.numero);
    if (!nota) throw new Error('Nota nao encontrada.');

    const { dadosDaLoja } = await import('./pdf-orcamento.js');
    const loja = await dadosDaLoja();

    res.json({
      ok: true,
      texto: [
        `*Nota fiscal nº ${nota.numero}*${loja?.nome ? ' — ' + loja.nome : ''}`,
        '',
        `Valor: *R$ ${nota.total.toFixed(2).replace('.', ',')}*`,
        `Chave de acesso: ${nota.chave}`,
        '',
        'Segue a nota em anexo. Obrigado pela preferência!',
      ].join('\n'),
    });
  } catch (e) { erro(res, e); }
});

/** Testa a pasta das notas digitada na aba Ajustes. */
rotasVendas.post('/api/notas/testar-pasta', exigirLogin, (req, res) => {
  try {
    const pastas = String(req.body.pastas || '').split(/[\n;]+/).map((p) => p.trim()).filter(Boolean);
    if (!pastas.length) throw new Error('Escreva ao menos uma pasta.');
    res.json({ ok: true, resultados: pastas.map((p) => ({ pasta: p, ...testarPasta(p) })) });
  } catch (e) { erro(res, e); }
});
