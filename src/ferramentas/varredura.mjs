// Varredura de problemas no codigo, sem precisar abrir o navegador.
//
// Procura:
//   1. modulo que nem carrega (erro de import, nome trocado);
//   2. coisa importada e nunca usada (sobra de refatoracao);
//   3. funcao importada que o outro arquivo nao exporta mais;
//   4. expressao regular que perdeu a barra invertida ("\d" virou "d");
//   5. TODO/FIXME esquecido e console.log de depuracao;
//   6. id do HTML procurado pelo JS que nao existe.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let problemas = 0;
const avisar = (tipo, texto) => { console.log(`  ${tipo} ${texto}`); if (tipo === 'PROBLEMA') problemas += 1; };

const arquivosDe = (pasta, filtro = /\.(js|mjs)$/) => {
  const achados = [];
  (function anda(atual) {
    for (const nome of fs.readdirSync(atual)) {
      if (['node_modules', 'dados', '.git'].includes(nome)) continue;
      const caminho = path.join(atual, nome);
      if (fs.statSync(caminho).isDirectory()) anda(caminho);
      else if (filtro.test(nome)) achados.push(caminho.split(path.sep).join('/'));
    }
  }(pasta));
  return achados;
};

// servidor.js fica de fora: importar ele SOBE o servidor (e a porta ja esta em uso)
const doServidor = arquivosDe('src')
  .filter((a) => !a.includes('/ferramentas/') && !a.endsWith('/servidor.js'));
const daTela = arquivosDe('web');
const todos = [...doServidor, ...daTela];

