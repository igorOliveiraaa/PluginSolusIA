// Consulta de CNPJ em base publica. Nao precisa de chave nem de IA: sao dados
// publicos de cadastro de empresa.
//
// Sao duas fontes de proposito, porque nenhuma sozinha traz tudo que a nota exige:
//   - BrasilAPI: rapida e estavel, tem o endereco e a situacao, mas NAO tem
//     inscricao estadual e devolve a rua sem o tipo ("VOLUNTARIOS DA FRANCA"
//     em vez de "RUA VOLUNTARIOS DA FRANCA").
//   - cnpj.ws (publica): tem a INSCRICAO ESTADUAL por estado e o tipo da rua.
//     Tem limite de consultas por minuto, entao entra so para completar - se ela
//     falhar, o cadastro continua com o que a BrasilAPI trouxe.
//
// Nota fiscal sem endereco completo (rua, numero, bairro, cidade, UF e CEP) e
// recusada pela Sefaz, por isso a resposta diz o que ficou faltando.

const BRASILAPI = 'https://brasilapi.com.br/api/cnpj/v1/';
const CNPJWS = 'https://publica.cnpj.ws/cnpj/';
const CNPJA = 'https://open.cnpja.com/office/';

const CAMPOS_DA_NOTA = [
  ['rua', 'a rua'],
  ['numero', 'o número'],
  ['bairro', 'o bairro'],
  ['cidade', 'a cidade'],
  ['uf', 'o estado'],
  ['cep', 'o CEP'],
];

/** Busca um JSON sem derrubar a consulta inteira quando a fonte esta fora. */
async function pegarJson(url, tempo = 12000) {
  try {
    const resposta = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'FerramentaSolus/1.0' },
      signal: AbortSignal.timeout(tempo),
    });
    if (!resposta.ok) return { status: resposta.status, dados: null };
    return { status: 200, dados: await resposta.json() };
  } catch {
    return { status: 0, dados: null };
  }
}

const limpo = (valor) => String(valor ?? '').trim();

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

  // ---- fonte principal --------------------------------------------------
  const brasil = await pegarJson(BRASILAPI + cnpj);
  let empresa = brasil.dados ? daBrasilApi(brasil.dados, cnpj) : null;

  // BrasilAPI fora do ar: tenta a segunda fonte antes de desistir
  if (!empresa) {
    if (brasil.status === 404) throw new Error('CNPJ nao encontrado na base da Receita.');
    const reserva = await pegarJson(CNPJA + cnpj);
    if (reserva.dados) empresa = doCnpja(reserva.dados, cnpj);
  }

  if (!empresa) {
    if (brasil.status === 429) {
      throw new Error('Muitas consultas seguidas. Espere um minutinho e tente de novo.');
    }
    throw new Error('Nao consegui consultar o CNPJ. O PC esta conectado na internet?');
  }

  // ---- completa o que falta (inscricao estadual, tipo da rua, e-mail) -----
  const extra = await pegarJson(CNPJWS + cnpj);
  if (extra.dados) completarComCnpjWs(empresa, extra.dados);

  // ---- o que a nota fiscal ainda exige -----------------------------------
  empresa.faltando = CAMPOS_DA_NOTA.filter(([campo]) => !empresa[campo]).map(([, rotulo]) => rotulo);
  empresa.enderecoCompleto = empresa.faltando.length === 0;

  return empresa;
}

function daBrasilApi(dados, cnpj) {
  if (!dados || !dados.razao_social) return null;
  const situacao = limpo(dados.descricao_situacao_cadastral).toUpperCase();
  const fone = limpo(dados.ddd_telefone_1);

  return {
    cnpj: formatarCnpj(cnpj),
    cnpjNumeros: cnpj,
    razaoSocial: limpo(dados.razao_social),
    fantasia: limpo(dados.nome_fantasia),
    inscricaoEstadual: '',
    // a BrasilAPI separa "RUA" de "VOLUNTARIOS DA FRANCA": a nota quer os dois juntos
    rua: [limpo(dados.descricao_tipo_de_logradouro), limpo(dados.logradouro)]
      .filter(Boolean).join(' '),
    numero: limpo(dados.numero),
    complemento: limpo(dados.complemento),
    bairro: limpo(dados.bairro),
    cidade: limpo(dados.municipio),
    uf: limpo(dados.uf),
    cep: formatarCep(dados.cep),
    telefone: formatarTelefone(fone.slice(0, 2), fone.slice(2)) || fone,
    email: limpo(dados.email).toLowerCase(),
    abertura: limpo(dados.data_inicio_atividade),
    atividade: limpo(dados.cnae_fiscal_descricao),
    situacao,
    ativa: situacao === 'ATIVA',
  };
}

function doCnpja(dados, cnpj) {
  const endereco = dados.address || {};
  const situacao = limpo(dados.status?.text).toUpperCase();
  const fone = dados.phones?.[0];

  return {
    cnpj: formatarCnpj(cnpj),
    cnpjNumeros: cnpj,
    razaoSocial: limpo(dados.company?.name),
    fantasia: limpo(dados.alias),
    inscricaoEstadual: (dados.registrations || [])
      .find((r) => r.enabled && r.state === endereco.state)?.number || '',
    rua: limpo(endereco.street).toUpperCase(),
    numero: limpo(endereco.number),
    complemento: limpo(endereco.details),
    bairro: limpo(endereco.district).toUpperCase(),
    cidade: limpo(endereco.city).toUpperCase(),
    uf: limpo(endereco.state),
    cep: formatarCep(endereco.zip),
    telefone: fone ? formatarTelefone(fone.area, fone.number) : '',
    email: limpo(dados.emails?.[0]?.address).toLowerCase(),
    abertura: limpo(dados.founded),
    atividade: limpo(dados.mainActivity?.text),
    situacao,
    ativa: situacao === 'ATIVA',
  };
}

/**
 * Completa com a segunda fonte. Ela e a unica que tem INSCRICAO ESTADUAL, e a
 * inscricao certa e a do estado do proprio estabelecimento (uma empresa grande
 * tem inscricao em varios estados).
 */
function completarComCnpjWs(empresa, dados) {
  const est = dados.estabelecimento || {};
  const uf = limpo(est.estado?.sigla) || empresa.uf;

  if (!empresa.inscricaoEstadual) {
    const inscricoes = est.inscricoes_estaduais || [];
    const daUf = inscricoes.find((i) => i.ativo && limpo(i.estado?.sigla) === uf)
      || inscricoes.find((i) => i.ativo);
    empresa.inscricaoEstadual = limpo(daUf?.inscricao_estadual);
  }

  const rua = [limpo(est.tipo_logradouro), limpo(est.logradouro)].filter(Boolean).join(' ');
  if (rua && (!empresa.rua || empresa.rua.length < rua.length)) empresa.rua = rua;

  empresa.numero = empresa.numero || limpo(est.numero);
  empresa.complemento = empresa.complemento || limpo(est.complemento);
  empresa.bairro = empresa.bairro || limpo(est.bairro);
  empresa.cidade = empresa.cidade || limpo(est.cidade?.nome).toUpperCase();
  empresa.uf = empresa.uf || uf;
  empresa.cep = empresa.cep || formatarCep(est.cep);
  empresa.email = empresa.email || limpo(est.email).toLowerCase();
  if (!empresa.telefone && est.telefone1) {
    empresa.telefone = formatarTelefone(est.ddd1, est.telefone1);
  }
  empresa.razaoSocial = empresa.razaoSocial || limpo(dados.razao_social);
  empresa.fantasia = empresa.fantasia || limpo(est.nome_fantasia);
}
