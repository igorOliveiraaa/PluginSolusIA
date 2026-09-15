# Plugin IA Solus

Ferramentas que conversam direto com o **Solus**, o sistema de loja
(programa Delphi antigo, banco **Firebird 2.5**).

## O que é a ferramenta de hoje

**Entrada de Nota**: a pessoa manda o XML, o PDF ou uma foto da nota do fornecedor.
A ferramenta lê, casa cada item com o produto do Solus, calcula o custo real
(com frete/IPI/ICMS-ST), mostra "custo era X, agora é Y, vende por Z" item a item,
e depois de conferido grava **estoque, custo e preço** no cadastro do produto.

Problema que ela resolve: hoje a importação do Solus cadastra "1 caixa" em vez de
"12 unidades", e cadastro manual dá muito trabalho.

## Como rodar

```
npm install          # só na primeira vez  (ou dois cliques em INSTALAR.bat)
npm start            # sobe o servidor      (ou dois cliques em INICIAR-PLUGIN.bat)
```
**Segundo plano (sem janela preta na tela):** `INICIAR-ESCONDIDO.vbs` sobe o servidor
escondido, `ABRIR-PLUGIN.bat` abre no navegador (ligando antes, se precisar) e
`PARAR-PLUGIN.bat` fecha. Só o `.vbs` consegue esconder de verdade: `.bat` sempre
mostra a janela, no máximo minimizada. Em segundo plano tudo que iria para a tela vai
para `dados/plugin-log.txt`, o servidor grava o número do processo em `dados/plugin.pid`
(é assim que o PARAR acha o programa) e não abre o navegador sozinho
(`PLUGIN_SEGUNDO_PLANO=1`).

`INICIAR-COM-O-WINDOWS.bat` põe um `.vbs` na pasta de inicialização para o Plugin subir
em segundo plano quando o PC liga. `ATUALIZAR-PLUGIN.bat` baixa a versão nova do GitHub.
Abre em `http://localhost:3535`. No celular pela rede WiFi da loja, usar o IP que
aparece no terminal. O PC servidor precisa ficar ligado.

Configuração (banco, chave da IA, regras de preço) fica em `dados/config.json`,
editável pela aba **Ajustes** da própria ferramenta.

**Atualizar (dois cliques):** `ATUALIZAR-PLUGIN.bat` faz tudo sozinho — fecha o Plugin,
baixa a versão nova do GitHub (com Git se houver; senão baixa o ZIP pelo PowerShell),
copia por cima **pulando `dados`, `node_modules` e `.git`** (robocopy) e roda o
`npm install`. Nada de apagar pasta: chave da IA, lojas, histórico e logo ficam.
Testado numa pasta de mentira: `dados` intacta e 110 arquivos atualizados.

## Mapa do código

