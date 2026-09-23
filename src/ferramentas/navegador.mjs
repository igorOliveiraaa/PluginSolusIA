// Um navegador de verdade, dirigido pelo teste.
//
// POR QUE EXISTE
// Os outros testes chamam o servidor direto. Eles provam que a conta está certa,
// mas não pegam o que só aparece NA TELA: botão que não faz nada, botão coberto
// por outra coisa, erro de JavaScript no console, tela que quebra no celular.
// Isto abre o Chrome (ou o Edge) do próprio PC em modo invisível e clica como
// uma pessoa clicaria - sem instalar nada, pelo protocolo de depuração que o
// próprio Chrome oferece.
//
// Uso (ver t-navegador.mjs):
//   const nav = await abrirNavegador();
//   await nav.ir('http://localhost:3535');
//   await nav.clicar('#btn-entrar');
//   ...
//   nav.erros   -> tudo que deu erro no console, desde o começo
//   await nav.fechar();

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ONDE_PROCURAR = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function abrirNavegador({ porta = 9333, largura = 1366, altura = 900, pastaFotos } = {}) {
  const exe = ONDE_PROCURAR.find((c) => fs.existsSync(c));
  if (!exe) throw new Error('Não achei Chrome nem Edge neste PC.');

  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-navegador-'));
  const processo = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    '--disable-extensions',
    `--window-size=${largura},${altura}`,
    'about:blank',
  ], { stdio: 'ignore' });

  // espera o Chrome abrir a porta de depuração
  let alvos = null;
  for (let tentativa = 0; tentativa < 50 && !alvos; tentativa += 1) {
    await esperar(200);
    try {
      const lista = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      if (lista.some((t) => t.type === 'page')) alvos = lista;
    } catch { /* ainda subindo */ }
  }
  if (!alvos) { processo.kill(); throw new Error('O navegador não abriu a porta de depuração.'); }

  const pagina = alvos.find((t) => t.type === 'page');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, falhou) => { ws.onopen = ok; ws.onerror = falhou; });

  let proximoId = 0;
  const pendentes = new Map();
  const erros = [];
  const dialogos = [];
  let respostaDoDialogo = { aceitar: true, texto: undefined };

  const enviar = (method, params = {}) => new Promise((ok, falhou) => {
    const id = ++proximoId;
    pendentes.set(id, { ok, falhou, method });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.onmessage = (evento) => {
    const msg = JSON.parse(evento.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { ok, falhou, method } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) falhou(new Error(`${method}: ${msg.error.message}`));
      else ok(msg.result);
      return;
    }
    // --- o que acontece na página ---
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      erros.push(`ERRO JS: ${d.exception?.description || d.text} (${d.url || ''}:${d.lineNumber})`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      erros.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      erros.push(`${e.source}: ${e.text}${e.url ? ' ' + e.url : ''}`);
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      dialogos.push({ tipo: msg.params.type, texto: msg.params.message });
      const resposta = respostaDoDialogo;
      respostaDoDialogo = { aceitar: true, texto: undefined };      // uma resposta vale para um diálogo
      enviar('Page.handleJavaScriptDialog', { accept: resposta.aceitar, promptText: resposta.texto })
        .catch(() => {});
    }
  };

  await enviar('Page.enable');
  await enviar('Runtime.enable');
  await enviar('Log.enable');
  await enviar('DOM.enable');

  /** Roda JavaScript na página e devolve o valor. */
  async function avaliar(expressao) {
    const r = await enviar('Runtime.evaluate', {
      expression: expressao, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`avaliar: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }

  /** Espera uma condição (JavaScript) ficar verdadeira. */
  async function esperarAte(condicao, { tempo = 15000, descricao = condicao } = {}) {
    const fim = Date.now() + tempo;
    while (Date.now() < fim) {
      try { if (await avaliar(`Boolean(${condicao})`)) return true; } catch { /* página trocando */ }
      await esperar(150);
    }
    throw new Error(`Passou ${tempo / 1000}s esperando: ${descricao}`);
  }

  async function ir(url) {
    const carregou = new Promise((ok) => {
      const anterior = ws.onmessage;
      ws.onmessage = (evento) => {
        anterior(evento);
        if (JSON.parse(evento.data).method === 'Page.loadEventFired') { ws.onmessage = anterior; ok(); }
      };
    });
    await enviar('Page.navigate', { url });
    await Promise.race([carregou, esperar(20000)]);
  }

  /**
   * Clica como gente: rola até o elemento, confere que NADA está por cima dele
   * (faixa, aviso, menu) e aperta o mouse no meio dele.
   */
  async function clicar(seletor, { indice = 0 } = {}) {
    // 1) leva o mouse até perto do alvo: quem clica tira o mouse de onde estava
    //    (e o menu lateral, aberto pelo clique anterior, fecha sozinho)
    const perto = await avaliar(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(seletor)})[${indice}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (perto) {
      await enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x: perto.x, y: perto.y });
      await esperar(260);                                   // a animação do menu
    }

    // 2) confere o que está à vista e mira
    const alvo = await avaliar(`(() => {
      const todos = document.querySelectorAll(${JSON.stringify(seletor)});
      const el = todos[${indice}];
      if (!el) return { erro: 'não existe' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return { erro: 'está escondido (tamanho zero)' };
      if (el.disabled) return { erro: 'está desabilitado' };
      // mira onde uma pessoa miraria: primeiro o meio; se o meio não está à
      // vista (a aba do menu recolhido mostra só o ícone), outro ponto dele
      // que esteja. Se NENHUM ponto está à vista, tem algo por cima de verdade.
      const y = r.top + r.height / 2;
      let quem = '';
      for (const fracao of [0.5, 0.2, 0.8, 0.1, 0.35, 0.65, 0.9]) {
        const x = r.left + r.width * fracao;
        if (x < 0 || x > innerWidth) continue;
        const noPonto = document.elementFromPoint(x, y);
        if (noPonto && (noPonto === el || el.contains(noPonto))) return { x, y };
        if (!quem && noPonto) quem = noPonto.id ? '#' + noPonto.id : String(noPonto.className || noPonto.tagName);
      }
      return { coberto: true, quem: quem.slice(0, 60) };
    })()`);
    if (alvo.erro) throw new Error(`clicar ${seletor}: ${alvo.erro}`);
    if (alvo.coberto) throw new Error(`clicar ${seletor}: tem outra coisa por cima (${alvo.quem})`);
    // o mouse passa por cima antes (abre o menu recolhido, como com gente)
    await enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x: alvo.x, y: alvo.y });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await enviar('Input.dispatchMouseEvent', { type, x: alvo.x, y: alvo.y, button: 'left', clickCount: 1 });
    }
    await esperar(120);
  }

  /** Dá para clicar nele (existe, está à vista e nada está por cima)? Não clica. */
  async function podeClicar(seletor) {
    return avaliar(`(() => {
      const el = document.querySelector(${JSON.stringify(seletor)});
      if (!el) return { ok: false, motivo: 'não existe' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return { ok: false, motivo: 'escondido' };
      const y = r.top + r.height / 2;
      let quem = '';
      for (const fracao of [0.5, 0.2, 0.8]) {
        const noPonto = document.elementFromPoint(r.left + r.width * fracao, y);
        if (noPonto && (noPonto === el || el.contains(noPonto))) return { ok: true };
        if (!quem && noPonto) quem = noPonto.id ? '#' + noPonto.id : String(noPonto.className || noPonto.tagName);
      }
      return { ok: false, motivo: 'coberto por ' + quem.slice(0, 60) };
    })()`);
  }

  /** Digita num campo (limpa antes). */
  async function digitar(seletor, texto) {
    await avaliar(`(() => {
      const el = document.querySelector(${JSON.stringify(seletor)});
      if (!el) throw new Error('campo não existe: ${seletor.replace(/'/g, '')}');
      el.focus(); el.select?.(); el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await enviar('Input.insertText', { text: String(texto) });
    await avaliar(`document.querySelector(${JSON.stringify(seletor)})
      .dispatchEvent(new Event('change', { bubbles: true }))`);
  }

  /** Escolhe arquivo(s) num <input type=file>. */
  async function enviarArquivo(seletor, caminhos) {
    const { root } = await enviar('DOM.getDocument', { depth: 0 });
    const { nodeId } = await enviar('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
    if (!nodeId) throw new Error(`enviarArquivo: ${seletor} não existe`);
    const lista = (Array.isArray(caminhos) ? caminhos : [caminhos]).map((c) => path.resolve(c));
    await enviar('DOM.setFileInputFiles', { nodeId, files: lista });
  }

  /** A próxima confirm()/prompt() vai ser respondida assim. */
  function responderDialogo({ aceitar = true, texto } = {}) {
    respostaDoDialogo = { aceitar, texto };
  }

  /** Tira foto da tela (para eu ver como ficou). */
  async function foto(nome) {
    if (!pastaFotos) return null;
    fs.mkdirSync(pastaFotos, { recursive: true });
    const { data } = await enviar('Page.captureScreenshot', { format: 'png' });
    const arquivo = path.join(pastaFotos, `${nome}.png`);
    fs.writeFileSync(arquivo, Buffer.from(data, 'base64'));
    return arquivo;
  }

  /** Vira um celular (390 x 844, toque) ou volta ao PC. */
  async function comoCelular(sim = true) {
    if (sim) {
      await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await enviar('Emulation.setTouchEmulationEnabled', { enabled: true });
    } else {
      await enviar('Emulation.clearDeviceMetricsOverride');
      await enviar('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    await esperar(300);
  }

  async function fechar() {
    try { ws.close(); } catch { /* já fechado */ }
    try { processo.kill(); } catch { /* já saiu */ }
    // o Chrome abre processos filhos; o kill do pai nem sempre leva todos junto
    try { execSync(`taskkill /PID ${processo.pid} /T /F`, { stdio: 'ignore' }); } catch { /* já saiu */ }
    await esperar(300);
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* arquivo preso: fica no temp */ }
  }

  return {
    avaliar, esperarAte, ir, clicar, podeClicar, digitar, enviarArquivo, responderDialogo,
    foto, comoCelular, fechar, erros, dialogos, esperar,
  };
}
