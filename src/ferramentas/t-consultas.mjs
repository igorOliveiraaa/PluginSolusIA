import * as c from '../ia/consultas.js';

const mostrar = (titulo, dados) => {
  console.log('\n--- ' + titulo + ' ---');
  console.log(JSON.stringify(dados, null, 1).slice(0, 900));
};

try { mostrar('Resumo da loja', await c.resumoDaLoja()); } catch (e) { console.log('FALHOU resumo:', e.message); }
try { mostrar('Ultimas vendas do SABAO EM PEDRA YPE', await c.ultimasVendasDoProduto({ termo: 'SABAO EM PEDRA YPE', quantos: 3 })); } catch (e) { console.log('FALHOU vendas:', e.message); }
try { mostrar('Ultimas compras do mesmo produto', await c.ultimasComprasDoProduto({ termo: 'SABAO EM PEDRA YPE', quantos: 3 })); } catch (e) { console.log('FALHOU compras:', e.message); }
try { mostrar('Desde quando temos o produto', await c.desdeQuandoTemOProduto({ termo: 'SABAO EM PEDRA YPE' })); } catch (e) { console.log('FALHOU desde:', e.message); }
try { mostrar('Estoque negativo', await c.produtosComEstoqueRuim({ quantos: 4, apenasNegativo: true })); } catch (e) { console.log('FALHOU estoque:', e.message); }
try { mostrar('Mais vendidos (90 dias)', await c.maisVendidos({ dias: 90, quantos: 4 })); } catch (e) { console.log('FALHOU mais vendidos:', e.message); }
try { mostrar('Melhores clientes', await c.melhoresClientes({ dias: 180, quantos: 3 })); } catch (e) { console.log('FALHOU clientes:', e.message); }
try { mostrar('Produtos repetidos', await c.produtosRepetidos({ quantos: 3 })); } catch (e) { console.log('FALHOU repetidos:', e.message); }
process.exit(0);