| Arquivo | O que faz |
|---|---|
| `src/servidor.js` | Servidor Express, todas as rotas da API |
| `src/config.js` | Configuração: o que é global (IA, regras) e o que é de cada loja (banco, PDF, notas) |
| `src/loja-atual.js` | Qual loja a requisição atende (AsyncLocalStorage) |
| `src/instalacoes-solus.js` | Procura os Solus do PC (BANCO.INI + .FDB) e lê a empresa de cada um |
| `src/rotas-lojas.js` | Lojas no login e tela "Configurar lojas" (só no PC servidor ou gerente) |
| `src/db/firebird.js` | Conexão, conversão de número e de acento |
| `src/db/produtos.js` | Buscar produto (barras, fornecedor, nome) e achar repetidos |
| `src/db/catalogo.js` | Indice do catalogo na memoria: a busca que ignora acento e sabe o que mais vende |
| `src/db/gravacao.js` | Gravar, igualar preço de repetidos, desativar, desfazer |
| `src/leitura/xml.js` | Ler XML da NF-e + converter caixa em unidade |
| `src/leitura/ia.js` | Ler foto/PDF com o Google Gemini |
| `src/leitura/gemini.js` | Porta única da IA: tenta de novo, usa modelo reserva e escolhe o provedor |
| `src/leitura/openai.js` | O ChatGPT por trás dessa porta: traduz o pedido e a resposta |
| `src/xlsx.js` | Escreve arquivo .xlsx (ZIP + XML na mão, sem biblioteca) |
| `src/excel-orcamento.js` | O orçamento em planilha do Excel, com fórmulas |
| `src/logica/padroes-fiscais.js` | CST, IBS/CBS e "acessa valores" que o produto precisa ter |
| `src/logica/custo.js` | Custo real com frete, IPI, ICMS-ST e crédito de imposto |
| `src/logica/precos.js` | Margem, preço sugerido e arredondamento |
| `src/logica/medidas.js` | Lê "3.70 X 2.10" no nome da venda e calcula o preço do m² |
| `src/logica/conferencia.js` | Junta tudo e monta a tela de conferência |
| `src/historico.js` | Histórico das notas aplicadas (é o que permite desfazer) |
| `src/ia/assistente.js` | O assistente: escolhe a consulta e monta a resposta |
| `src/ia/consultas.js` | As perguntas prontas (só leitura) |
| `src/ia/sql-seguro.js` | Porteiro das consultas livres da IA |
| `src/ia/exportar.js` | Resultado vira planilha (CSV) ou PDF |
| `src/db/clientes.js` | Cliente, histórico de compra e último preço pago |
| `src/db/orcamento.js` | Grava orçamento em PEDIDOS/ITEMPEDIDO (com pagamento e frete) |
| `src/db/vendas.js` | Acompanha a venda e a nota dentro do Solus (só leitura) |
| `src/tarefas.js` | O que falta fazer; some sozinho quando o Solus resolve |
| `src/danfe.js` | Monta o DANFE em PDF a partir do XML autorizado |
| `src/notas-arquivos.js` | Acha XML e PDF da nota nas pastas do ACBr/Solus |
| `src/db/operadores.js` | Login com os usuários do Solus |
| `src/leitura/cnpj.js` | Consulta de CNPJ na Receita |
| `src/leitura/lista-texto.js` | Lê lista digitada sem gastar IA |
| `src/pdf-orcamento.js` | PDF do orçamento (com o logo da loja, quando tem) |
| `src/logo.js` | O logo de cada loja: guardar, ler e apagar |
| `src/etiquetas.js` | Folha A4 de etiquetas de prateleira (uma por produto) |
| `src/orcamentos-abertos.js` | Orçamentos montados e ainda não gravados (a tela e o chat usam o mesmo) |
| `src/ia/montar-pelo-chat.js` | A única ferramenta do assistente que faz algo: monta orçamento |
| `src/https-local.js` | Certificado do HTTPS da rede |
| `web/` | A interface (PWA, funciona no celular e no PC) |
| `web/icones.js` | Ícones em SVG (sem emoji, sem biblioteca) |
| `web/instalar.js` | Instalar como aplicativo no celular e no PC |
| `web/marca.js` | O logo da loja no menu e as cores dele no Plugin inteiro |
| `web/progresso.js` | O "trabalhando nisso" com etapas (nota, orçamento e chat) |
| `web/colar.js` | Colar foto/print com Ctrl+V |
| `web/efeitos.js` | A onda no clique e os movimentos gerais |
| `web/aviso-ia.js` | Faixa de "acabou o crédito da IA" |
| `src/ferramentas/` | Scripts de teste (`varredura.mjs` caça bugs no codigo; `gerar-icones.mjs` refaz os icones) |
| `src/ferramentas/credenciais-de-teste.mjs` | Usuário/senha dos testes — vem de `dados/teste.json`, nunca do código |

## O que aprendi do banco do Solus (importante, custou trabalho descobrir)

