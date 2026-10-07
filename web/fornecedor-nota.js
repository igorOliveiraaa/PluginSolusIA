/* Fornecedor da nota: OBRIGATORIO antes de gravar.
   Ja achado no Solus pelo CNPJ: so mostra quem e. Nao achado: a pessoa escolhe
   um que ja esta no Solus (cadastrado sem CNPJ, por exemplo) ou cadastra - com
   os dados do XML ou da Receita, tudo editavel. Sem isso a nota nao aparece na
   aba "Fornecedores do Produto" do Solus. */

import { $, api, escapar, avisar } from './comum.js';

let contexto = null;          // { idConferencia, conferencia, aoMudar }

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

function documento(valor) {
  const n = digitos(valor);
  if (n.length === 14) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
  if (n.length === 11) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  return String(valor || '');
}

/** A nota ja tem o fornecedor do Solus? (sem isso o botao de gravar nao segue) */
export function fornecedorResolvido(conferencia) {
  return Boolean(conferencia?.fornecedor?.codigoNoSolus);
}

export function desenharFornecedor({ idConferencia, conferencia, aoMudar }) {
  contexto = { idConferencia, conferencia, aoMudar };
  const area = $('#fornecedor-nota');
  const f = conferencia.fornecedor || {};

  if (f.codigoNoSolus) {
    area.className = 'cartao fornecedor-nota fornecedor-ok';
    area.innerHTML = `
      <div class="fornecedor-linha">
        <span class="etiqueta ok">fornecedor no Solus</span>
        <strong>${escapar(f.nomeNoSolus || f.nome)}</strong>
        <span class="ajuda">código ${escapar(f.codigoNoSolus)}${f.cnpj ? ` · ${escapar(documento(f.cnpj))}` : ''}</span>
      </div>`;
    return;
  }

  area.className = 'cartao fornecedor-nota fornecedor-falta';
  area.innerHTML = `
    <div class="item-aviso" style="margin-top:0">
      <strong>Fornecedor não está cadastrado no Solus.</strong>
      Obrigatório para gravar: é ele que aparece na aba "Fornecedores do Produto",
      com o número da nota e o custo.
    </div>
    <p style="margin:10px 0 4px">
      Na nota: <strong>${escapar(f.nome || 'nome não lido')}</strong>
      · ${f.cnpj ? `CNPJ ${escapar(documento(f.cnpj))}` : 'CNPJ não lido'}
    </p>
    <div id="forn-parecidos"></div>
    <div class="fornecedor-abas">
      <button class="botao secundario" data-forn="cadastrar">Cadastrar este fornecedor</button>
      <button class="botao secundario" data-forn="procurar">Já está no Solus — procurar</button>
    </div>
    <div id="forn-painel"></div>`;

  area.querySelectorAll('[data-forn]').forEach((botao) => {
    botao.addEventListener('click', () => abrirPainel(botao.dataset.forn));
  });
  mostrarParecidos(f.nome);
  abrirPainel('cadastrar');
}

function abrirPainel(qual) {
  $('#fornecedor-nota').querySelectorAll('[data-forn]').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.forn === qual);
  });
  if (qual === 'procurar') painelProcurar();
  else painelCadastrar();
}

// ---------------------------------------------------------------------------
// Ja esta no Solus: parecidos pelo nome e busca livre
// ---------------------------------------------------------------------------

// palavra que todo fornecedor tem no nome: procurar por ela traz a lista inteira
const COMUNS = new Set(['COMERCIO', 'COM', 'COMERCIAL', 'DISTRIBUIDORA', 'DIST', 'DISTRIBUICAO', 'IND',
  'INDUSTRIA', 'LTDA', 'EPP', 'EIRELI', 'PRODUTOS', 'PROD', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'SA', 'ATACADO']);

/** Antes de cadastrar, mostra quem ja existe com nome parecido (evita repetido). */
async function mostrarParecidos(nome) {
  const palavra = String(nome || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/).find((p) => p.length >= 3 && !COMUNS.has(p));
  if (!palavra) return;
  try {
    const { fornecedores } = await api('/api/fornecedores?busca=' + encodeURIComponent(palavra));
    if (!fornecedores.length || fornecedorResolvido(contexto.conferencia)) return;
    $('#forn-parecidos').innerHTML = `
      <p class="ajuda" style="margin:8px 0 4px">Já cadastrados com nome parecido — se for um deles, é só escolher:</p>
      ${listaDeFornecedores(fornecedores.slice(0, 4))}`;
    ligarEscolha($('#forn-parecidos'));
  } catch { /* sem parecidos: segue so com o cadastrar/procurar */ }
}

