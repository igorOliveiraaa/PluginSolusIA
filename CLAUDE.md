# Plugin IA Solus

Ferramentas que conversam direto com o **Solus**, o sistema de loja do Igor
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
npm install          # só na primeira vez
npm start            # sobe o servidor
```
Abre em `http://localhost:3535`. No celular pela rede WiFi da loja, usar o IP que
aparece no terminal. O PC servidor precisa ficar ligado.

Configuração (banco, chave da IA, regras de preço) fica em `dados/config.json`,
editável pela aba **Ajustes** da própria ferramenta.

## Mapa do código

| Arquivo | O que faz |
|---|---|
| `src/servidor.js` | Servidor Express, todas as rotas da API |
| `src/config.js` | Configuração (banco, IA, regras de preço) |
| `src/db/firebird.js` | Conexão, conversão de número e de acento |
| `src/db/produtos.js` | Buscar produto (barras, fornecedor, nome) e achar repetidos |
| `src/db/gravacao.js` | Gravar, igualar preço de repetidos, desativar, desfazer |
| `src/leitura/xml.js` | Ler XML da NF-e + converter caixa em unidade |
| `src/leitura/ia.js` | Ler foto/PDF com o Google Gemini |
| `src/logica/custo.js` | Custo real com frete, IPI, ICMS-ST e crédito de imposto |
| `src/logica/precos.js` | Margem, preço sugerido e arredondamento |
| `src/logica/conferencia.js` | Junta tudo e monta a tela de conferência |
| `src/historico.js` | Histórico das notas aplicadas (é o que permite desfazer) |
| `web/` | A interface (PWA, funciona no celular) |
| `src/ferramentas/` | Scripts de teste |

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
- `OPERADOR` guarda a senha em **texto puro** — é assim que o Solus funciona.
- A tabela `EMPRESAS` está vazia neste banco; os dados da loja ficam na configuração.

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

### 2. Orçamento — pronto
- Lê a lista do cliente por foto/print/PDF (IA) ou digitada (sem IA, de graça).
- Procura cada item no estoque; **quando fica em dúvida, pergunta** em vez de chutar.
- Mostra quanto **aquele cliente** pagou da última vez, preço de tabela, custo e margem
  (custo só para quem tem permissão no Solus).
- Avisa sobre estoque insuficiente e produto cancelado.
- Grava como **STATUS='ORCAMENTO'** em PEDIDOS/ITEMPEDIDO: aparece na tela de
  orçamento do Solus, e a venda/nota é finalizada por lá.
- Gera PDF, imprime e compartilha no WhatsApp (escolhendo o contato).

### 3. Cliente por CNPJ — pronto
- Digita o CNPJ, busca na Receita (BrasilAPI) e cadastra no Solus.
- Avisa se o CNPJ já existe e se a empresa não está ATIVA.

### 4. Login e acesso — pronto
- Usa os **mesmos usuários e senhas do Solus** (tabela OPERADOR).
- Respeita as permissões do Solus (ver custo, mexer em cadastro, fazer orçamento).
- HTTPS com certificado próprio, para o celular instalar como aplicativo
  e o botão de compartilhar funcionar.

### Pendente
- **Testar com nota e lista reais da loja** (é o próximo passo).
- Configurar a chave do Gemini (aba Ajustes) — sem ela, só a lista digitada funciona.
- Preencher os dados da loja em Ajustes (saem no PDF do orçamento).
- Apontar para o banco da loja (hoje aponta para `C:/SolusTeste/EC.FDB`).
- Não implementado de propósito: emitir NF-e pela ferramenta. A nota sai do Solus.

## Cuidados

- **Nunca mexer no banco da loja sem backup.** Para testar, restaurar o `.FBK` numa
  cópia (`gbak -c`) e apontar a configuração para ela.
- A ferramenta **não lança a nota** nas tabelas fiscais do Solus (`CENTRADA`/`ENTRADA`).
  Ela mexe só no cadastro do produto. O lançamento fiscal continua como é hoje.
- O backup de teste usado no desenvolvimento está em `C:/SolusTeste/EC.FDB`.
