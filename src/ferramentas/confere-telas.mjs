// Confere se todo #id que o JavaScript procura existe no HTML.
// Sem isso, um id errado so aparece como tela quebrada na frente do cliente.
import fs from 'node:fs';

const html = fs.readFileSync('web/index.html', 'utf8');
const idsNoHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const arquivos = ['web/app.js', 'web/comum.js', 'web/login.js', 'web/orcamento.js',
  'web/inicio.js', 'web/instalar.js', 'web/tarefas.js', 'web/assistente.js'];
let faltando = 0;

const todoCodigo = arquivos.map((a) => fs.readFileSync(a, 'utf8')).join('\n');

// muitos elementos sao criados pelo proprio JS (botoes dentro de innerHTML),
// entao tambem vale como "existe" se o id for escrito em algum lugar do codigo
const idsCriadosNoJs = new Set([...todoCodigo.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
// e os criados na mao, tipo document.createElement + .id = 'x'
for (const achado of todoCodigo.matchAll(/\.id\s*=\s*'([a-zA-Z0-9_-]+)'/g)) {
  idsCriadosNoJs.add(achado[1]);
}

for (const arquivo of arquivos) {
  const codigo = fs.readFileSync(arquivo, 'utf8');
  const usados = [...new Set([...codigo.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]))];

  const ausentes = usados.filter((id) => !idsNoHtml.has(id) && !idsCriadosNoJs.has(id));
  if (ausentes.length) {
    faltando += ausentes.length;
    console.log(`  FALTANDO (usado em ${arquivo}, nao existe no HTML nem e criado no codigo):`);
    ausentes.forEach((id) => console.log(`     #${id}`));
  }
}

console.log(faltando
  ? `\n>>> ${faltando} ELEMENTO(S) FALTANDO`
  : '  OK   todo elemento procurado pelo JS existe no HTML ou e criado por ele');
process.exit(faltando ? 1 : 0);