function painelProcurar() {
  $('#forn-painel').innerHTML = `
    <div class="linha-dupla linha-busca">
      <label class="campo">
        <span>Nome ou CNPJ do fornecedor no Solus</span>
        <input type="text" id="forn-busca" placeholder="ex.: YPE, COMPRE FACIL, 01.611.823">
      </label>
      <button class="botao secundario" id="forn-btn-busca">Procurar</button>
    </div>
    <div id="forn-resultados"></div>`;
  const procurar = async () => {
    const termo = $('#forn-busca').value.trim();
    if (termo.length < 2) return;
    $('#forn-resultados').innerHTML = '<p class="ajuda">Procurando...</p>';
    try {
      const { fornecedores } = await api('/api/fornecedores?busca=' + encodeURIComponent(termo));
      $('#forn-resultados').innerHTML = fornecedores.length
        ? listaDeFornecedores(fornecedores)
        : '<p class="ajuda">Nenhum fornecedor com esse nome no Solus. Cadastre na outra opção.</p>';
      ligarEscolha($('#forn-resultados'));
    } catch (erro) {
      $('#forn-resultados').innerHTML = `<div class="item-aviso erro">${escapar(erro.message)}</div>`;
    }
  };
  $('#forn-btn-busca').addEventListener('click', procurar);
  $('#forn-busca').addEventListener('keydown', (e) => { if (e.key === 'Enter') procurar(); });
  $('#forn-busca').focus();
}

function listaDeFornecedores(lista) {
  return `<div class="lista-fornecedores">${lista.map((f) => `
    <div class="opcao-fornecedor">
      <div>
        <strong>${escapar(f.nome)}</strong>
        <div class="ajuda">cód. ${escapar(f.codigo)} · ${f.semCnpj ? 'sem CNPJ no Solus' : escapar(f.cnpj)}
          ${f.cidade ? ` · ${escapar(f.cidade)}${f.uf ? '/' + escapar(f.uf) : ''}` : ''}</div>
      </div>
      <button class="botao secundario" data-escolher="${escapar(f.codigo)}"
        data-cnpj="${escapar(digitos(f.cnpj))}" data-sem-cnpj="${f.semCnpj ? '1' : ''}">É este</button>
    </div>`).join('')}</div>`;
}

function ligarEscolha(area) {
  area.querySelectorAll('[data-escolher]').forEach((botao) => {
    botao.addEventListener('click', () => escolher(botao));
  });
}

