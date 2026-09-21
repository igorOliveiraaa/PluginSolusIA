/* Instalar o Plugin como aplicativo no aparelho.
 *
 * Tres situacoes diferentes, e cada uma precisa de uma resposta diferente:
 *
 *  1. Android/Chrome/Edge com tudo certo -> o navegador avisa que da para
 *     instalar (evento beforeinstallprompt). Guardamos o aviso e mostramos o
 *     botao "Instalar o aplicativo".
 *  2. iPhone/iPad -> o Safari NUNCA manda esse aviso. La e no braco: menu
 *     Compartilhar -> "Adicionar a Tela de Inicio". So cabe explicar.
 *  3. Acesso por http://IP (sem o "s") -> o navegador nem considera instalar,
 *     porque so libera isso em endereco seguro. Ai o certo e mandar a pessoa
 *     para o endereco https, que o proprio servidor abre.
 */

import { $, escapar } from './comum.js';

const CHAVE_DISPENSADO = 'solus-instalar-dispensado';

let aviso = null;          // o beforeinstallprompt guardado
const faixa = $('#faixa-instalar');

const jaInstalado = () =>
  window.matchMedia?.('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

const ehIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const foiDispensado = () => {
  try { return localStorage.getItem(CHAVE_DISPENSADO) === 'sim'; } catch { return false; }
};

const dispensar = () => {
  try { localStorage.setItem(CHAVE_DISPENSADO, 'sim'); } catch { /* sem localStorage */ }
  esconder();
};

function esconder() {
  if (!faixa) return;
  faixa.classList.add('escondido');
  faixa.innerHTML = '';
}

// o endereco com NOME (plugin-solus.local), que o servidor informa. Com ele o app
// instalado nao quebra quando o roteador troca o IP do PC servidor.
let enderecos = null;
const buscarEnderecos = fetch('/api/enderecos')
  .then((r) => r.json())
  .then((dados) => { enderecos = dados.ok ? dados : null; })
  .catch(() => { enderecos = null; });

const acessandoPeloIp = () => /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);

/** Endereco https para instalar: o com nome (que nao muda) ou, sem ele, o mesmo IP. */
function enderecoSeguro() {
  if (enderecos?.nomeFixo) return `${enderecos.nomeFixo}${location.pathname}`;
  const porta = Number(location.port || 3535) + 1;
  return `https://${location.hostname}:${porta}${location.pathname}`;
}

function mostrar(html, ligar) {
  if (!faixa) return;
  faixa.innerHTML = `
    <div class="instalar-texto">${html}</div>
    <div class="instalar-acoes"></div>`;
  ligar(faixa.querySelector('.instalar-acoes'));

  const fechar = document.createElement('button');
  fechar.className = 'botao secundario';
  fechar.textContent = 'Agora não';
  fechar.addEventListener('click', dispensar);
  faixa.querySelector('.instalar-acoes').appendChild(fechar);

  faixa.classList.remove('escondido');
}

// ---------------------------------------------------------------------------

/** O navegador avisou que da para instalar: guarda e oferece o botao. */
window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();               // o convite e nosso, na hora certa
  aviso = evento;
  if (jaInstalado() || foiDispensado()) return;

  mostrar(
    '<strong>Instale o Plugin no aparelho.</strong>'
    + ' Abre direto do ícone, sem digitar endereço, e ocupa a tela inteira.',
    (acoes) => {
      const botao = document.createElement('button');
      botao.className = 'botao principal';
      botao.textContent = 'Instalar o aplicativo';
      botao.addEventListener('click', instalarAgora);
      acoes.appendChild(botao);
    }
  );
});

async function instalarAgora() {
  if (!aviso) return;
  aviso.prompt();
  const { outcome } = await aviso.userChoice;
  aviso = null;
  if (outcome === 'accepted') esconder();
}

window.addEventListener('appinstalled', () => {
  aviso = null;
  esconder();
});

/**
 * Quando o navegador nao manda o aviso, ainda assim da para ajudar:
 * no iPhone, explicando o caminho; no http, mandando para o https.
 */
async function conferirOutrosCasos() {
  await buscarEnderecos;
  if (jaInstalado() || foiDispensado() || aviso) return;

  // acesso por http, ou pelo IP: instalar so funciona em endereco seguro - e,
  // pelo IP, o app instalado para de abrir no dia em que o roteador trocar o IP
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const precisaTrocar = !local && (location.protocol === 'http:' || (acessandoPeloIp() && enderecos?.nomeFixo));
  if (precisaTrocar) {
    mostrar(
      '<strong>Para instalar o aplicativo, use o endereço que não muda.</strong>'
      + ` Abra <code>${escapar(enderecoSeguro())}</code>.`
      + (acessandoPeloIp() ? ' Pelo número (IP), o app instalado para de abrir quando o roteador troca o IP do PC.' : '')
      + ' Na primeira vez o aparelho avisa que "o site não é seguro" — é o certificado da'
      + ' própria loja: toque em <em>Avançado</em> e depois em <em>Continuar</em>.',
      (acoes) => {
        const botao = document.createElement('button');
        botao.className = 'botao principal';
        botao.textContent = 'Abrir o endereço seguro';
        botao.addEventListener('click', () => { location.href = enderecoSeguro(); });
        acoes.appendChild(botao);
      }
    );
    return;
  }

  if (ehIos()) {
    mostrar(
      '<strong>Instale o Plugin no iPhone.</strong>'
      + ' Toque no botão <em>Compartilhar</em> (o quadradinho com a seta para cima),'
      + ' role e escolha <em>Adicionar à Tela de Início</em>.',
      () => { /* no iPhone nao ha botao: o caminho e pelo menu do Safari */ }
    );
  }
}

