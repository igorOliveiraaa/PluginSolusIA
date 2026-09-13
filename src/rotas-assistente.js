// Rotas do assistente: perguntar e exportar o resultado.

import express from 'express';
import { exigirLogin } from './db/operadores.js';
import { perguntar } from './ia/assistente.js';
import { gerarCsv, gerarPdfTabela, nomeDeArquivo } from './ia/exportar.js';

export const rotasAssistente = express.Router();

// guarda a ultima resposta de cada operador, para poder exportar depois
const ultimaResposta = new Map();

rotasAssistente.post('/api/perguntar', exigirLogin, async (req, res) => {
  try {
    const pergunta = String(req.body.pergunta || '').trim();
    if (!pergunta) throw new Error('Escreva a pergunta.');
    if (pergunta.length > 2000) throw new Error('Pergunta muito longa.');

    const historico = Array.isArray(req.body.historico) ? req.body.historico.slice(-12) : [];

    const resultado = await perguntar({ pergunta, historico, operador: req.operador });

    ultimaResposta.set(req.operador.codigo, {
      pergunta,
      resposta: resultado.resposta,
      dados: resultado.dadosParaExportar,
      quando: Date.now(),
    });

    res.json({
      ok: true,
      resposta: resultado.resposta,
      // o que a IA consultou, para a pessoa poder conferir de onde veio o numero
      consultou: resultado.consultas.map((c) => ({
        ferramenta: c.ferramenta,
        argumentos: c.argumentos,
      })),
      podeExportar: Boolean(resultado.dadosParaExportar?.linhas?.length),
      quantidadeLinhas: resultado.dadosParaExportar?.linhas?.length || 0,
    });
  } catch (erro) {
    console.error('[assistente]', erro.message);
    res.status(400).json({ ok: false, erro: erro.message });
  }
});

/** Baixa o resultado da ultima pergunta como planilha ou PDF. */
rotasAssistente.get('/api/exportar/:formato', exigirLogin, async (req, res) => {
  try {
    const guardado = ultimaResposta.get(req.operador.codigo);
    if (!guardado?.dados?.linhas?.length) {
      throw new Error('Nao tem dados da ultima pergunta para exportar.');
    }

    const titulo = guardado.pergunta.slice(0, 70);
    const linhas = guardado.dados.linhas;

    if (req.params.formato === 'planilha') {
      const csv = gerarCsv(linhas);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeDeArquivo(titulo, 'csv')}"`);
      return res.send(csv);
    }

    if (req.params.formato === 'pdf') {
      const pdf = await gerarPdfTabela({
        titulo,
        subtitulo: guardado.resposta.split('\n')[0].slice(0, 150),
        linhas,
        rodape: 'Gerado pelo Plugin IA Solus a partir dos dados do sistema.',
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeDeArquivo(titulo, 'pdf')}"`);
      return res.send(pdf);
    }

    throw new Error('Formato nao reconhecido. Use planilha ou pdf.');
  } catch (erro) {
    res.status(400).json({ ok: false, erro: erro.message });
  }
});
