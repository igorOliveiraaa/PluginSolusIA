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

/**
 * Devolve o certificado, gerando um novo se nao existir ou se o IP da maquina
 * tiver mudado (o certificado precisa citar o IP que o celular vai acessar).
 */
export async function obterCertificado() {
  const ips = ipsDaMaquina();
  const assinatura = JSON.stringify({ ips: [...ips].sort(), versao: 1 });

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
  const alternativos = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];

  const gerado = await selfsigned.generate(
    [{ name: 'commonName', value: ips[0] || 'localhost' }],
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
  fs.writeFileSync(ARQUIVO_INFO, JSON.stringify({ assinatura, validoAte, ips }, null, 2), 'utf8');

  return { cert: gerado.cert, key: gerado.private, novo: true };
}