- Banco: `C:/Solus/Solussis/BANCO/BANCO.FDB`. Na loja, no PC servidor.
  **Usar barra normal (`/`)** no caminho: o driver do Node se perde com `\`.
- **Charset NONE**: o Delphi gravou os textos em Windows-1252. O driver do Node lê
  tudo como UTF-8 e quebra o acento ("SAB?O"). A saída é pedir os bytes crus no SQL
  (`CAST(campo AS VARCHAR(n) CHARACTER SET OCTETS)`) e converter no código —
  é o que `campoTexto()` / `lerTexto()` / `gravarTexto()` fazem.
- Quase todo número é **texto em formato brasileiro** (`"1844,50"`). Estoque com
  2 casas (`"51,00"`). Campos duplicados: `PRECOCUSTO` (número) e `PC` (texto) —
  os dois precisam ser gravados.
- `MARGEM` é markup sobre o custo: `(venda - custo) / custo * 100`.
- **Produto ativo tem `STATUS` vazio**; `STATUS = 'CANCELADO'` é produto desativado.
- `ENTRADA.PRODUTO` guarda o **código de barras**, não o código interno.
- `PRODUTOFORNE` liga código do produto no fornecedor → código de barras da loja.
- `VOLUMECAIXA` existe mas na prática está vazio — **não dá para confiar nele**.
- O banco não tem trigger nenhuma, então gravação por fora é viável.
- **Dentro de uma transação, só consultar com o `executar` dela.** Consultar por
  outra conexão no meio de uma gravação trava (a leitura espera o commit e o
  commit espera a leitura).
- `PEDIDOS` + `ITEMPEDIDO` guardam venda E orçamento; o que separa é
  `PEDIDOS.STATUS` ('ORCAMENTO', 'FATURADO', 'CANCELADO').
- O próximo número de pedido vem de `CODVENDA.NUMERO` (não use MAX(NUMERO):
  existe outra faixa de numeração muito mais alta na tabela).
- `ITEMPEDIDO.PRODUTO` guarda o código de barras (ou o código, quando não tem barras).
- O login do Plugin usa a tabela `OPERADOR` do próprio Solus (mesmo usuário e senha).
- A tabela `EMPRESAS` está vazia neste banco. **O cadastro da empresa está em `PARAMETRO`**
  (RAZAO, FANTASIA, CPFCNPJ) — é por ali que se descobre de qual CNPJ é cada banco.
- O Solus diz qual banco usa no `BANCO.INI` da pasta do Solus.exe (1ª linha, às vezes
  com `servidor:` na frente).
- **Pode haver mais de um Solus no mesmo PC** (um por CNPJ), cada um com seus usuários.
  Foi o que aconteceu na loja: o Plugin abriu o banco do outro CNPJ e dava "senha
  incorreta" / "usuário não existe".
- **Venda → nota:** `PEDIDOS.NOTA` = `NF.NUMERO` (confere também o CODCLIENTE).
  `NF.NUMPEDIDO` existe mas vem vazio — não serve para ligar.
- `NF.STATUSNFE` é texto da Sefaz ("Autorizado o uso da NF-e", "NFE CANCELADA",
  "Rejeição: ..."). `NF.CHAVENFE` tem a chave e `NF.XML` o caminho do arquivo.
- Quem emite é o **ACBrMonitor**, no PC do certificado, e salva o XML em
  `C:ACBrMonitorPLUSLogs`. Para o Plugin enxergar, essa pasta precisa estar
  compartilhada na rede e cadastrada em Ajustes.
- Pagamento fica em `PEDIDOS.TIPOVENDA`, com os nomes da tabela `CONDICAO`
  (um deles começa com espaço — gravar exatamente como está lá).
- Frete: `PEDIDOS.FRETE`, e `TOTALPEDIDO = TOTALITENS + FRETE`.
- **A mesma rede tem VÁRIOS cadastros de cliente com o mesmo nome**, um por CNPJ/cidade
  (um cliente da loja tem 21). Consulta que pega só o primeiro responde errado —
  todas as consultas por nome de cliente olham em TODOS e dizem de qual cidade foi.
- **Tapete é vendido por m², mas gravado como a peça**: `ITEMPEDIDO.DESCRICAO` vira
  "TAPETE PERSONALIZADO KAPAZI 3.70 X 2.10" e `PRECO` é o valor da peça inteira
  (R$ 2.952,60). O preço do m² sai da divisão pela área — e bate exatamente com o
  cadastro "... M2". É `logica/medidas.js` que faz essa conta.
- Em venda de item personalizado a `ITEMPEDIDO.DESCRICAO` NÃO é igual à do cadastro,
  e às vezes o código da venda nem existe mais em `PRODUTO`.

## A IA: hoje e o ChatGPT (OpenAI)

- A chave fica em `dados/config.json` (fora do Git). **Chave que começa com `sk-` é da
  OpenAI**; qualquer outra é tratada como Gemini. `ia.provedor` fixa isso à mão.
- **Nada no Plugin foi reescrito para trocar de IA**: todo o código continua montando o
  pedido no formato do Gemini, e `leitura/openai.js` TRADUZ (pedido e resposta) quando a
  chave é da OpenAI. Trocar de volta é só colar a chave antiga.
- Modelos escolhidos **por teste com nota real de 60 itens** (15/09/2026):
  `gpt-5.4-mini` principal (60 itens sem erro em 16s), `gpt-4.1-mini` reserva — de outra
  família de propósito, para não cair junto — e `gpt-5.4-nano` para tarefa pequena.
- `reasoning_effort: 'none'` é o equivalente ao `thinkingBudget: 0` do Gemini (o
  "raciocínio interno" é cobrado e não ajuda a ler documento de formato fixo).
  Modelo de raciocínio **não aceita `temperature`** diferente do padrão.
- PDF vai como `{ type: 'file', file: { file_data: 'data:application/pdf;base64,...' } }`
  e foto como `image_url`. **HEIC (foto de iPhone) a OpenAI não lê** — a mensagem na tela
  pede JPG/PNG ou print.
- Conta sem saldo responde **429 `insufficient_quota`** e isso NÃO passa esperando:
  `/api/ia/situacao` marca, e a faixa vermelha do topo avisa (`web/aviso-ia.js`).
- Velocidade medida: nota de 1 item 3s, nota de 60 itens 16s, observação 1s, lista 1,6s,
  pergunta no chat 2 a 5s. No Gemini grátis era de 10 a 50s com 503 no meio.

## O que aprendi do Gemini (continua valendo como reserva)

- **Use `gemini-flash-latest`**. O `gemini-2.5-flash` aparece na lista de modelos mas
  devolve 404 "no longer available to new users" para contas novas.
- O Gemini gratuito responde **503 (sobrecarregado)** com frequência. Por isso toda
  chamada passa por `src/leitura/gemini.js`: tenta de novo e cai para
  `gemini-flash-lite-latest`.
- Com ferramentas (function calling), a fala do modelo tem que voltar **inteira** para a
  conversa: os modelos novos mandam `thoughtSignature` e dão 400 se ela sumir.
- O assistente leva de 10 a 50 segundos por pergunta no plano gratuito
  (com o raciocínio interno desligado ficou perto de 15s).
- **O modelo `-lite` RECUSA o `thinkingConfig`** e responde só "Request contains an
  invalid argument". Como o Plugin cai para o lite quando o principal bate o limite
  do dia, mandar PDF dava erro toda vez — e o erro que aparecia era esse, técnico e
  sem relação com a causa. Agora o campo nem é enviado para modelos lite, qualquer
  400 com esse campo repete sem ele, e o erro de LIMITE é o que a pessoa vê.
- **O que mais gasta não é a resposta, é o "raciocínio interno"** (thinking), cobrado
  como texto gerado. Para leitura de documento com formato fixo ele não ajuda:
  `thinkingConfig: { thinkingBudget: 0 }`. Nem todo modelo aceita o campo — por isso
  `chamarGemini` repete sem ele quando o erro 400 fala em "thinking".

## Cuidado ao editar código por linha de comando

Este ambiente **come as barras invertidas** de texto passado pelo terminal (mesmo em
heredoc com aspas). Já quebrou coisas de verdade três vezes: `/\./g` virou `/./g`
(apagava tudo em vez de só o ponto), `2\d` virou `2d` (faixa de IP que nunca casava)
e `$$` virou `$` (import quebrado). **Para editar arquivo com `\` ou `$$`, use o
editor, não o terminal.** `node src/ferramentas/varredura.mjs` acha esses casos.

## Status atual

Tudo abaixo foi **testado de ponta a ponta** numa cópia do banco real da loja
(12.275 produtos, 1.909 clientes, 89 mil pedidos). Testes em `src/ferramentas/`.

### 1. Entrada de nota — pronto
- Lê XML da NF-e (exato) e foto/PDF pela IA (Gemini).
- **Converte caixa em unidade**: item que veio "5 CX" entra como 60 unidades,
  com o custo por unidade certo. Era o problema principal.
- Casa o produto por barras → código do fornecedor → referência → nome.
- Custo real com frete, IPI e ICMS-ST, rateados quando vêm só no total.
- Preço: mostra "vende hoje por X (margem Y%)" e sugere o preço que mantém a margem.
  O arredondamento nunca puxa para baixo e não estoura em produto barato.
- Cadastra produto novo sozinho, sempre em UNIDADE.
- Produtos repetidos: mostra todos, iguala preço e/ou desativa os repetidos
  (escreve " - DESATIVADO" no nome e marca STATUS='CANCELADO'). Nada é apagado.
  O estoque entra **só** no cadastro principal.
- Avisa se a nota já foi lançada antes.
- Histórico com **desfazer** completo.
- **Campos fiscais que faltam são preenchidos** (`logica/padroes-fiscais.js`): CST 102,
  CST Cbs/Ibs 000, classificação 000001, acessa descrição N, acessa valores S, baixa
  estoque S. Só onde está VAZIO — quem já tem 500 configurado de propósito fica como
  está. Produto novo nasce com tudo (antes nascia vazio e a nota de venda era recusada).
  As colunas da reforma (IBS/CBS) são achadas pelo NOME, porque a cópia de banco usada
  no desenvolvimento é anterior a elas: rode `node src/ferramentas/campos-fiscais.mjs`
  na loja para conferir quais existem lá.
- **Observação em porcentagem** ("calcular DIFAL de 6%", "veio de outro estado 6%"):
  o próprio código lê a porcentagem, sem depender da IA, e aplica em cima do valor de
  cada item (produto − desconto + frete + IPI). Antes a IA só sabia devolver valor em
  reais e era proibida de calcular, então "6%" virava ZERO em silêncio.
- A tela de conferência abre com **"O que fiz com a sua observação"**: quanto entrou de
  DIFAL/taxa, em quantos itens, o que foi rateado e o que não foi entendido. Se a IA
  falhar, aparece em vermelho que NADA foi somado (antes era silencioso).

### 2. Orçamento — pronto
- Lê a lista do cliente por foto/print/PDF (IA) ou digitada (sem IA, de graça).
- **Busca pelo índice do catálogo** (`db/catalogo.js`): ignora acento e cedilha,
  entende que "5LT", "5 L" e "5 litros" são a mesma coisa, aguenta erro de digitação
  e **põe na frente o que a loja mais vende e o que saiu por último**. Produto
  CANCELADO cai para o fim. Na dúvida, o que **aquele cliente** já comprou ganha.
- Cada opção vem com etiqueta explicando por que apareceu ("é o que mais sai",
  "mais provável", "sem estoque", "cancelado"), para a escolha ser rápida.
- **Quando fica em dúvida, pergunta** em vez de chutar — e o item continua visível
  e destacado (não some nem fica apagado).
- Mostra os quatro números juntos: preço de tabela, **quanto aquele cliente pagou**,
  última venda da loja e custo/margem (custo só para quem tem permissão no Solus).
  Aparecem igual nos três caminhos: achado sozinho, escolhido na tela, adicionado na mão.
- Dá para **escolher o cliente depois** de montar a lista: o histórico de preço de
  todos os itens é refeito na hora (`/api/orcamento/cliente`).
- Avisa sobre estoque insuficiente e produto cancelado.
- Grava como **STATUS='ORCAMENTO'** em PEDIDOS/ITEMPEDIDO: aparece na tela de
  orçamento do Solus, e a venda/nota é finalizada por lá.
- Gera PDF (com o **logo da loja** no topo, se cadastrado em Ajustes), imprime e
  compartilha no WhatsApp (escolhendo o contato) — os botões aparecem **antes de
  gravar** também: manda para o cliente aprovar e só depois grava no Solus.
- **Excel (.xlsx)** ao lado do PDF, para o cliente que prefere planilha: mesmo conteúdo,
  com o total de cada linha e o total geral em FÓRMULA (se o cliente mudar a quantidade,
  a conta acompanha). Feito sem biblioteca nova (`src/xlsx.js` escreve o ZIP e os XML),
  porque a loja atualiza por ZIP e não roda `npm install` a cada versão.
- **Cliente sem cadastro**: dá para digitar só o nome ("Dona Maria"). O nome sai no PDF,
  no Excel, no texto do WhatsApp e no nome do arquivo
  (`orcamento-123-dona-maria.pdf`); no Solus entra como CONSUMIDOR, com o nome na
  observação do pedido para dar para achar depois. O chat também aceita.
- **Quantidade é número inteiro** — "2,4 detergente" vira 2. A exceção é o que a loja
  vende em pedaço (unidade M2, M, KG, L, ou "M2" no nome, como o tapete), que continua
  aceitando vírgula.
- **Produto parado não é sugerido**: quem não teve venda, entrada nem mudança de preço
  há mais de 2 anos (`DIAS_PARA_PARADO`) fica de fora da sugestão automática. Na
  pesquisa que a pessoa faz na mão ele aparece, marcado como "parado há X anos".
  São 7.920 dos 12.275 produtos da cópia do banco — por isso a busca melhorou tanto.

### 3. Cliente por CNPJ — pronto
- Digita o CNPJ, busca em base pública e cadastra no Solus.
- **Duas fontes, porque nenhuma tem tudo**: BrasilAPI (endereço e situação) +
  cnpj.ws (**inscrição estadual** e o tipo da rua). Reserva: open.cnpja.com.
- A rua vem completa ("RUA VOLUNTARIOS DA FRANCA", não só "VOLUNTARIOS DA FRANCA").
- **Tudo que sai na nota é editável na tela** (IE, rua, número, complemento, bairro,
  cidade, UF, CEP) e a tela avisa o que a Receita não informou — nota sem endereço
  completo é recusada pela Sefaz.
- A IE é gravada no formato que o Solus usa (em SP, `123.456.789.012`).
- Avisa se o CNPJ já existe e se a empresa não está ATIVA.

### 4. Assistente que sabe do sistema — pronto
- Pergunta em português; ele escolhe a consulta, busca no banco e responde com o
  número real. Nunca responde de cabeça.
- 13 consultas prontas (vendas, compras, histórico de preço, estoque negativo,
  parados, mais vendidos, melhores clientes, repetidos, resumo...) mais
  **consulta livre** para o que não estava previsto.
- A consulta livre passa por um porteiro (`sql-seguro.js`): só SELECT, um comando
  só, sem tabela de senha, com limite de linhas e tempo. Testado contra 8
  tentativas de comando perigoso — todas barradas.
- Respeita a permissão de custo: quem não vê custo no Solus não vê aqui.
- O resultado vira **planilha (CSV) ou PDF** com um clique — inclusive quando a
  pessoa pede "me faz um relatório de X".
- **Lucro**: pergunta "qual foi meu lucro no mês passado" e ele calcula de verdade,
  porque `ITEMPEDIDO.PRECOCUSTO` guarda o custo que a mercadoria tinha NO DIA da
  venda. Devolve faturamento, custo, lucro bruto, margem, o que deu mais lucro e o
  que saiu **abaixo do custo**. A resposta é obrigada a dizer que é **lucro BRUTO**
  (sem imposto, aluguel, folha, cartão) — senão quem lê decide em cima do número errado.
- **A conversa inteira vai junto** até apertar "Nova conversa": é o que faz "e no mês
  passado?" e "e o preço dela?" funcionarem. Ela sobrevive a trocar de aba e a recarregar
  a página (fica no `sessionStorage`, só desta janela e só de quem entrou). O teto é de
  segurança: 40 falas ou 40 mil letras, as mais antigas saem primeiro. Mensagem de erro
  não entra no contexto.
- **Monta orçamento pelo chat**: "monta um orçamento para o fulano de 10 detergente".
  É a única ferramenta dele que faz algo — e mesmo assim **não grava no Solus**:
  deixa pronto na aba Orçamento e aparece o botão "Abrir e conferir". Recusa quem
  não tem permissão de orçamento, e com nome de cliente batendo em vários cadastros
  ela devolve a lista e pergunta qual é, em vez de escolher.

### 5. Venda, nota fiscal e tarefas — pronto
- O orçamento vai para o Solus **com forma de pagamento, frete, entrega e validade**,
  já sugeridos pelo histórico do próprio cliente.
- O Plugin **acompanha sozinho** no banco: orçamento → venda faturada → nota gerada →
  nota autorizada. A aba **Tarefas** mostra o que falta e tira da lista quando o
  Solus resolve. Confere a cada 45 segundos e avisa quando a nota é autorizada.
- Com a nota autorizada, entrega o **PDF**: usa o do Solus/ACBr quando alcança a
  pasta; senão **monta o DANFE** a partir do XML (código de barras da chave,
  protocolo, itens, impostos, várias folhas). Imprime, baixa e manda no WhatsApp.
- Também vira tarefa: nota rejeitada pela Sefaz, nota cancelada, e venda para
  empresa (CNPJ) que saiu sem nota nos últimos 3 dias.
- **A emissão continua no Solus.** O Plugin não emite nada.

### 6. Observação vira cálculo — pronto
- A pessoa escreve "veio uma taxa de 50 reais a mais" ou "a caixa vem com 24".
- A **IA só entende** o que foi escrito; **o código faz a conta** (rateia o valor
  entre os itens na proporção, recalcula o custo por unidade).
- A tela mostra o que foi entendido e o que entrou em cada item, antes de gravar.

### 7. Várias lojas (um Solus por CNPJ) — pronto
- Tela **Configurar lojas**: procura todos os Solus do PC, mostra empresa, CNPJ,
  produtos, última venda e **em qual existe o usuário digitado**. Marca as lojas e salva.
- Funciona sem login, mas **só no próprio PC servidor** (ou para gerente logado).
- No login a pessoa escolhe a loja; tudo depois (consultas, gravações, histórico,
  tarefas) usa só o banco dela. Testado com 2 bancos e consultas simultâneas.
- Instalação nova sem loja configurada: o login avisa e leva para Configurar lojas.
- Config antiga (`banco` solto no topo do config.json) continua valendo como loja
  "principal".

### 8. Login e permissões — pronto
- Usa os **mesmos usuários e senhas do Solus** (tabela OPERADOR).
- Respeita as permissões do Solus (ver custo, mexer em cadastro, fazer orçamento).
- HTTPS com certificado próprio, para o celular instalar como aplicativo
  e o botão de compartilhar funcionar.
- Trava de 10 minutos depois de 5 senhas erradas (as senhas do Solus são curtas).
- **O que grava exige permissão**: lançar nota e desfazer pedem `mexerProduto`
  (ACESSACADASTRO no Solus); ajustes e logo pedem gerente. Antes qualquer um que
  entrasse podia reescrever preço e estoque da loja inteira pelo celular.
- **Custo não vaza**: quem não tem CUSTO marcado no Solus não recebe custo nem
  margem em NENHUMA resposta da API (a tela escondia, mas o número ia junto no
  JSON), a consulta de lucro é recusada, e a consulta livre da IA barra as colunas
  de custo (PRECOCUSTO, MARGEM, PC, UPRECOCUSTO, CUSTOVENDA).
- Orçamento é liberado para todos **de propósito**: PERMITEORCA está vazio para
  todo mundo neste Solus, e exigir travaria o balcão.
- ⚠️ Na loja, só quem é **gerente** (TIPO=G) ou tem "acessa cadastro" consegue
  lançar nota. Quem lança nota hoje é gerente, então segue normal. Se outra pessoa precisar,
  marque ACESSACADASTRO no usuário dela dentro do Solus.

### 9. Visual — pronto
- Vidro fosco, ícones em SVG desenhados no projeto (nenhum emoji, nenhuma
  biblioteca externa), animações curtas.
- **Paleta com várias cores** (verde da marca, teal, roxo, azul, âmbar, rosa) em vez
  de só verde: fundo com manchas que se movem devagar, topo em degradê animado,
  e cada bloco de comparação com a sua cor. Tokens `--roxo`, `--azul`, `--ambar`,
  `--rosa` no `:root`.
- A entrada em cascata dos itens roda **só na primeira montagem da lista**
  (`animarSeForAPrimeiraVez`). Antes ela rodava a cada redesenho e a tela inteira
  piscava do transparente para o opaco — era o "fica tudo apagado".
- **Chat "pesquisando"**: enquanto a IA trabalha aparecem etapas que vão ganhando
  tique, relógio de segundos, barra correndo e frases de espera (etapas diferentes
  para orçamento, lucro, relatório, cliente e estoque). As etapas andam por TEMPO
  (o servidor não manda progresso) e a última fica ativa até a resposta chegar.
  Só a fala nova anima (antes a conversa inteira piscava a cada pergunta), e o
  indicador continua girando mesmo com as animações do Windows desligadas.
- **As cores saem do LOGO da loja** (`web/marca.js`): a imagem é desenhada num
  quadradinho escondido, os pixels são agrupados por matiz e as 3 cores mais fortes
  viram o menu, o botão principal e a aurora do fundo. Sem logo, paleta padrão
  (indigo, teal e rosa). As cores ficam guardadas no navegador para a tela não piscar
  a paleta errada ao abrir. Trocar o logo em Ajustes repinta o Plugin na hora.
- **Cada tela tem a sua cor** (`--acento`): Nota azul, Orçamento violeta, Cliente âmbar,
  Tarefas rosa, Histórico ciano, Ajustes ardósia. Vale para o título do cartão, foco de
  campo, área de arquivo e botão secundário.
- **Movimento em tudo**: onda no clique (todo botão, aba e opção), cartões entrando em
  cascata a cada troca de tela, modal que abre E FECHA com movimento (fecha no Esc e
  clicando fora), hover em cartão, item, tarefa e opção, ícone da aba que cresce,
  e o contador de tarefas que pulsa quando muda.
- No celular: abas com ícone em cima, botões grandes, respeita a área segura do aparelho.
- **No PC o menu é uma barra lateral recolhida** (só os ícones, 78px) que **abre ao
  passar o mouse** e fecha sozinha, por cima do conteúdo — com o logo da loja no topo e
  "Sair" embaixo. Abre também pelo teclado (`:focus-within`).
- Respeita "reduzir animações" do sistema e tem estilo próprio para impressão.

### 10. Instalar como aplicativo (PWA) — pronto
- O celular **só oferece instalar com ícone PNG**: o manifesto tinha só SVG, e era
  por isso que instalava no PC e não no celular. Agora há `icone-192.png`,
  `icone-512.png` e `icone-maskable-512.png`, gerados por
  `node src/ferramentas/gerar-icones.mjs` (desenho em código, sem biblioteca).
- `web/instalar.js` cuida dos três casos: Android/Chrome (botão "Instalar o
  aplicativo" com o `beforeinstallprompt`), iPhone (explica Compartilhar →
  Adicionar à Tela de Início) e acesso por `http://IP` (leva para o endereço
  `https`, porque instalar só funciona em conexão segura).
