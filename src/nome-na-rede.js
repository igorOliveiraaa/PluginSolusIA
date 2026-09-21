// Um NOME que nao muda para o Plugin na rede da loja: plugin-solus.local
//
// O problema: o roteador da um IP novo para o PC servidor quase todo dia (DHCP).
// O aplicativo instalado no celular e no outro PC ficava apontando para o IP de
// ontem e parava de abrir.
//
// A saida e a mesma que impressora de rede usa: o proprio PC responde na rede
// "plugin-solus.local sou eu, meu IP de hoje e X" (protocolo mDNS / Bonjour).
// Quem acessa pelo nome sempre chega, qualquer que seja o IP do dia.
//
// Funciona em: Windows 10/11, iPhone, Mac e na maioria dos Android recentes.
// Para 100% (Android antigo inclusive), o jeito definitivo e reservar o IP no
// roteador - ver a aba Ajustes.
//
// Sem biblioteca: e UDP na porta 5353, poucas linhas de protocolo DNS.

import dgram from 'node:dgram';
import os from 'node:os';

export const NOME_NA_REDE = 'plugin-solus.local';
const GRUPO = '224.0.0.251';
const PORTA = 5353;
const TIPO_A = 1;
const TIPO_QUALQUER = 255;

/** IPv4 desta maquina (sem os internos). */
function meusIps() {
  const ips = [];
  for (const enderecos of Object.values(os.networkInterfaces())) {
    for (const e of enderecos || []) {
      if (e.family === 'IPv4' && !e.internal && !e.address.startsWith('169.254.')) {
        ips.push({ ip: e.address, mascara: e.netmask });
      }
    }
  }
  return ips;
}

const paraNumero = (ip) => ip.split('.').reduce((n, parte) => (n << 8) + Number(parte), 0) >>> 0;

/** O meu IP que esta na mesma rede de quem perguntou (o celular no WiFi). */
function ipParaQuemPerguntou(deQuem) {
  const ips = meusIps();
  const destino = paraNumero(deQuem || '0.0.0.0');
  const mesmaRede = ips.find(({ ip, mascara }) =>
    (paraNumero(ip) & paraNumero(mascara)) === (destino & paraNumero(mascara)));
  return (mesmaRede || ips[0])?.ip || null;
}

function nomeEmBytes(nome) {
  const partes = nome.split('.').map((parte) => {
    const bytes = Buffer.from(parte, 'utf8');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...partes, Buffer.from([0])]);
}

/** Le um nome do pacote DNS (com o atalho de compressao). */
function lerNome(pacote, inicio) {
  const partes = [];
  let posicao = inicio;
  let fim = -1;
  for (let voltas = 0; voltas < 30; voltas += 1) {
    const tamanho = pacote[posicao];
    if (tamanho === undefined) return null;
    if (tamanho === 0) { posicao += 1; break; }
    if ((tamanho & 0xc0) === 0xc0) {
      if (fim < 0) fim = posicao + 2;
      posicao = ((tamanho & 0x3f) << 8) | pacote[posicao + 1];
      continue;
    }
    partes.push(pacote.slice(posicao + 1, posicao + 1 + tamanho).toString('utf8'));
    posicao += 1 + tamanho;
  }
  return { nome: partes.join('.').toLowerCase(), proximo: fim >= 0 ? fim : posicao };
}

/** Resposta "NOME = IP". `pergunta` repete a pergunta (resposta direta, nao multicast). */
function montarResposta({ id = 0, ip, comPergunta = false, classe = 0x8001 }) {
  const cabecalho = Buffer.alloc(12);
  cabecalho.writeUInt16BE(id, 0);
  cabecalho.writeUInt16BE(0x8400, 2);                 // resposta, autoritativa
  cabecalho.writeUInt16BE(comPergunta ? 1 : 0, 4);
  cabecalho.writeUInt16BE(1, 6);

  const nome = nomeEmBytes(NOME_NA_REDE);
  const pergunta = comPergunta
    ? Buffer.concat([nome, Buffer.from([0, TIPO_A, 0, 1])])
    : Buffer.alloc(0);

  const registro = Buffer.alloc(10);
  registro.writeUInt16BE(TIPO_A, 0);
  registro.writeUInt16BE(classe, 2);                  // 0x8001 = IN + "troque o que tinha guardado"
  registro.writeUInt32BE(120, 4);                     // vale 2 minutos
  registro.writeUInt16BE(4, 8);
  const endereco = Buffer.from(ip.split('.').map(Number));

  return Buffer.concat([cabecalho, pergunta, nome, registro, endereco]);
}

/**
 * Comeca a responder pelo nome na rede. Nunca derruba o Plugin: se a porta
 * 5353 estiver indisponivel, so avisa e segue sem o nome.
 */
export function anunciarNomeNaRede({ aoFalhar } = {}) {
  let socket;
  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch (erro) {
    aoFalhar?.(erro);
    return null;
  }

  socket.on('error', (erro) => {
    aoFalhar?.(erro);
    try { socket.close(); } catch { /* ja fechado */ }
  });

  socket.on('message', (pacote, quem) => {
    try {
      if (pacote.length < 12) return;
      const flags = pacote.readUInt16BE(2);
      if (flags & 0x8000) return;                     // e resposta de outro, nao pergunta
      const perguntas = pacote.readUInt16BE(4);
      let posicao = 12;
      for (let i = 0; i < perguntas; i += 1) {
        const lido = lerNome(pacote, posicao);
        if (!lido) return;
        const tipo = pacote.readUInt16BE(lido.proximo);
        posicao = lido.proximo + 4;
        if (lido.nome !== NOME_NA_REDE || (tipo !== TIPO_A && tipo !== TIPO_QUALQUER)) continue;

        const ip = ipParaQuemPerguntou(quem.address);
        if (!ip) return;
        if (quem.port !== PORTA) {
          // pergunta "direta" (Windows e alguns celulares): responde so para ele
          socket.send(montarResposta({ id: pacote.readUInt16BE(0), ip, comPergunta: true, classe: 1 }),
            quem.port, quem.address);
        } else {
          socket.send(montarResposta({ ip }), PORTA, GRUPO);
        }
        return;
      }
    } catch { /* pacote estranho: ignora */ }
  });

  socket.bind(PORTA, () => {
    for (const { ip } of meusIps()) {
      try { socket.addMembership(GRUPO, ip); } catch { /* placa sem multicast */ }
    }
    try { socket.setMulticastTTL(255); } catch { /* ok */ }
    // avisa a rede na hora que liga (quem tinha o IP de ontem guardado atualiza)
    const avisar = () => {
      for (const { ip } of meusIps()) {
        try { socket.send(montarResposta({ ip }), PORTA, GRUPO); } catch { /* ok */ }
      }
    };
    avisar();
    setTimeout(avisar, 1500);
  });

  return socket;
}
