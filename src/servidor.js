// Servidor da ferramenta. Roda no PC servidor da loja (o mesmo que tem o Firebird).
// Os outros computadores e os celulares acessam pelo WiFi, pelo IP dessa maquina.

import express from 'express';
import multer from 'multer';
import os from 'node:os';
import https from 'node:https';
import path from 'node:path';

import { carregarConfig, salvarConfig, garantirPastas, PASTAS } from './config.js';
import { testarConexao, reiniciarConexao } from './db/firebird.js';
import { limparCacheColunas, buscarPorBarras, buscarPorCodigo, buscarPorDescricao } from './db/produtos.js';
import { invalidarCatalogo } from './db/catalogo.js';
import { aplicarNota, desfazer } from './db/gravacao.js';
import { lerXmlNfe, pareceXmlNfe } from './leitura/xml.js';
import { lerDocumentoComIA, testarChave, listarModelos, interpretarObservacao } from './leitura/ia.js';
import { montarConferencia } from './logica/conferencia.js';
import { analisarItem } from './logica/precos.js';
import {
  salvarAplicacao, listarHistorico, lerAplicacao, marcarComoDesfeita, notaJaAplicada,
} from './historico.js';
import { rotas as rotasOrcamento } from './rotas-orcamento.js';
import { rotasAssistente } from './rotas-assistente.js';
import { rotasVendas } from './rotas-vendas.js';
import { rotasLojas } from './rotas-lojas.js';
import { exec } from 'node:child_process';
import { lojaAtualId } from './loja-atual.js';
import { exigirLogin } from './db/operadores.js';
import { obterCertificado, ipsDaMaquina, ehRedeLocal } from './https-local.js';

garantirPastas();

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(PASTAS.web));

// lojas vem antes de tudo: e o que decide qual banco cada login usa
app.use(rotasLojas);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },   // 20 MB por arquivo
});

// Conferencias abertas, guardadas na memoria entre "ler a nota" e "gravar".
// Some sozinho depois de 2 horas para nao acumular.
const conferenciasAbertas = new Map();
const DUAS_HORAS = 2 * 60 * 60 * 1000;

function guardarConferencia(dados) {
  const id = Math.random().toString(36).slice(2, 10);
  conferenciasAbertas.set(id, { dados, lojaId: lojaAtualId(), criadaEm: Date.now() });
  for (const [chave, valor] of conferenciasAbertas) {
    if (Date.now() - valor.criadaEm > DUAS_HORAS) conferenciasAbertas.delete(chave);
  }
  return id;
}

function responderErro(res, erro, status = 400) {
  console.error('[erro]', erro?.message || erro);
  res.status(status).json({ ok: false, erro: erro?.message || String(erro) });
}

// ---------------------------------------------------------------------------
// Ler a nota (XML, PDF ou foto)
// ---------------------------------------------------------------------------

const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