- O mesmo assunto aparece na aba **Ajustes**, para quem fechou a faixa.
- A faixa é **fixa no rodapé, por cima de tudo** (z-index 120). Dentro do `<main>`
  ela ficava atrás da tela de login — e no celular ninguém via, justamente no
  primeiro acesso, que é quando se quer instalar.
- `INICIAR-COM-O-WINDOWS.bat` grava um **.vbs na pasta de inicialização**, não um
  atalho .lnk via PowerShell/COM: criar item de inicialização por COM é padrão de
  vírus e o antivírus bloqueava ("erro de permissão"). O `.vbs` também é o que
  permite subir **sem janela nenhuma** — testado neste PC: 0 janelas visíveis,
  servidor respondendo, `PARAR-PLUGIN.bat` fechando pelo `plugin.pid`.

### 11. Economia de IA — pronto
- `configEconomica()` em `leitura/gemini.js`: desliga o **"raciocínio interno"**
  do Gemini (`thinkingBudget: 0`), que é cobrado como texto gerado e não ajuda
  em nada a arrancar dados de um documento — é a maior economia possível.
  Se algum modelo não aceitar, a chamada repete sozinha sem essa parte.
- Limite de tamanho de resposta em cada tarefa (nota 8192, lista 4096,
  observação 1024, assistente 2048).