// Acesso por http pelo IP nunca vai poder instalar, entao nao ha o que esperar:
// avisa na hora. Nos outros casos o Chrome demora um pouco para decidir se da
// para instalar, e so depois disso vale mostrar alguma coisa.
const acessoLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ((location.protocol === 'http:' || acessandoPeloIp()) && !acessoLocal) conferirOutrosCasos();
else setTimeout(conferirOutrosCasos, 2500);

// ---------------------------------------------------------------------------
// O mesmo assunto na aba Ajustes, para quem fechou a faixa achar depois
// ---------------------------------------------------------------------------

/** O quadro "endereco que nao muda", com o que fazer se o celular nao abrir. */
function quadroDoEndereco() {
  if (!enderecos?.nomeFixo) return '';
  return `
    <div class="endereco-fixo">
      <span class="ajuda" style="margin:0">Endereço que não muda (use no celular e nos outros PCs):</span>
      <code>${escapar(enderecos.nomeFixo)}</code>
      <span class="ajuda" style="margin:0">Nos PCs com Windows também funciona: <code>${escapar(enderecos.nomeDoPc)}</code></span>
      <details class="caminho-manual">
        <summary>O celular não abriu pelo nome?</summary>
        <p class="ajuda">Alguns Android mais antigos não entendem o nome ".local". A solução
          definitiva é <strong>fixar o IP do PC servidor no roteador</strong> — aí o número
          ${enderecos.ip ? `<code>${escapar(enderecos.ip)}</code>` : ''} nunca mais muda:</p>
        <ol class="ajuda">
          <li>No PC servidor, abra <code>http://192.168.0.1</code> (ou o endereço do roteador,
            escrito embaixo dele) e entre com a senha do roteador.</li>
          <li>Procure <em>DHCP</em> → <em>Reserva de endereço</em> (ou "IP fixo", "Address Reservation").</li>
          <li>Escolha este PC na lista e reserve o IP ${enderecos.ip ? `<code>${escapar(enderecos.ip)}</code>` : 'atual'}. Salve.</li>
          <li>Instale o app no celular pelo endereço <code>${escapar(enderecos.ipDeHoje || '')}</code>.</li>
        </ol>
      </details>
    </div>`;
}

async function desenharNosAjustes() {
  const area = $('#instalar-ajustes');
  if (!area) return;
  await buscarEnderecos;

  if (jaInstalado()) {
    area.innerHTML = '<div class="item-aviso info">O Plugin já está instalado neste aparelho.</div>'
      + quadroDoEndereco();
    return;
  }

  if (aviso) {
    area.innerHTML = '<button class="botao principal largura-total" id="btn-instalar-ajustes">Instalar o aplicativo</button>' + quadroDoEndereco();
    $('#btn-instalar-ajustes').addEventListener('click', instalarAgora);
    return;
  }

  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol === 'http:' && !local) {
    area.innerHTML = `
      <div class="item-aviso">Para instalar, abra o endereço seguro:
        <code>${escapar(enderecoSeguro())}</code></div>
      <button class="botao principal largura-total" id="btn-ir-seguro">Abrir o endereço seguro</button>` + quadroDoEndereco();
    $('#btn-ir-seguro').addEventListener('click', () => { location.href = enderecoSeguro(); });
    return;
  }

  if (ehIos()) {
    area.innerHTML = `
      <div class="item-aviso info">
        No iPhone: toque em <strong>Compartilhar</strong> e escolha
        <strong>Adicionar à Tela de Início</strong>.
      </div>` + quadroDoEndereco();
    return;
  }

  area.innerHTML = `
    <p class="ajuda" style="margin:0">
      Este navegador não ofereceu a instalação. No computador, procure o ícone de
      instalar na barra de endereço; no celular, use o menu do navegador em
      "Instalar aplicativo" ou "Adicionar à tela inicial".
    </p>` + quadroDoEndereco();
}

document.addEventListener('abriu-tela', (evento) => {
  if (evento.detail === 'config') desenharNosAjustes();
});

export { instalarAgora, jaInstalado, ehIos, enderecoSeguro };