app.post('/api/ler-nota', exigirLogin, upload.array('arquivos', 10), async (req, res) => {
  try {
    const arquivos = req.files || [];
    if (!arquivos.length) throw new Error('Nenhum arquivo foi enviado.');

    const observacao = String(req.body.observacao || '').trim();

    // 1) se veio XML, usa o XML: e exato, nao precisa de IA
    const xml = arquivos.find(
      (a) => a.originalname.toLowerCase().endsWith('.xml') || pareceXmlNfe(a.buffer.toString('utf8'))
    );

    let nota;
    if (xml) {
      nota = lerXmlNfe(xml.buffer.toString('utf8'));
      nota.observacaoDoOperador = observacao;
    } else {
      // 2) sem XML: manda foto/PDF para a IA ler
      const paraIA = arquivos
        .filter((a) => a.mimetype === 'application/pdf' || TIPOS_IMAGEM.includes(a.mimetype))
        .map((a) => ({ base64: a.buffer.toString('base64'), tipo: a.mimetype }));

      if (!paraIA.length) {
        throw new Error('Envie o XML da nota, um PDF ou uma foto (JPG/PNG).');
      }
      nota = await lerDocumentoComIA(paraIA, observacao);
      nota.observacaoDoOperador = observacao;
    }

    if (!nota.itens?.length) {
      throw new Error('Nao consegui identificar nenhum item nessa nota. Tente uma foto mais nitida ou envie o XML.');
    }

    // 3) avisa se essa nota ja foi lancada antes
    const repetida = notaJaAplicada({
      chave: nota.chave,
      numero: nota.numero,
      cnpjFornecedor: nota.fornecedor?.cnpj,
    });

    // 4) se a pessoa escreveu uma observacao, a IA entende e o sistema calcula
    let ajustes = null;
    if (observacao) {
      try {
        ajustes = await interpretarObservacao(observacao, nota);
      } catch (falha) {
        // sem a IA a nota continua valendo; so nao aplica o ajuste
        console.error('[observacao]', falha.message);
      }
    }

    // 5) casa com os produtos, calcula custo e preco
    const conferencia = await montarConferencia(nota, ajustes);
    const id = guardarConferencia(conferencia);

    res.json({
      ok: true,
      id,
      conferencia,
      jaAplicada: repetida
        ? { id: repetida.id, quando: repetida.quando, operador: repetida.operador }
        : null,
    });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// ---------------------------------------------------------------------------
// Recalcular um item quando o operador muda algo na tela
// ---------------------------------------------------------------------------

app.post('/api/recalcular', exigirLogin, (req, res) => {
  try {
    const { id, indice, quantidadeUnidades, custoUnitario, unidadesPorCaixa } = req.body;
    const guardada = conferenciasAbertas.get(id);
    if (!guardada) throw new Error('Essa conferencia expirou. Envie a nota de novo.');
    if (guardada.lojaId !== lojaAtualId()) throw new Error('Essa nota foi lida em outra loja.');

    const item = guardada.dados.itens[indice];
    if (!item) throw new Error('Item nao encontrado.');

    // recalcula o custo por unidade quando muda a quantidade da caixa
    if (unidadesPorCaixa > 0 && item.quantidadeComercial > 0) {
      item.unidadesPorCaixa = Number(unidadesPorCaixa);
      item.quantidadeUnidades = item.quantidadeComercial * Number(unidadesPorCaixa);
      item.custoUnitario = item.custoTotalItem / item.quantidadeUnidades;
      item.convertido = true;
    }
    if (quantidadeUnidades !== undefined && Number(quantidadeUnidades) > 0) {
      item.quantidadeUnidades = Number(quantidadeUnidades);
      item.custoUnitario = item.custoTotalItem / item.quantidadeUnidades;
    }
    if (custoUnitario !== undefined && Number(custoUnitario) > 0) {
      item.custoUnitario = Number(custoUnitario);
    }

    const cfg = carregarConfig();
    item.analise = analisarItem({
      produto: item.produto,
      custoNovo: item.custoUnitario,
      regras: cfg.regras,
    });
    item.precoVenda = item.analise.precoEscolhido;

    res.json({ ok: true, item });
  } catch (erro) {
    responderErro(res, erro);
  }
});

/** Trocar manualmente o produto de um item (quando a ferramenta casou errado). */
app.post('/api/trocar-produto', exigirLogin, async (req, res) => {
  try {
    const { id, indice, codigoProduto } = req.body;
    const guardada = conferenciasAbertas.get(id);
    if (!guardada) throw new Error('Essa conferencia expirou. Envie a nota de novo.');
    if (guardada.lojaId !== lojaAtualId()) throw new Error('Essa nota foi lida em outra loja.');

    const item = guardada.dados.itens[indice];
    if (!item) throw new Error('Item nao encontrado.');

    const produto = await buscarPorCodigo(codigoProduto);
    if (!produto) throw new Error('Produto nao encontrado no Solus.');

    const cfg = carregarConfig();
    item.produto = produto;
    item.acao = 'atualizar';
    item.comoAchou = 'escolhido na tela';
    item.certezaDoCasamento = 'alta';
    item.analise = analisarItem({ produto, custoNovo: item.custoUnitario, regras: cfg.regras });
    item.precoVenda = item.analise.precoEscolhido;
    item.precisaAtencao = false;

    res.json({ ok: true, item });
  } catch (erro) {
    responderErro(res, erro);
  }
});

/** Busca de produto para a tela (quando o operador quer procurar na mao). */
app.get('/api/produtos', exigirLogin, async (req, res) => {
  try {
    const termo = String(req.query.q || '').trim();
    if (termo.length < 2) return res.json({ ok: true, produtos: [] });

    const somenteDigitos = termo.replace(/\D/g, '');
    if (somenteDigitos.length >= 8) {
      const porBarras = await buscarPorBarras(somenteDigitos);
      if (porBarras) return res.json({ ok: true, produtos: [porBarras] });
    }
    const porCodigo = /^\d{1,6}$/.test(termo) ? await buscarPorCodigo(termo) : null;
    const porNome = await buscarPorDescricao(termo, 15);

    const lista = porCodigo ? [porCodigo, ...porNome] : porNome;
    res.json({ ok: true, produtos: lista });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// ---------------------------------------------------------------------------
// Gravar no Solus
// ---------------------------------------------------------------------------

app.post('/api/aplicar', exigirLogin, async (req, res) => {
  try {
    const { id, decisoes, operador, atualizarEstoque = true } = req.body;
    const guardada = conferenciasAbertas.get(id);
    if (!guardada) throw new Error('Essa conferencia expirou. Envie a nota de novo.');
    if (guardada.lojaId !== lojaAtualId()) throw new Error('Essa nota foi lida em outra loja.');

    const conferencia = guardada.dados;

    // aplica as decisoes que vieram da tela em cima dos itens conferidos
    const itens = conferencia.itens.map((item, indice) => {
      const decisao = decisoes?.[indice] || {};
      return {
        ...item,
        acao: decisao.acao || item.acao,
        quantidadeUnidades: Number(decisao.quantidadeUnidades ?? item.quantidadeUnidades),
        custoUnitario: Number(decisao.custoUnitario ?? item.custoUnitario),
        precoVenda: Number(decisao.precoVenda ?? item.precoVenda),
        igualarIrmaos: Boolean(decisao.igualarIrmaos),
        desativarIrmaos: Array.isArray(decisao.desativarIrmaos) ? decisao.desativarIrmaos : [],
        descricao: decisao.descricao || item.descricao,
      };
    });

    const paraGravar = itens.filter((i) => i.acao !== 'ignorar');
    if (!paraGravar.length) throw new Error('Nenhum item foi marcado para gravar.');

    const registros = await aplicarNota({ itens, atualizarEstoque });

    const historico = salvarAplicacao({
      nota: conferencia,
      registros,
      operador: String(operador || '').trim(),
      observacao: conferencia.observacaoDoOperador || '',
    });

    conferenciasAbertas.delete(id);

    res.json({ ok: true, historico: historico.id, registros, resumo: historico.resumo });
  } catch (erro) {
    responderErro(res, erro, 500);
  }
});

// ---------------------------------------------------------------------------
// Historico e desfazer
// ---------------------------------------------------------------------------

app.get('/api/historico', exigirLogin, (req, res) => {
  try {
    res.json({ ok: true, historico: listarHistorico(Number(req.query.limite) || 50) });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get('/api/historico/:id', exigirLogin, (req, res) => {
  try {
    const dados = lerAplicacao(req.params.id);
    if (!dados) throw new Error('Lancamento nao encontrado.');
    res.json({ ok: true, dados });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.post('/api/desfazer/:id', exigirLogin, async (req, res) => {
  try {
    const dados = lerAplicacao(req.params.id);
    if (!dados) throw new Error('Lancamento nao encontrado.');
    if (dados.desfeita) throw new Error('Esse lancamento ja foi desfeito antes.');

    const resultado = await desfazer(dados.registros);
    marcarComoDesfeita(dados.id, resultado);

    res.json({ ok: true, resultado });
  } catch (erro) {
    responderErro(res, erro, 500);
  }
});

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

app.get('/api/config', exigirLogin, (req, res) => {
  const cfg = carregarConfig();
  // nao devolve a chave inteira da IA, so o final, para conferencia
  const chave = cfg.ia?.chave || '';
  res.json({
    ok: true,
    config: {
      ...cfg,
      ia: {
        ...cfg.ia,
        chave: chave ? `...${chave.slice(-6)}` : '',
        temChave: Boolean(chave),
      },
      banco: undefined,     // o banco de cada loja e escolhido em Configurar lojas
    },
  });
});

app.post('/api/config', exigirLogin, (req, res) => {
  try {
    const novo = { ...req.body };
    const atual = carregarConfig();

    // campos mascarados: se o usuario nao digitou de novo, mantem o que ja estava
    delete novo.banco;    // o banco so muda pela tela de Configurar lojas
    if (novo.ia?.chave?.startsWith('...')) novo.ia.chave = atual.ia.chave;

    const salvo = salvarConfig(novo);
    reiniciarConexao();
    limparCacheColunas();
    invalidarCatalogo();

    res.json({ ok: true, config: { ...salvo, banco: undefined } });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get('/api/testar-banco', exigirLogin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await testarConexao()) });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get('/api/testar-ia', exigirLogin, async (req, res) => {
  try {
    res.json({ ok: true, ...(await testarChave()) });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get('/api/modelos-ia', exigirLogin, async (req, res) => {
  try {
    res.json({ ok: true, modelos: await listarModelos() });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// ---------------------------------------------------------------------------

// rotas de login, cliente e orcamento
app.use(rotasOrcamento);
app.use(rotasAssistente);
app.use(rotasVendas);

const porta = carregarConfig().servidor?.porta || 3535;
const portaSegura = Number(porta) + 1;

// Se o Plugin ja estiver aberto (alguem deu dois cliques duas vezes), a porta
// esta ocupada. Em vez do erro em ingles, explica e fecha esta segunda copia.
function portaOcupada(erro) {
  if (erro.code !== 'EADDRINUSE') throw erro;
  console.log('\n==================================================');
  console.log('  O Plugin IA Solus JA ESTA ABERTO neste computador.');
  console.log('==================================================');
  console.log('  Nao precisa abrir de novo. Procure a outra janela');
  console.log('  preta na barra de tarefas, ou acesse direto:');
  console.log(`     http://localhost:${porta}\n`);
  process.exit(0);
}

// HTTP: serve para usar aqui no proprio PC servidor.
// Espera a porta confirmar antes de seguir, para nao mostrar enderecos de uma
// copia que vai fechar em seguida por ja existir outra aberta.
await new Promise((pronto) => {
  app.listen(porta, '0.0.0.0', pronto).on('error', portaOcupada);
});

// HTTPS: e o que o celular precisa para instalar como aplicativo e para o
// botao de compartilhar o orcamento no WhatsApp funcionar.
// O certificado demora um pouco para ser criado na primeira vez, por isso os
// enderecos so aparecem depois - assim a tela ja mostra o endereco certo.
let certificadoOk = false;
try {
  const { cert, key, novo } = await obterCertificado();
  https.createServer({ cert, key }, app).listen(portaSegura, '0.0.0.0').on('error', portaOcupada);
  certificadoOk = true;
  if (novo) console.log('\n[certificado desta rede criado]');
} catch (erro) {
  console.error('\n[aviso] nao consegui subir o HTTPS:', erro.message);
  console.error('        a ferramenta funciona mesmo assim pelo endereco http,');
  console.error('        mas o celular nao vai conseguir instalar como aplicativo.');
}

mostrarEnderecos();
abrirNoNavegador();

/**
 * Abre o Plugin no navegador deste PC assim que o servidor liga. Junto com o
 * INICIAR-COM-O-WINDOWS.bat, e so ligar o PC que a tela ja aparece.
 */
function abrirNoNavegador() {
  const cfg = carregarConfig();
  if (cfg.servidor?.abrirNavegador === false || process.platform !== 'win32') return;
  if (process.env.PLUGIN_NAO_ABRIR_NAVEGADOR) return;   // usado pelos testes
  exec(`start "" "http://localhost:${porta}"`, () => { /* sem navegador: segue sem abrir */ });
}

function mostrarEnderecos() {
  // So mostra o endereco da rede da loja. Placas falsas (modulo de seguranca
  // de banco, Bluetooth, VPN) geram enderecos que so confundem quem vai digitar.
  const todos = ipsDaMaquina().filter((ip) => !ip.startsWith('169.254.'));
  const ips = todos.some(ehRedeLocal) ? todos.filter(ehRedeLocal) : todos;
  console.log('\n==================================================');
  console.log('  Plugin IA Solus');
  console.log('==================================================');
  console.log(`  Neste computador:   http://localhost:${porta}`);
  if (ips.length) {
    console.log('\n  No celular (pelo WiFi da loja):');
    for (const ip of ips) {
      console.log(certificadoOk ? `     https://${ip}:${portaSegura}` : `     http://${ip}:${porta}`);
    }
    if (certificadoOk) {
      console.log('\n  Na primeira vez o celular avisa que o site nao e seguro.');
      console.log('  E normal: o certificado e da propria loja. Toque em');
      console.log('  "Avancado" e depois em "Continuar" - so precisa uma vez.');
    }
  }
  console.log('==================================================');
  console.log('  Deixe esta janela aberta enquanto usar.\n');
}