- A observação usa o modelo mais barato (`gemini-flash-lite-latest`).
- **A mesma pergunta não é paga duas vezes**: respostas ficam guardadas 15 minutos
  (reenviar a mesma foto sai de graça e na hora).
- O assistente manda só as 6 últimas falas da conversa, não 12.

### 12. Etiquetas de prateleira — pronto
- Depois de gravar a nota aparece **Imprimir etiquetas**: sai uma folha A4 com o
  preço novo dos produtos daquela nota, para papel adesivo comum.
- **Uma etiqueta por PRODUTO, não por unidade** — 20 águas de 5L viram UMA etiqueta
  da de 5L, e outra separada para a de 1L. É a regra que o dono da loja deixou clara.
- Preto e branco, preço grande (o dobro do nome), linhas de corte tracejadas
  atravessando a folha. Dois tamanhos: 24 por folha (64 x 35 mm) e 10 (96 x 56 mm),
  que batem com os adesivos picotados comuns.
- O preço é lido **fresco do cadastro** na hora de imprimir, nunca da tela.
- Conferido por dentro do PDF (`t-etiquetas-layout.mjs`): posição na grade,
  tamanho da letra, folga da borda e ausência de cor.
- **Pergunta o que imprimir antes de gerar**: só as que mudaram de preço (já vem
  marcado), todas da nota, ou escolher uma a uma. Produto cujo preço não mudou
  aparece marcado como "não mudou" — a etiqueta da prateleira ainda serve, e não
  gastar papel adesivo à toa foi pedido expresso.
