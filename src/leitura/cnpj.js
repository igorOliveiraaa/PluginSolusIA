// Consulta de CNPJ em base publica (BrasilAPI, que repassa os dados da Receita).
// Nao precisa de chave nem de IA: sao dados publicos de cadastro de empresa.

const ENDERECO = 'https://brasilapi.com.br/api/cnpj/v1/';

/** Deixa so os digitos. */
export function limparCnpj(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** Confere os dois digitos verificadores do CNPJ. */
export function cnpjValido(valor) {
  const cnpj = limparCnpj(valor);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;      // 00000000000000 e afins

  const calcular = (tamanho) => {
    let soma = 0;
    let peso = tamanho - 7;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(cnpj[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(cnpj[12]) && calcular(13) === Number(cnpj[13]);
}

/** Escreve o CNPJ com pontuacao, como o Solus guarda: 12.345.678/0001-99 */
export function formatarCnpj(valor) {
  const cnpj = limparCnpj(valor);
  if (cnpj.length !== 14) return String(valor || '');
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatarCep(valor) {
  const cep = String(valor || '').replace(/\D/g, '');
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : String(valor || '');
}

function formatarTelefone(ddd, numero) {
  const d = String(ddd || '').replace(/\D/g, '');
  const n = String(numero || '').replace(/\D/g, '');
  if (!n) return '';
  if (!d) return n;
  return `(${d}) ${n}`;
}

/**
 * Busca os dados publicos da empresa pelo CNPJ.
 * Devolve ja no formato dos campos do cadastro de cliente do Solus.
 */
export async function consultarCnpj(valor) {
  const cnpj = limparCnpj(valor);
  if (!cnpjValido(cnpj)) {
    throw new Error('CNPJ invalido. Confira os numeros.');
  }

  let resposta;
  try {
    resposta = await fetch(ENDERECO + cnpj, {
      headers: {
        Accept: 'application/json',
        // sem User-Agent o servico devolve 403
        'User-Agent': 'FerramentaSolus/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Nao consegui consultar o CNPJ. O PC esta conectado na internet?');
  }

  if (resposta.status === 404) {
    throw new Error('CNPJ nao encontrado na base da Receita.');
  }
  if (resposta.status === 429) {
    throw new Error('Muitas consultas seguidas. Espere um minutinho e tente de novo.');
  }
  if (!resposta.ok) {
    throw new Error(`A consulta de CNPJ falhou (erro ${resposta.status}).`);
  }

  const dados = await resposta.json();

  const situacao = String(dados.descricao_situacao_cadastral || '').toUpperCase();
  const telefone = formatarTelefone(dados.ddd_telefone_1?.slice(0, 2), dados.ddd_telefone_1?.slice(2))
    || String(dados.ddd_telefone_1 || '');

  return {
    cnpj: formatarCnpj(cnpj),
    cnpjNumeros: cnpj,
    razaoSocial: String(dados.razao_social || '').trim(),
    fantasia: String(dados.nome_fantasia || '').trim(),
    inscricaoEstadual: (dados.inscricoes_estaduais || [])
      .find((i) => i.ativo)?.inscricao_estadual || '',
    rua: String(dados.logradouro || '').trim(),
    numero: String(dados.numero || '').trim(),
    complemento: String(dados.complemento || '').trim(),
    bairro: String(dados.bairro || '').trim(),
    cidade: String(dados.municipio || '').trim(),
    uf: String(dados.uf || '').trim(),
    cep: formatarCep(dados.cep),
    telefone,
    email: String(dados.email || '').trim().toLowerCase(),
    abertura: String(dados.data_inicio_atividade || '').trim(),
    atividade: String(dados.cnae_fiscal_descricao || '').trim(),
    situacao,
    // aviso importante para quem vai vender a prazo
    ativa: situacao === 'ATIVA',
  };
}
