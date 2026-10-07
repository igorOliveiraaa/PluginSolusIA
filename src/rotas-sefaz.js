// Notas que chegaram para a loja pela Sefaz (ver src/sefaz/).
//   GET  /api/sefaz/notas            a lista + certificado + quando busca de novo
//   POST /api/sefaz/buscar           busca agora (respeitando a regra de 1 hora)
//   POST /api/sefaz/notas/:chave/xml baixa o XML (ciencia + consulta) para a conferencia
// E a busca automatica, de hora em hora, em todas as lojas com certificado.

import express from 'express';

import { exigirLogin, exigirPermissao } from './db/operadores.js';
import { lojasConfiguradas } from './config.js';
import { comLoja } from './loja-atual.js';
import { buscarNotasNovas, listarNotasRecebidas, situacaoDaSefaz, xmlDaNota } from './sefaz/notas-recebidas.js';

export const rotasSefaz = express.Router();

function erro(res, e, status = 400) {
  console.error('[sefaz]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

async function tudoParaATela() {
  const [situacao, notas] = await Promise.all([situacaoDaSefaz(), listarNotasRecebidas()]);
  return { situacao, notas };
}

rotasSefaz.get('/api/sefaz/notas', exigirLogin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await tudoParaATela()) });
  } catch (e) { erro(res, e); }
});

rotasSefaz.post('/api/sefaz/buscar', exigirLogin, exigirPermissao('mexerProduto'), async (req, res) => {
  try {
    const busca = await buscarNotasNovas();
    res.json({ ok: true, busca, ...(await tudoParaATela()) });
  } catch (e) { erro(res, e); }
});

// a ciencia e um registro oficial na Sefaz: so quem lanca nota pode disparar
rotasSefaz.post('/api/sefaz/notas/:chave/xml', exigirLogin, exigirPermissao('mexerProduto'), async (req, res) => {
  try {
    const { xml } = await xmlDaNota(req.params.chave);
    res.json({ ok: true, xml, nome: `NFe${String(req.params.chave).replace(/\D/g, '')}.xml` });
  } catch (e) { erro(res, e); }
});

/**
 * De tempos em tempos olha cada loja. Quem decide se pode perguntar a Sefaz e o
 * proprio buscarNotasNovas (regra de 1 hora); loja sem certificado neste PC so
 * e pulada. Nada aqui pode derrubar o servidor.
 */
export function buscarNotasDeHoraEmHora() {
  const rodada = async () => {
    for (const loja of lojasConfiguradas()) {
      try {
        await comLoja(loja.id, () => buscarNotasNovas());
      } catch { /* sem certificado, sem internet...: a tela mostra o motivo */ }
    }
  };
  setTimeout(rodada, 2 * 60 * 1000);            // 2 minutos depois de ligar
  setInterval(rodada, 10 * 60 * 1000).unref();  // e confere a cada 10 (a Sefaz manda esperar 1 hora)
}
