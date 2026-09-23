// Quanto tempo leva uma nota GRANDE agora que todo item procura os parecidos?
//
//   node src/ferramentas/t-nota-grande.mjs      (o Plugin precisa estar ligado)
//
// Monta um XML de 60 itens com nomes de produtos reais do banco de teste e
// mede a leitura inteira (casar produto + custo + preco + parecidos).

import { entrarComoTeste } from './login-teste.mjs';
import { consultar, campoTexto, lerTexto } from '../db/firebird.js';

let falhas = 0;
const conferir = (titulo, ok, detalhe = '') => {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${titulo}${detalhe ? ' -> ' + String(detalhe).slice(0, 140) : ''}`);
  if (!ok) falhas += 1;
};

const linhas = await consultar(
  `SELECT FIRST 60 TRIM(CODIGO) AS CODIGO, ${campoTexto('DESCRICAO', 70)}, TRIM(BARRAS) AS BARRAS
     FROM PRODUTO
    WHERE (STATUS IS NULL OR TRIM(STATUS) = '') AND BARRAS IS NOT NULL AND TRIM(BARRAS) <> ''
    ORDER BY CODIGO`
);
const produtos = linhas.map((l) => ({
  codigo: l.CODIGO,
  descricao: lerTexto(l.DESCRICAO).trim().replace(/[<>&]/g, ' '),
  barras: String(l.BARRAS || '').trim(),
}));

const itens = produtos.map((p, i) => `
<det nItem="${i + 1}"><prod>
<cProd>F-${i + 1}</cProd><cEAN>${p.barras}</cEAN>
<xProd>${p.descricao}</xProd><NCM>34011190</NCM><CFOP>5102</CFOP>
<uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>5.0000000000</vUnCom><vProd>50.00</vProd>
<cEANTrib>${p.barras}</cEANTrib><uTrib>UN</uTrib><qTrib>10.0000</qTrib>
<vUnTrib>5.0000000000</vUnTrib><indTot>1</indTot>
</prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>400</CSOSN></ICMSSN102></ICMS></imposto></det>`).join('');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe versao="4.00" Id="NFe35250912345678000199550010000099991000099998">
<ide><cUF>35</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>9999</nNF>
<dhEmi>2026-09-22T09:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>12345678000199</CNPJ><xNome>DISTRIBUIDORA TESTE LTDA</xNome>
<enderEmit><UF>SP</UF><xMun>BAURU</xMun></enderEmit></emit>
<dest><CNPJ>98765432000188</CNPJ><xNome>LOJA CLIENTE</xNome></dest>
${itens}
<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>${(produtos.length * 50).toFixed(2)}</vProd>
<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vIPI>0.00</vIPI><vST>0.00</vST>
<vOutro>0.00</vOutro><vNF>${(produtos.length * 50).toFixed(2)}</vNF></ICMSTot></total>
<transp><modFrete>0</modFrete></transp>
</infNFe></NFe></nfeProc>`;

const chamar = await entrarComoTeste();

console.log(`\n=== Nota de ${produtos.length} itens (XML, sem IA) ===`);
const envio = new FormData();
envio.append('arquivos', new Blob([xml], { type: 'text/xml' }), 'nota-grande.xml');

const comecou = Date.now();
const resposta = await chamar('/api/ler-nota', { method: 'POST', body: envio });
const resultado = await resposta.json();
const segundos = (Date.now() - comecou) / 1000;

conferir('leu a nota inteira', resultado.ok === true, resultado.erro);
if (!resultado.ok) process.exit(1);

const itensLidos = resultado.conferencia.itens;
const casados = itensLidos.filter((i) => i.produto).length;
const comParecidos = itensLidos.filter((i) => (i.irmaos || []).length).length;

conferir(`levou ${segundos.toFixed(1)}s (o limite bom e 15s)`, segundos < 15, `${segundos.toFixed(1)}s`);
conferir('casou os produtos pelo codigo de barras', casados === itensLidos.length,
  `${casados}/${itensLidos.length}`);
conferir('e ainda trouxe os parecidos de cada item', comParecidos > 0,
  `${comParecidos} itens com parecidos`);

console.log(`\n  ${(segundos / itensLidos.length * 1000).toFixed(0)} ms por item`);
console.log(falhas ? `\n>>> ${falhas} FALHA(S)` : '\n>>> TUDO CERTO');
process.exit(falhas ? 1 : 0);