- Quem sabe se mudou é o `precoMudou` que `db/gravacao.js` grava em cada registro
  (produto novo conta sempre como mudou: nunca teve etiqueta).

### 13. Colar com Ctrl+V — pronto
- Copiou o print do WhatsApp ou a foto da nota? **Ctrl+V** na aba Nota ou Orçamento e a
  imagem entra como se tivesse escolhido o arquivo (`web/colar.js`). Colar texto dentro
  de um campo continua normal: só arquivo é capturado. Print colado sempre se chama
  "image.png", então ele é renomeado para não parecer repetido.

### 14. Aviso de crédito da IA — pronto
- Conta da OpenAI sem saldo responde 429 `insufficient_quota`, e isso **não passa
  esperando**. A faixa vermelha no topo de todas as telas avisa, com o link do Billing,
  e lembra que lista digitada e XML continuam funcionando sem IA.
- A tela pergunta `/api/ia/situacao` a cada 90 segundos e na hora em que uma chamada
  falha por crédito.

### 15. XML da nota com um clique — pronto
- No Solus, exportar o XML exige ir a outra tela depois de gerar a nota. Na aba
  **Tarefas** agora tem **Baixar XML** ao lado de "Ver a nota" — sai direto da
  pasta onde o ACBr já salvou (precisa da pasta cadastrada em Ajustes).