// ---------------------------------------------------------------------------
console.log('\n=== 1. Todo modulo do servidor carrega? ===');
for (const arquivo of doServidor) {
  try {
    await import(pathToFileURL(path.resolve(arquivo)).href);
  } catch (erro) {
    avisar('PROBLEMA', `${arquivo} nao carrega: ${erro.message}`);
  }
}
console.log(`  (${doServidor.length} arquivos conferidos)`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. Importado e nunca usado ===');
for (const arquivo of todos) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  for (const achado of codigo.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const nomes = achado[1].split(',').map((n) => n.split(' as ').pop().trim()).filter(Boolean);
    // o "..." de espalhar objeto nao e acesso a propriedade: tira antes de procurar
    const corpo = codigo.slice(achado.index + achado[0].length).split('...').join(' ');
    for (const nome of nomes) {
      // sem \b: nomes como "$" e "$$" nao tem borda de palavra
      const escapado = nome.replace(/[$]/g, '\\$');
      const usos = corpo.match(new RegExp(`(?<![\\w$.])${escapado}(?![\\w$])`, 'g'));
      if (!usos) avisar('PROBLEMA', `${arquivo}: importa "${nome}" de ${achado[2]} e nao usa`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Importa algo que o outro arquivo nao exporta ===');
const exportados = new Map();
for (const arquivo of todos) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  const nomes = new Set();
  for (const a of codigo.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) nomes.add(a[1]);
  for (const a of codigo.matchAll(/export\s*\{([^}]+)\}/g)) {
    a[1].split(',').forEach((n) => nomes.add(n.split(' as ').pop().trim()));
  }
  exportados.set(arquivo, nomes);
}

for (const arquivo of todos) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  for (const achado of codigo.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const alvo = path.join(path.dirname(arquivo), achado[2]).split(path.sep).join('/');
    const nomes = exportados.get(alvo);
    if (!nomes) continue;
    for (const bruto of achado[1].split(',')) {
      const nome = bruto.split(' as ')[0].trim();
      if (nome && !nomes.has(nome)) {
        avisar('PROBLEMA', `${arquivo}: importa "${nome}", mas ${alvo} nao exporta isso`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Expressao regular com barra invertida perdida ===');
for (const arquivo of todos) {
  fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach((linha, i) => {
    for (const r of linha.match(/\/(?![/*])(?:\[[^\]]*\]|\\.|[^/\\\n])+\/[gimsuy]*/g) || []) {
      const semClasses = r.replace(/\[[^\]]*\]/g, '');
      if (/(^|[^\\A-Za-z0-9_])[dswDSW](\{\d|\+|\*)/.test(semClasses) || /[|(]\s*\dd\b/.test(semClasses)) {
        avisar('PROBLEMA', `${arquivo}:${i + 1}  ${r}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Sobras de desenvolvimento ===');
for (const arquivo of todos) {
  fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach((linha, i) => {
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(linha)) avisar('AVISO   ', `${arquivo}:${i + 1} ${linha.trim().slice(0, 80)}`);
    if (/console\.log\(/.test(linha) && arquivo.startsWith('web/')) {
      avisar('AVISO   ', `${arquivo}:${i + 1} console.log na tela: ${linha.trim().slice(0, 60)}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Isto pega o erro mais chato de todos: a tela usa uma funcao que ela esqueceu
// de importar. O navegador so quebra na hora do clique, e ninguem percebe antes.
console.log('\n=== 5b. Usa funcao de outro arquivo sem importar ===');

const todosOsExportados = new Map();          // nome -> arquivo que exporta
for (const [arquivo, nomes] of exportados) {
  for (const nome of nomes) if (!todosOsExportados.has(nome)) todosOsExportados.set(nome, arquivo);
}

for (const arquivo of daTela) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  const importados = new Set();
  for (const a of codigo.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    a[1].split(',').forEach((n) => importados.add(n.split(' as ').pop().trim()));
  }
  const meus = exportados.get(arquivo) || new Set();
  // nomes definidos no proprio arquivo tambem valem
  for (const a of codigo.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) meus.add(a[1]);

  const chamados = new Set([...codigo.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  for (const nome of chamados) {
    if (importados.has(nome) || meus.has(nome)) continue;
    if (!todosOsExportados.has(nome)) continue;              // pode ser do navegador
    if (todosOsExportados.get(nome) === arquivo) continue;
    avisar('PROBLEMA', `${arquivo}: usa "${nome}()" sem importar (esta em ${todosOsExportados.get(nome)})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Elementos do HTML ===');
const html = fs.readFileSync('web/index.html', 'utf8');
const idsNoHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const todoJs = daTela.map((a) => fs.readFileSync(a, 'utf8')).join('\n');
const criadosNoJs = new Set([
  ...[...todoJs.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]),
  ...[...todoJs.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)].map((m) => m[1]),
]);
for (const arquivo of daTela) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  for (const id of new Set([...codigo.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]))) {
    if (!idsNoHtml.has(id) && !criadosNoJs.has(id)) {
      avisar('PROBLEMA', `${arquivo}: procura #${id}, que nao existe no HTML`);
    }
  }
}

// arquivos que o service worker promete guardar precisam existir
const sw = fs.readFileSync('web/sw.js', 'utf8');
const listados = [...(sw.match(/ARQUIVOS = \[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const nome of listados) {
  if (nome === '.') continue;
  if (!fs.existsSync(path.join('web', nome))) {
    avisar('PROBLEMA', `sw.js promete guardar "${nome}", que nao existe em web/`);
  }
}
// e o contrario: arquivo da tela que ficou de fora do service worker
for (const arquivo of daTela) {
  const nome = arquivo.replace('web/', '');
  if (nome === 'sw.js') continue;   // o proprio service worker nao se guarda
  if (!listados.includes(nome)) avisar('AVISO   ', `${nome} nao esta na lista do sw.js (nao funciona sem internet)`);
}

// os icones que o manifesto promete
const manifesto = JSON.parse(fs.readFileSync('web/manifest.json', 'utf8'));
for (const icone of manifesto.icons || []) {
  if (!fs.existsSync(path.join('web', icone.src))) {
    avisar('PROBLEMA', `manifest.json aponta para "${icone.src}", que nao existe`);
  }
}
const temPng192 = (manifesto.icons || []).some((i) => i.sizes === '192x192' && i.type === 'image/png');
const temPng512 = (manifesto.icons || []).some((i) => i.sizes === '512x512' && i.type === 'image/png');
if (!temPng192 || !temPng512) {
  avisar('PROBLEMA', 'sem PNG de 192 e 512 o celular nao oferece instalar o aplicativo');
}

console.log('\n' + (problemas ? `>>> ${problemas} PROBLEMA(S)` : '>>> NENHUM PROBLEMA ENCONTRADO'));
process.exit(problemas ? 1 : 0);
