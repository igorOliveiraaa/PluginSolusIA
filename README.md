# Plugin IA Solus

Plugin que conversa direto com o **Solus** (sistema de loja em Delphi, banco Firebird 2.5)
e resolve na prática três coisas que hoje dão trabalho na loja:

| O que faz | Como resolve |
|---|---|
| **Entrada de nota** | Você manda o XML, o PDF ou uma foto da nota. Ele lê, acha cada produto, calcula o custo real (com frete, IPI e ICMS-ST) e mostra "o custo era X, agora é Y" item a item. Depois de conferir, grava estoque, custo e preço. |
| **Orçamento** | Foto da lista do cliente (pode ser escrita à mão), print do WhatsApp ou texto digitado. Ele procura no estoque, pergunta quando fica em dúvida, mostra quanto aquele cliente pagou da última vez, e grava como orçamento **dentro do Solus**. |
| **Assistente** | Pergunta em português sobre a loja ("para quem vendemos isso da última vez?", "o que está parado no estoque?") e a resposta sai com os números do sistema. Dá para baixar como planilha ou PDF. |

Também cadastra cliente pelo CNPJ (busca os dados na Receita) e mostra produtos
cadastrados em duplicidade, que é o que costuma deixar o estoque negativo.

## O problema principal que ele resolve

A importação de nota do Solus lança **"1 caixa"** quando o fornecedor manda
"1 CX com 12 unidades". O estoque entra errado e o custo unitário sai errado junto.

O Plugin usa a unidade tributável da NF-e (que traz a quantidade real em unidades)
e converte: 5 caixas viram 60 unidades, com o custo por unidade correto.

## Como rodar

Precisa de **Node.js 20+** e do Firebird rodando com o banco do Solus.

```bash
npm install
npm start
```

- No próprio PC: `http://localhost:3535`
- No celular, pelo WiFi: `https://IP-DO-PC:3536` (o endereço aparece no terminal)

O acesso pelo celular usa HTTPS com certificado próprio, gerado na primeira
execução. É o que permite instalar como aplicativo e usar o botão de compartilhar.
Na primeira vez o navegador avisa que o site não é confiável — é o certificado da
própria loja; aceite uma vez por aparelho.

O PC que tem o banco precisa ficar ligado: é ele que serve o Plugin.

## Configuração

Tudo pela aba **Ajustes** dentro do próprio Plugin:

- caminho e senha do banco Firebird;
- chave da API do Google Gemini (só é usada para ler foto/PDF; XML e lista
  digitada não gastam IA);
- dados da loja, que saem no PDF do orçamento;
- regras de preço (arredondamento, margem de produto novo, se frete/IPI/ICMS-ST
  entram no custo, regime tributário).

As configurações ficam em `dados/config.json`, que **não vai para o repositório**.

## Login

Usa os mesmos usuários e senhas que já existem no Solus, e respeita as permissões
de lá (quem não pode ver custo no Solus também não vê aqui).

## Segurança

- O Plugin roda **dentro da rede da loja**. O banco não é exposto na internet.
- O assistente só faz **leitura**. Consultas passam por uma validação que bloqueia
  qualquer comando de escrita e o acesso à tabela de usuários.
- Gravações (nota e orçamento) rodam em transação e ficam registradas num
  histórico com **desfazer**.
- Nada de chave, senha, certificado ou cópia de banco entra no repositório
  (veja o `.gitignore`).

## Testes

```bash
node src/ferramentas/teste-completo.mjs       # entrada de nota, ponta a ponta
node src/ferramentas/teste-fluxo-completo.mjs # login, cliente, orçamento e PDF
node src/ferramentas/t-sql-seguro.mjs         # tentativas de comando perigoso
node src/ferramentas/confere-telas.mjs        # telas x código
```

> Os testes gravam e desfazem no banco configurado. **Aponte sempre para uma cópia**,
> nunca para o banco da loja em produção.

## Documentação

O arquivo [CLAUDE.md](CLAUDE.md) tem o mapa do código, o que foi descoberto sobre o
banco do Solus (charset, formato dos números, tabelas) e o status de cada parte.