async function escolher(botao) {
  const daNota = digitos(contexto.conferencia.fornecedor?.cnpj);
  const dele = botao.dataset.cnpj;
  // outro CNPJ no Solus costuma ser outra filial da mesma empresa: deixa escolher, avisando
  if (daNota && dele && !botao.dataset.semCnpj && dele !== daNota) {
    const segue = confirm(`Esse fornecedor tem OUTRO CNPJ no Solus (${documento(dele)}).\n`
      + `A nota é do CNPJ ${documento(daNota)} — pode ser outra filial.\n\nUsar esse cadastro mesmo assim?`);
    if (!segue) return;
  }
  botao.disabled = true;
  try {
    const resposta = await api('/api/conferencia/fornecedor', {
      method: 'POST',
      body: JSON.stringify({ id: contexto.idConferencia, codigo: botao.dataset.escolher }),
    });
    avisar(resposta.cnpjGravado
      ? 'Fornecedor escolhido. O cadastro dele estava sem CNPJ e recebeu o da nota.'
      : 'Fornecedor escolhido.');
    terminou(resposta.fornecedor);
  } catch (erro) {
    avisar(erro.message, 'erro');
    botao.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Cadastrar: dados do XML (ou da Receita), tudo editavel
// ---------------------------------------------------------------------------

function painelCadastrar() {
  const f = contexto.conferencia.fornecedor || {};
  const campo = (id, rotulo, valor, dica = '', tipo = 'text') => `
    <label class="campo">
      <span>${rotulo}</span>
      <input type="${tipo}" id="${id}" value="${escapar(valor || '')}" placeholder="${escapar(dica)}">
    </label>`;

  // XML de verdade traz o cadastro inteiro: aí basta um resumo e um clique.
  // Faltando algo (nota lida por foto), o formulario ja vem aberto.
  const completo = Boolean(f.nome && f.rua && f.cidade && f.uf && digitos(f.cnpj).length >= 11);
  const cep = digitos(f.cep).length === 8 ? `${digitos(f.cep).slice(0, 5)}-${digitos(f.cep).slice(5)}` : f.cep;
  const endereco = [[f.rua, f.numero].filter(Boolean).join(', '), f.bairro,
    [f.cidade, f.uf].filter(Boolean).join('/'), cep].filter(Boolean).join(' — ');

  $('#forn-painel').innerHTML = `
    ${completo ? `
      <div id="forn-resumo">
        <div class="dados-empresa">
          <div><span>Razão social</span><strong>${escapar(f.nome)}</strong></div>
          <div><span>Endereço</span><strong>${escapar(endereco)}</strong></div>
          <div><span>Inscrição estadual</span><strong>${escapar(f.inscricaoEstadual || 'não veio na nota')}</strong></div>
        </div>
        <p class="ajuda" style="margin:0">Dados do XML da nota.
          <button class="link-acao" id="forn-editar">Corrigir algum dado</button></p>
      </div>` : ''}
    <div id="forn-formulario" class="${completo ? 'escondido' : ''}">
    <div class="linha-dupla linha-busca">
      ${campo('forn-cnpj', 'CNPJ do fornecedor', documento(f.cnpj), '00.000.000/0000-00', 'tel')}
      <button class="botao secundario" id="forn-btn-receita">Buscar na Receita</button>
    </div>
    <div id="forn-aviso-receita"></div>
    ${campo('forn-nome', 'Razão social', f.nome)}
    ${campo('forn-fantasia', 'Nome fantasia <em>(opcional)</em>', f.fantasia)}
    ${campo('forn-ie', 'Inscrição estadual <em>(ou ISENTO)</em>', f.inscricaoEstadual)}
    <div class="linha-dupla">
      ${campo('forn-rua', 'Rua / avenida', f.rua)}
      ${campo('forn-numero', 'Número', f.numero)}
    </div>
    <div class="linha-dupla">
      ${campo('forn-bairro', 'Bairro', f.bairro)}
      ${campo('forn-cep', 'CEP', f.cep, '00000-000', 'tel')}
    </div>
    <div class="linha-dupla">
      ${campo('forn-cidade', 'Cidade', f.cidade)}
      ${campo('forn-uf', 'Estado <em>(UF)</em>', f.uf, 'SP')}
    </div>
    <div class="linha-dupla">
      ${campo('forn-telefone', 'Telefone <em>(opcional)</em>', f.telefone, '', 'tel')}
      ${campo('forn-email', 'E-mail <em>(opcional)</em>', f.email, '', 'email')}
    </div>
    </div>
    <button class="botao principal largura-total" id="forn-btn-cadastrar">Cadastrar no Solus e usar nesta nota</button>`;

  if (completo) {
    $('#forn-editar').addEventListener('click', () => {
      $('#forn-resumo').remove();
      $('#forn-formulario').classList.remove('escondido');
    });
  }
  $('#forn-btn-receita').addEventListener('click', () => buscarNaReceita(true));
  $('#forn-cnpj').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarNaReceita(true); });
  $('#forn-btn-cadastrar').addEventListener('click', cadastrar);

  // nota lida por foto/PDF (ou XML sem endereco): completa sozinho pela Receita
  if (digitos(f.cnpj).length === 14 && !f.rua) buscarNaReceita(false);
}