### Pendente
- **Testar com nota e lista reais da loja** (é o próximo passo).
- **Trocar a chave da OpenAI** por uma nova (a atual foi colada numa conversa; gerar
  outra em platform.openai.com e colar em Ajustes leva 1 minuto).
- Na loja, rodar `node src/ferramentas/campos-fiscais.mjs` para conferir o nome real das
  colunas de **CST Cbs/Ibs** e **Classificação Fiscal** (não existem na cópia de teste).
- Acompanhar o **gasto da IA** em platform.openai.com → Usage nos primeiros dias.
- No celular, para instalar o aplicativo é preciso abrir pelo endereço **https**.
  Com certificado próprio o Chrome do Android não registra o service worker, então
  pode não aparecer o botão: nesse caso o caminho é o menu do navegador →
  "Adicionar à tela inicial" (a faixa na tela explica isso sozinha).
- Chave do Gemini **já configurada** neste PC (em `dados/config.json`, fora do Git).
  Na loja, colar de novo pela aba Ajustes. Assistente testado com o banco real.
- Preencher os dados da loja em Ajustes (saem no PDF do orçamento).
- Na loja: atualizar (git pull), abrir no PC servidor e usar **Configurar lojas** para
  escolher os dois Solus. Este PC de desenvolvimento aponta para `C:/SolusTeste/EC.FDB`.
- Não implementado de propósito: emitir NF-e pela ferramenta. A nota sai do Solus.
- Cadastrar em Ajustes a pasta das notas do PC do certificado (compartilhada na rede),
  senão o PDF da nota não é encontrado a partir do servidor.

## Cuidados

- **Nunca mexer no banco da loja sem backup.** Para testar, restaurar o `.FBK` numa
  cópia (`gbak -c`) e apontar a configuração para ela.
- A ferramenta **não lança a nota** nas tabelas fiscais do Solus (`CENTRADA`/`ENTRADA`).
  Ela mexe só no cadastro do produto. O lançamento fiscal continua como é hoje.
- O backup de teste usado no desenvolvimento está em `C:/SolusTeste/EC.FDB`.
