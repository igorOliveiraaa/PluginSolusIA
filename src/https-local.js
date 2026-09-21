// HTTPS na rede da loja.
//
// Por que isso e necessario: o navegador so libera "instalar como aplicativo"
// e o botao de compartilhar (que manda o PDF para o WhatsApp) em conexao segura.
// Em HTTP puro, pelo IP, essas duas coisas ficam bloqueadas.
//
// Como e rede interna, usamos um certificado proprio, gerado aqui mesmo.
// O celular mostra um aviso de "site nao seguro" na primeira vez; e so aceitar
// uma vez por aparelho. Os dados continuam trafegando criptografados.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import selfsigned from 'selfsigned';
import { PASTAS } from './config.js';
import { NOME_NA_REDE } from './nome-na-rede.js';

const PASTA_CERT = path.join(PASTAS.dados, 'certificado');
const ARQUIVO_CERT = path.join(PASTA_CERT, 'certificado.pem');
const ARQUIVO_CHAVE = path.join(PASTA_CERT, 'chave.pem');
const ARQUIVO_INFO = path.join(PASTA_CERT, 'info.json');

/** IPs desta maquina na rede local. */
export function ipsDaMaquina() {
  const ips = [];
  for (const enderecos of Object.values(os.networkInterfaces())) {
    for (const endereco of enderecos || []) {
      if (endereco.family === 'IPv4' && !endereco.internal) ips.push(endereco.address);
    }
  }
  return ips;
}

/** Endereco de rede interna (WiFi/cabo da loja). Os outros sao VPN, celular roteado etc. */
export function ehRedeLocal(ip) {
  // Os pontos precisam de barra invertida: sem ela, "/^10./" tambem aceitava
  // 100.64.x.x (celular roteando internet) e a faixa 172.16-31 nunca era aceita.
  return /^192\.168\./.test(ip)
    || /^10\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * Os nomes que o certificado precisa aceitar: o nome fixo do Plugin na rede
 * (plugin-solus.local) e o nome do proprio PC (que o Windows ja acha na rede).
 */
export function nomesDaMaquina() {
  const nomeDoPc = String(os.hostname() || '').trim();
  return [...new Set(['localhost', NOME_NA_REDE, nomeDoPc, nomeDoPc && `${nomeDoPc}.local`]
    .filter(Boolean).map((n) => n.toLowerCase()))];
}

/** "192.168.0.242" -> "192.168.0" (a rede da loja). */
const redeDo = (ip) => ip.split('.').slice(0, 3).join('.');

/**
 * Devolve o certificado, gerando um novo so quando precisa.
 *
 * Antes ele era refeito toda vez que o roteador trocava o IP do PC (quase todo
 * dia): o celular mostrava "site nao seguro" de novo e o app instalado quebrava.
 * Agora o certificado vale para o NOME do Plugin e para TODOS os enderecos da
 * rede da loja (192.168.0.1 a .254) - o IP pode mudar a vontade dentro da rede.
 */
export async function obterCertificado() {
  const ips = ipsDaMaquina();
  const redes = [...new Set(ips.filter(ehRedeLocal).map(redeDo))].sort();
  const nomes = nomesDaMaquina();
  const assinatura = JSON.stringify({ redes, nomes, versao: 2 });

  if (fs.existsSync(ARQUIVO_CERT) && fs.existsSync(ARQUIVO_CHAVE)) {
    try {
      const info = JSON.parse(fs.readFileSync(ARQUIVO_INFO, 'utf8'));
      const validoAte = new Date(info.validoAte);
      if (info.assinatura === assinatura && validoAte > new Date()) {
        return {
          cert: fs.readFileSync(ARQUIVO_CERT, 'utf8'),
          key: fs.readFileSync(ARQUIVO_CHAVE, 'utf8'),
          novo: false,
        };
      }
    } catch { /* info corrompida: gera de novo */ }
  }

  // o certificado precisa valer para localhost e para cada IP da maquina,
  // senao o navegador recusa antes mesmo de perguntar
  const enderecos = new Set(['127.0.0.1', ...ips]);
  for (const rede of redes) {
    for (let final = 1; final <= 254; final += 1) enderecos.add(`${rede}.${final}`);
  }
  const alternativos = [
    ...nomes.map((nome) => ({ type: 2, value: nome })),
    ...[...enderecos].map((ip) => ({ type: 7, ip })),
  ];

  const gerado = await selfsigned.generate(
    [{ name: 'commonName', value: NOME_NA_REDE }],
    {
      days: 730,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'subjectAltName', altNames: alternativos },
      ],
    }
  );

  fs.mkdirSync(PASTA_CERT, { recursive: true });
  fs.writeFileSync(ARQUIVO_CERT, gerado.cert, 'utf8');
  fs.writeFileSync(ARQUIVO_CHAVE, gerado.private, 'utf8');

  const validoAte = new Date();
  validoAte.setDate(validoAte.getDate() + 720);
  fs.writeFileSync(ARQUIVO_INFO, JSON.stringify({ assinatura, validoAte, ips, redes, nomes }, null, 2), 'utf8');

  return { cert: gerado.cert, key: gerado.private, novo: true };
}