/** CNPJ digitado: se ja esta no Solus, liga direto; senao, completa com a Receita. */
async function buscarNaReceita(digitouAgora) {
  const cnpj = digitos($('#forn-cnpj')?.value);
  const aviso = $('#forn-aviso-receita');
  if (cnpj.length !== 14 && cnpj.length !== 11) {
    if (digitouAgora) avisar('Digite os 14 números do CNPJ.', 'erro');
    return;
  }
  aviso.innerHTML = '<p class="ajuda">Consultando...</p>';
  try {
    const resposta = await api('/api/fornecedores/cnpj/' + cnpj);
    if (resposta.noSolus) {
      // a IA leu o CNPJ errado e a pessoa corrigiu: esse ja estava cadastrado
      const ligado = await api('/api/conferencia/fornecedor', {
        method: 'POST',
        body: JSON.stringify({ id: contexto.idConferencia, codigo: resposta.noSolus.codigo, cnpj }),
      });
      avisar(`Esse CNPJ já está no Solus: ${resposta.noSolus.nome}. Ficou ligado à nota.`);
      terminou(ligado.fornecedor);
      return;
    }
    if (!resposta.receita) {
      aviso.innerHTML = `<div class="item-aviso">Não consegui completar pela Receita
        (${escapar(resposta.erroReceita || 'sem resposta')}). Preencha o que souber abaixo.</div>`;
      return;
    }
    const r = resposta.receita;
    const por = { 'forn-nome': r.razaoSocial, 'forn-fantasia': r.fantasia, 'forn-ie': r.inscricaoEstadual,
      'forn-rua': r.rua, 'forn-numero': r.numero, 'forn-bairro': r.bairro, 'forn-cep': r.cep,
      'forn-cidade': r.cidade, 'forn-uf': r.uf, 'forn-telefone': r.telefone, 'forn-email': r.email };
    // o que a Receita trouxe entra; o que ela nao sabe fica como estava (o do XML)
    for (const [id, valor] of Object.entries(por)) if (valor && $('#' + id)) $('#' + id).value = valor;
    aviso.innerHTML = r.ativa === false
      ? `<div class="item-aviso erro">Atenção: essa empresa está <strong>${escapar(r.situacao)}</strong> na Receita.</div>`
      : '<p class="ajuda">Dados completados pela Receita. Confira e cadastre.</p>';
  } catch (erro) {
    aviso.innerHTML = `<div class="item-aviso erro">${escapar(erro.message)}</div>`;
  }
}

async function cadastrar() {
  const ler = (id) => ($('#' + id)?.value || '').trim();
  const dados = {
    cnpj: digitos(ler('forn-cnpj')),
    razaoSocial: ler('forn-nome'),
    fantasia: ler('forn-fantasia'),
    inscricaoEstadual: ler('forn-ie'),
    rua: ler('forn-rua'),
    numero: ler('forn-numero'),
    bairro: ler('forn-bairro'),
    cep: ler('forn-cep'),
    cidade: ler('forn-cidade'),
    uf: ler('forn-uf').toUpperCase(),
    telefone: ler('forn-telefone'),
    email: ler('forn-email'),
  };
  if (dados.cnpj.length !== 14 && dados.cnpj.length !== 11) {
    avisar('Digite o CNPJ do fornecedor (14 números).', 'erro');
    $('#forn-cnpj').focus();
    return;
  }
  if (!dados.razaoSocial) {
    avisar('Falta a razão social do fornecedor.', 'erro');
    $('#forn-nome').focus();
    return;
  }
  const faltando = [[dados.cidade, 'a cidade'], [dados.uf, 'o estado (UF)']]
    .filter(([valor]) => !valor).map(([, rotulo]) => rotulo);
  if (faltando.length && !confirm(`Falta ${faltando.join(' e ')}. Cadastrar assim mesmo?`)) return;

  const botao = $('#forn-btn-cadastrar');
  botao.disabled = true;
  botao.textContent = 'Cadastrando...';
  try {
    const resposta = await api('/api/conferencia/fornecedor/novo', {
      method: 'POST',
      body: JSON.stringify({ id: contexto.idConferencia, dados }),
    });
    avisar(resposta.jaExistia
      ? `Esse CNPJ já estava no Solus (código ${resposta.codigo}). Ficou ligado à nota.`
      : `Fornecedor cadastrado no Solus com o código ${resposta.codigo}.`);
    terminou(resposta.fornecedor);
  } catch (erro) {
    avisar(erro.message, 'erro');
    botao.disabled = false;
    botao.textContent = 'Cadastrar no Solus e usar nesta nota';
  }
}

function terminou(fornecedor) {
  contexto.conferencia.fornecedor = fornecedor;
  desenharFornecedor(contexto);
  contexto.aoMudar?.(fornecedor);
}
