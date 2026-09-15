// Rotas do assistente: perguntar e exportar o resultado.

import express from 'express';
import { exigirLogin } from './db/operadores.js';
import { perguntar } from './ia/assistente.js';
import { gerarCsv, gerarPdfTabela, nomeDeArquivo } from './ia/exportar.js';

export const rotasAssistente = express.Router();

// guarda a ultima resposta de cada operador, para poder exportar depois
const ultimaResposta = new Map();

const MAXIMO_DE_FALAS = 40;
const MAXIMO_DE_LETRAS = 40000;

/** As falas anteriores, das mais novas para tras, ate o teto. */
function historicoQueCabe(bruto) {
  if (!Array.isArray(bruto)) return [];
  const limpas = bruto
    .filter((m) => m && (m.papel === 'ia' || m.papel === 'pessoa') && String(m.texto || '').trim())
    .map((m) => ({ papel: m.papel, texto: String(m.texto).slice(0, 6000) }))
    .slice(-MAXIMO_DE_FALAS);

  const ficam = [];
  let letras = 0;
  for (let i = limpas.length - 1; i >= 0; i -= 1) {
    letras += limpas[i].texto.length;
    if (letras > MAXIMO_DE_LETRAS) break;
    ficam.unshift(limpas[i]);
  }
  // a conversa precisa comecar com a pessoa falando
  while (ficam.length && ficam[0].papel !== 'pessoa') ficam.shift();
  return ficam;
}

rotasAssistente.post('/api/perguntar', exigirLogin, async (req, res) => {
  try {
    const pergunta = String(req.body.pergunta || '').trim();
    if (!pergunta) throw new Error('Escreva a pergunta.');
    if (pergunta.length > 2000) throw new Error('Pergunta muito longa.');

    // A conversa inteira vai junto, ate a pessoa apertar "Nova conversa": e o
    // que faz "e no mes passado?" e "e o preco dela?" funcionarem. O teto e so
    // de seguranca (texto demais encarece sem ajudar): as falas mais recentes
    // ficam, as mais antigas saem primeiro.
    const historico = historicoQueCabe(req.body.historico);

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
      // quando ela montou um orcamento, a tela mostra o botao de abrir
      orcamentoMontado: resultado.orcamentoMontado || null,
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
