// Fornecedor da nota: obrigatorio antes de gravar.
// A conferencia ja tenta achar o fornecedor pelo CNPJ. Quando nao acha, a tela
// pede para escolher um que ja esta no Solus ou cadastrar (CNPJ do XML ou digitado,
// dados do XML ou da Receita). Tudo exige a mesma permissao de lancar nota.

import express from 'express';

import { exigirLogin, exigirPermissao } from './db/operadores.js';
import {
  procurarFornecedores, fornecedorPorCodigo, fornecedorPorDocumento, cadastrarFornecedor,
  completarCnpjDoFornecedor, cnpjDaLoja,
} from './db/fornecedores.js';
import { consultarCnpj } from './leitura/cnpj.js';

const digitos = (valor) => String(valor || '').replace(/\D/g, '');
const ERRO_CNPJ_DA_LOJA = 'Esse e o CNPJ da sua propria loja. O do fornecedor fica no alto da nota, '
  + 'no quadro do EMITENTE.';

function erro(res, e, status = 400) {
  console.error('[fornecedor]', e?.message || e);
  res.status(status).json({ ok: false, erro: e?.message || String(e) });
}

/** Deixa a conferencia aberta apontando para o fornecedor do Solus. */
function ligar(conferencia, fornecedor, documento) {
  const daNota = conferencia.fornecedor || {};
  conferencia.fornecedor = {
    ...daNota,
    cnpj: digitos(documento) || daNota.cnpj || digitos(fornecedor.cnpj),
    nome: daNota.nome || fornecedor.nome,
    codigoNoSolus: fornecedor.codigo,
    nomeNoSolus: fornecedor.nome,
  };
  return conferencia.fornecedor;
}

/** `pegarConferencia(id)` devolve a conferencia aberta (ou da erro se expirou). */
export function rotasFornecedor(pegarConferencia) {
  const rotas = express.Router();
  const podeLancarNota = [exigirLogin, exigirPermissao('mexerProduto')];

  /** Procurar fornecedor do Solus pelo nome ou CNPJ. */
  rotas.get('/api/fornecedores', ...podeLancarNota, async (req, res) => {
    try {
      res.json({ ok: true, fornecedores: await procurarFornecedores(req.query.busca) });
    } catch (e) { erro(res, e); }
  });

  /** CNPJ digitado: ja esta no Solus? Se nao, os dados da Receita para cadastrar. */
  rotas.get('/api/fornecedores/cnpj/:cnpj', ...podeLancarNota, async (req, res) => {
    try {
      const numeros = digitos(req.params.cnpj);
      if (numeros.length !== 14 && numeros.length !== 11) {
        throw new Error('Digite os 14 numeros do CNPJ (ou os 11 do CPF).');
      }
      if (numeros === await cnpjDaLoja()) throw new Error(ERRO_CNPJ_DA_LOJA);

      const noSolus = await fornecedorPorDocumento(numeros);
      if (noSolus) return res.json({ ok: true, noSolus });
      if (numeros.length === 11) {
        return res.json({ ok: true, receita: null, erroReceita: 'CPF nao se consulta na Receita: preencha os dados abaixo.' });
      }
      try {
        res.json({ ok: true, receita: await consultarCnpj(numeros) });
      } catch (falha) {
        // sem internet ou Receita fora do ar: ainda da para cadastrar digitando
        res.json({ ok: true, receita: null, erroReceita: falha.message });
      }
    } catch (e) { erro(res, e); }
  });

  /** "E este": liga a nota a um fornecedor que ja esta no Solus. */
  rotas.post('/api/conferencia/fornecedor', ...podeLancarNota, async (req, res) => {
    try {
      const conferencia = pegarConferencia(req.body?.id);
      const fornecedor = await fornecedorPorCodigo(req.body?.codigo);
      if (!fornecedor) throw new Error('Fornecedor nao encontrado no Solus.');

      const documento = digitos(req.body?.cnpj) || digitos(conferencia.fornecedor?.cnpj);
      if (documento && documento === await cnpjDaLoja()) throw new Error(ERRO_CNPJ_DA_LOJA);
      // cadastro dele estava sem CNPJ: recebe o da nota (proxima nota ja acha sozinha)
      const cnpjGravado = documento ? await completarCnpjDoFornecedor(fornecedor.codigo, documento) : false;

      res.json({ ok: true, fornecedor: ligar(conferencia, fornecedor, documento), cnpjGravado });
    } catch (e) { erro(res, e); }
  });

  /** Cadastra o fornecedor no Solus e ja liga a nota a ele. */
  rotas.post('/api/conferencia/fornecedor/novo', ...podeLancarNota, async (req, res) => {
    try {
      const conferencia = pegarConferencia(req.body?.id);
      const dados = req.body?.dados || {};
      const documento = digitos(dados.cnpj);
      if (documento === await cnpjDaLoja()) throw new Error(ERRO_CNPJ_DA_LOJA);

      // o CNPJ que veio no XML foi autorizado pela Sefaz: vale como esta
      const doXml = conferencia.origem === 'xml' && documento === digitos(conferencia.fornecedor?.cnpj);
      const { fornecedor, jaExistia } = await cadastrarFornecedor(dados, { aceitarDocumento: doXml });

      res.json({ ok: true, fornecedor: ligar(conferencia, fornecedor, documento), jaExistia, codigo: fornecedor.codigo });
    } catch (e) { erro(res, e); }
  });

  return rotas;
}
