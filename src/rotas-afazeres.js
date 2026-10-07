// Afazeres da loja (src/afazeres.js): a lista que a equipe escreve, com ou sem IA.
//   GET    /api/afazeres               a lista
//   POST   /api/afazeres               { texto, usarIA } texto livre (a IA monta)
//                                      ou { titulo, detalhe, data, hora, prioridade }
//   PUT    /api/afazeres/:id           editar
//   POST   /api/afazeres/:id/concluir  { feita: true | false }
//   DELETE /api/afazeres/:id           excluir

import express from 'express';

import { exigirLogin } from './db/operadores.js';
import {
  listarAfazeres, criarAfazer, editarAfazer, concluirAfazer, excluirAfazer, entenderTexto, temIA,
} from './afazeres.js';

export const rotasAfazeres = express.Router();

function erro(res, e, status = 400) {
  console.error('[afazeres]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

rotasAfazeres.get('/api/afazeres', exigirLogin, (req, res) => {
  try {
    res.json({ ok: true, tarefas: listarAfazeres(), comIA: temIA() });
  } catch (e) { erro(res, e); }
});

rotasAfazeres.post('/api/afazeres', exigirLogin, async (req, res) => {
  try {
    const corpo = req.body || {};
    const operador = req.operador?.nome || '';
    if (corpo.texto !== undefined) {
      // texto livre: com a IA ela monta (e separa); sem, entra como foi escrito
      const entendido = corpo.usarIA
        ? await entenderTexto(corpo.texto)
        : { tarefas: [{ titulo: corpo.texto }], comIA: false, aviso: '' };
      const criadas = entendido.tarefas.map((t) => criarAfazer(t, operador));
      return res.json({ ok: true, criadas, comIA: entendido.comIA, aviso: entendido.aviso });
    }
    res.json({ ok: true, criadas: [criarAfazer(corpo, operador)], comIA: false, aviso: '' });
  } catch (e) { erro(res, e); }
});

rotasAfazeres.put('/api/afazeres/:id', exigirLogin, (req, res) => {
  try {
    res.json({ ok: true, tarefa: editarAfazer(req.params.id, req.body || {}, req.operador?.nome) });
  } catch (e) { erro(res, e); }
});

rotasAfazeres.post('/api/afazeres/:id/concluir', exigirLogin, (req, res) => {
  try {
    res.json({ ok: true, tarefa: concluirAfazer(req.params.id, req.body?.feita !== false, req.operador?.nome) });
  } catch (e) { erro(res, e); }
});

rotasAfazeres.delete('/api/afazeres/:id', exigirLogin, (req, res) => {
  try {
    excluirAfazer(req.params.id);
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});
